# 프로젝트 고도화 & 포트폴리오 로드맵

## 진행 상황 (매 작업 후 갱신)

- [x] 로드맵 수립 (2026-07-15)
- [x] **Phase 1. 안전망** (2026-07-16 완료)
  - [x] 레포 이전: 팀 레포 → `binseoyun/song-time` orphan 스냅샷 ([ADR-001](ADR/ADR-001-레포-이전-및-시크릿-정리.md), 2026-07-16)
  - [x] `.env.example` 템플릿 3종 작성 (2026-07-16)
  - [x] 키 로테이션 (JWT_SECRET, DB 비밀번호, GEMINI_API_KEY) — 사용자 완료 (2026-07-16)
  - [x] JWT secret fallback 제거 + 필수 환경변수 fail-fast (`src/config/env.js`, 2026-07-16)
  - [x] 테스트 환경 구축: app/server 분리 + Jest/supertest + Docker MySQL 테스트 DB ([ADR-002](ADR/ADR-002-테스트-DB-전략.md), [리팩토링 01](../doc/refactoring/01-app-server-분리와-테스트-환경.md), 2026-07-16)
  - [x] 핵심 API 통합 테스트 19개 (auth / courses / timetables) — `npm run test:db:up` 후 `npm test` (2026-07-16)
  - [x] 로컬 `docker compose` 실행 환경 복구: 팀플 시절부터 반복되던 db 초기화 crash-loop의 근본 원인(환경변수 치환 버그) 규명 및 수정, Windows Docker Desktop 포트 잔류 우회 ([트러블슈팅 01](troubleshooting/01-docker-compose-환경변수-치환-버그와-포트-잔류.md), 2026-07-22)
  - [x] Docker Hub 이미지 이관(`krpark1108` → `binseoyun`) 및 kind 클러스터 배포 검증(Phase 3 착수 전 사전 점검): `app-secrets`의 `cron-secret` 키 누락으로 backend가 못 뜨던 문제, frontend 이미지가 Vite 빌드 시점에 docker-compose용 주소를 번들에 구워 K8s에서 API 호출이 조용히 깨지던 문제 발견 및 수정 ([트러블슈팅 02](troubleshooting/02-kind-배포-명령어-레퍼런스.md), [K8s 아키텍처 다이어그램](architecture/k8s-architecture.html), 2026-07-22)
- [x] **로드맵 외 작업**: 비밀번호 재설정 기능 추가 — DB 스키마/로그인 흐름 수정에 앞서 사용자 요청으로 진행. "찾기"가 아닌 "재설정" 방식 채택, bcrypt 단방향 해시 특성상 원본 비밀번호 노출이 불가능함을 근거로 설계 ([ADR-004](ADR/ADR-004-비밀번호-재설정-기능-추가.md), 2026-08-04)
- [x] **로드맵 외 작업**: 회원 탈퇴 기능 추가 — 하드 삭제 채택, `course_interests`/`timetables`는 `ON DELETE CASCADE`로 자동 정리되지만 `Class.enrolled` 카운터는 CASCADE를 안 거쳐서 별도 감소 처리 필요했음을 발견·수정 ([ADR-005](ADR/ADR-005-회원-탈퇴-기능-추가.md), 2026-08-04)
- [x] **로드맵 외 작업**: Git 작업 규칙 정의 — Issue 기반 계획 → 브랜치 네이밍(`타입/#이슈번호-내용`) → Conventional Commits(`타입: 제목 (#이슈번호)`) → PR(`Closes #N`) → 머지 시 이슈 자동 종료 + 브랜치 삭제로 흐름 고정. Phase 4(CI/CD)에서 "PR merge = 배포 트리거"를 명확히 하기 위한 선행 작업 ([git-workflow.md](git-workflow.md), PR 템플릿: `.github/pull_request_template.md`, 2026-08-10)
- [ ] **로드맵 외 작업(예정)**: 실시간 수강신청 기능 신설 — 기존 "관심 과목" 토글과는 별개로, 실제로 수강신청을 해볼 수 있는 신규 기능/탭을 추가하는 것. 대기열(Waiting Room)뿐 아니라 신청 자체가 지금까지 없던 새 기능이므로, "기존 기능 개선의 연장"이 아니라 비밀번호 재설정([ADR-004](ADR/ADR-004-비밀번호-재설정-기능-추가.md))·회원 탈퇴([ADR-005](ADR/ADR-005-회원-탈퇴-기능-추가.md))와 같은 **로드맵 외 작업**으로 솔직하게 분류한다.
  - 설계: [ADR-006](ADR/ADR-006-실시간-수강신청-설계.md) — 아직 약 10개 결정이 통합된 설계 문서 상태. 각 결정을 실제로 구체화하는 시점마다 개별 ADR로 분리한다.
  - 구현 시 별도 "수강신청" 탭을 신설하고, 실제 학교 수강신청 사이트와 동일한 UI/UX를 목표로 한다.
  - 구현 순서 및 Stage별 측정 계획(naive 버전으로 Before 증명 → 개선 → After 재측정 원칙 포함): [실시간-수강신청-구현계획.md](실시간-수강신청-구현계획.md)
  - Stage 3(운영 고도화)는 전부 필수가 아님 — 2026-08-19 재검토로 [필수]/[권장]/[보류]로 재분류함 (구현계획 문서 참고). [보류] 항목은 아래 Phase 3 나머지·AWS/K8s 실배포와 함께 마지막 인프라 트랙에서 처리.
