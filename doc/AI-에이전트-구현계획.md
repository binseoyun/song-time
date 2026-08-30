# AI 에이전트 챗봇 구현계획

> 설계: [ADR-010](ADR/ADR-010-AI-에이전트-챗봇-설계.md) — 이 문서는 ADR-010의 결정들을 실제 작업 단위로 쪼갠 것이다. 설계 변경이 필요하면 ADR-010부터 갱신한다.
> 관련 이슈: #51(설계 검토, 이 문서로 종결)

## 진행 원칙

- 실시간 수강신청과 동일한 원칙을 따른다: naive/baseline을 먼저 만들고 측정 → 개선 → 재측정. "새 기능이라 비교 대상이 없다"고 건너뛰지 않는다(ADR-010 §14).
- Stage 단위로 이슈를 분리한다(`feat/#N-...`). 한 Stage 안에서도 항목이 크면 더 쪼갠다.
- 각 Stage 종료 시 `doc/experiment/`에 측정 결과를 남긴다.

## 전제 조건 (착수 전 확인)

- [x] 사용자가 강의계획서 PDF 제공(2026-08-27) — 소프트웨어학부 2026-2학기 19개(`C:\Users\82102\Cloudsystem\pdf`). Stage 1-1에서 전수 정독
- [x] 사용자가 최신 학기 강의 데이터(캡쳐본) 제공(2026-08-27) — Notion 강의목록 3장(소프트웨어학부). `Class` 테이블 재시딩은 별도 이슈(1-1 다음 순서)

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

- [x] 1-1. 강의계획서 19개(소프트웨어학부 2026-2) 전수 정독 → 청킹 규칙 확정(ADR-010 §13 닫음) + eval 라벨 작성 — 이슈 #87. **결정 요약**:
  - 완전히 고정된 숙명 양식(섹션 1~8, 8번=주차별 표, 1번=개요 산문). 의미검색용 본문이 얇음(과목당 ~250토큰)
  - **과목당 1청크**, 분반 병합/분리는 본문 해시로(알고리즘 001/002 병합, 경영정보시스템 001/002 분리). 19파일 → 17청크
  - 임베딩 본문 = 메타 헤더 + 개요 + 목표 + 선수과목 + 강의방법 + 주차별 주제. 오버랩 0
  - 구조화 필드(평가·주교재·선수과목·이메일·강의형태)는 **벡터 DB 페이로드(메타데이터)**(별도 SQL 테이블 없음). `get_syllabus`가 페이로드 필터로 정확 조회
  - RAG Tool 1개 → **2개**(`search_syllabus` 유사도 / `get_syllabus` 정확 조회) — ADR-010 §8 갱신
  - PDF 없는 과목 → "강의계획서 미등록" 답변 + Tool 정보만
  - eval 라벨: `backend/ai-server/eval/rag_questions.yaml` (의미검색 / 미등록 negative / 범위밖)
  - 설계 상세: Notion "AI 챗봇 RAG 결합 (Stage 1) — 강의계획서 데이터셋 설계"
