# 트러블슈팅 06: 취소 후 재신청 시 DUPLICATE 오탐 + 여석이 반영되지 않는 문제

- 날짜: 2026-08-20
- Phase: Stage 2-6, 이슈 #54 (`실시간 수강신청 연습` 탭) — 기능 구현 후 실사용 테스트에서 발견
- 관련: `doc/portfolio/01-group-c-redis-설계-결정.md` §4, `backend/src/services/registrationService.js`, `backend/src/worker.js`

## 증상 (사용자 리포트)

실사용 계정으로 "실시간 수강신청 연습" 탭을 쓰다가 세 가지를 보고받았다.

1. 수강신청을 취소한 직후 같은 과목을 다시 신청하면 "이미 신청한 과목입니다"가 뜬다. 그런데 화면에는 방금 취소가 정상 처리된 것처럼 보였다.
2. (위 문제를 고치는 과정에서 관찰) 신청 직후 "수강신청내역" 테이블에 방금 신청한 과목이 바로 나타나지 않는다.
3. 수강신청에 성공해도 개설과목조회 테이블의 "여석"이 줄어들지 않는다.

## 원인 분석

### 1) 취소 후 재신청 DUPLICATE 오탐 — MySQL과 Redis의 반영 시점이 다르다는 걸 놓침

Group C 등록 흐름(`registerRedisAtomic`)은 **Redis만 동기로 확정**하고 MySQL 반영은 RabbitMQ 워커가 비동기로 처리한다(`doc/portfolio/01-group-c-redis-설계-결정.md` §3). 반면 기존 취소 흐름(`cancelRedisAtomic`)은 다음 순서였다.

```js
// 수정 전
async function cancelRedisAtomic({ userId, classId }) {
  const deletedCount = await Registration.destroy({ where: { user_id: userId, class_id: classId } });
  if (deletedCount === 0) {
    throw new RegistrationError('NOT_FOUND', '신청 내역이 없습니다.');
  }
  // ...Redis 반환은 이 뒤에
}
```

MySQL 삭제가 0건이면 **Redis를 건드리지도 않고** `NOT_FOUND`로 끝난다. 그런데 등록 직후 곧바로 취소하면(실사용자가 "신청 눌렀다가 바로 취소" 하는 흔한 패턴), 워커가 아직 MySQL에 INSERT하지 않은 시점에 취소가 먼저 도착할 수 있다 — 이 경우 `deletedCount === 0`이 되어 Redis의 `user:{userId}:registered`가 전혀 안 풀린 채로 취소 요청이 끝난다. 다음에 같은 과목을 재신청하면 `registerAtomic.lua`의 `SISMEMBER` 체크가 여전히 1이라 `DUPLICATE`("이미 신청한 과목입니다")로 오탐한다.

원래 이 순서(MySQL 먼저)는 의도적인 설계였다(`doc/portfolio/01-group-c-설계-결정.md` §4) — Redis를 먼저 풀면 MySQL 삭제가 실패했을 때 "Redis는 비었는데 MySQL엔 남아있는" 이중 등록(Ghost Increment)이 생길 수 있다는 이유였다. 하지만 그 설계는 **등록이 MySQL에 이미 반영돼 있다는 걸 전제**로 했고, 실제로는 등록 자체가 비동기라 그 전제가 항상 성립하지 않았다.

### 2) 수강신청내역 반영 지연 — 위와 같은 원인, 반대 방향

`GET /api/registrations/redis`(수강신청내역 목록)는 MySQL을 조회한다. 신청 성공 직후 프론트가 이 목록을 다시 불러와도, 워커가 아직 INSERT하기 전이면 빈 목록/이전 상태가 그대로 보인다. Redis 기준으로는 이미 확정된 신청인데 화면엔 안 보이는, "성공했는데 반영 안 된 것처럼 보이는" 체감 지연이다.

### 3) 여석 미반영 — 애초에 다른 컬럼을 보고 있었다

`GET /api/courses`(`courseController.getCourses`)는 `Class.capacity`/`Class.enrolled`를 그대로 반환한다. `Class.enrolled`는 `courseController.toggleInterest`(관심과목 찜하기, 무관한 기능)만 건드리고, **Group C 등록/취소 경로는 이 컬럼을 아예 참조하지 않는다**(`doc/portfolio/01-group-c-redis-설계-결정.md` §2 — 실시간 좌석의 유일한 소스는 Redis `class:{classId}:seats`). 개설과목조회 화면이 `course.capacity - course.enrolled`로 "여석"을 계산했으니, Group C로 아무리 신청/취소해도 이 값은 절대 바뀌지 않는 게 당연했다 — 애초에 실시간 좌석 데이터를 안 보고 있었다.

## 수정

### 취소를 Redis-먼저로 뒤집고, 워커에 취소 확인 가드 추가

`cancelRedisAtomic`을 등록과 대칭으로 맞췄다 — **Redis가 register/cancel 양쪽 모두에서 "지금 신청 중인가"의 유일한 실시간 판정 기준**이 되도록.

