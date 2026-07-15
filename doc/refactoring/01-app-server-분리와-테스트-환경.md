# 리팩토링 01: app/server 분리, JWT fail-fast, 테스트 환경 구축

- 날짜: 2026-07-16
- Phase: 1 (안전망)
- 관련: ADR-002 (테스트 DB 전략)

## 1. app.js / server.js 분리

### Before의 문제
`src/app.js` 하나가 앱 정의(라우팅·미들웨어·모델 관계)와 서버 기동(`sequelize.sync()` → `app.listen()`)을 모두 담당했다. 이 구조에서는 **supertest로 테스트가 불가능하다**: 테스트가 `require('./app')` 하는 순간 실제 DB sync와 포트 리스닝이 발생하기 때문이다. 마지막 줄에 `module.exports = app`이 있었지만 import 부수효과 때문에 사실상 사용할 수 없는 export였다.

### After
- `src/app.js`: 순수하게 Express 앱만 정의하고 export. import 부수효과 없음.
- `src/server.js`: 환경변수 검증 → `sequelize.sync()` → `listen()`. DB 연결 실패 시 `process.exit(1)`로 명확히 죽는다(이전에는 에러 로그만 찍고 살아있는 좀비 상태 — K8s가 재시작으로 복구할 기회조차 없었음).
- 엔트리포인트 변경에 따라 `backend/Dockerfile` CMD와 루트 `docker-compose.yml` command를 `src/server.js`로 갱신. (Docker Hub의 기존 이미지는 옛 엔트리포인트를 갖고 있으므로, K8s 재배포 시 이미지 재빌드 필요 — Phase 3~4에서 진행)

## 2. JWT secret fail-fast (보안 결함 수정)

### Before의 문제
`authController.js`의 회원가입 토큰 발급이 `process.env.JWT_SECRET || 'secret'` 이었다. 환경변수 주입이 누락된 채 배포되면 **아무나 알 수 있는 키('secret')로 서명된 토큰이 발급**된다 — 공격자가 임의 사용자 ID로 토큰을 위조해 전체 계정에 접근 가능한 심각한 취약점. 더 나쁜 것은 로그인 쪽은 fallback이 없어서, 같은 누락 상황에서 회원가입은 되고 로그인은 안 되는 비대칭 동작으로 원인 추적을 어렵게 만들었다.

### After
`src/config/env.js`를 신설해 기동 시점에 필수 환경변수(`DB_*`, `JWT_SECRET`)를 검증하고, 하나라도 없으면 **서버가 뜨지 않는다**. "잘못된 설정으로 조용히 돌아가는 것"보다 "시끄럽게 죽는 것"이 낫다는 fail-fast 원칙. `authController`와 `authMiddleware`는 검증을 통과한 `JWT_SECRET`을 이 모듈에서 가져온다.

## 3. 테스트 환경

- Jest + supertest, 전용 Docker MySQL(3311, tmpfs) — 선택 근거는 ADR-002.
- `NODE_ENV=test`면 `.env` 대신 `.env.test`를 읽도록 env 로딩을 일원화 → 개발용 DB와 테스트 DB가 절대 섞이지 않음.
- 통합 테스트 19개: auth(가입/중복/로그인/오류/토큰 위조), courses(목록/관심 토글과 enrolled 증감/404/401), timetables(생성/본인 것만 조회/타인 삭제 차단/삭제).
- 실행: `npm run test:db:up` → `npm test`

## 4. 부수 정리

- 사용처가 전혀 없는 `mongoose` 의존성 제거 (MySQL 프로젝트에 MongoDB ODM이 들어있었음 — 초기 기술 선택이 바뀐 흔적)

## 결과

- Before: 테스트 0개, 테스트 불가능한 구조, JWT 위조 취약점 잠재
- After: 테스트 19개(6.8초), 앱/기동 분리로 supertest 기반 확립, 설정 누락 시 fail-fast
- 이 안전망 위에서 Phase 2(동시성 개선) 착수 가능
