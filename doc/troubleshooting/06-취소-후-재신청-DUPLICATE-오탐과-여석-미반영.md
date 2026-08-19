# 트러블슈팅 06: 취소 후 재신청 시 DUPLICATE 오탐 + 여석이 반영되지 않는 문제

- 날짜: 2026-08-20
- Phase: Stage 2-6, 이슈 #54 (`실시간 수강신청 연습` 탭) — 기능 구현 직후 실사용 테스트에서 발견
- 관련 코드: `backend/src/services/registrationService.js`, `backend/src/worker.js`, `backend/src/controllers/registrationController.js`, `backend/src/routes/registrationRoutes.js`, `backend/src/lua/cancelAtomic.lua`, `frontend/.../RegistrationPractice.tsx`
- 관련 문서: `doc/portfolio/01-group-c-redis-설계-결정.md` §2~4, `doc/experiment/01-수강신청-동시성-naive-vs-개선-실험계획.md`

## 1. 증상 (사용자 리포트, 원문)

실제 로그인 계정("빈서윤", 컴퓨터과학과)으로 "실시간 수강신청 연습" 탭을 쓰며 세 가지를 순서대로 보고받았다.

> "수강신청 취소한 다음에 다시 수강 신청하니깐 이미 신청한 과목이라고 떠. 근데 화면에는 잘 취소된거 처럼 보이는데 이미 신청한 과목입니다. 라는 메세지가 떠."
>
> "이건 또 해결된거 같은데 이번엔 화면에 바로 안뜨네."
>
> "내가 신청해도 여석이 안줄고 그대로 있어."

세 증상 모두 코드 리뷰만으로는 재현이 안 됐다 — 겉보기엔 각 API(등록/취소/조회)가 개별적으로는 정상 응답을 주고 있었기 때문에, 실제로 Redis/MySQL/RabbitMQ 상태를 직접 열어보고 나서야 원인이 잡혔다.

## 2. 진단 과정

증상 1(취소→재신청 DUPLICATE)이 가장 재현하기 까다로웠다. 순서대로 확인한 파일:

1. `backend/src/lua/cancelAtomic.lua` — Lua 스크립트 자체 로직(SISMEMBER→SREM→INCR)은 정상이었다. 여기서 버그가 없다는 걸 먼저 배제.
2. `backend/src/services/registrationService.js`의 `cancelRedisAtomic` — MySQL 삭제를 먼저 하고, 실패해도 삼키는 구조를 확인. "MySQL 삭제가 0건이면 어떻게 되지?"라는 질문에서 의심이 시작됨.
3. `backend/src/worker.js` — 등록의 MySQL 반영이 **RabbitMQ를 통한 비동기**라는 걸 재확인(당연히 알고 있던 설계지만, 취소 로직이 이 전제를 깨고 있다는 걸 여기서 연결).
4. 이 세 파일을 나란히 놓고 나서야 "등록 직후 곧바로 취소하면 MySQL 삭제가 0건으로 끝난다"는 타이밍 버그가 보였다(§3 참고).

증상 3(여석 미반영)은 `backend/src/controllers/courseController.js`의 `getCourses`를 열어보고 30초 만에 원인이 잡혔다 — `Class.capacity`/`Class.enrolled`를 그대로 반환하고 있었고, `enrolled`를 갱신하는 곳은 `toggleInterest`(관심과목 찜하기) 하나뿐이었다. Group C 등록/취소 코드 어디에도 `Class.enrolled`를 건드리는 줄이 없었다.

## 3. 원인 분석

### 3-1) 취소 후 재신청 DUPLICATE 오탐

**문제의 핵심: 등록은 비동기(Redis 즉시 + MySQL은 나중), 취소는 동기(MySQL 먼저)라고 서로 다른 전제로 짜여 있었다.**

수정 전 `cancelRedisAtomic`:

```js
// 수정 전 — backend/src/services/registrationService.js
async function cancelRedisAtomic({ userId, classId }) {
  const deletedCount = await Registration.destroy({ where: { user_id: userId, class_id: classId } });
  if (deletedCount === 0) {
    throw new RegistrationError('NOT_FOUND', '신청 내역이 없습니다.');
  }
  // Redis 반환(redis.cancelAtomic)은 이 뒤에 — 실패해도 로그만 남기고 성공 처리
  try {
    const [code] = await redis.cancelAtomic(/* ... */);
    if (code === -1) console.warn('Redis에 신청 내역이 없어 좌석 반환을 건너뜀:', { userId, classId });
  } catch (error) {
    console.error('Redis 좌석 반환 실패:', { userId, classId, error: error.message });
  }
  return { classId };
}
```

버그가 재현되는 정확한 타임라인:

