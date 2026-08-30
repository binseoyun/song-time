# 실험계획서 04: RAG 검색 hit rate + naive 베이스라인 Before/After

- 작성일: 2026-08-31
- 상태: 계획 확정, 실행 중
- 관련: [ADR-010](../ADR/ADR-010-AI-에이전트-챗봇-설계.md) §7(Tool vs RAG)·§13(청킹)·§14(측정), [구현계획](../AI-에이전트-구현계획.md) Stage 1-4, 이슈 #104
- 하네스: `backend/ai-server/eval/run_rag_eval.py` · `rag_scoring.py` · `_harness.py`
- 질문 세트: `backend/ai-server/eval/rag_questions.yaml` (54문항)

> 새 기능이라 비교 대상이 없는 게 아니다(ADR-010 §14). Stage 1-1에서 "이 프로젝트의 옛
> `/recommend`가 전체 과목 텍스트를 프롬프트에 주입하는 방식"임을 확인했다. 그게 **naive
> 베이스라인(Before)** 이고, RAG(Qdrant top-3)가 **After** 다.

---

## 1. 무엇을 측정하나

Stage 1-2(#100)에서 강의계획서 18청크를 Qdrant에 적재하고, Stage 1-3(#102)에서
`search_syllabus`·`get_syllabus` Tool을 붙였다. 이제:

1. **검색이 정답 청크를 끌어오는가** — retrieval hit rate@k
2. **에이전트가 강의계획서 질문에 RAG Tool을 고르는가** — routing
3. **강의계획서가 없는 과목을 지어내지 않는가** — 미등록 할루시네이션
4. **정확한 값(잔여석·정원) 질문에 RAG를 오선택하지 않는가** — 범위밖
5. **1-3 변경(Tool 2개 추가 + 프롬프트 2문장)이 기존 라우팅을 깨지 않았는가** — routing 회귀
6. **naive(전문 주입) 대비 정확도·비용·확장성** — Before/After

## 2. 질문 세트 (`rag_questions.yaml`, 54문항)

| category | expect_kind | 수 | 채점 |
|---|---|---|---|
| 의미검색 | `hit` | 35 | 정답 `course_code`가 `search_syllabus` top-k에. 17과목 전부 커버 |
| 미등록 | `not_registered` | 7 | `answer_must_not_include` 위반 없음 / "미등록"이라 답함 |
| 범위밖 | `out_of_scope` | 5 | `search_syllabus`·`get_syllabus` 둘 다 안 부름 |
| 라우팅 | `routing` | 7 | `expect_tool`(search_courses/get_course_by_code/any/none) 일치 + 강의계획서 Tool 안 부름 |

전부 단일 턴. Stage 1-1에서 강의계획서 19개를 정독하며 손으로 라벨링(라우팅 7개는 1-4에서 추가, 현행 37분반 기준).

## 3. 세 가지 실행 모드

| `--mode` | 무엇 | 목적 | 비용 |
|---|---|---|---|
| `retrieval` | 에이전트 없이 `search_syllabus` 로직만 35회 | 순수 hit rate@1/3/5. 임베딩은 결정론적이라 reps=1 | 임베딩 35회(~$0) |
| `agent` | 질문마다 에이전트 호출(reps=3), tool_calls·retrieved·답변 채점 | 실제 챗봇 동작 — 라우팅·할루시네이션·오선택 | 162 invoke |
| `naive` | 강의계획서 18청크 전문(~11k 토큰) + 질문 단일 LLM 호출, Tool 없음(reps=3) | Before 베이스라인 — hit/미등록만 답변 레벨 채점 | 126 invoke × ~11k 입력 토큰 |

## 4. 지표

**retrieval**
- `hit@1`, `hit@3`, `hit@5` — 정답 `course_code`가 상위 k에 드는 비율. **k=3이 운영값**(1-3에서 top-3 반환)

**agent**
- 의미검색: `hit@3` + `search_syllabus_called` + 답변 할루시네이션 없음 → pass
- 미등록: `answer_must_not_include` 위반 없음 → pass
- 범위밖: 강의계획서 Tool 미호출 → pass
- 라우팅: `expect_tool` 일치 + 강의계획서 Tool 미호출 → pass
- 안정성: 시나리오당 3회, 전 rep pass 수 / flaky
- latency(invoke), Gemini 토큰

**naive vs agent(RAG) 비교표**
| | naive (전문 주입) | RAG (top-3) |
|---|---|---|
| 의미검색 정답률 | 답변이 정답 과목명 언급 | hit@3 + 답변 |
| 미등록 할루시네이션 | 위반율 | 위반율 |
| turn당 입력 토큰 | ~11k 고정 | 임베딩 + top-3 |
| 확장성 | 수백 청크 시 컨텍스트 한도 | 무관 |

## 5. threshold 결정

1-3에서 `search_syllabus`는 cutoff 없이 top-3를 반환한다. 이 측정에서:
- 35개 의미검색 정답의 `relevance` 분포
- "코퍼스에 없는 질문"(미등록 rag-40/41 + 라우팅 rag-51 등)에서 `search_syllabus`가 뱉는 top1 점수

두 분포에 갭이 보이면 그 사이에 threshold를 박고, 겹치면 두지 않는다(측정 후 결정 원칙).

## 6. 범위 밖

- 기존 `questions.yaml` 74문항 전면 재라벨 + `seedBenchmarkSeats.js` 픽스처 → **Stage 3-3**
- Stage 3-3 가드레일 전/후 최종 종합 측정에서 이 1-4 수치를 After로 종합

## 7. 재현

```bash
# 스택: backend + qdrant + syllabi 적재 완료 상태
docker compose build ai-server
MSYS_NO_PATHCONV=1 docker compose run --rm --no-deps \
  -v "$(pwd)/doc/experiment/raw:/out" ai-server \
  python -m eval.run_rag_eval --mode retrieval --reps 1 --out-dir /out
#   ... --mode agent   --reps 3 --sleep 1 --label s1-3
#   ... --mode naive   --reps 3 --sleep 1
```

Git Bash에서 `MSYS_NO_PATHCONV=1` 없으면 `/out`이 `C:/Program Files/Git/out`으로 뭉개진다.

결과: [`04-결과.md`](04-결과.md)