- [x] (별도 이슈) `Class` 테이블 재시딩 — 이슈 #89, PR #99 머지. `seedData.js` courseData를 소프트웨어학부 2026-2 실데이터 22과목/37분반으로 교체. rag_questions.yaml 17개 course_code 전부 포함.
- [x] 1-2. 강의계획서 → `gemini-embedding-001` 비대칭 임베딩(`RETRIEVAL_DOCUMENT`) → **Qdrant** 적재 (이슈 #100). `docker-compose.yml`에 `qdrant` 서비스(호스트 포트 미노출), `requirements.txt`에 `qdrant-client`. `backend/ai-server/rag/`: `validate_syllabi.py` / `ingest.py --dry-run` / `inspect_qdrant.py list|show|query`. wipe-and-reload = `recreate_collection`. **18청크 적재 완료**(17개 course_code, 알고리즘만 분반 병합). 스팟체크 rank-1 정답률 5/5.
  - **파싱 방식 = A3 확정**(2026-08-29, 이슈 #95, ADR-010 §6 재검토): pdfplumber 파서를 지금 만들지 않고, Stage 1-1 정독 산출물을 `syllabi.yaml`(single source of truth)로 커밋 → 로더는 `YAML → 임베딩 → Qdrant`. PDF 원본은 로컬만, 커밋은 정제된 YAML만. `syllabi.yaml` 스키마 검증 스크립트 포함(필드·`grading` 합 100·`weekly_plan` 8~15주[집중학기 예외]·`course_code` `^\d{8}$`). 분반 병합은 사람이 YAML 작성 시 적용(해시 자동 병합은 A2 파서 도입 시). A2(파서 + `overrides.yaml`)는 범위 확장 시 재검토 — 트리거는 그때 논의.
  - **Qdrant 페이로드 스키마·`get_syllabus` 시그니처 확정**(이슈 #95, ADR-010 §13 재검토): `class_no`는 패딩 없는 `["1","2"]`, `grading`/`weekly_plan`은 네이티브 JSON, `class_codes` 미저장(응답에서 파생), point ID = `uuid5(NS, "{code}__{min class_no}")`, 병합 규칙 = 본문 해시 AND 교수 일치. `get_syllabus(course_code, class_no=None)` — `class_no` 타입 관대하게, 다중 청크면 되물음.
- [x] 1-3. `search_syllabus`·`get_syllabus`를 `TOOLS`에 추가 (이슈 #102). `chat/syllabus_tools.py` 신설(Qdrant 읽기, chat→rag 단방향). `search_syllabus`=top-3·threshold 없음(1-4에서 결정), `get_syllabus`=course_code 필터·`class_no` 관대·다중 청크 되물음·미등록 None·`covers` 부분 커버리지. `agent.py` SYSTEM_PROMPT는 A안(최소 2문장). 스모크 9케이스 라우팅 100%·할루시네이션 0·기존 회귀 0. 정식 hit rate·74문항 회귀는 1-4.
- [ ] 1-4. RAG 검색 hit rate 측정(정답 과목코드가 top-k 안에 들어오는 비율) + naive 베이스라인(전체 강의계획서 프롬프트 주입) Before/After — `doc/experiment/`에 원본 저장. **재시딩 선행 필요**

## Stage 2 — 스트리밍 + UI (~2~3일)

목표: 실제 채팅 UI로 완성한다. write Tool은 설계에서 배제했으므로(ADR-010 §9), `registrationRoutes` 최종안 확정 여부와 무관하게 진행 가능하다. ADR-010 §11 반영.

- [x] 2-1. `POST /api/ai/chat`을 SSE 스트리밍으로 전환(이슈 #83) — `agent.stream(stream_mode=["updates","messages"])`로 `meta`/`tool_call`/`token`/`done`/`error` 이벤트. nginx `location = /api/ai/chat`에 `proxy_buffering off`/`proxy_read_timeout 300s`, Node는 `axios` stream + `pipe`로 버퍼링 없이 통과(클라 끊기면 상류도 destroy), ai-server 응답 헤더 `X-Accel-Buffering: no`. `docker-compose.yml`(+ override)에서 `ai-server` 호스트 포트 노출 제거. → [리팩토링 02](refactoring/02-챗봇-SSE-스트리밍-전환-및-채팅-UI.md)
- [x] 2-2. 프론트 채팅 UI(이슈 #83) — "AI 상담 챗봇" 새 탭("실시간 수강신청 연습" 왼쪽). 읽기 전용(신청·취소 버튼 없음), "새 대화" + 왼쪽 세션 목록(0-4/0-5 API). `fetch` 스트림 리더로 SSE 직접 파싱(EventSource는 POST/헤더 불가). 레이아웃은 인라인 style(정적 Tailwind CSS 제약 — 트러블슈팅 03)

## Stage 3 — 가드레일 강화 + 최종 측정 (~1.5~2.5일)

목표: 프로덕션 수준의 안정성을 갖추고, Before/After 수치를 최종 정리한다.

- [ ] 3-0. Node에 사용자 단위 rate limit 미들웨어 구현(기존 Group C `redis` 사용, `redis-chat`은 `ai-server` 전용이라 안 씀 — 구조는 ADR-010 §15 확정, 윈도우 길이·허용 횟수는 실측 후 확정)
- [x] 3-1. 프롬프트/Tool 고도화 — 이슈 #82. baseline·모델비교 raw에서 발견한 갭을 닫고 gemini-3.1-flash-lite로 재측정. (a) `search_courses`에 professor 매칭 + 노이즈 토큰("교수님"·"관련"·"수업" 등) 흡수 필터 — 실사용 버그("창병모 교수님 이번학기 수업 해?" → 빈 결과) 수정, (b) 시스템 프롬프트에 관심과목 담기·강의평 거절 + "거절 시 조회 Tool 안 씀" 명시, (c) Tool description 정리. **Before/After: 답변 포함 검사 77.8→100%, Tool 선택·과잉·과소 호출·할루시네이션 전부 유지(회귀 없음), 벤치마크 70→72**. 상세: [`03-프롬프트개선-before-after.md`](experiment/03-프롬프트개선-before-after.md), Notion 보고서 06. ADR 안 만듦(구현 세부).
- [x] 3-1b. 좌석 데이터 소스 단일화 — 이슈 #86, [ADR-013](ADR/ADR-013-좌석-데이터-소스-단일화.md). 실사용 버그: 챗봇 "잔여석"이 `capacity - enrolled`(= 정원 - 관심과목 하트 수, 실시간 수강신청과 무관)였다. `GET /api/courses`·`/api/courses/:code`가 Redis `class:{id}:seats`(실시간 잔여석)와 `course_interests` 행 수(관심 등록 수)를 응답에 싣도록 하고, 챗봇 Tool이 **실시간 잔여석 / 실시간 신청자 수 / 관심 등록 수** 3개를 분리해 답하도록 `_summarize` 재구성(`enrolled` 노출 제거). 벤치마크 72→74(seats-11/12: 신청자 수 vs 관심 등록 수 분리 검증), 결정적 좌석 픽스처 `seedBenchmarkSeats.js` 추가. 상세: [`03-프롬프트개선-before-after.md`](experiment/03-프롬프트개선-before-after.md) §8.
- [ ] 3-2. Gemini API 장애 시 폴백(에러 메시지 vs 재시도) — `/recommend`는 3-4에서 제거 대상이라 다운그레이드 경로로 쓰지 않는다(ADR-010 §17 "완전 대체" 결정)
- [ ] 3-3. 최종 측정: Tool 선택 정확도 재측정, 할루시네이션 비율(수작업 샘플링), E2E p95 latency, Gemini 토큰 비용 — Stage 0/1 결과와 비교해 "가드레일 전/후" Before/After로 정리(ADR-010 §14)
- [ ] 3-4. `/recommend` 제거 — 새 챗봇이 3-3 측정까지 끝나 안정성이 검증된 뒤, 프론트 `AIRecommendation.tsx`(및 진입 탭), `backend/src/routes/aiRoutes.js`·`aiController.js`의 `/recommend` 경로, `backend/ai-server/main.py`의 `/recommend` 엔드포인트를 삭제(ADR-010 §17 "완전 대체" 결정)

## 완료 조건

- Stage 0~3 전부 완료 + 측정 결과 문서화
- `doc/experiment/03-ai-에이전트-결과.md`(가칭)에 종합 정리
- ADR-010에 "결과" 섹션 추가(실시간 수강신청 ADR들의 패턴과 동일)
