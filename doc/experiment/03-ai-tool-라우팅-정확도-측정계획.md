# 실험계획서 03: AI 챗봇 Tool 라우팅 정확도 — baseline 측정

- 작성일: 2026-08-26
- 상태: 계획 확정, 질문 세트(25~30개) 완성 후 실행
- 관련: [ADR-010](../ADR/ADR-010-AI-에이전트-챗봇-설계.md) §8(Tool 인벤토리·설계 원칙)·§14(측정 계획), [구현계획](../AI-에이전트-구현계획.md) Stage 0-6, 이슈 #74
- 하네스: `backend/ai-server/eval/`

> 새 기능이라 비교 대상이 없는 게 아니다(ADR-010 §14). 실시간 수강신청 때처럼 "가드레일 없는
> baseline → 개선 → 재측정" 구조로 수치를 남긴다. 이 문서는 그 baseline을 만드는 절차를 정의한다.

---

## 1. 무엇을 측정하나

Stage 0-5에서 구현한 에이전트(`create_agent` + Gemini, read-only Tool 2개)가 **자연어 질문을
받아 맞는 Tool을 맞는 인자로 호출하는가**. RAG(Stage 1)는 아직 없으므로 Tool 인벤토리는 2개다:

| Tool | 언제 써야 하나 |
|---|---|
| `search_courses(keyword)` | 과목명/키워드로 목록·잔여석을 찾을 때 |
| `get_course_by_code(code)` | 과목 코드가 주어졌을 때 단건 상세 |
| (Tool 안 씀) | 신청 대행·대기열 순번·범위 밖 질문 → 거절하고 "화면에서 직접" 유도 (§8/§9) |

## 2. 왜 이 지점을 baseline으로 잡나

- **RAG를 붙이기 전에 재야 한다.** RAG Tool이 추가되면 "정확한 값 질문에 RAG를 잘못 고르는"
  새로운 실패 모드가 생긴다(§7/§8). 그 전에 순수 2-Tool 라우팅의 정확도를 고정해두어야
  Stage 1-4(RAG hit rate)·Stage 3-3(가드레일 후 재측정)의 Before 값이 생긴다.
- **모델 선택의 기준선.** 이 질문 세트와 지표를 그대로 재사용해 `CHAT_MODEL`만 바꿔가며
  GPT/Claude/Gemini/Grok을 비교한다(별도 이슈). 먼저 현재 기본값(Gemini)의 수치가 있어야
  "무엇 대비 좋다/나쁘다"를 말할 수 있다.
- **시드 데이터가 라우팅을 어렵게 만든다.** 과목 코드가 `21003183-1` 형식이라 사용자가 코드로
  묻는 일이 드물고, 전 과목 `department`가 `컴퓨터공학` 한 값이라 학과 필터가 무의미하며,
  동명 과목이 분반으로 여러 개다(`데이터베이스설계와질의` 3개). 이 조건에서 라우팅이
  실제로 얼마나 버티는지가 궁금한 지점이다.

## 3. 측정 범위 경계

- **측정한다**: LLM이 고른 Tool·인자, 최종 답변의 근거 정합성, 에이전트 invoke latency, Gemini 토큰
- **측정하지 않는다**: E2E latency(Node 프록시+SSE 포함, → Stage 3-3), rate limit 동작(→ Stage 3-0),
  세션 저장/조회(`db-chat`/`redis-chat`, → Stage 0-5에서 수동 E2E로 이미 확인)
- 하네스는 `chat.agent.get_agent()`를 직접 호출한다. 인증·프록시·스트리밍·DB·Redis를 우회해
  "Tool 선택" 하나만 분리한다. 멀티턴 히스토리는 production(`router.py`)과 동일하게
  user/assistant **텍스트만** 되재생한다(ToolMessage는 다음 턴에 넘기지 않음).

## 4. 지표 정의

| 지표 | 정의 | 분모 |
|---|---|---|
| **Tool 선택 정확도** | 기대 Tool 동작과 일치한 turn 비율 | Tool 차원을 채점하는 모든 turn(`ignore` 제외) × rep |
| **파라미터 정확도** | 맞는 Tool을 부른 전제로, 인자에 기대 부분문자열이 든 turn 비율 | 구체 Tool을 기대하고 `expect_args`가 라벨된 turn 중, 그 Tool이 실제 호출된 turn × rep |
| **과잉 호출률** | `expect_tool: none` 인데 Tool을 1개 이상 부른 비율 | `none` 기대 turn × rep |
| **과소 호출률** | Tool 호출을 기대(`search_courses`/`get_course_by_code`/`any`)했는데 0개 부른 비율 | 해당 turn × rep |
| **답변 포함 검사 통과율** | 최종 답변에 `answer_must_include` 값이 전부 들어간 비율 | 해당 라벨이 있는 turn × rep |
| **답변 제외 검사 통과율** | `answer_must_not_include` 값이 하나도 안 들어간 비율(할루시네이션 근사) | 해당 라벨이 있는 turn × rep |
| **안정성(sd)** | rep별 Tool 선택 정확도의 표준편차 | rep 5개 |
| **전 rep 통과 시나리오 수** | 5회 반복 내내 Tool 선택이 통과한 시나리오 / 채점 대상 시나리오 | — |
| **latency** | 에이전트 invoke 구간 p50/p95/mean (ms) | 오류가 아닌 turn |
| **토큰** | `usage_metadata` 합계, turn당 평균 | 오류가 아닌 turn |

