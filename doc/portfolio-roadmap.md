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
- [ ] **로드맵 외 작업(진행 중)**: AI 에이전트 챗봇(RAG + Function Calling) — 기존 단발성 추천(`/recommend`)을 강의계획서 기반 근거 응답 + 실제 수강신청 보조까지 가능한 대화형 상담 에이전트로 확장하는 것. 새 기능이므로 위와 같은 원칙으로 **로드맵 외 작업**으로 분류한다.
  - 설계 완료(2026-08-20, 이슈 #51 종결): [ADR-010](ADR/ADR-010-AI-에이전트-챗봇-설계.md) — Vector DB는 Chroma로 확정(AWS S3 Vectors/Aurora+pgvector는 AWS 실배포 단계로 재검토 이월), 언어/서비스 배치(Python `ai-server` 확장, 상태는 Node가 소유), 임베딩 모델(`gemini-embedding-001`), PDF 파싱(`pdfplumber`)까지 전부 결정 완료.
  - 구현계획: [doc/AI-에이전트-구현계획.md](AI-에이전트-구현계획.md) — Stage 0(Tool 라우팅 검증) → Stage 1(RAG 결합, PDF 확보 후) → Stage 2(스트리밍+UI) → Stage 3(가드레일+최종 측정). 설계 재검토로 write Tool은 배제됨(ADR-010 §9).
  - 진행: Stage 0-1~0-5 완료·머지(인프라 분리 #66, 라우팅 뼈대 #68, `ai-server` 실제 엔드포인트 #70). Stage 0-6(Tool 라우팅 정확도 baseline, 이슈 #74) — 측정 하네스·계획서·질문 세트 70개 완료, **Gemini baseline 실측 완료**([결과](experiment/03-결과.md)): Tool 선택 정확도 93.1%, 정보 조회는 견고(할루시네이션 0건), 범위 밖 요청에 42% 과잉 호출이 Stage 3-1 Before. 모델 비교 7종 완료 → `gemini-3.1-flash-lite` 선정([ADR-012](ADR/ADR-012-챗봇-LLM-모델-선정.md), #78/#80).
  - **Stage 2(스트리밍+UI) 완료(2026-08-27, 이슈 #83)**: `POST /api/ai/chat`을 SSE로 전환(`agent.stream`, nginx/Node/ai-server 3중 버퍼링 해제), `ai-server` 호스트 포트 노출 제거(ADR-010 §11). 프론트 "AI 상담 챗봇" 새 탭 — 읽기 전용 상담 UI, 세션 목록·멀티턴. → [리팩토링 02](refactoring/02-챗봇-SSE-스트리밍-전환-및-채팅-UI.md).
  - **Stage 3-1(프롬프트/Tool 고도화) 완료(2026-08-27, 이슈 #82)**: `search_courses` professor 매칭 + 노이즈 토큰 흡수, 시스템 프롬프트 거절 범위 명시. 답변 포함 검사 77.8→100%, 회귀 없음. → [실험 03 프롬프트개선](experiment/03-프롬프트개선-before-after.md).
  - **Stage 3-1b(좌석 데이터 소스 단일화) 완료(2026-08-27, 이슈 #86, [ADR-013](ADR/ADR-013-좌석-데이터-소스-단일화.md))**: 챗봇 "잔여석"이 `capacity - enrolled`(관심과목 하트 수 기반, 실시간 수강신청과 무관)였던 버그. `/api/courses`가 Redis 실시간 좌석 + `course_interests` 수를 응답에 싣고, 챗봇이 실시간 잔여석/신청자 수/관심 등록 수 3개를 분리해 답하도록 수정. → [실험 03 §8](experiment/03-프롬프트개선-before-after.md).
  - 다음은 Stage 3-3(가드레일 전/후 최종 측정).
- [x] Phase 2. 동시성 개선 (진행 중) — 기존 `courseController.js`의 정원 초과 방지 로직 부재 문제(로드맵 P1)를 다룬다. 위 실시간 수강신청 신규 기능과는 별개 트랙.
  - [x] Group A(무방비)/B(비관적 락) API 구현 (#9, 2026-08-10)
  - [x] k6+Prometheus+Grafana 부하테스트 인프라 + 계정 시딩 스크립트 (#13, 2026-08-11)
  - [x] 실험 01 정식 실행: 7단계 동시성 스윕(50~12,000명) × 그룹 × 5회 반복, 총 70회차 (#15, 2026-08-12) — [결과](experiment/01-결과.md). H1(A는 정합성 깨짐, 저동시성에선 고처리량이나 3,000명↑부터 A도 붕괴) 부분 확인, H2(B는 정합성 완벽하나 특정 수준부터 처리량 급락) 확인. Group A가 "정원 검사 로직이 있는데도" TOCTOU 레이스로 무력화되는 메커니즘 규명.
  - [x] Group C(Redis 원자 연산) 구현 및 동일 스윕 재실험 — Group B와 비교 (#23/#29, 2026-08-18) — [결과](experiment/01-결과-groupC.md). 정합성 스윕 35/35 회차 전부 오버셀 0건·DLQ 0건(H3 정합성 확인, success sd 항상 0.0). 처리량은 12,000명에서 handled_rate 12.1%(A 8.1%/B 9.1%보다 근소 우위)로, "3,000명↑ 붕괴는 락 경합이 아니라 인프라 한계"라는 A/B 관찰이 Group C에서도 재확인됨. 어뷰징(매크로 연타/시간표 겹침)은 로컬 커넥션 한계로 노이즈가 컸으나 판정 기준(정원 초과 성공·겹침 유저) 위반은 0건
  - [ ] 3,000명↑ 구간 붕괴 원인 분리(락 경합 vs 인프라 한계) 후속 실험 — Group C 실험으로 "락 경합이 아님"까지는 간접 확인됐으나, 정확한 인프라 병목 지점(커넥션 한도 등) 특정은 아직 안 함
  - [ ] 최종 개선안 선택 + ADR 작성
- [x] Phase 3. K8s 운영화 (일부, 당겨서 진행) — Ingress 도입 + frontend same-origin 전환: K8s 배포 후 브라우저에서 로그인 검증 자체가 불가능했던 문제(클러스터 내부 DNS를 브라우저가 해석 못함) 해결. LoadBalancer×2 → Ingress 1개로 진입점 통합, docker-compose에도 nginx 리버스 프록시로 동일 구조 적용 ([ADR-003](ADR/ADR-003-Ingress-도입과-Frontend-API-주소-구성-방식-전환.md), 2026-08-04)
- [ ] Phase 3. 나머지 (Probe 재설계, resource requests/limits + CronHPA 사전 확장·HPA 병행([ADR-011](ADR/ADR-011-CronHPA-HPA-병행-확장-구조.md)), DB 마이그레이션 도구 도입) — resource/HPA는 이미 실험 01(Group A/B/C) 실측 데이터가 있어 실시간 수강신청 Stage 3의 Sentinel/풀 사이징보다 우선순위 높음(2026-08-19 결정)
- [ ] Phase 4. CI/CD
- [ ] Phase 5. 관측성

> 작성일: 2026-07-15
> 목적: PRD.md의 목표(구조 파악 → 리팩토링/아키텍처 보완 → 포트폴리오 정리)를 실행 가능한 단계로 구체화한다.
> 원칙: **"무엇을 만들었다"가 아니라 "왜 그렇게 결정했고, 무엇이 문제였고, 어떻게 측정하며 개선했는가"** 를 남긴다.

---

## 0. 현재 상태 진단 (As-Is)

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

### (선택) 서사 D. "AI 서버 경계 재설계" — 시간이 남으면

- 프론트가 전체 과목 데이터를 AI 서버에 실어 보내는 현재 구조의 문제(payload 비대, 데이터 위변조 가능, 프론트-DB 스키마 결합)를 정의하고, AI 서버가 backend API에서 직접 조회(또는 read-only DB 접근)하도록 변경.
- Gemini API 호출 캐싱/타임아웃/폴백 처리 — 외부 의존성 장애 격리 서사.

---

## 2. 실행 순서 (의존관계 기준)

```
Phase 1. 안전망         : 테스트 환경 구축 + 핵심 API 통합 테스트 + .env/시크릿 위생   (서사 C 앞부분)
Phase 2. 동시성 개선     : 부하테스트(Before) → 개선 실험 → 측정(After)              (서사 A 전체)
Phase 3. K8s 운영화     : Ingress → Probe → resources/HPA → 마이그레이션            (서사 B 전체)
Phase 4. CI/CD          : GitHub Actions → (선택) GitOps                            (서사 C 뒷부분)
Phase 5. 관측성         : 구조화 로깅 → Prometheus/Grafana → 부하테스트 대시보드      (서사 A,B의 측정 강화)
```

Phase 1을 먼저 하는 이유: 이후 모든 리팩토링의 "깨지지 않았음"을 증명할 수단이 필요하고, 시크릿이 git에 있는 상태로 CI를 붙이면 유출 위험이 커지기 때문.

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
