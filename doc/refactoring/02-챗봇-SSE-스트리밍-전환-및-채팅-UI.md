# 리팩토링 02: 챗봇 SSE 스트리밍 전환 + 프론트 채팅 UI

- 날짜: 2026-08-27
- 트랙: AI 에이전트 챗봇(로드맵 외 작업) — Stage 2 (`doc/AI-에이전트-구현계획.md`)
- 관련: [ADR-010](../ADR/ADR-010-AI-에이전트-챗봇-설계.md) §9/§11, 이슈 #31/#83
- 병렬 작업: Stage 3-1(#82)이 `chat/tools.py`·`chat/agent.py`·`chat/message_utils.py`를 동시에 수정 중 —
  이 작업은 `chat/router.py`·`main.py`·`docker-compose.yml`·`nginx/`·`frontend/`만 건드린다.

## 배경

`POST /api/ai/chat`은 Stage 0-5에서 비-스트리밍(`agent.invoke` → 완성된 응답 1건 JSON 반환)으로
구현됐다. 턴당 응답 생성에 p50 1.7s(ADR-012 기준), Tool을 부르면 3~4s가 걸리는데 그동안 화면은
빈 상태다. 실제 채팅 UX로 완성하는 것이 Stage 2의 목표다.

설계는 이미 ADR-010 §11에서 **SSE**로 결정됐다(Polling은 타이핑 효과 불가, WebSocket은 Stateful
확장성 문제 — ADR-006 1.4의 대기열 통신 방식 결정과 같은 논리). 이 문서는 그 결정의 구현 기록이다.

## 1. `POST /api/ai/chat` — SSE 스트리밍 전환 (2-1)

### 전환 방식

`create_agent`(LangChain 1.x)는 내부적으로 LangGraph `StateGraph`를 컴파일해 반환한다(ADR-010 §12).
그래서 `agent.invoke` 대신 `agent.stream(..., stream_mode=["updates", "messages"])`로 두 채널을 동시에 받는다.

| stream_mode | 쓰임 |
|---|---|
| `messages` | LLM 토큰이 생성되는 대로 `(AIMessageChunk, metadata)`로 옴 → `token` 이벤트로 흘려보냄 |
| `updates` | 노드 실행 단위 결과 → `AIMessage.tool_calls`를 잡아 `tool_call` 이벤트로 알리고, 끝난 뒤 전체 메시지를 모아 `message_utils.extract_tool_calls`로 최종 관측값을 직렬화 |

`message_utils.py`(#82 조율 대상)는 **읽기만** 한다 — `extract_text`/`extract_tool_calls`를 그대로 재사용해
비-스트리밍 때와 동일한 형식으로 db-chat에 기록한다.

### SSE 이벤트 스킴

```
event: meta       data: {"session_id": "..."}          # 새 대화면 프론트가 여기서 세션 ID를 처음 안다
event: tool_call  data: {"tool": "...", "tool_input": {...}}   # UX 피드백용 (관측값은 안 실음)
event: token      data: {"text": "..."}                # 최종 답변 증분
event: done       data: {"session_id": "...", "tool_calls": [...]}   # 관측값 포함 최종
event: error      data: {"detail": "..."}              # 스트림 도중 예외 (이미 200을 보내 상태코드로는 못 알림)
```

### 검증·이력 로딩은 스트림 시작 전에

`StreamingResponse`가 시작되면 HTTP 상태코드를 못 바꾼다. 그래서 세션 소유자 검증(401/403/404)과
Redis/MySQL 이력 로딩은 엔드포인트 함수 본문에서 끝내고, 그 뒤에 `StreamingResponse`를 반환한다.

### DB 세션 수명

제너레이터는 엔드포인트 함수가 리턴한 **뒤에** 실행되므로, 그때쯤 FastAPI 의존성(`get_db`)이 이미
닫혔을 수 있다. 스트림 종료 후 기록은 제너레이터 안에서 `SessionLocal()`로 새 세션을 열어 처리한다.

### `docker-compose.yml` — `ai-server` 포트 노출 제거

`ports: ["5000:5000"]`을 삭제했다(ADR-010 §11, 이슈 #31/#83). 정상 경로가 전부 nginx→Node를 거치므로
(인증·rate limit), 이 포트가 열려 있으면 인증을 우회해 Gemini 토큰 비용을 유발시킬 수 있는 표면만 남는다.
이 격리가 `x-user-id` 신뢰 헤더 방식의 보안 전제이기도 하다. 워크트리용
`docker-compose.override.yml`에서도 다시 열지 않는다.

### 버퍼링 해제 — 3중 방어

스트리밍 효과는 경로상의 **모든** 구간이 버퍼링을 안 해야 산다.

1. **nginx** (`nginx/default.conf`): `location = /api/ai/chat` 블록 신설(`/api/` 보다 먼저 매칭).
   `proxy_buffering off` / `proxy_cache off` / `proxy_read_timeout 300s` / `proxy_http_version 1.1`.
   채팅도 정상 경로는 Node(`backend_pool`)를 거친다 — ai-server 직결이 아니다.
2. **Node** (`aiController.js`): `axios` `responseType: 'stream'`으로 받아 `upstream.data.pipe(res)`.
   `res.flushHeaders()` + `X-Accel-Buffering: no`. 클라이언트가 끊으면 `req.on('close')`로 상류 스트림도
   `destroy()`해서 Gemini 토큰 낭비를 막는다.
3. **ai-server** (`router.py`): 응답 헤더에 `X-Accel-Buffering: no` (nginx 설정과 이중 방어).

## 2. 프론트 채팅 UI (2-2)

### 배치 결정 — 새 탭 "AI 상담 챗봇"

기존 "실시간 수강신청 연습" 탭 **왼쪽**에 새 탭을 뒀다. "실시간 수강신청 연습" 안의 패널로 넣는 것도
검토했으나, 챗봇은 로그인만 필요하고 대기열·Active 상태와 무관하게 항상 쓸 수 있어야 해서 독립 탭이 맞다.
Stage 3-4에서 `/recommend`와 "AI 수업 추천" 탭이 제거되면(ADR-010 §17 "완전 대체") 이 탭이 그 자리를
잇는다.

### 읽기 전용

신청·취소 버튼은 없다(write Tool 배제, ADR-010 §9). "새 대화" 버튼 + 왼쪽 세션 목록(GET
`/api/ai/sessions`, `/api/ai/sessions/:id/messages`)으로 과거 대화를 다시 연다.

### SSE 파싱

`EventSource`는 POST·커스텀 헤더(`Authorization`)를 못 실어서 못 쓴다. `fetch` +
`response.body.getReader()`로 직접 읽고 `\n\n` 경계로 프레임을 잘라 파싱한다. 확정 답변은 상태 갱신
타이밍에 의존하지 않도록 스트림 루프 안에서 로컬 변수로도 누적한 뒤, 종료 시 메시지 배열에 커밋한다.

### 레이아웃은 인라인 style

이 프로젝트의 `frontend/.../src/index.css`는 **빌드타임에 고정된 Tailwind v4 산출물**이다(툴체인 없음,
`main.tsx`가 이 정적 파일만 import). 코드베이스에 이미 쓰인 유틸리티 클래스만 CSS에 존재하고, 새 클래스는
생성되지 않는다 — [트러블슈팅 03](../troubleshooting/03-회원-탈퇴-버튼-미표시-Tailwind-정적-CSS-누락.md)에서
이미 겪은 함정이다. 그래서 구조(flex 방향·높이·스크롤·grid)는 전부 인라인 `style`로 짜고, 색/타이포/보더/
라운드/섀도만 기존 클래스를 쓴다.

## 검증 (로컬 docker-compose, `COMPOSE_PROJECT_NAME=songtime-s2`)

`docker compose exec ai-server alembic upgrade head` 후:

- SSE 파이프라인 E2E (nginx :8190 → Node → ai-server): `meta`→`token`(증분)→`done` 순서 확인,
  첫 토큰 1.37s / 총 10청크 1.85s → 버퍼링 해제 확인
- `tool_call` 이벤트: `get_course_by_code` 호출이 토큰보다 먼저 도착, `done`에 `observation` 포함
- 멀티턴: 같은 `session_id`로 2턴, "그 중 1분반은 몇시에 해?"가 직전 턴 컨텍스트(알고리즘 21000549-1)를
  이어받아 스케줄 조회
- 영구 기록: db-chat `chat_messages`에 user/assistant + `tool_calls` JSON 저장 확인
- 세션 소유자: 없는 세션 404, 무인증 `POST /api/ai/chat` 401
- `ai-server` 호스트 포트 미노출 확인 (`docker compose config` → `ports: None`)
- 브라우저(신규 탭): 질문 입력 → 스트리밍 렌더 → 세션 목록 갱신, 멀티턴, "새 대화" 동작 확인

## Before / After

| | Before (Stage 0-5) | After (Stage 2) |
|---|---|---|
| 응답 방식 | `agent.invoke`, 완성 후 JSON 1건 | SSE 스트림(`meta`/`tool_call`/`token`/`done`/`error`) |
| 체감 지연 | 턴당 전체 대기(1.7~4s 빈 화면) | 첫 토큰 ~1.4s 후 타이핑 렌더 |
| 프론트 | 없음(`/recommend` 단발 UI만) | "AI 상담 챗봇" 탭 — 세션 목록·멀티턴·읽기 전용 상담 |
| `ai-server` 노출 | `5000:5000` 호스트 바인딩(인증 우회로) | 미노출, Docker 내부망 한정 |

## 남은 것

- 마크다운 렌더링은 안 함(어시스턴트 응답의 `**bold**`가 평문). Stage 범위 밖 — 필요하면 별도 이슈.
- Node rate limit(3-0), 범위 밖 질문 거절(3-1)은 Stage 3.