**할루시네이션 최종 판정은 수동**이다(ADR-010 §14). `answer_must_include/not_include`는 자동
근사일 뿐이라, 실행 후 raw jsonl의 답변을 표본으로 읽고 "Tool/관측값 근거 없이 지어낸" 비율을
직접 센다.

## 5. 질문 세트 설계

- **크기**: 1차 70 시나리오(카테고리 7종 × 10), 82 turn. `backend/ai-server/eval/questions.yaml`.
- **작성 주체**: 수동 작성(ADR-010 §14 "1차 완전 수동"). 라벨(`expect_*`)은 `seedData.js` 실측값과 대조.
- **형식**: 스키마는 파일 상단 주석. 시나리오 = 대화 1개, 단일턴이면 turn 1개·멀티턴이면 2~3개.
- **turn별 기대 분포**: `search_courses` 52 / `get_course_by_code` 10 / `none` 12 / `ignore` 7 / `any` 1.

| 카테고리 | 노리는 것 | 기대 |
|---|---|---|
| 과목검색 | 이름/키워드로 목록 찾기 | `search_courses`, keyword 정확도 |
| 코드조회 | 코드가 주어진 단건 질문 | `get_course_by_code`, code 정확도 |
| 잔여석 | 코드 없이 이름만 주고 자리 여부 | `search_courses` 후 잔여석 답변 |
| 분반비교 | 동명 과목 여러 분반 중 선택 | `search_courses` 후 여러 결과 비교 |
| 모호 | 여러 과목 매칭 | 되묻기/목록 제시(최소 `search_courses`) |
| 범위밖 | 신청 대행·대기열 순번·무관한 질문 | `none` — 거절 + UI 유도 |
| 멀티턴 | 앞 대화를 기억해야 답 가능 | 컨텍스트 유지 (Tool 재호출 여부는 `ignore`, 답변만 채점) |

## 6. 실행 절차

1. `docker compose up -d db backend_1 redis rabbitmq` — backend_1이 과목 마스터를 시딩.
   **좌석 수 라벨은 이 갓 시드된 상태 기준**이므로, 연습 앱으로 신청을 돌린 적 있으면
   `db` 볼륨을 초기화하고 다시 띄운다.
2. `docker compose build ai-server` — `eval/` + `pyyaml` 반영
3. `docker compose run --rm --no-deps -v "$PWD/doc/experiment/raw:/out" ai-server python -m eval.run_tool_eval --out-dir /out`
   - 질문당 **5회 반복**(기존 실험 패턴). 82 turn × 5 = 410 invoke, invoke당 최대 2회 LLM 호출
     (Tool 호출 + 최종 답변) ≈ 600~800 Gemini 호출. rate limit 시 자동 backoff 재시도.
   - 1차 감을 잡을 땐 `--reps 3` 또는 `--limit`으로 축소 실행 후 전체 5회.
4. 산출물
   - `doc/experiment/raw/03-tool-eval-<model>-<ts>.jsonl` — turn별 원본(질문/tool_calls/답변/latency/토큰/점수)
   - `doc/experiment/raw/03-tool-eval-<model>-<ts>-summary.json` — 집계
5. `03-결과.md`에 요약표 + 카테고리별 분석 + 수동 할루시네이션 표본 판정을 정리.

## 7. baseline 이후 (이 실험의 범위 밖)

- **개선 후보**: Tool description 정교화(§8 "언제 쓰지 않는지"까지 명시), `search_courses`가
  전체 목록을 반환할 때의 토큰 비용, 시스템 프롬프트의 거절 지시 강화. 각각 이 지표로 재측정.
- **모델 비교**: 같은 질문 세트로 `CHAT_MODEL` 스위프 → `doc/experiment/`에 원본, 선정 이유는 새 ADR.
- **RAG 결합 후(Stage 1-4)**: Tool 3개 체제에서 이 질문 세트를 재실행해 "RAG 오선택률" 추가.

## 8. 성공 기준

이 실험 자체에 합격/불합격 임계값은 두지 않는다 — **baseline을 남기는 것이 목적**이다. 다만
아래는 실행 후 반드시 답이 나와야 하는 질문이다:

- 카테고리별로 Tool 선택 정확도가 어디서 무너지는가? (모호·분반비교·멀티턴이 취약할 것으로 예상)
- 과잉 호출(범위 밖 질문에 Tool을 부름)이 실제로 일어나는가?
- 좌석 수처럼 정확한 값을 물었을 때 Tool 없이 지어내는 사례가 있는가?
- 5회 반복에서 라우팅이 흔들리는(flaky) 질문이 있는가?
