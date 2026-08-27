# AI 에이전트 챗봇 구현계획

> 설계: [ADR-010](ADR/ADR-010-AI-에이전트-챗봇-설계.md) — 이 문서는 ADR-010의 결정들을 실제 작업 단위로 쪼갠 것이다. 설계 변경이 필요하면 ADR-010부터 갱신한다.
> 관련 이슈: #51(설계 검토, 이 문서로 종결)

## 진행 원칙

- 실시간 수강신청과 동일한 원칙을 따른다: naive/baseline을 먼저 만들고 측정 → 개선 → 재측정. "새 기능이라 비교 대상이 없다"고 건너뛰지 않는다(ADR-010 §14).
- Stage 단위로 이슈를 분리한다(`feat/#N-...`). 한 Stage 안에서도 항목이 크면 더 쪼갠다.
- 각 Stage 종료 시 `doc/experiment/`에 측정 결과를 남긴다.

## 전제 조건 (착수 전 확인)

- [ ] 사용자가 강의계획서 PDF 샘플 제공 — Stage 1 착수 조건
- [ ] 사용자가 최신 학기 강의 데이터(캡쳐본) 제공 — `Class` 테이블 재시딩, Stage 0 End-to-End 테스트를 실제 데이터로 하려면 필요(Tool 라우팅 자체 검증은 기존 시드 데이터로도 가능해 완전 차단은 아님)

## Stage 0 — Tool 라우팅 검증 (RAG 없이, ~2~3일)

목표: RAG 없이 순수 function calling 라우팅부터 검증한다. ADR-010 §2/§3/§8 반영.

**순서 원칙(2026-08-21 추가)**: MSA 구조(컨테이너·상태 소유권)를 먼저 확정하고, 그 위에 에이전트 로직을 짠다 — 구조는 이미 도메인 분석으로 답이 나온 결정이라 naive/baseline 측정 대상이 아니고, 나중에 옮기려면 이미 짠 코드를 갈아엎어야 해서 먼저 하는 게 비용이 싸다(ADR-010 §3 재검토 참고). 아래 0-1/0-2가 인프라, 0-3/0-4가 라우팅 뼈대, 0-5가 그 위에서 작성하는 실제 에이전트 로직이다.