```
T0  사용자가 "신청" 클릭
    → registerRedisAtomic: Redis SADD user:{id}:registered classId  (즉시 확정, 200 응답)
    → RabbitMQ에 등록 메시지 발행 (워커가 나중에 소비)
T1  사용자가 바로 "취소" 클릭  (워커가 아직 메시지를 처리하기 전)
    → cancelRedisAtomic: Registration.destroy() 실행
    → MySQL엔 아직 INSERT가 안 됐으므로 deletedCount === 0
    → RegistrationError('NOT_FOUND') 던짐, redis.cancelAtomic()은 호출조차 안 됨
    → Redis의 user:{id}:registered는 여전히 classId를 갖고 있음
T2  뒤늦게 워커가 원래 등록 메시지를 처리 → MySQL에 INSERT (Redis 기준으론 이미 "취소됐어야 할" 신청이 뒤늦게 DB에 박힘)
T3  사용자가 같은 과목 재신청
    → registerAtomic.lua의 SISMEMBER user:{id}:registered classId → 1 (T1에서 안 지워졌으므로)
    → DUPLICATE("이미 신청한 과목입니다") 오탐
```

이 순서(MySQL 먼저)는 원래 `doc/portfolio/01-group-c-redis-설계-결정.md` §4에서 의도적으로 결정한 설계였다 — "Redis를 먼저 풀면 MySQL 삭제가 실패했을 때 이중 등록(Ghost Increment)이 생긴다"는 이유였다. 이 판단 자체는 틀리지 않았지만, **"MySQL 삭제가 실패한다"와 "MySQL 삭제 시점에 아직 그 행이 존재하지도 않는다"를 구분하지 못했다** — 후자는 등록이 비동기라는, 이 설계 문서 §3에서 이미 확정한 전제와 정면으로 충돌하는데도 놓쳤다.

### 3-2) 수강신청내역 반영 지연

3-1과 원인은 같다 — 방향만 반대다. `GET /api/registrations/redis`(수강신청내역 목록)는 MySQL을 조회하므로, 신청 성공(Redis 기준 즉시) 직후 프론트가 곧바로 이 목록을 다시 불러와도 워커가 아직 INSERT하기 전이면 화면엔 안 보인다. 실패는 아니고 "성공은 했는데 반영이 늦어 보이는" 체감 지연이다.

### 3-3) 여석 미반영

```js
// backend/src/controllers/courseController.js — 수정 안 함, 원인 확인용
exports.getCourses = async (req, res) => {
  const courses = await Class.findAll({ include: [...], order: [['id', 'ASC']] });
  res.status(200).json(courses);  // Class.capacity, Class.enrolled 그대로 반환
};
```

`Class.enrolled`를 증감시키는 코드는 저장소 전체에서 `courseController.toggleInterest`(관심과목 찜하기, 수강신청과 무관한 기능) 딱 한 곳뿐이었다. Group A(무방비)/B(비관적 락)는 `Class.remainingSeats`를 쓰고, Group C(Redis)는 애초에 MySQL의 정원 관련 컬럼을 하나도 건드리지 않는 게 설계였다(`doc/portfolio/01-group-c-redis-설계-결정.md` §2 — 실시간 판정은 Redis만 본다). 그런데 "실시간 수강신청 연습" 탭의 개설과목조회 화면은 `course.capacity - course.enrolled`로 "여석"을 계산하고 있었다 — **Group C로 등록/취소를 아무리 해도 절대 바뀔 수 없는 값을 보고 있었던 것**이다. 실제로 Stage 1 부하테스트로 이미 50/50이 찬 과목(`21001083-2`)을 조회해보면 `enrolled`는 부하테스트 이전 값 그대로였고, Redis만 정확히 0을 갖고 있었다.

## 4. 수정

### 4-1) 취소를 Redis-먼저 순서로 뒤집음

```js
// 수정 후 — backend/src/services/registrationService.js
async function cancelRedisAtomic({ userId, classId }) {
  const [code] = await redis.cancelAtomic(
    classSeatsKey(classId), classSlotsKey(classId),
    userRegisteredKey(userId), userSlotsKey(userId), classId
  );

  if (code === -1) {
    throw new RegistrationError('NOT_FOUND', '신청 내역이 없습니다.');
  }

  try {
    const deletedCount = await Registration.destroy({ where: { user_id: userId, class_id: classId } });
    if (deletedCount === 0) {
      console.warn('MySQL에 아직 반영되지 않은 신청을 취소함 (워커가 나중에 반영을 스킵함):', { userId, classId });
    }
  } catch (error) {
    console.error('MySQL 취소 반영 실패 (Redis는 이미 취소됨):', { userId, classId, error: error.message });
  }

  return { classId };
}
```