- [x] **로드맵 외 작업(완료, 2026-09-01)**: AI 에이전트 챗봇(RAG + Function Calling) — 기존 단발성 추천(`/recommend`)을 강의계획서 기반 근거 응답이 가능한 대화형 상담 에이전트로 대체. 새 기능이므로 위와 같은 원칙으로 **로드맵 외 작업**으로 분류. Stage 0~3 + 실사용 버그 2건 완료, 회고 → [portfolio/03](portfolio/03-ai-챗봇-rag-function-calling.md).
  - 설계 완료(2026-08-20, 이슈 #51 종결): [ADR-010](ADR/ADR-010-AI-에이전트-챗봇-설계.md) — Vector DB는 **Qdrant**(2026-08-27 §4 재검토로 Chroma→Qdrant, K8s+AWS/GCP 배포 확정 반영, 이슈 #91), 언어/서비스 배치(Python `ai-server` 확장, 상태는 Node가 소유), 임베딩 모델(`gemini-embedding-001`), PDF 파싱 라이브러리(`pdfplumber`, 실제 파서는 A3로 유예 — 아래 2026-08-29 항목)까지 전부 결정 완료.
  - 구현계획: [doc/AI-에이전트-구현계획.md](AI-에이전트-구현계획.md) — Stage 0(Tool 라우팅 검증) → Stage 1(RAG 결합, PDF 확보 후) → Stage 2(스트리밍+UI) → Stage 3(가드레일+최종 측정). 설계 재검토로 write Tool은 배제됨(ADR-010 §9).
  - 진행: Stage 0-1~0-5 완료·머지(인프라 분리 #66, 라우팅 뼈대 #68, `ai-server` 실제 엔드포인트 #70). Stage 0-6(Tool 라우팅 정확도 baseline, 이슈 #74) — 측정 하네스·계획서·질문 세트 70개 완료, **Gemini baseline 실측 완료**([결과](experiment/03-결과.md)): Tool 선택 정확도 93.1%, 정보 조회는 견고(할루시네이션 0건), 범위 밖 요청에 42% 과잉 호출이 Stage 3-1 Before. 모델 비교 7종 완료 → `gemini-3.1-flash-lite` 선정([ADR-012](ADR/ADR-012-챗봇-LLM-모델-선정.md), #78/#80).
  - **Stage 2(스트리밍+UI) 완료(2026-08-27, 이슈 #83)**: `POST /api/ai/chat`을 SSE로 전환(`agent.stream`, nginx/Node/ai-server 3중 버퍼링 해제), `ai-server` 호스트 포트 노출 제거(ADR-010 §11). 프론트 "AI 상담 챗봇" 새 탭 — 읽기 전용 상담 UI, 세션 목록·멀티턴. → [리팩토링 02](refactoring/02-챗봇-SSE-스트리밍-전환-및-채팅-UI.md).

  - **Stage 3-1(프롬프트/Tool 고도화) 완료(2026-08-27, 이슈 #82)**: `search_courses` professor 매칭 + 노이즈 토큰 흡수, 시스템 프롬프트 거절 범위 명시. 답변 포함 검사 77.8→100%, 회귀 없음. → [실험 03 프롬프트개선](experiment/03-프롬프트개선-before-after.md).
  - **Stage 3-1b(좌석 데이터 소스 단일화) 완료(2026-08-27, 이슈 #86, [ADR-013](ADR/ADR-013-좌석-데이터-소스-단일화.md))**: 챗봇 "잔여석"이 `capacity - enrolled`(관심과목 하트 수 기반, 실시간 수강신청과 무관)였던 버그. `/api/courses`가 Redis 실시간 좌석 + `course_interests` 수를 응답에 싣고, 챗봇이 실시간 잔여석/신청자 수/관심 등록 수 3개를 분리해 답하도록 수정. → [실험 03 §8](experiment/03-프롬프트개선-before-after.md).
  - **Stage 3-2(장애 폴백) 완료(2026-08-31, 이슈 #106)**: `chat/errors.py` LLM 장애 3분류, Tool/임베딩/Qdrant 장애 친절 degrade, 실패 시에도 사용자 메시지 저장. 수동 장애 주입 3종 검증. → [리팩토링 03](refactoring/03-챗봇-장애-폴백.md).
  - **Stage 3-0(사용자 단위 rate limit) 완료(2026-08-31, 이슈 #108)**: ADR-010 §15 재검토 — Node → `ai-server` 계층. `chat/rate_limit.py` `redis-chat` 카운터 + `INCR`/`EXPIRE` Lua 원자화, Redis 장애 fail-open.
  - **Stage 3-3(가드레일 전/후 최종 종합 측정) 완료(2026-08-31, 이슈 #113)**: 벤치마크 재작성(#111) 후 74문항×5회. 가드레일만으로는 Tool 선택 93.1→93.5%(제자리)지만 **실패 성격이 뒤바뀜** — baseline 과잉호출 41.7→0%, 대신 RAG 결합이 "개념어 과목검색→`search_syllabus` 오라우팅"(과목검색 100→66.7%)을 만듦. **`search_courses`·`search_syllabus` description 2곳만 교정**(프롬프트 무변경) → Tool 선택 **100%**(sd 0.0, 72/72), 회귀 0, 할루시네이션 0/17. latency invoke p50 4.9→1.9초, 비용 $3.26→$1.00/1000turn. → [실험 05](experiment/05-가드레일-전후-최종-측정.md), Notion 보고서 08.
  - **Stage 3-4(옛 `/recommend` 제거) 완료(2026-09-01, 이슈 #115)**: ADR-010 §17 "완전 대체" 결정 실행. 프론트 `AIRecommendation.tsx` 삭제 + `App.tsx` `'ai'` 페이지 제거(`HomePage` 카드는 "AI 상담 챗봇"으로 교체), Node `POST /api/ai/recommend` 라우트·`getRecommendation` 제거, ai-server `POST /recommend` 엔드포인트 + `/recommend` 전용 전역 Gemini 설정·죽은 import 제거, `K8s/01-configmap.yaml`의 dead "AI 추천 설정"·"직무별 추천" 5키 제거. 검증: 프론트 `vite build`·backend 모듈 로드·`main.py` compile 통과, 잔여 참조 0. → [리팩토링 04](refactoring/04-recommend-제거.md). **남은 것**: ADR-010에 Stage 0~3 종합 "결과" 섹션 추가.
  - **실사용 버그 #117 완료 (2026-09-01, PR #118)**: 실제 앱에서 챗봇과 대화하다 발견 — 강의계획서를 여러 턴 물어본 뒤 "교수 이메일 알아?" 후속 질문에서 `get_syllabus` 재호출 없이 이메일을 지어냄(`jhshim@university.ac.kr`, 실제 `jshim@sookmyung.ac.kr`). Tool 관측값은 다음 턴 히스토리에 안 남는데(설계 의도), 대화가 "조회→설명" 흐름으로 드리프트하면 flash-lite가 재호출을 건너뛴다. `run_rag_eval`에 멀티턴 지원 + `expect_kind: syllabus_followup` 추가, 재현 시나리오 `rag-54`(#117 그대로)/`rag-55`(정상 멀티턴, 회귀 가드). **수정(A)**: `SYSTEM_PROMPT`에 "담당교수 이메일·연구실"을 강의계획서 값 목록에 추가 + "히스토리에 안 보이면 get_syllabus 재호출, 기억에 의존 금지" 1문장. **Before→After**: `rag-54` 0/3→5/5(결정적), `후속` 카테고리 50→100%. 회귀 0 — `routing`·`out_of_scope` 양쪽 결정적 100%, `hit`/`not_registered` 흔들림은 수정 전/후 실행 모두 나타난 `search_syllabus`(Qdrant/임베딩 API) 일시 장애 노이즈(p95 18초). → [실험 06](experiment/06-후속질문-tool-재호출.md).
  - **Stage 3-1(프롬프트/Tool 고도화) 완료(2026-08-27, 이슈 #82)**: `search_courses` professor 매칭 + 노이즈 토큰 흡수, 시스템 프롬프트에 거절 정책. 답변 포함 검사 77.8→100%, 회귀 없음.
  - **Stage 1-1(강의계획서 청킹 규칙 확정) 완료(2026-08-27, 이슈 #87)**: 강의계획서 19개 전수 정독 → 과목당 1청크(본문 해시로 분반 병합/분리, 19파일→17청크), 구조화 필드는 벡터 DB 페이로드(별도 SQL 테이블 없음), RAG Tool 2개(`search_syllabus`/`get_syllabus`). ADR-010 §13/§8 확정 + eval 라벨. 설계: Notion "AI 챗봇 RAG 결합 (Stage 1)".
  - **벡터 DB 재선정(2026-08-27, 이슈 #91)**: Chroma → **Qdrant**. K8s + AWS/GCP 실배포·운영이 로드맵에 확정돼 ADR-010 §4 재검토 조건 충족. Qdrant는 공식 Helm·클라우드 관리형·로컬↔클라우드 API 연속성. RAG 코드 착수 전이라 전환 비용 ≈ 0. ADR-010 §4/§5/부록 A 갱신.
  - **파싱 방식·페이로드 스키마 확정(2026-08-29, 이슈 #95)**: 파싱 = **A3**(pdfplumber 파서 대신 수기 `syllabi.yaml` single source of truth — 17청크 규모라 파서는 이미 한 정독 작업의 재구현). A2(파서 + `overrides.yaml`)는 범위 확장 시 재검토. Qdrant 페이로드 스키마·point ID(`uuid5`)·`get_syllabus` 시그니처 확정. ADR-010 §6/§13 재검토 서브섹션 추가.
  - **Class 재시딩 완료(2026-08-30, 이슈 #89)**: `seedData.js` courseData를 소프트웨어학부 2026-2 실데이터 22과목/37분반으로 교체(강의계획서 있는 17과목 전부 포함). Redis 좌석·챗봇 E2E 검증.
  - **Stage 1-2(강의계획서 → Qdrant 적재) 완료(2026-08-30, 이슈 #100)**: PDF 19개 전수 정독 → `syllabi.yaml`(18청크, A3 single source of truth). `backend/ai-server/rag/` 파이프라인(`validate_syllabi`/`ingest --dry-run`/`inspect_qdrant`), `gemini-embedding-001` 비대칭 임베딩(3072d), `docker-compose`에 `qdrant` 추가. 스팟체크 rank-1 정답 5/5. ADR-010 §13에 실행 결과 서브섹션(17→18청크 정정, weekly_plan 8~15주). 설계: Notion "AI 챗봇 RAG 결합 (Stage 1)".
  - **Stage 1-3(RAG Tool 결합) 완료(2026-08-31, 이슈 #102)**: `chat/syllabus_tools.py` — `search_syllabus`(top-3, threshold 없음)·`get_syllabus`(course_code 필터, 다중청크 되물음, 미등록 None). TOOLS 2→4, SYSTEM_PROMPT +2문장(A안). 스모크 9케이스 라우팅 100%.
  - **Stage 1-4(RAG hit rate + naive Before/After) 완료(2026-08-31, 이슈 #104)**: `eval/run_rag_eval.py` 3모드. retrieval hit@3 **100%**, agent 전체 pass **100%**(162 rows, 미등록 할루시네이션 0·범위밖 오호출 0·1-3 회귀 0), naive(Before)도 의미검색 100%. **18청크 규모에선 RAG 정확도 우위 없음** — 실질 이득은 토큰 2.2×↓ + 확장성 + §7 아키텍처 분리. threshold 점수 겹쳐 보류. → [실험 04](experiment/04-결과.md).
  - **AI 에이전트 챗봇 트랙 완료 (2026-09-01, 이슈 #119)**: Stage 0~3 + 실사용 버그 2건(#93/#117) 전부 마무리. 개발 전체 회고(문제→해결 상세→Before/After→방법론→한계) → [portfolio/03-ai-챗봇-rag-function-calling.md](portfolio/03-ai-챗봇-rag-function-calling.md), ADR-010 §18 "결과" 섹션 추가. **핵심 수치**: Tool 라우팅 93.1→100%, 범위밖 과잉호출 42→0%, RAG hit@3 100%·미등록 할루시네이션 0%, latency invoke p50 4.9→1.9초, 비용 $3.26→$1.00/1000turn, 옛 `/recommend` 완전 제거.
- [x] **Phase 2. 동시성 개선 (완료, 2026-09-01 — [ADR-014](ADR/ADR-014-실시간-수강신청-동시성-제어-방식-확정.md))** — 로드맵 P1(`courseController.js` 정원 초과 방지 부재)과 실시간 수강신청의 동시성 제어를 함께 다룸. naive(Group A)로 "깨짐" 증명 → A/B/C 실험 → Group C 확정.
  - [x] Group A(무방비)/B(비관적 락) API 구현 (#9, 2026-08-10)
  - [x] k6+Prometheus+Grafana 부하테스트 인프라 + 계정 시딩 스크립트 (#13, 2026-08-11)
  - [x] 실험 01 정식 실행: 7단계 동시성 스윕(50~12,000명) × 그룹 × 5회 반복, 총 70회차 (#15, 2026-08-12) — [결과](experiment/01-결과.md). H1(A는 정합성 깨짐, 저동시성에선 고처리량이나 3,000명↑부터 A도 붕괴) 부분 확인, H2(B는 정합성 완벽하나 특정 수준부터 처리량 급락) 확인. Group A가 "정원 검사 로직이 있는데도" TOCTOU 레이스로 무력화되는 메커니즘 규명.
  - [x] Group C(Redis 원자 연산) 구현 및 동일 스윕 재실험 — Group B와 비교 (#23/#29, 2026-08-18) — [결과](experiment/01-결과-groupC.md). 정합성 스윕 35/35 회차 전부 오버셀 0건·DLQ 0건(H3 정합성 확인, success sd 항상 0.0). 처리량은 12,000명에서 handled_rate 12.1%(A 8.1%/B 9.1%보다 근소 우위)로, "3,000명↑ 붕괴는 락 경합이 아니라 인프라 한계"라는 A/B 관찰이 Group C에서도 재확인됨. 어뷰징(매크로 연타/시간표 겹침)은 로컬 커넥션 한계로 노이즈가 컸으나 판정 기준(정원 초과 성공·겹침 유저) 위반은 0건
  - [x] 3,000명↑ 구간 붕괴 원인 분리 — **로컬 단일 호스트 backend 프로세스 CPU 천장으로 이미 특정([ADR-007](ADR/ADR-007-대기열-부하-backend-인스턴스-수평-확장.md), [트러블슈팅 08](troubleshooting/08-validate3k-잔여노이즈-원인-docker-desktop-cpu-캡.md)). 로컬에서 커넥션 한도 스윕은 "노트북 측정"이라 무의미 — 실배포 규모 처리량 상한 측정은 인프라 트랙 순서 ④(AWS 부하테스트)로 이관.**
  - [x] 최종 개선안 선택 + ADR 작성 — **Group C 확정, [ADR-014](ADR/ADR-014-실시간-수강신청-동시성-제어-방식-확정.md) (2026-09-01, #123). ADR-006 §2.1/§2.2 결정을 독립 ADR로 분리 + 실험 01 수치(오버셀 A +925 / B·C 0·105회차 sd 0.0, 카오스 3종) 편입. Phase 2 종결.**
- [x] Phase 3. K8s 운영화 — 일부 당겨서 완료: Ingress 도입 + frontend same-origin 전환. K8s 배포 후 브라우저에서 로그인 검증이 불가능했던 문제(클러스터 내부 DNS를 브라우저가 해석 못함) 해결. LoadBalancer×2 → Ingress 1개, docker-compose에도 nginx 리버스 프록시로 동일 구조 ([ADR-003](ADR/ADR-003-Ingress-도입과-Frontend-API-주소-구성-방식-전환.md), 2026-08-04). 나머지는 아래 인프라 트랙 ③.

---

## 인프라 트랙 실행 순서 (2026-09-01 확정, 이슈 #123 / #121 아키텍처 검토 반영)

챗봇 트랙(로드맵 외 작업) 완료 후 마지막 트랙. **모듈러 모놀리스를 먼저 K8s·클라우드·CI/CD로 운영화한 뒤, 그 플랫폼 위에서 수강신청 도메인을 마이크로서비스로 점진 추출**한다(strangler fig). 서비스 분리와 K8s 운영을 동시에 디버깅하지 않기 위한 순서 — 근거: [아키텍처 스타일 검토](architecture/00-아키텍처-스타일-검토.md).

- [x] **①** Phase 2 결론 ADR — [ADR-014](ADR/ADR-014-실시간-수강신청-동시성-제어-방식-확정.md) (완료)
- [ ] **②** C-lite: `backend/src/`를 `modules/{auth,courses,registration,timetables}/`로 격리, `registrations` 별도 스키마, 모듈 간 직접 import 정리 — ③의 마이그레이션 작업이 모듈 단위로 조직되도록 (~1일)
- [ ] **③** Phase 3 (K8s 운영화, 모놀리스 상태) — ★ K8s 운영 경험 (~1.5주)
  - Probe 재설계: `readinessProbe` 신설(`/health`, DB 체크). `livenessProbe`는 `/` 유지 (이미 그렇게 돼 있음 — `K8s/30-backend.yaml`). "liveness에 DB 넣으면 DB 장애 시 재시작 폭풍" 서사
  - resource requests/limits — 실험 01/02 실측(backend 프로세스 CPU 천장 등, ADR-007) 기반 산정
  - CronHPA(9시 사전 확장) + HPA 병행 — 구조는 [ADR-011](ADR/ADR-011-CronHPA-HPA-병행-확장-구조.md)에서 확정(스케줄은 `minReplicas`만 조정). 임계값·`maxReplicas`는 resource 실측 후
  - DB 마이그레이션 도구(umzug 등) — `app.js`의 `sequelize.sync()` 제거 (P6). backend만 대상 (ai-server는 이미 Alembic)
  - StatefulSet 백업 — CronJob `mysqldump`
  - kind에서 부하 걸어 HPA 반응·파드 kill 무중단(rolling update + readiness gate) 검증
- [ ] **④** AWS 실배포 — ★ 클라우드 K8s 운영 (~1주)
  - EKS vs 자체관리 K8s on EC2 — 별도 ADR
  - 관리형 LB(ALB/NLB), EBS PV, Route53, ACM(HTTPS)
  - **엣지 coarse rate limit** — nginx-ingress `limit-rps`/`limit-connections` 또는 AWS WAF rate-based rule. DoS·봇 방어용, 애플리케이션 비용 방어(챗봇 LLM 토큰 = ai-server 계층, ADR-010 §15)와는 별도 계층(defense in depth). 전용 게이트웨이(Kong/Apigee)는 이 규모에 불필요
  - **실험 01/02를 AWS에서 재실행** — 로컬 CPU 2코어 한계가 풀린 상태의 진짜 처리량 상한. ①(ADR-014)에서 이관한 검증. 서사 A의 마무리
- [ ] **⑤** Phase 4. CI/CD — ★ 파이프라인 (~1주). GitHub Actions: lint → test → docker build → 커밋 SHA 태깅 → push → deploy. "PR merge = 배포 트리거"([git-workflow.md](git-workflow.md)에서 선행 작업 완료)
- [ ] **⑥** Phase 5. 관측성 (~3~5일) — 구조화 로깅, Prometheus/Grafana(부하 대시보드는 기존 재사용), 알림
- [ ] **⑦** (재결정 포인트) registration-service 물리 추출 — ★ MSA 전환 (~2~3주)
  - ①~⑥만으로도 면접 답변 성립("MSA 설계 + 모듈러 모놀리스 + ai-server 실물"). ⑦은 "다수 서비스를 실제 배포·운영·부하검증" 경험이 하드 요구인 자리를 지원할 때
  - C-full(②의 확장) + registrationRoutes/queueRoutes/worker를 새 서비스로. 과목 데이터는 backend `/api/courses/:code` 호출, 인증은 게이트웨이가 `x-user-id` 전달(ai-server 패턴). 자기 Deployment/HPA/Probe/CI(⑤ 복제). nginx가 `/api/registrations`·`/api/queue` 라우팅
  - **실험 01을 2-서비스 토폴로지로 재재실행** — 서비스 경계를 넘어도 오버셀 0 유지되는지, Ghost Decrement가 진짜 네트워크 경계 넘을 때. "MSA 전환 전후 비교" 별도 ADR + 트러블슈팅
  - (선택 ⑧) 폴리글랏 연습 — registration-service를 Go/Java로. ADR-006 §0 "폴리글랏 회피" 기각을 뒤집는 ADR에 "스킬 목적으로 감수" 명시

> 작성일: 2026-07-15
> 목적: PRD.md의 목표(구조 파악 → 리팩토링/아키텍처 보완 → 포트폴리오 정리)를 실행 가능한 단계로 구체화한다.
> 원칙: **"무엇을 만들었다"가 아니라 "왜 그렇게 결정했고, 무엇이 문제였고, 어떻게 측정하며 개선했는가"** 를 남긴다.

---

## 0. 현재 상태 진단 (As-Is)

> **아키텍처 스타일**: 이 시스템은 MSA가 아니라 **모듈러 모놀리스(Node backend) + 근거 있게 추출한 서비스 1개(ai-server)**다. 상세 검토·근거·포트폴리오 서사는 [아키텍처 스타일 검토](architecture/00-아키텍처-스타일-검토.md) (#121). 4장 "MSA 전환 같은 대수술은 하지 말 것"의 근거.

### 아키텍처
```
[React/Vite Frontend] ──> [Express Backend :8000] ──> [MySQL (StatefulSet+PVC)]
        │                        │
        └──────────────> [FastAPI AI Server :5000] ──> Gemini API
                                 (시간표 생성 알고리즘 + AI 추천)

K8s: namespace / ConfigMap / Secret / backend 2 replicas / CronJob(관심과목 체커, 매분)
```

### 발견된 문제점 목록 (각각이 포트폴리오 소재)

| # | 문제 | 위치 | 심각도 |
|---|------|------|--------|
| P1 | `enrolled` 카운터가 비정규화되어 있고, 동시 요청 시 정합성 검증이 안 됨. 정원 초과 방지 로직 자체가 없음 | `courseController.js` toggleInterest | 높음 |
| P2 | 테스트 코드 0개 (`"test": "exit 1"`) — 리팩토링의 안전망 부재 | backend/package.json | 높음 |
| P3 | CI/CD 없음 — 이미지 수동 빌드/푸시, 태그가 `v3`, `v4` 수동 관리 | K8s/*.yaml 주석 참고 | 높음 |
| P4 | JWT secret fallback이 `'secret'` 하드코딩, 회원가입/로그인의 secret 처리 불일치 | authController.js:27,62 | 높음 |
| P5 | 서비스마다 LoadBalancer 노출, Ingress 없음. CORS origin도 `127.0.0.1:3000` 하드코딩 | K8s/30-backend.yaml, app.js:32 | 중간 |
| P6 | `sequelize.sync()` 기반 스키마 관리 — 마이그레이션 이력 없음, 운영 DB에 위험 | app.js:69 | 중간 |
| P7 | 관측성 제로: console.log 로깅, 메트릭/트레이싱 없음, liveness가 `/` 200만 확인 (readiness 없음) | app.js, K8s | 중간 |
| P8 | AI 서버가 상태를 안 가짐에도 프론트가 **전체 과목 목록을 요청 바디에 실어** 보냄 — 데이터 소유권/경계 설계 문제 | ai-server/main.py ScheduleRequest | 중간 |
| P9 | CronJob이 매분 로그인 → 토큰 발급 반복, 서비스 계정 개념 없음 | K8s/50-cronjob-checker.yaml | 낮음 |
| P10 | 매 기동 시 `seedData.js` 실행, 시드와 앱 라이프사이클 미분리 | docker-compose.yml command | 낮음 |
| P11 | `.env` 파일·`__pycache__` 등이 저장소에 존재 — 시크릿 위생 문제 | backend/.env 등 | 중간 |
| P12 | resource requests/limits, HPA 없음 — "부하 분산 위해 replicas 2"라고 주석만 있고 근거 없음 | K8s/30-backend.yaml | 중간 |

---

## 1. 고도화 전략: 3개의 포트폴리오 서사(Narrative)

기능 나열 대신, **문제 정의 → 가설 → 실험/측정 → 개선 → 정량 결과**로 완결되는 스토리 3개를 만든다.
각 서사가 백엔드/인프라/DevOps 역량을 하나씩 커버한다.

### 서사 A. "수강신청 트래픽 폭주를 견디는 백엔드" (백엔드 역량)

수강신청 도메인의 본질적 난제 = **순간 동시성**. 이걸 정면으로 다루는 것이 이 프로젝트의 최고 차별점.

1. **문제 정의**: 정원 30명 과목에 동시 300명이 신청하면? 현재 코드는 정원 검사 자체가 없고, `enrolled`는 카운트 캐시라 CourseInterest 실제 행 수와 어긋날 수 있다.
2. **측정(Before)**: k6/Artillery로 동시 신청 부하 테스트 → 정원 초과 발생 건수, p95 latency, 에러율 기록. **"깨지는 걸 먼저 증명"** 하는 게 핵심.
3. **개선 실험 (비교 자체가 포트폴리오)**:
   - 1안: 조건부 원자 UPDATE (`UPDATE ... SET enrolled=enrolled+1 WHERE enrolled < capacity`)
   - 2안: 비관적 락 (`SELECT ... FOR UPDATE`) — 현재 코드의 lock 사용이 실제로 유효한지 검증 포함
   - 3안: Redis 원자 연산(INCR/Lua) + 비동기 DB 반영
   - 각 안의 처리량/정합성/복잡도 트레이드오프를 표로 비교하고 **왜 최종안을 선택했는지** ADR로 기록
4. **측정(After)**: 동일 시나리오 재실행 → 정원 초과 0건, 처리량/지연시간 변화 정량 기록
5. **파생 소재**: 데드락 발생 시 트러블슈팅(MySQL `SHOW ENGINE INNODB STATUS`), 커넥션 풀 사이징

### 서사 B. "장난감 K8s를 운영 가능한 클러스터로" (인프라/클라우드 역량)

1. **문제 정의**: 현재 K8s는 "떠 있기만 한" 상태 — 진입점이 서비스별 LoadBalancer로 분산, 프로브 부실, 리소스 한도 없음, 스케일 근거 없음.
2. **개선 항목** (각각 ADR 1건):
   - **Ingress(NGINX) 도입**: 단일 진입점 + path 라우팅(`/api`→backend, `/ai`→ai-server, `/`→frontend). LoadBalancer 3개 → 1개로 줄인 이유(비용/보안/CORS 단순화)를 문서화
   - **Probe 재설계**: liveness(`/` 생존)와 readiness(`/health` DB 연결)를 분리. "liveness에 DB 체크를 넣으면 DB 장애 시 전체 파드 재시작 폭풍이 온다"는 함정을 서사로
   - **resource requests/limits + HPA**: 부하 테스트로 파드당 처리량을 실측 → 그 근거로 requests 산정 → HPA 임계값 설정. "replicas: 2 (주석: 부하 분산)"에서 "실측 기반 오토스케일링"으로
   - **Secret 관리 개선**: git에 있던 .env 정리, git 히스토리 세탁(BFG), Sealed Secrets 또는 External Secrets 검토
   - **DB 운영성**: 마이그레이션 도구(sequelize-cli 또는 umzug) 도입, `sync()` 제거. StatefulSet 백업 전략(CronJob mysqldump) 추가
3. **측정**: 장애 주입 실험 — DB 파드 kill 시 복구 시간, backend 파드 kill 시 무중단 여부(rolling update + readiness gate), HPA 반응 시간

### 서사 C. "수동 배포에서 자동화된 파이프라인으로" (DevOps 역량)

1. **문제 정의**: 현재 배포 = 로컬 빌드 → Docker Hub 수동 push → yaml 이미지 태그 수동 수정(`v3`, `v4`) → kubectl apply. 사람이 태그를 틀리면 끝.
2. **개선**:
   - **테스트 기반 구축**: Jest + supertest로 핵심 API 통합 테스트(동시성 테스트 포함 — 서사 A와 연결)
   - **GitHub Actions CI**: lint → test → docker build → 커밋 SHA 태깅 → push
   - **CD**: 1단계는 Actions에서 kustomize edit + apply, 2단계(선택)는 ArgoCD GitOps. 로컬 kind 클러스터 한계 때문에 어디까지 했고 실환경이라면 어떻게 할지를 문서로
3. **측정**: 배포 소요 시간(수동 N분 → 자동 M분), 배포 실수 가능 지점 수 감소

### 서사 D. "AI 서버 경계 재설계" — ✅ AI 상담 챗봇(로드맵 외 작업)으로 사실상 완료

- 옛 `/recommend`가 "프론트→Node→ai-server로 전체 과목 데이터를 실어 보내는" 구조였고, 이게 payload 비대·프론트-DB 스키마 결합의 원인이었다. → 챗봇으로 대체하며 **ai-server가 필요한 데이터만 Tool(`GET /api/courses`)로 조회**하도록 바뀌었고, `/recommend`는 Stage 3-4에서 완전 제거([ADR-010](ADR/ADR-010-AI-에이전트-챗봇-설계.md), [portfolio/03](portfolio/03-ai-챗봇-rag-function-calling.md)).
- Gemini API 호출 타임아웃/폴백/장애 격리 — Stage 3-2(`chat/errors.py` 3분류 degrade), rate limit은 ai-server 계층(§15). "완전 MSA 분리"로 ai-server가 자기 데이터(db-chat·redis-chat·qdrant) 소유.
- **남은 조각**: ai-server의 read-only DB 직접 접근은 안 함(Tool = HTTP API로 유지, 경계가 더 깨끗). 캐싱은 `redis-chat` 작업 메모리로 부분 적용.

---

## 2. 실행 순서 (의존관계 기준)

```
Phase 1. 안전망         : 테스트 환경 + 핵심 API 통합 테스트 + .env/시크릿 위생        (서사 C 앞부분)  ✅
Phase 2. 동시성 개선     : 부하테스트(Before) → A/B/C 실험 → Group C 확정(ADR-014)     (서사 A)  ✅
로드맵 외: 실시간 수강신청 (대기열·Redis 원자연산·비동기 반영), AI 상담 챗봇 (RAG+FC)  ✅

── 인프라 트랙 (strangler fig 순서, 위 "인프라 트랙 실행 순서" 참조) ──
② modules/ 격리 → ③ Phase 3 K8s(모놀리스) → ④ AWS 실배포 + 부하 재측정
  → ⑤ Phase 4 CI/CD → ⑥ Phase 5 관측성 → ⑦ registration-service 물리 추출(MSA)
```

- Phase 1을 먼저 한 이유: 이후 모든 리팩토링의 "깨지지 않았음"을 증명할 수단이 필요하고, 시크릿이 git에 있는 상태로 CI를 붙이면 유출 위험이 커지기 때문.
- 인프라 트랙에서 K8s·CI/CD·관측성(③~⑥)을 **모놀리스 상태로 먼저** 하는 이유: K8s 운영을 단순한 대상(Deployment 2개)에서 익힌 뒤 서비스를 늘려야, "서비스 분리 + K8s 처음"을 동시에 디버깅하지 않는다. ⑦에서 매니페스트·파이프라인을 복제(copy-adapt)하므로 재작업 비용도 작다.

---

## 3. 문서화 체계 (CLAUDE.md 규칙 반영)

```
doc/
├── ADR/                          # 의사결정 기록 (결정 1건 = 파일 1개)
│   ├── ADR-001-동시성-제어-방식-선택.md
│   ├── ADR-002-ingress-도입.md
│   ├── ADR-003-probe-전략.md
│   └── ...
├── troubleshooting/              # 문제 발생 → 원인 분석 → 해결 과정 (시간순 기록)
├── refactoring/                  # 리팩토링 단위별 Before/After와 근거
├── experiment/                   # 부하테스트 시나리오, 원본 결과 데이터, 그래프
└── portfolio/                    # 위 문서들을 서사 A/B/C로 재구성한 최종본
```

ADR 템플릿: **상황(Context) / 검토한 대안들과 각각의 트레이드오프 / 결정과 이유 / 결과(정량·정성)**

### 포트폴리오 글쓰기 원칙
- 기술 이름은 결론이 아니라 **선택의 결과**로만 등장시킨다. ("Redis를 썼다" ✕ → "락 경합으로 p95가 N초까지 튀어서, 정합성 요구 수준과 비교한 끝에 ~를 선택했다" ○)
- 모든 개선은 **숫자 2개(Before/After)** 를 갖는다. 숫자를 못 만들면 그 개선은 서사에서 뺀다.
- 실패한 시도도 기록한다. (예: 비관적 락으로 먼저 시도 → 데드락 → 방향 전환) — 트러블슈팅 서사는 실패에서 나온다.
- 각 서사의 끝에 "실제 운영 환경이라면 추가로 무엇을 했을지"(한계 인식)를 한 단락 쓴다.

---

## 4. 리스크 & 스코프 관리

- **하지 말 것**: 새 기능 추가(기능은 이미 충분함), MSA 전환 같은 대수술, 프론트엔드 대개편. 포트폴리오 심사자는 완성도보다 **사고 과정의 깊이**를 본다.
- **(2026-08-19 결정, 계획 변경)** 원래는 kind 로컬 클러스터의 한계(LoadBalancer, 스토리지)를 "클라우드 환경이라면 이렇게 매핑된다"는 문서 서술로 대체할 계획이었으나, **실제 AWS 환경에 K8s로 배포하는 것으로 스코프를 확정**한다. 1단계는 지금처럼 kind로 개념 검증 → 2단계에서 AWS(EKS 또는 자체관리 K8s on EC2 등, 선택은 별도 ADR)로 실배포. 이 작업은 Phase 3 나머지·Phase 4(CI/CD)와 함께 인프라 트랙으로 묶어 AI 에이전트(로드맵 외 작업) 이후 진행한다.
- Gemini API 키 등 시크릿은 어떤 문서/커밋에도 남기지 않는다. AWS 자격증명(IAM 키 등)도 동일 원칙 적용.