- [x] 0-1. `docker-compose.yml`에 `ai-server` 전용 컨테이너 2개 신설: `redis-chat`(작업 메모리), `db-chat`(공식 `mysql:8.0` 이미지, `healthcheck` 포함) — 기존 Group C `redis`/`db`와 완전히 분리, `ai-server`가 직접 연결(Node는 관여 안 함) (ADR-010 §10 Redis/MySQL 분리) — 이슈 #66
- [x] 0-2. `ai-server`에 Alembic 마이그레이션으로 `chat_sessions`/`chat_messages` 스키마 생성(`db-chat` 대상) — `requirements.txt`의 기존 `sqlalchemy`/`mysql-connector-python` 의존성 활용 (ADR-010 §10) — 이슈 #66
- [x] 0-3. `GET /api/courses/:code`(과목 단건 조회) 신설 (ADR-010 §8, 0-1/0-2와 병렬 가능) — 이슈 #68
- [x] 0-4. Node에 프록시 라우트 3개 신설(전부 `authMiddleware`로 로그인 필수, 인증 후 `x-user-id` 신뢰 헤더를 붙여 `ai-server`로 그대로 전달): `POST /api/ai/chat`, `GET /api/ai/sessions`, `GET /api/ai/sessions/:id/messages` — 프론트는 처음부터 `ai-server`를 직접 호출하지 않고 Node를 거친다. 실제 로직은 없고 인증+프록시만 한다(ADR-010 §3/§11 최종 결정) — 이슈 #68. `ai-server`가 아직 이 경로들을 구현하지 않아(Stage 0-5) 프록시 자체는 E2E로 열리지 않음(라우팅 뼈대만 검증: 인증 게이트·에러 전파 확인)
- [x] 0-5. `ai-server`에 실제 엔드포인트 구현(이슈 #70):
  - `POST /api/ai/chat`(비-스트리밍) — LangChain(`langchain-google-genai`의 `ChatGoogleGenerativeAI` + `create_agent`) 기반 Tool 호출 루프. read-only Tool 2개 연동: `search_courses`(잔여석/키워드 검색, `GET /api/courses`), `get_course_by_code`(과목 단건 조회, 0-3) — 대기열 순번은 Tool 인벤토리에서 제외됨(ADR-010 §8). 착수 첫날 `AgentExecutor`/`create_tool_calling_agent`가 LangChain 1.x에서 완전히 제거된 걸 확인해 `create_agent`로 전환(ADR-010 §12 2026-08-23 재검토). 턴당 호출 상한은 `recursion_limit`, Tool 에러는 `create_agent` 내부 `ToolNode` 기본 동작으로 처리. 응답 완료 후 자기 소유 `db-chat`에 직접 기록(Node 왕복 없음), `redis-chat`을 작업 메모리 캐시로 사용(ADR-010 §10, 캐시 미스 시 MySQL 웜업)
  - `GET /api/ai/sessions`/`GET /api/ai/sessions/:id/messages` — Node가 넘긴 `user_id`로 `db-chat`을 직접 쿼리, 세션 소유자 검증(IDOR 방지) 포함 (ADR-010 §7/§8/§10/§12)
  - 로컬 docker-compose로 수동 E2E 검증 완료(Tool 라우팅, 멀티턴 컨텍스트, 세션 소유자 403/404, 인증 401)
- [ ] 0-6. 테스트 질문 세트 1차 작성 + Tool 선택 정확도 측정 — 이슈 #74
  - [x] 측정 하네스 `backend/ai-server/eval/`(질문 로드 → 에이전트 직접 호출(멀티턴) → tool_calls 캡처 → 자동 채점 → raw+요약), 채점 단위 테스트, 측정계획서 [`03-ai-tool-라우팅-정확도-측정계획.md`](experiment/03-ai-tool-라우팅-정확도-측정계획.md) — 지표: Tool 선택 정확도 / 파라미터 정확도 / 과잉·과소 호출 / 답변 정합성 / 안정성(5회 반복 sd) / latency / 토큰
  - [x] 질문 세트 `questions.yaml` — 70 시나리오(카테고리 7종×10), 82 turn. `seedData.js` 실측값 대조 라벨
  - [x] Gemini `gemini-3.6-flash` baseline 실측(2026-08-26, 5회 반복) → [`doc/experiment/03-결과.md`](experiment/03-결과.md) + raw. **Tool 선택 정확도 93.1%** (정보 조회 5개 카테고리 전부 100%, 할루시네이션 0건), 핵심 발견은 **범위 밖 요청(신청 대행·강의평)에 42% 과잉 Tool 호출** — Stage 3-1의 Before
  - [ ] LLM 모델 선정(GPT/Claude/Gemini/Grok) — **별도 이슈**. 위 질문 세트/지표를 그대로 재사용해 `CHAT_MODEL` 스위프. 프로바이더 팩토리(LangChain 클래스 분기) 구현부터. `.env.docker`에 `OPENAI_API_KEY` 이미 있음. 선정 이유는 새 ADR

## Stage 1 — RAG 결합 (PDF 확보 후 착수, ~3~5일)

목표: 강의계획서 의미 검색을 실제로 붙인다. ADR-010 §4/§5/§6/§13 반영.

- [ ] 1-1. 제공받은 PDF 샘플로 실제 구조 확인(주차별 계획이 표인지 텍스트인지 등) → 청킹 규칙 확정(ADR-010 §13 열린 사항을 여기서 닫음). 청크를 읽는 김에 eval용 (질문, 정답 청크) 쌍을 수동으로 함께 작성(ADR-010 §14 "eval 정답 라벨링 방법론") — 검수 부담이 크면 LLM 보조 생성으로 전환
- [ ] 1-2. `pdfplumber` 파싱 파이프라인 + `gemini-embedding-001` 임베딩 + Chroma 적재 스크립트 — 완전 수동 실행(관리자 UI 없음), 실행 시 기존 collection 전체 삭제 후 재생성(wipe-and-reload), 재적재 전 `ai-server` 컨테이너 정지 필요(동시 파일 락 충돌 방지) (ADR-010 §4 "재적재 운영 방식")
- [ ] 1-3. RAG 검색을 0-5의 `AgentExecutor`에 세 번째 Tool로 결합(별도 경로 아님, ADR-010 §12 재검토) — "이런 걸 배우고 싶은데 관련 과목 있어?" 같은 의미 기반 질문 처리. description에 "정확한 값 질문(잔여석 등)에는 쓰지 않는다"는 부정형 지시 포함(ADR-010 §8 Tool 설계 원칙)
- [ ] 1-4. RAG 검색 hit rate 측정(정답 청크가 top-k 안에 들어오는 비율) — `doc/experiment/`에 원본 저장

## Stage 2 — 스트리밍 + UI (~2~3일)

목표: 실제 채팅 UI로 완성한다. write Tool은 설계에서 배제했으므로(ADR-010 §9), `registrationRoutes` 최종안 확정 여부와 무관하게 진행 가능하다. ADR-010 §11 반영.

- [ ] 2-1. `POST /api/ai/chat`을 SSE 스트리밍으로 전환 + nginx `proxy_buffering off`/타임아웃 설정 추가. Node→`ai-server` 구간도 버퍼링 없이 청크 단위로 흘려보내도록 구현. `docker-compose.yml`에서 `ai-server`의 `ports: ["5000:5000"]` 직접 노출 제거 (ADR-010 §11)
- [ ] 2-2. 프론트 채팅 UI(기존 "실시간 수강신청 연습" 탭과 자연스럽게 연결되는 위치 검토) — 읽기 전용 상담 UI(추천/질의응답/상태 조회)로, 신청·취소 버튼은 없음. "새 대화" 버튼(0-4/0-5의 세션 목록·과거 대화 조회 API) 포함(ADR-010 §10 세션 경계 정의)

## Stage 3 — 가드레일 강화 + 최종 측정 (~1.5~2.5일)

목표: 프로덕션 수준의 안정성을 갖추고, Before/After 수치를 최종 정리한다.

- [ ] 3-0. Node에 사용자 단위 rate limit 미들웨어 구현(기존 Group C `redis` 사용, `redis-chat`은 `ai-server` 전용이라 안 씀 — 구조는 ADR-010 §15 확정, 윈도우 길이·허용 횟수는 실측 후 확정)
- [x] 3-1. 프롬프트/Tool 고도화 — 이슈 #82. baseline·모델비교 raw에서 발견한 갭을 닫고 gemini-3.1-flash-lite로 재측정. (a) `search_courses`에 professor 매칭 + 노이즈 토큰("교수님"·"관련"·"수업" 등) 흡수 필터 — 실사용 버그("창병모 교수님 이번학기 수업 해?" → 빈 결과) 수정, (b) 시스템 프롬프트에 관심과목 담기·강의평 거절 + "거절 시 조회 Tool 안 씀" 명시, (c) Tool description 정리. **Before/After: 답변 포함 검사 77.8→100%, Tool 선택·과잉·과소 호출·할루시네이션 전부 유지(회귀 없음), 벤치마크 70→72**. 상세: [`03-프롬프트개선-before-after.md`](experiment/03-프롬프트개선-before-after.md), Notion 보고서 06. ADR 안 만듦(구현 세부).
- [ ] 3-2. Gemini API 장애 시 폴백(에러 메시지 vs 재시도) — `/recommend`는 3-4에서 제거 대상이라 다운그레이드 경로로 쓰지 않는다(ADR-010 §17 "완전 대체" 결정)
- [ ] 3-3. 최종 측정: Tool 선택 정확도 재측정, 할루시네이션 비율(수작업 샘플링), E2E p95 latency, Gemini 토큰 비용 — Stage 0/1 결과와 비교해 "가드레일 전/후" Before/After로 정리(ADR-010 §14)
- [ ] 3-4. `/recommend` 제거 — 새 챗봇이 3-3 측정까지 끝나 안정성이 검증된 뒤, 프론트 `AIRecommendation.tsx`(및 진입 탭), `backend/src/routes/aiRoutes.js`·`aiController.js`의 `/recommend` 경로, `backend/ai-server/main.py`의 `/recommend` 엔드포인트를 삭제(ADR-010 §17 "완전 대체" 결정)

## 완료 조건

- Stage 0~3 전부 완료 + 측정 결과 문서화
- `doc/experiment/03-ai-에이전트-결과.md`(가칭)에 종합 정리
- ADR-010에 "결과" 섹션 추가(실시간 수강신청 ADR들의 패턴과 동일)