핵심은 "신청 중인가?"를 등록/취소 양쪽 모두 **Redis 하나로만** 판정하게 만든 것이다. 등록의 `registerAtomic.lua`도 `user:{id}:registered`의 `SISMEMBER`로 중복을 판정하므로, 취소도 같은 키를 같은 순서로(먼저) 다뤄야 서로 어긋나지 않는다.

### 4-2) 워커에 "처리 직전 재확인" 가드 추가

Redis를 먼저 풀면 §4-1이 막 뒤집은 그 위험(Redis는 풀렸는데 MySQL엔 안 지워진 상태)이 **원래 등록 메시지가 아직 큐에 남아있을 때**만 다시 열린다 — T1에서 취소가 Redis를 먼저 풀어버리면, T2에서 뒤늦게 도착한 등록 메시지가 그대로 INSERT돼 "Redis는 취소했다고 기억하는데 MySQL엔 유령처럼 남아있는" 고아 행이 생길 수 있다. 이 경로를 막기 위해 워커의 INSERT 직전에 Redis를 한 번 더 확인하는 가드를 추가했다.

```js
// 수정 후 — backend/src/worker.js, persist() 안
async function persist({ userId, classId, publishedAt }) {
  if (CHAOS_TEST_DELAY_MS > 0) {
    await new Promise((resolve) => setTimeout(resolve, CHAOS_TEST_DELAY_MS));
  }

  const stillRegistered = await redis.sismember(userRegisteredKey(userId), classId);
  if (!stillRegistered) {
    console.warn(`[worker] 처리 전 이미 취소된 신청 — MySQL 반영 스킵 userId=${userId} classId=${classId}`);
    return;
  }

  await Registration.create({ user_id: userId, class_id: classId });
  console.log(`[worker] MySQL 반영 완료 userId=${userId} classId=${classId} leadTimeMs=${Date.now() - publishedAt}ms`);
}
```

두 수정을 합치면 취소와 등록 메시지가 어느 순서로 도착하든 MySQL에 유령 행이 남지 않는다:

| 시나리오 | Redis | MySQL delete | 워커의 INSERT |
|---|---|---|---|
| 취소가 워커보다 먼저 도착 | 즉시 풀림(SREM) | 0건(경고만 로그, 실패 아님) | Redis 재확인 → 스킵 |
| 취소가 워커보다 나중에 도착 | 즉시 풀림(SREM) | 정상 1건 삭제 | (이미 처리됨, 해당 없음) |

### 4-3) 여석을 Redis 기준으로 재배선

```js
// 신규 — backend/src/services/registrationService.js
async function getSeatCounts(classIds) {
  if (!Array.isArray(classIds) || classIds.length === 0) return {};
  const values = await redis.mget(classIds.map(classSeatsKey));
  const result = {};
  classIds.forEach((classId, index) => {
    result[classId] = values[index] === null ? null : Number(values[index]);
  });
  return result;
}
```

```
GET /api/registrations/redis/seats?classIds=21000555-1,21001083-2,...
→ { "seats": { "21000555-1": 79, "21001083-2": 0, ... } }
```

프론트(`RegistrationPractice.tsx`)의 개설과목조회 테이블에서 `course.capacity - course.enrolled` 대신 이 값을 쓰도록 바꿨다. Redis에 아직 시딩 안 된 과목(`null`)만 기존 MySQL 계산으로 폴백한다. 신청/취소 성공 직후와 4초 주기 폴링으로 갱신하고, 여석이 0이면 "신청" 버튼을 "마감"으로 바꾸고 비활성화한다(이전엔 정원 마감 과목도 버튼이 눌려서, 클릭하면 그제서야 서버가 409로 막는 방식이었다).

### 4-4) 체감 지연 완화 — 낙관적 UI 갱신

3-2를 프론트에서 완화했다. 신청/취소가 성공하면(Redis 기준 응답이 즉시 오므로) `courses` prop에서 해당 과목 정보를 찾아 "수강신청내역" 로컬 상태에 먼저 반영해두고, 그 뒤에 `fetchMyRegistrations()`(MySQL 기준, authoritative)를 호출해 재조정한다. 워커가 아직 못 따라와도 화면은 Redis가 확정한 순간 바로 바뀐다.

## 5. 결과 (Before/After)

| | 수정 전 | 수정 후 |
|---|---|---|
| 등록 직후 곧바로 취소 | MySQL에 행이 없어 취소가 `404 NOT_FOUND`(사실상 실패), Redis는 그대로 "신청 중" | Redis 기준으로 정상 취소(`200`), 이후 워커가 INSERT 스킵 |
| 취소 후 같은 과목 재신청 | `409 DUPLICATE` 오탐 ("이미 신청한 과목입니다") | `201` 정상 등록 |
| 신청 직후 수강신청내역 화면 | 워커 반영 전이면 빈 목록/구 상태 유지 | Redis 확정 즉시 로컬에 낙관적 반영 |
| 개설과목조회 "여석" | `capacity - Class.enrolled` — Group C 등록/취소와 무관하게 고정값 | `class:{id}:seats`(Redis 실시간 값) |
| 정원 마감 과목의 "신청" 버튼 | 활성 상태로 남아있다가 클릭 시 서버가 409로 거부 | 여석 0이면 "마감"으로 비활성화 |

