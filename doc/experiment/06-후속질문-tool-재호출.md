# 챗봇: 후속 질문에서 강의계획서 Tool 재호출 안 함 → 교수 이메일 할루시네이션

- 이슈: #117
- 관련: ADR-010 §8/§13/§14, `doc/AI-에이전트-구현계획.md` (Stage 3 이후 실사용 버그 트랙)
- 상태: **완료.** 재현 케이스 추가 → Before → 수정(A) → After.
- 선례: Stage 3-1b(#93) — "실사용 → 버그 → Tool/프롬프트 보강 + 벤치마크 강화" 루프

---

## 0. 배경 — 5개월 뒤에 봐도 이해되게

챗봇은 매 턴 다음 3가지만 보고 답한다: ① 시스템 프롬프트 ② 최근 대화 ③ Tool 4개 설명서.
이때 **②에 저장되는 "최근 대화"는 `{역할, 최종 답변 텍스트}` 뿐**이다 —
`chat/cache.py`의 `append_turn`, `chat/router.py`의 `_to_history_messages`가 사용자 발화와
어시스턴트의 **최종 답변만** 남기고, 그 답을 만들 때 Tool이 가져온 원본 관측값
(`get_syllabus`가 준 평가 비중·교수 이메일 JSON 등)은 **다음 턴에 사라진다**.

설계 의도는 맞다 — Tool 관측값은 크고(강의계획서 1건 payload ≈ 2KB), 매 턴 히스토리에
쌓으면 토큰이 선형으로 늘어난다. 필요하면 다시 부르면 된다.

문제는 "다시 부르면 된다"를 모델이 항상 하지는 않는다는 것이다.

---

## 1. 증상 (실사용 재현)

사용자가 한 세션에서 데이터베이스설계와질의 강의계획서를 네 턴에 걸쳐 물어본 뒤:

```
사용자: 심준호 교수님 이메일 알아?
챗봇:  심준호 교수님의 이메일 주소는 jhshim@university.ac.kr 입니다.
```

실제 값은 `jshim@sookmyung.ac.kr` (`backend/ai-server/rag/syllabi.yaml`,
그리고 **같은 세션 3·4턴의 `get_syllabus` 관측값에도 그 값이 들어 있었다**).
지어낸 답은 로컬파트(`jhshim` vs `jshim`)·도메인(`university.ac.kr` vs `sookmyung.ac.kr`)
둘 다 틀렸다 — `이름@university.ac.kr`이라는 "대학 이메일처럼 생긴" 형식을 만들어냈다.

### 세션 트레이스 (`db-chat.chat_messages.tool_calls`, 세션 `7a28c737…`)

| 턴 | 질문 | Tool 호출 | 결과 |
|---|---|---|---|
| 1 | 이번 학기에 데이터 관련 수업 있어? | `search_courses("데이터")` | 정상 |
| 2 | 심준호 교수님의 데이터베이스설계와 질문은 분반별 수업 시간? | `search_courses` + `get_course_by_code` ×3 | 정상 |
| 3 | 그럼 저거 1,2,3 분반 평가 기준? | `get_syllabus("21003183")` | 정상 (grading: 45/50/5) |
| 4 | 그러면 책은 뭐써 | `get_syllabus("21003183")` (재호출) | 정상 (교재/참고문헌) |
| 5 | **심준호 교수님 이메일 알아?** | **없음** | **할루시네이션** |
| 6 | 저거 근데 뭐 배우는 수업이야? | 없음 | 모델 자체 지식 (표준 과목이라 우연히 맞음) |

3·4턴은 `get_syllabus`를 (재)호출했는데 5턴은 안 했다. 차이는 질문의 성격 —
"평가 기준", "책"은 명백히 강의계획서 조회로 읽히고, "교수 이메일"은 모델이
"그 정도는 그냥 답하지" 하고 넘어간다.

---

## 2. 재현 조건

`chat.agent`를 직접 호출(하네스와 동일, Node/SSE 우회)해 5턴을 순서대로 넣고
5턴째 답변을 본다. `gemini-3.1-flash-lite`, temperature=0.

| 5턴 프리픽스 | 5턴째 결과 (5회 반복) |
|---|---|
| 사용자 발화 그대로 (2턴 "…데이터베이스설계와 **질문은**…" 오타 포함) | `get_syllabus` **미호출 5/5**, `jhshim@university.ac.kr` **5/5** |
| 2턴을 "데이터베이스설계와질의"로 정정 | `get_syllabus` 호출, 정답 이메일 5/5 |
| 3턴짜리 축약(평가기준 → 교재 → 이메일) | `get_syllabus` 호출, 정답 이메일 5/5 |

→ **버그는 "드리프트 의존"이다.** 대화 컨텍스트가 지저분할수록(오타 검색, 여러 번의
`get_course_by_code`, 턴 수 누적) 5턴째에 Tool을 건너뛴다. 짧고 깔끔한 흐름에선 안 난다.
그래서 기존 벤치마크(단일턴 위주)가 못 잡았다.

---

## 3. 벤치마크 추가

멀티턴 + 강의계획서 후속 질문은 기존 두 세트 어디에도 안 맞았다:

- `questions.yaml` / `run_tool_eval` — 멀티턴은 되지만 `expect_tool`이 `search_courses`/
  `get_course_by_code`만 (syllabus Tool은 "부르면 안 되는 경우"만 확인)
- `rag_questions.yaml` / `run_rag_eval` — `get_syllabus` 의미는 되지만 단일턴만

→ `run_rag_eval`에 **멀티턴 지원 + `expect_kind: syllabus_followup`** 추가:

| 파일 | 변경 |
|---|---|
| `rag_questions.yaml` | `후속` 카테고리 2개. `turns[]`(문자열 리스트), `expect_tool_lastturn`, `answer_must_include`(정답 이메일), `answer_must_not_include`(할루시네이션 마커) |
| `run_rag_eval.py` | `load_items` 가 `syllabus_followup` = `turns` 필수로 검증. `_run_multiturn` — 턴을 순서대로 invoke, 히스토리는 `router.py`처럼 **최종 답변 텍스트만** 보존. 마지막 턴만 채점. `retrieval`/`naive` 모드는 이 kind를 건너뜀 |
| `rag_scoring.py` | `score_agent`에 `syllabus_followup` 분기 — pass = 마지막 턴에 `get_syllabus` 호출 AND `answer_must_include` 충족 AND 할루시네이션 마커 없음. 선행 `search_courses`(코드 찾기)는 penalize 안 함 |
| `test_rag_scoring.py` | 단위 테스트 4개 |

| 시나리오 | 5턴 흐름 | 마지막 질문 | 정답 |
|---|---|---|---|
| `rag-54` | #117 실사용 그대로(오타 포함) | 심준호 교수님 이메일 알아? | `jshim@sookmyung.ac.kr` |
| `rag-55` | 알고리즘, 깔끔한 흐름 | 안태훈 교수님 이메일 주소 뭐야? | `taehoon@sookmyung.ac.kr` |

`rag-55`는 "고쳐도 깨지면 안 되는" 케이스(정상 멀티턴) 겸 일반화 확인.

---

## 4. Before (2026-09-01, `gemini-3.1-flash-lite`, 3 reps)

원본: `doc/experiment/raw/04-rag-eval-agent-117-before-20260901.jsonl`

| 시나리오 | pass | last-turn `get_syllabus` | 이메일 정답 | 할루시네이션 없음 |
|---|---|---|---|---|
| `rag-54` | **0/3** | 0/3 | 0/3 | 0/3 (`jhshim@university.ac.kr` 3/3) |
| `rag-55` | 3/3 | 3/3 | 3/3 | 3/3 |
| **`후속` 합계** | **50.0%** | 50.0% | 50.0% | 50.0% |

**회귀 확인**: 하네스 변경(`run_rag_eval`/`rag_scoring`)이 기존 채점을 안 바꾸는지 —
Stage 1-4 agent raw를 새 코드로 `--rescore` → hit 100%/97.1%, not_registered 100%,
out_of_scope 100%, routing 100%, 54/54 전 rep 통과. **동일.** retrieval 모드도 35문항
hit@3 100%로 불변.

---

## 5. 수정 (A) — 시스템 프롬프트

`chat/agent.py` `SYSTEM_PROMPT`, 2군데:

1. "강의계획서 내용(…·주교재·선수과목)" 목록에 **"·담당교수 이메일·연구실"** 추가.
   교수 이메일이 원래 이 목록에 없어서 모델이 "강의계획서 값 = Tool 전용"으로 안 봤다.
2. 한 문장 추가: **"앞선 대화에서 이미 조회했더라도 그 값이 지금 대화 내용에 그대로
   보이지 않으면 get_syllabus를 다시 호출해 확인하고, 기억에 의존해 답하지 않는다."**

후보 B(과목 API에 `professor_email` 얹기)는 Class 스키마 확장이 필요해 범위가 크고,
C(Tool description 수정)는 A와 겹쳐서 A만 적용. flash-lite 과적합 위험(#113) 때문에
프롬프트 다른 부분은 안 건드렸다.

---

## 6. After (2026-09-01, `gemini-3.1-flash-lite`)

원본: `doc/experiment/raw/04-rag-eval-agent-117-after-A-20260901.jsonl` (재현 5 reps),
`...-after-A-full-20260901-summary.json` (전체 3 reps),
`...-baseline-nofix-20260901-summary.json` (수정 없이 같은 환경 3 reps).

### 재현 시나리오 (5 reps)

| 시나리오 | Before | After (A) |
|---|---|---|
| `rag-54` | **0/3** (`jhshim@university.ac.kr`) | **5/5** ✅ (`get_syllabus` 재호출 → `jshim@sookmyung.ac.kr`) |
| `rag-55` | 3/3 | 5/5 |
| **`후속` pass** | **50%** | **100%** |

### 전체 `rag_questions.yaml` (56 시나리오, agent, 3 reps) — 수정 전/후 동일 환경 비교

| 카테고리 | Before (수정 없음) | After (A) |
|---|---|---|
| overall | 91.1% | 95.8% |
| hit (의미검색) | 91.4% | 94.3% |
| not_registered (미등록) | 85.7% | 95.2% |
| **out_of_scope (범위밖)** | **100%** | **100%** |
| **routing (라우팅)** | **100%** | **100%** |
| **syllabus_followup (후속)** | **50%** | **100%** |

**회귀 판정: 없음.**
- 라우팅 오선택에 민감한 두 카테고리(`out_of_scope`·`routing`)는 양쪽 다 결정적 100%.
- `hit`/`not_registered`의 rep별 흔들림은 **`search_syllabus`가 에러를 반환한 케이스**
  (Stage 3-2 degrade 문구 "강의계획서 검색 기능을 사용할 수 없어…", `retrieved: []`).
  Qdrant / `gemini-embedding-001` API의 일시적 실패다 — **양쪽 실행 모두 p95 latency
  ≈ 18초**, flaky 시나리오 목록도 실행마다 바뀜(Before: rag-03/10/12/13/22/23/24/33/34,
  After: rag-11/21/23/32/34/41 — 겹침 2개). 수정과 무관한 환경 노이즈다.
- flaky 재확인: 위 flaky 13개를 `--sleep 4`로 재측정 → 11/13 전 rep 통과, 남은 2개
  (rag-10/11)도 실패 원인이 전부 `search_syllabus` 에러였다.

### 비용

`SYSTEM_PROMPT` +약 90자 → input 토큰 turn당 소폭 증가(무시 가능). latency invoke
구간은 불변(에러 케이스 제외 p50 ≈ 2.4초).