```js
// 수정 후 (backend/src/services/registrationService.js)
async function cancelRedisAtomic({ userId, classId }) {
  const [code] = await redis.cancelAtomic(/* ... */);
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

이 순서를 뒤집으면 §4에서 우려했던 "Redis는 풀렸는데 MySQL 삭제가 안 된" 상태가 다시 생길 수 있다 — 다만 이번엔 그게 **원래 등록 메시지가 아직 큐에 있을 때**만 발생한다(등록이 이미 MySQL에 반영된 뒤라면 delete는 정상적으로 그 행을 지운다). 그 유일한 경로를 막기 위해 워커에 가드를 추가했다.

```js
// backend/src/worker.js — persist() 안, INSERT 직전
const stillRegistered = await redis.sismember(userRegisteredKey(userId), classId);
if (!stillRegistered) {
  console.warn(`[worker] 처리 전 이미 취소된 신청 — MySQL 반영 스킵 userId=${userId} classId=${classId}`);
  return;
}
await Registration.create({ user_id: userId, class_id: classId });
```

큐에 있던 등록 메시지를 워커가 처리하려는 시점에 Redis가 이미 "취소됨"으로 알고 있다면(=사용자가 워커보다 먼저 취소했다면) INSERT를 건너뛴다. 그 결과:

- 취소가 등록 메시지 처리보다 **먼저** 와도: Redis 먼저 풀림 → MySQL delete는 0건(아직 없음, 경고만 로그) → 뒤늦게 도착한 등록 메시지는 워커가 Redis를 다시 확인해 스킵 → 고아 행 없음.
- 취소가 등록 메시지 처리보다 **나중**에 와도: 기존과 동일하게 정상 delete.

두 경우 모두 MySQL에는 "Redis가 기억 못 하는" 유령 행이 남지 않는다.

### 여석을 Redis 기준으로 다시 배선

`GET /api/registrations/redis/seats?classIds=...`(신규)가 `class:{classId}:seats`를 `MGET`으로 조회해 반환하도록 추가하고, 프론트(`RegistrationPractice.tsx`)의 개설과목조회 테이블이 `course.capacity - course.enrolled` 대신 이 값을 쓰도록 바꿨다. 아직 Redis에 시딩되지 않은 과목은 `null`을 반환해 기존 MySQL 계산으로 폴백한다. 등록/취소 직후와 4초 주기 폴링으로 갱신하고, 여석이 0이면 신청 버튼을 "마감"으로 비활성화한다.

### 체감 지연 완화 — 낙관적 UI 갱신

신청/취소 성공 응답(Redis 기준, 즉시 옴)을 받는 시점에 `courses` prop에서 해당 과목 정보를 찾아 "수강신청내역" 로컬 상태에 먼저 반영하고, 그 뒤에 `fetchMyRegistrations()`(MySQL 기준, authoritative)로 재조정한다. 워커가 늦어도 화면은 Redis가 확정한 순간 바로 갱신된다.

## 검증

### 자동 테스트 (`backend/tests/registrations.test.js`, 신규 3건 추가)

테스트 환경엔 워커 프로세스가 없어서, Redis로 등록한 직후 취소를 호출하면 **항상** "MySQL에 아직 반영 안 된 상태에서 취소"가 재현된다 — 실사용자의 "신청 후 바로 취소" 시나리오와 동일한 조건이라 회귀 테스트로 그대로 쓸 수 있었다.

```
✓ 워커가 MySQL에 반영하기 전에 취소해도 성공하고, 재신청도 막히지 않는다
✓ 신청한 적 없는 과목을 취소하면 404를 반환한다
✓ 이미 신청한 과목을 다시 신청하면 409를 반환한다
✓ GET /api/registrations/redis/seats — Redis 좌석 카운터를 그대로 반환한다
```

수정 전 코드로 첫 번째 테스트를 돌리면 재신청 단계에서 409(DUPLICATE)가 나 실패한다 — 버그가 실제로 재현됐다는 뜻이다. 전체 스위트 61건 통과(기존 55건 + 신규 6건).

### 실제 docker-compose 스택 E2E (임시 테스트 계정)

```
1) POST /api/registrations/redis  {classId: "21000555-1"}  → 201
   Redis: SISMEMBER user:{id}:registered → 1, class:{id}:seats: 80→79
2) DELETE /api/registrations/redis/21000555-1               → 200
   Redis: SISMEMBER → 0, seats: 79→80
3) POST /api/registrations/redis  {classId: "21000555-1"}  → 201 (수정 전이었다면 409)
   worker_1/worker_2 로그: "MySQL 반영 완료" ×2, leadTime 24ms/89ms
4) MySQL registrations 최종 상태: user_id=485337(테스트), class_id=21000555-1 — 정확히 1행
5) RabbitMQ: registration.persist 0 messages / 2 consumers, .dlq 0 messages
6) GET /api/registrations/redis/seats?classIds=21000555-1 → {"21000555-1": 79}
```

취소→재신청 사이클 후에도 MySQL에 중복/고아 행 없음, DLQ 0건, 여석 API가 Redis 값과 일치함을 확인했다.