### 자동 테스트 (`backend/tests/registrations.test.js`, 신규 6건)

테스트 환경엔 워커 프로세스가 없어서, Redis로 등록한 직후 취소를 호출하면 **매번** "MySQL에 아직 반영 안 된 상태에서 취소"가 재현된다 — 실사용자의 "신청 후 바로 취소" 시나리오와 정확히 같은 조건이라 결정론적인 회귀 테스트로 그대로 쓸 수 있었다.

```
✓ 워커가 MySQL에 반영하기 전에 취소해도 성공하고, 재신청도 막히지 않는다
✓ 신청한 적 없는 과목을 취소하면 404를 반환한다
✓ 이미 신청한 과목을 다시 신청하면 409를 반환한다
✓ GET /api/registrations/redis/seats — Redis 좌석 카운터를 그대로 반환한다
✓ Redis에 시딩되지 않은 과목은 null을 반환한다
✓ 토큰 없이 요청하면 401을 반환한다
```

수정 전 코드로 위 첫 번째 테스트를 돌리면 재신청 단계에서 `409`가 나며 실패한다 — 버그가 실제로 재현됨을 먼저 확인한 뒤 수정했다. 전체 스위트 61건 통과(기존 55건 + 신규 6건).

### 실제 docker-compose 스택 E2E (임시 테스트 계정으로 재현)

로그인 세션의 JWT가 만료돼(1시간, `authController.js`) 브라우저로 계속 조작할 수 없었던 시점부터는 API로 직접 등록→취소→재신청 사이클을 돌리고, 각 단계마다 Redis/MySQL/RabbitMQ를 직접 조회해 대조했다.

```
1) POST /api/registrations/redis  {classId: "21000555-1"}      → 201
   Redis: SISMEMBER user:{id}:registered → 1, class:{id}:seats: 80 → 79
2) DELETE /api/registrations/redis/21000555-1                   → 200   (수정 전이었다면 404)
   Redis: SISMEMBER → 0, seats: 79 → 80
3) POST /api/registrations/redis  {classId: "21000555-1"}      → 201   (수정 전이었다면 409)
   worker_1/worker_2 로그: "[worker] MySQL 반영 완료" ×2, leadTimeMs 24ms / 89ms
4) MySQL registrations 최종 상태: user_id=488090(테스트), class_id=21000555-1 — 정확히 1행 (중복/고아 행 없음)
5) RabbitMQ: registration.persist 0 messages / 2 consumers, registration.persist.dlq 0 messages
6) GET /api/registrations/redis/seats?classIds=21000555-1        → {"21000555-1": 79}
```

취소→재신청 사이클을 반복해도 MySQL에 중복/고아 행이 남지 않고, DLQ는 0건을 유지하며, 여석 API 값이 Redis 실측치와 항상 일치함을 확인했다.

## 6. 부가 확인 — 후속 리포트 2건은 별도 버그가 아니었음

수정을 배포한 직후 같은 계정에서 두 가지를 추가로 보고받아, 코드 수정 없이 실측으로만 확인했다.

**"정원이 남아있는데 정원 초과했다고 뜬다" (`21001083-2`)**

```
docker compose exec redis redis-cli GET class:21001083-2:seats        → 0
docker compose exec redis redis-cli SISMEMBER user:485337:registered 21001083-2 → 0
```

Redis 기준 실제 잔여 좌석이 0(Stage 1 부하테스트로 50/50 등록된 과목)이고, 이 계정은 애초에 이 과목에 등록된 적도 없었다 — `정원이 초과되었습니다` 응답 자체는 정확했다. 화면에 정원이 남아 보인 건 §4-3 수정 전 프론트 번들(캐시)을 보고 있었을 가능성으로 판단하고, 서버가 실제로 새 번들(`index-3zLktpbk.js`)을 서빙 중임을 `curl`로 확인한 뒤 강력 새로고침을 안내했다.

**"이미 신청한 과목입니다가 뜨는데 신청된 걸로 보인다"**

```sql
SELECT id, user_id, class_id, created_at FROM registrations WHERE user_id=485337 ORDER BY created_at;
-- 과목당 정확히 1행씩, 중복 없음
```

MySQL/Redis 모두 과목당 정확히 1건만 존재해 실제 이중 등록은 없었다 — 이미 등록된 과목을 다시 누르면 `DUPLICATE`가 뜨고 그 과목이 계속 "신청됨"으로 보이는 건 정상 동작이었다.
