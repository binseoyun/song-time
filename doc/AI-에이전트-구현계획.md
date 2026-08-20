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

- [ ] 0-1. MySQL `chat_sessions`/`chat_messages` 테이블 설계 + 마이그레이션 (ADR-010 §10)
- [ ] 0-2. Node backend 내부 API(대화 상태 CRUD: 세션 생성/메시지 기록/최근 N턴 조회) — Python `ai-server`가 호출할 대상 (ADR-010 §3)
- [ ] 0-3. `GET /api/courses/:code`(과목 단건 조회) 신설 (ADR-010 §8, 0-2와 병렬 가능)
- [ ] 0-4. `ai-server`에 `POST /api/ai/chat`(비-스트리밍 우선) + `google-generativeai` native function calling 라우팅. read-only Tool 3개만 연동: 잔여석 조회(`GET /api/courses`), 대기열 순번(`GET /api/queue/status`), 과목 단건 조회(0-3) (ADR-010 §7/§8/§12)
- [ ] 0-5. 테스트 질문 세트 1차 작성(예: "이번 학기 데이터베이스 관련 과목 뭐 있어?", "CS301 몇 명 남았어?") + Tool 선택 정확도 측정 — `doc/experiment/`에 원본 저장

## Stage 1 — RAG 결합 (PDF 확보 후 착수, ~3~5일)

목표: 강의계획서 의미 검색을 실제로 붙인다. ADR-010 §4/§5/§6/§13 반영.

- [ ] 1-1. 제공받은 PDF 샘플로 실제 구조 확인(주차별 계획이 표인지 텍스트인지 등) → 청킹 규칙 확정(ADR-010 §13 열린 사항을 여기서 닫음)
- [ ] 1-2. `pdfplumber` 파싱 파이프라인 + `gemini-embedding-001` 임베딩 + Chroma 적재 스크립트(로컬 1회성 실행, 관리자 UI는 스코프 아웃)
- [ ] 1-3. RAG 검색을 Tool로 결합 — "이런 걸 배우고 싶은데 관련 과목 있어?" 같은 의미 기반 질문 처리
- [ ] 1-4. RAG 검색 hit rate 측정(정답 청크가 top-k 안에 들어오는 비율) — `doc/experiment/`에 원본 저장

## Stage 2 — 스트리밍 + UI (~2~3일)

목표: 실제 채팅 UI로 완성한다. write Tool은 설계에서 배제했으므로(ADR-010 §9), `registrationRoutes` 최종안 확정 여부와 무관하게 진행 가능하다. ADR-010 §11 반영.

- [ ] 2-1. `POST /api/ai/chat`을 SSE 스트리밍으로 전환 + nginx `proxy_buffering off`/타임아웃 설정 추가 (ADR-010 §11)
- [ ] 2-2. 프론트 채팅 UI(기존 "실시간 수강신청 연습" 탭과 자연스럽게 연결되는 위치 검토) — 읽기 전용 상담 UI(추천/질의응답/상태 조회)로, 신청·취소 버튼은 없음

## Stage 3 — 가드레일 강화 + 최종 측정 (~1.5~2.5일)

목표: 프로덕션 수준의 안정성을 갖추고, Before/After 수치를 최종 정리한다.

- [ ] 3-1. 범위 밖 질문 거절(수강신청과 무관한 질문에 대한 응답 정책)
- [ ] 3-2. Gemini API 장애 시 폴백(에러 메시지 vs 재시도 vs 기존 `/recommend` 방식으로 다운그레이드)
- [ ] 3-3. 최종 측정: Tool 선택 정확도 재측정, 할루시네이션 비율(수작업 샘플링), E2E p95 latency, Gemini 토큰 비용 — Stage 0/1 결과와 비교해 "가드레일 전/후" Before/After로 정리(ADR-010 §14)

## 완료 조건

- Stage 0~3 전부 완료 + 측정 결과 문서화
- `doc/experiment/03-ai-에이전트-결과.md`(가칭)에 종합 정리
- ADR-010에 "결과" 섹션 추가(실시간 수강신청 ADR들의 패턴과 동일)
