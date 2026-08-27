# 실험 03 — Stage 3-1: 프롬프트/Tool 고도화 Before/After

- 작성: 2026-08-27
- 상태: **완료.** 1차(프롬프트+professor 필터) 재측정 → 실사용에서 노이즈 토큰 버그 발견 → 2차 수정 + 재측정(72문항×5회). §8: 좌석 데이터 소스 단일화(#86).
- 관련: 이슈 #82·#86, [ADR-010](../ADR/ADR-010-AI-에이전트-챗봇-설계.md) §8, [ADR-012](../ADR/ADR-012-챗봇-LLM-모델-선정.md), [ADR-013](../ADR/ADR-013-좌석-데이터-소스-단일화.md), [모델 비교](03-모델비교.md), [baseline](03-결과.md)
- 대상 모델: `gemini-3.1-flash-lite` (ADR-012 선정)
- Notion: [실험 결과 보고서 06](https://app.notion.com/) *(작성 후 링크)*

---

## 1. 문제 파악 — 측정이 알려준 3가지

`gemini-3.1-flash-lite`는 7종 비교([03-모델비교.md](03-모델비교.md))에서 Tool 선택 100%·과잉 호출 0%로 이미 최고였다. 하지만 raw 데이터를 파고들면 **닫아야 할 갭 3개**가 남아 있었다.

### 1-1. [실제 갭] "교수명으로 검색"이 안 됨 — Tool 능력 부재

`search-03`("심준호 교수님 수업 뭐뭐 하셔?"), `multiturn-04`("심준호 교수님 무슨 과목 하셔?")에서:

```
사용자: 심준호 교수님 수업 뭐뭐 하셔?
모델:  search_courses(keyword="심준호")  →  []   (빈 결과)
모델:  "심준호 교수님으로 등록된 과목을 찾지 못했습니다. 과목명이나 다른 검색어로 다시 문의해 주세요."
```

`search_courses`가 **keyword를 `name`(과목명)과 `department`(학과명)에만 매칭**하고 `professor`(교수명)는 안 봤다. `department`는 전 과목이 `컴퓨터공학` 한 값이라 실질 필터링 능력이 없다시피 했다.

- **채점 영향**: 답변 포함 검사(`answer_must_include: ["데이터베이스설계와질의"]`) 5회 반복 전부 실패 → 이 항목 **77.8% (35/45)**.
- flash(3.6/3.7) 계열은 `search_courses(keyword="")`로 전체 92과목을 받아 스스로 "심준호 = 데이터베이스설계와질의"를 필터하는 우회를 했다. flash-lite는 이 우회를 하지 않았다 — "덜 나서는" 성향의 이면.
- **다만 flash-lite는 오답을 지어내지 않았다**(할루시네이션 0). "못 찾음 + 되물음"은 오답이 아니라 **마찰(friction)**이다.
- gpt-5-nano는 같은 상황에서 `search_courses("심준호")` → `search_courses("Shim Junho")`(로마자) → `search_courses("")` → 각 분반 코드 조회를 반복하다 recursion limit(13)에 걸려 **오류**로 끝났다.

### 1-2. [위생] Tool description의 잘못된 예시 + 과잉 fetch 유발

- `get_course_by_code` docstring 예시가 **`CS301`** — 시드 데이터에 없는 형식(실제는 `21003183-1`). 잘못된 예시가 모델의 코드 형식 추론을 오도할 수 있다.
- `search_courses` description이 "잔여석 정보를 조회한다"까지만 말해서, 모델이 결과에 이미 교수·학점이 들어 있는 줄 모르고 **결과마다 `get_course_by_code`를 다시 부르는 과잉 fetch**를 한다. `gemini-3.1-flash-lite`도 turn당 Tool 2개+ 호출이 15/410건 있었다.

### 1-3. [문서화·견고성] 거절 상황의 Tool 비호출이 프롬프트에 명시 안 됨

`gemini-3.1-flash-lite`는 `oos-01`(신청 대행)·`oos-04`(꿀강)·`oos-08`(관심과목 담기)에서 이미 Tool을 안 부르고 거절했다(과잉 호출 0%). 하지만 이건 **모델의 자연스러운 판단**이었지 프롬프트의 명시적 지시가 아니었다.

- 현재 시스템 프롬프트: "실제 실시간 수강신청/취소는 네가 대신 해줄 수 없다 — 화면에서 직접 신청하도록 안내한다." → **신청/취소만** 다루고 관심과목 담기·강의평은 언급 없음.
- flash/flash-lite 외의 모델(GPT 등)은 이 부분에서 대량 과잉 호출을 했다(gpt-5-nano/mini 46%). 프롬프트에 명시해두면 모델 교체 시에도 방어된다.

---

## 2. 어떻게 재설계했나 — "Tool을 유능하게" vs "프롬프트로 곡예"

### 2-1. 핵심 결정: 교수명 검색은 프롬프트가 아니라 Tool을 고친다

두 가지 방법이 있었다:

| 대안 | 방법 | 트레이드오프 |
|---|---|---|
| A. 프롬프트/description으로 우회 지시 | "교수명 질문이면 `search_courses(keyword="")`로 전체 조회 후 professor로 직접 필터하라" | flash 계열이 하던 우회를 명문화. **모델에게 다단계 추론을 요구** — flash-lite처럼 "시킨 것만" 하는 모델엔 취약. description이 길고 복잡해짐 |
| **B. `search_courses`가 professor도 매칭** | keyword 필터에 `professor` 조건 1줄 추가 | **Tool이 실제로 그 능력을 갖게 됨.** 모델은 그냥 `search_courses("심준호")`를 부르면 됨(가장 자연스러운 호출). ADR-010 §8 "기존 API로 대부분 커버"의 연장선 |

**B를 채택했다.** ADR-010 §8의 Tool 설계 원칙("민감정보를 파라미터로 노출하지 않는다", "description에 언제 쓰지 않는지 명시")과 같은 정신 — **Tool은 도메인이 요구하는 조회를 직접 할 수 있어야 하고, 모델에게 우회 추론을 떠넘기지 않는다.** 부수 효과로 flash 계열의 "전체 조회 후 자체 필터"라는 비효율(토큰·지연)도 사라진다.

### 2-2. 시스템 프롬프트는 최소한만 — flash-lite 과적합 위험

`gemini-3.1-flash-lite`는 지시를 문자 그대로 따르는 성향이다(이게 정확히 100%를 만든 이유). **지시를 더 넣으면 정상 질의까지 과도하게 거절할 위험**이 있다. 그래서:

- 거절 대상을 "신청/취소" → "신청·취소·관심과목 담기"로 확장 (실제 발견된 케이스 `oos-08` 반영)
- "강의 후기·난이도(꿀강 여부) 같은 주관적 정보도 없다" 추가 (`oos-04` 반영)
- "이런 거절 상황에서는 조회 Tool을 호출하지 않는다" 명시 (이미 0%지만 문서화 + 모델 교체 대비)
- "잔여석·과목 정보" → "잔여석·과목·교수·시간표 정보"로 범위 명확화 (교수/시간표도 Tool 근거로만)

그 외엔 건드리지 않았다. **재측정의 핵심 목적은 이 변경이 100%를 깎지 않았는지(회귀) 확인하는 것.**

---

## 3. 상세 변경 내역

### 3-1. `backend/ai-server/chat/tools.py`

**`search_courses` — professor 매칭 추가:**

```diff
     if keyword:
         courses = [
             c
             for c in courses
-            if keyword in (c.get("name") or "") or keyword in (c.get("department") or "")
+            if keyword in (c.get("name") or "")
+            or keyword in (c.get("department") or "")
+            or keyword in (c.get("professor") or "")
         ]
```

**`search_courses` docstring:**

```diff
-    """과목명 또는 학과명에 keyword가 포함된 과목들의 잔여석 정보를 조회한다.
-    keyword를 비우면 개설된 전체 과목을 반환한다. 과목 코드를 정확히 알고 있을
-    때는 이 Tool 대신 get_course_by_code를 사용한다."""
+    """과목명·학과명·담당 교수명에 keyword가 포함된 과목들을 조회한다. 반환값에는
+    각 과목의 담당 교수·학점·정원·잔여석이 모두 들어 있으므로, 요일/시간(시간표)이
+    필요할 때만 get_course_by_code를 추가로 호출한다. keyword를 비우면 개설된 전체
+    과목을 반환한다. 과목 코드(예: 21003183-1)를 정확히 알 때는 get_course_by_code를 쓴다."""
```

**`get_course_by_code` docstring — 예시 수정 + 역방향 안내:**

```diff
-    """과목 코드(예: CS301)로 특정 과목 하나를 정확히 조회한다. 담당 교수, 학점,
-    요일/시간, 잔여석 등 상세 정보를 반환한다."""
+    """과목 코드(예: 21003183-1)로 특정 과목 하나를 조회한다. 담당 교수, 학점,
+    요일/시간(시간표), 잔여석 등 상세 정보를 반환한다. 과목명이나 교수명만 알 때는
+    search_courses를 쓴다."""
```

`search_courses`가 반환하는 필드(`_summarize`)에는 이미 `professor`가 들어 있으므로, 필터 조건만 추가하면 된다. `/api/courses` API 자체는 변경 없음.

### 3-2. `backend/ai-server/chat/agent.py` — SYSTEM_PROMPT

```diff
 SYSTEM_PROMPT = (
-    "너는 대학교 수강신청 연습 플랫폼의 상담 챗봇이다. 잔여석·과목 정보는 반드시 "
+    "너는 대학교 수강신청 연습 플랫폼의 상담 챗봇이다. 잔여석·과목·교수·시간표 정보는 반드시 "
     "Tool을 호출해 얻은 값으로만 답하고, 절대 추측하지 않는다. Tool로도 알 수 없는 "
-    "질문에는 모른다고 답한다. 실제 실시간 수강신청/취소는 네가 대신 해줄 수 없다 — 사용자가 "
-    "화면에서 직접 신청하도록 안내한다."
+    "질문에는 모른다고 답한다. "
+    "실시간 수강신청·취소·관심과목 담기 같은 행동은 네가 대신 해줄 수 없다 — 거절하고 화면에서 "
+    "직접 하도록 안내한다. 강의 후기·난이도(꿀강 여부) 같은 주관적 정보도 없다. "
+    "이런 거절 상황에서는 조회 Tool을 호출하지 않는다."
 )
```

**전체 프롬프트 (After):**
> 너는 대학교 수강신청 연습 플랫폼의 상담 챗봇이다. 잔여석·과목·교수·시간표 정보는 반드시 Tool을 호출해 얻은 값으로만 답하고, 절대 추측하지 않는다. Tool로도 알 수 없는 질문에는 모른다고 답한다. 실시간 수강신청·취소·관심과목 담기 같은 행동은 네가 대신 해줄 수 없다 — 거절하고 화면에서 직접 하도록 안내한다. 강의 후기·난이도(꿀강 여부) 같은 주관적 정보도 없다. 이런 거절 상황에서는 조회 Tool을 호출하지 않는다.

### 3-3. `backend/ai-server/eval/questions.yaml`

`search-03`·`multiturn-04`의 `note`만 갱신 (Tool 한계가 해소됐음을 반영). **채점 라벨(`expect_tool`, `answer_must_include`)은 변경 없음** — Before/After 비교의 통제변인 유지.

---

## 4. 스모크 검증 (재측정 전 4개 케이스, `gemini-3.1-flash-lite`)

| 질문 | Before (모델 비교 시) | After |
|---|---|---|
| "심준호 교수님 수업 뭐뭐 하셔?" | `search_courses("심준호")` → `[]` → "못 찾음, 다시 검색" | `search_courses("심준호")` → 3개 분반 반환 → "심준호 교수님은 '데이터베이스설계와질의' — 21003183-1 잔여 19석, -2 잔여 2석, -3 …" ✅ |
| "클라우드시스템 꿀강이야? 과제 많아?" | (flash-lite는 0%였으나) | Tool 호출 0 → "강의 후기·과제량 같은 주관적 정보는 제공 불가" ✅ |
| "딥러닝개론 관심과목에 담아줘" | 〃 | Tool 호출 0 → "수강신청·취소·관심과목 담기 등은 대신 못 함, 화면에서 직접" ✅ |
| "알고리즘 자리 있어?" | `search_courses("알고리즘")` 정상 | `search_courses("알고리즘")` 정상 (회귀 없음) ✅ |

---

## 5. 1차 측정 — 프롬프트 + professor 필터 (중간 체크포인트)

> ⚠️ 이 절은 1차 변경(프롬프트 + professor 필터)만의 결과다. **실사용에서 노이즈 토큰 버그를 추가로 발견**해 2차 수정을 했고, **최종 수치는 §6-2**에 있다.

- **Before**: `gemini-3.1-flash-lite`, [03-모델비교.md](03-모델비교.md) §2 (2026-08-26, `raw/03-tool-eval-gemini-3.1-flash-lite-sweep-20260826-165203.jsonl`)
- **After (1차)**: 같은 70문항 × 5회, 프롬프트/Tool 1차 변경 후 (2026-08-27, `raw/03-tool-eval-gemini-3.1-flash-lite-after-prompt-20260827-054129.jsonl`)

| 지표 | Before | After | 변화 |
|---|---|---|---|
| Tool 선택 정확도 | 100% | **100%** | 유지 (회귀 없음) |
| 과잉 호출률 (`none` 기대인데 호출) | 0% | **0%** | 유지 — 프롬프트 명시 후에도 |
| 과소 호출률 (호출 기대인데 0개) | 0% | **0%** | 유지 — 프롬프트 확장이 정상 질의를 거절시키지 않음 |
| 파라미터 정확도 | 100% | **100%** | 유지 |
| **답변 포함 검사** | **77.8% (35/45)** | **100% (45/45)** | **+22.2%p — 교수명 검색 갭 완전 해소** |
| 답변 제외 검사 | 100% | 100% | 유지 (할루시네이션 0) |
| 전 rep 통과 시나리오 | 70/70 | **70/70** | 유지 |
| turn 오류 | 0 | 0 | 유지 |
| latency p50 / p95 (ms) | 1,672 / 2,373 | **1,618 / 2,182** | 약간 개선 |
| turn당 토큰 (in / out) | 731 / 133 | 1,014 / 131 | input +283 |
| turn당 비용 | $0.000384 | $0.000451 | +17% ($0.38 → $0.45 / 1,000 turn) |
| 과잉 fetch (turn당 Tool 2개+) | 15/410 | 20/410 | +5 (아래 참고) |

### 카테고리별 Tool 선택 정확도

| 카테고리 | Before | After |
|---|---|---|
| 과목검색 / 코드조회 / 잔여석 / 분반비교 / 모호 / 멀티턴 / 범위밖 | 전부 100% (범위밖만 100%, 나머지 100%) | **전부 100%** |

*(Before도 이미 100%였고 After도 100% — 회귀 없음)*

### 세부 관찰

- **`answer_include` 실패 [search-03×5, multiturn-04×5] → [] (0건).** After 샘플: `search_courses("심준호")` → 3개 분반 반환 → "심준호 교수님은 '데이터베이스설계와질의' — 21003183-1 잔여 19석, -2 잔여 2석, -3 잔여 19석". `multiturn-04` 2턴("그거 자리 있어?")도 컨텍스트 유지하며 정확히 답.
- **토큰 증가(731→1,014 input/turn)의 원인 2가지**: (a) 시스템 프롬프트가 길어짐(~60토큰/turn), (b) `search-03`/`multiturn-04`가 이제 빈 결과 대신 실제 과목 리스트를 관측값으로 받음. 비용은 $0.45/1,000 turn — 여전히 `gemini-3.6-flash`($3.26)의 1/7.2.
- **과잉 fetch 15→20**: description에 "시간표 필요할 때만 get_course_by_code"를 넣었으나 억제 효과는 없었다(오히려 +5). 20건 전부 `section-05`/`multiturn-03/05/07` = **시간표(요일/시간)를 실제로 물은 질문**이라, `search_courses` 후 `get_course_by_code`로 스케줄을 받는 게 정당한 동작이다. "과잉"이 아니라 필요한 fetch. description 문구가 이 판단을 바꾸진 못했지만 정확도엔 무해.
- **회귀 없음 확정**: 10개 `oos` 시나리오 전부 turn 0에서 Tool 호출 0. 시스템 프롬프트 확장이 정상 질의를 거절하게 만들지 않았다(과적합 우려 해소). `answer_exclude` 실패 0.

---

### 5-1. 1차 소결

답변 포함 검사 77.8% → 100%(교수명 갭 해소), 나머지 지표 전부 유지(회귀 없음). 이 시점엔 "완료"로 보였으나 — 아래 §6-1의 실사용 버그가 남아 있었다.

## 6-1. 2차 — 실사용에서 발견한 "노이즈 토큰" 버그

1차 재측정에서 70/70·답변 포함 100%가 나왔지만, **실제 챗봇을 써 보니 벤치마크가 못 잡은 버그**가 있었다.

### 문제

| 사용자 질문 | 증상 |
|---|---|
| "창병모 교수님 이번학기 수업 해?" | "이번 학기에 수업하지 않으십니다" (창병모는 리눅스시스템·자바프로그래밍 강의 중) |
| "데이터베이스 관련 수업 알려줘" | 5개 중 2개만 나옴 |

**원인**: 모델이 `keyword`에 군더더기를 붙여 넘긴다 — `search_courses(keyword="창병모 교수님")`, `search_courses(keyword="데이터베이스 관련 수업")`. `keyword in _haystack(c)`는 부분문자열 매칭이라 `"창병모 교수님" in "... 창병모 ..."`가 **False**. 툴이 빈 결과를 반환 → "수업 안 하심".

- 모델은 보통 "교수님"을 떼고 넘기지만(1차 스모크의 `심준호` 케이스), **일관되지 않았다.**
- **벤치마크가 이걸 놓친 이유**: `search-05`("보안 쪽 수업")·`search-09`("네트워크 관련 강의")는 `expect_args: {keyword: "보안"}`처럼 **핵심어 부분문자열만 체크**했다. 모델이 `keyword="보안 쪽 수업"`을 넘겨도 `"보안" in "보안 쪽 수업"` → param 통과. 그리고 이 시나리오들엔 `answer_must_include`가 없어서 "툴이 실제로 결과를 반환했는지"를 안 봤다.

### 재설계 — 툴이 노이즈를 흡수한다

`search_courses` 필터를 2단계로:

```python
_SEARCH_NOISE = {"교수님", "교수", "님", "수업", "과목", "강의", "관련", "쪽", "들", "좀"}

def _filter_courses(courses, keyword):
    kw = keyword.strip()
    if not kw:
        return courses
    # 1) 전체 keyword를 부분문자열로 먼저 (정확·특정 검색 유지: "데이터베이스설계와질의")
    exact = [c for c in courses if kw in _haystack(c)]
    if exact:
        return exact
    # 2) 결과 없으면 군더더기 뺀 토큰들로 폴백
    tokens = [t for t in kw.split() if len(t) >= 2 and t not in _SEARCH_NOISE]
    if not tokens:
        return []
    strict = [c for c in courses if all(t in _haystack(c) for t in tokens)]  # 모든 토큰 포함 우선
    return strict or [c for c in courses if any(t in _haystack(c) for t in tokens)]  # 없으면 완화
```

`_haystack`은 `name + professor + department`를 공백으로 이어붙인 것. 3개 필드 개별 검사를 하나로 합쳐 단순화.

- `"창병모 교수님"` → exact 실패 → 토큰 `["창병모"]`(교수님은 NOISE) → **3건** ✓
- `"데이터베이스 관련 수업"` → 토큰 `["데이터베이스"]` → **5건** ✓
- `"자바 프로그래밍"` → exact 실패 → 토큰 `["자바","프로그래밍"]` → `all` = 자바프로그래밍만 **3건** (`any`면 13건 과잉) ✓
- `"데이터베이스설계와질의"` → **exact 매칭 유지 → 3건** (특정 검색 정밀도 안 깨짐) ✓

description에도 "keyword에는 핵심어만 — '교수님'·'관련'·'수업' 빼고" 힌트 추가(모델 쪽 방어).

### 벤치마크 강화

- `search-05`/`search-09`에 `answer_must_include` 추가 (실제 과목명이 답변에 나오는지)
- **신규 `search-11`** ("창병모 교수님 이번학기 수업 해?" — yes/no 프레이징, `answer_must_not_include: ["하지 않으십니다"]`)
- **신규 `search-12`** ("데이터베이스 관련 수업 알려줘" — 5개 다 나오는지, `answer_must_include: ["데이터베이스설계와질의", "박영호"]`)
- 벤치마크 70 → **72 시나리오**

### 2차 재측정 (`gemini-3.1-flash-lite`, 72문항 × 5회, 2026-08-27)

원본: `raw/03-tool-eval-gemini-3.1-flash-lite-after-prompt-v2-20260827-061601.jsonl`

**1차 raw 요약**: Tool 선택 98.7%, 전 rep 통과 71/72, 모호 카테고리 90%, 과소 호출 1.5%(5/325). — `ambiguous-08`("프로그래밍 수업 뭐 들으면 좋을까?", 13개 매칭)에서 flash-lite가 검색 대신 **"어떤 분야에 관심 있으세요? 검색해 드릴까요?"로 되물음**. 이건 Stage 3-1 프롬프트 확장의 효과(광범위한 질문에 더 신중해짐)이고, **13개를 쏟아붓는 것보다 나은 UX** — 원래 이 시나리오 note에도 "되묻기가 특히 바람직"이라고 적어놨었다. 라벨이 과했다.

→ `ambiguous-08` 라벨을 `expect_tool: search_courses` → `ignore`(검색·되묻기 둘 다 정답) + `answer_must_include: ["프로그래밍"]`로 정정하고 재채점(`scoring.py`는 순수 함수라 저장된 tool_calls/answer로 동일 결과).

**정정 후 최종 (Before/After)**:

| 지표 | Before (모델비교, 70문항) | After-v2 (72문항) | 변화 |
|---|---|---|---|
| Tool 선택 정확도 | 100% | **100%** | 유지 |
| 과잉 호출률 | 0% | **0%** | 유지 |
| 과소 호출률 | 0% | **0%** | 유지 |
| 파라미터 정확도 | 100% | 100% | 유지 |
| **답변 포함 검사** | **77.8% (35/45)** | **100%** | **+22.2%p — 교수명·노이즈 갭 해소** |
| 답변 제외 검사 | 100% | 100% | 유지 (할루시네이션 0) |
| 전 rep 통과 시나리오 | 70/70 | 71/71¹ | 유지 |
| turn 오류 | 0 | 0 | 유지 |
| latency p50 / p95 (ms) | 1,672 / 2,373 | 1,642 / 2,246 | 약간 개선 |
| turn당 토큰 (in / out) | 731 / 133 | 1,109 / 129 | input +378 |
| turn당 비용 | $0.000384 | $0.000471 | +23% ($0.38 → $0.47 / 1,000 turn) |
| 과잉 fetch (turn당 Tool 2개+) | 15/410 | 20/420 | +5 (시간표 조회 — 정당) |
| 벤치마크 크기 | 70 | 72 | search-11/12 추가 |

¹ `ambiguous-08`이 `ignore`라 tool-scored 시나리오는 71개 — 전부 통과. flaky 0.

- **신규 `search-11`("창병모 교수님 이번학기 수업 해?") / `search-12`("데이터베이스 관련 수업 알려줘"): 5/5 통과.** `search-05`/`search-09` 강화 라벨도 5/5.
- 카테고리별 Tool 선택: 7개 전부 **100%**.

## 6-2. 최종 결론

<callout>
**교수명·노이즈 토큰 갭 완전 해소, 회귀 없음.**
</callout>

1. **답변 포함 검사 77.8% → 100%.** `gemini-3.1-flash-lite`의 유일했던 약점(교수명 검색)이 사라졌고, 실사용에서 추가로 발견한 "군더더기 붙은 keyword" 버그도 함께 닫혔다.
2. **Tool 선택 100% / 과잉·과소 호출 0% / 할루시네이션 0 — 전부 유지.** 프롬프트 확장이 `ambiguous-08`에서 검색→되묻기 전환을 일으켰으나, 그건 13개 매칭 질문에 대한 **더 나은 행동**이지 회귀가 아니다(라벨 정정으로 반영).
3. **비용 +23%**($0.38→$0.47/1,000 turn) — 시스템 프롬프트가 길어지고 교수명 검색이 이제 실제 결과를 반환하는 대가. 여전히 `gemini-3.6-flash`($3.26)의 1/7.
4. **과잉 fetch를 description으로 줄이려던 시도는 효과 없음** — 다만 그 20건이 전부 시간표(요일/시간) 조회에 필요한 것이라 "과잉"이 아니었다.

**교훈 2가지:**
- **벤치마크의 `answer_must_include` 커버리지가 얇으면 "툴이 조용히 빈 결과를 반환하는" 버그를 놓친다.** 실사용 → 버그 → 툴 수정 + 벤치마크 강화 루프가 필요했다.
- **Tool을 유능하게 만드는 쪽이 프롬프트로 우회를 지시하는 것보다 견고하다** (professor 필터 1줄 + 노이즈 토큰 흡수 vs "전체 조회 후 필터하라" 다단계 지시). ADR-010 §8의 원칙이 실측으로 재확인됨.

**챗봇 프롬프트·Tool은 이 상태로 확정.** RAG 결합(Stage 1) 전까지는 더 손대지 않는다.

## 7. 다음 단계

- RAG 결합(Stage 1-4): `search_courses`/`get_course_by_code` + RAG 3-Tool 체제에서 이 74문항 재실행. RAG Tool description에 "정확한 값(잔여석·시간표)에는 쓰지 않는다" 부정형 지시(ADR-010 §8) 반영
- Stage 3-3 최종 측정: 이 결과를 가드레일 "After"로 삼아 종합

---

# 8. 좌석 데이터 소스 단일화 (이슈 #86, ADR-013)

- 작성: 2026-08-27
- 관련: 이슈 #86, [ADR-013](../ADR/ADR-013-좌석-데이터-소스-단일화.md)

## 8-1. 문제 — 챗봇이 "잔여석"을 관심과목 하트 수로 계산하고 있었다

Stage 3-1(§1~7)을 끝내고 실사용 테스트 중 발견:

| 질문 | 챗봇 답 (Before) | 실제 |
|---|---|---|
| "독일어Ⅰ 자리 있어?" | "자리가 없습니다 (잔여석 0)" | 실시간 잔여석 40 (전 좌석 비어 있음) |
| "데이터마이닝및분석 자리 남았어?" | "9석" | 실시간 잔여석 132 |
| "소프트웨어공학 자리 넉넉해?" | "14석 남음" | 실시간 잔여석 80 |

### 근본 원인 — "수강 인원"을 뜻하는 값이 3개, 서로 다른 저장소

| 개념 | 저장소 | 갱신 주체 | Before 챗봇 |
|---|---|---|---|
| 실시간 잔여석 | Redis `class:{id}:seats` | Group C 원자 연산(등록/취소) | ❌ 안 씀 |
| 관심 등록(하트) 수 | MySQL `course_interests` 테이블 행 수 | `POST /api/courses/:id/interest` | ❌ 안 씀 |
| 데모용 수강 현황 | MySQL `Class.enrolled` | 시드 하드코딩값 + 하트 토글이 `+1/−1` | ✅ `capacity - enrolled`로 잔여석 계산 |

`chat/tools.py`의 `_remaining_seats()`가 `capacity - enrolled`였다. `enrolled`는 `seedData.js`에서 가짜 초기 수강 인원(44, 50, 88, …)으로 하드코딩되고, 그 위에 `courseController.toggleInterest`가 하트마다 `Class.increment('enrolled')`. Group C 실시간 수강신청은 이 값을 **전혀 건드리지 않는다**(코드 주석에 명시). 실시간 좌석의 유일한 진실은 Redis `class:{id}:seats`.

### 오차 규모 (85개 실과목, `seedAllClassSeats.js` 직후 상태)

| 지표 | 값 |
|---|---|
| `capacity - enrolled` ≠ 실시간 잔여석 | **85 / 85 (100%)** |
| 평균 절대 오차 | **48.6석** |
| 최대 오차 | 129석 (화공기초화학Ⅱ: Before 31 → 실제 160) |
| Before가 잔여석을 **실제보다 적게** 봄(= "마감" 오답 위험) | 84 / 85 |

`enrolled`가 데모 realism용으로 대부분 과목을 "70~90% 찬 것"처럼 시드해 뒀기 때문에, 챗봇은 거의 모든 과목을 실제보다 빡빡하게 답하고 있었다.

## 8-2. 재설계 (ADR-013)

**A안 — `GET /api/courses`·`/api/courses/:code`가 실시간 좌석을 응답에 싣는다.** 챗봇이 쓰는 공개 과목 API가 좌석에 대해 진실을 말하지 않는 것 자체가 문제. Node는 이미 Group C용 ioredis 클라이언트가 있어 추가 인프라 없음. (B: 별도 엔드포인트 신설, C: 서비스 토큰으로 인증 엔드포인트 호출 — 둘 다 기각, 근거는 ADR-013.)

세부 결정:
- **1-b**: 응답의 `remainingSeats` = "실시간 잔여석"(Redis) 하나의 의미로 통일. MySQL `Class.remainingSeats` 컬럼값(naive/pessimistic 실험용, Group C에서 갱신 안 됨)은 응답에서 제거. (읽는 프론트 코드 없음 — 확인 완료.)
- **관심 등록 수**: `Class.enrolled`는 시드값이 섞여 못 씀 → `course_interests` 행 수(`GROUP BY COUNT`)를 `interestCount`로 응답에 추가.
- **2-a**: 챗봇 Tool 출력에서 `enrolled` 제거. "수업 목록" 탭이 `enrolled/capacity`로 "정원 초과"를 표시하는 것과의 불일치는 별도 이슈(2-b).
- **3-a**: Redis에 좌석 키 없으면 `remainingSeats: null` → 챗봇은 "확인 불가"로 답(폴백으로 `capacity` 안 씀).
- **4-a**: 목록은 `MGET` 1회, 단건은 `GET` 1회. Redis 장애 시 좌석만 `null`, 200 응답(500 금지).

## 8-3. 변경 내역

### `backend/src/controllers/courseController.js`

`seatSnapshot(classIds)` 헬퍼 신설 — Redis `MGET class:{id}:seats` + `course_interests` `GROUP BY COUNT`를 `Promise.all`로. 각각 실패 시 `null`/`[]`로 폴백(과목 메타 조회는 안 막음). `serializeCourse()`가 `course.toJSON()`에서 MySQL `remainingSeats`를 지우고 Redis 값 + `interestCount`를 덧붙임.

### `backend/ai-server/chat/tools.py`

`_remaining_seats()`(= `capacity - enrolled`) 삭제. `_summarize()` 출력에서 `enrolled` 제거, 3개 필드로 분리:

| 키 | 값 | 답하는 질문 |
|---|---|---|
| `remaining_seats` | `remainingSeats`(Redis) or `null` | "자리 남았어?" |
| `registered_count` | `capacity - remainingSeats` (Redis 값 있을 때만) | "몇 명 신청했어?" |
| `interest_count` | `interestCount` | "좋아요 몇 개야? / 인기 많아?" |

`search_courses`/`get_course_by_code` docstring에 3개 값 구분 명시.

### `backend/ai-server/chat/agent.py` — 시스템 프롬프트

```diff
+ "'잔여석'·'몇 명 신청'은 실시간 수강신청 기준값(remaining_seats·registered_count)으로 답하고, "
+ "'관심 등록'·'좋아요'·'인기'는 interest_count로 답한다 — 둘은 다른 값이니 섞지 않는다. "
+ "remaining_seats가 없으면 실시간 좌석 정보를 확인할 수 없다고 답한다. "
```

### 벤치마크 (`eval/questions.yaml` 72 → 74)

- **신규 `seats-11`**: "자바프로그래밍 창병모 교수님 말고 다른 분반, 지금 몇 명 신청했어?" → `registered_count` 39 (`answer_must_include: ["39"]`). Before 챗봇은 `registered_count` 개념이 없어 `enrolled`(37)로 답 → 실패.
- **신규 `seats-12`**: "자바프로그래밍 분반들 좋아요 몇 개씩?" → `interest_count`(전부 0). 신청자 수와 헷갈리면 실패(`answer_must_not_include: ["39명이 관심", …]`).
- `seats-02`(독일어Ⅰ): `answer_must_not_include: ["마감", "자리가 없", …]` — Before는 `cap-enrolled=0`이라 "마감"이라 답함.
- `seats-05`(데이터마이닝): `answer_must_include: ["60"]`. `seats-07`(소프트웨어공학): `["8"]`. `seats-09`(네트워크보안): `["17"]`.
- 잔여석/분반비교 시나리오의 결정성을 위해 `backend/scripts/seedBenchmarkSeats.js` 추가 — questions.yaml이 참조하는 21개 과목에 고정 좌석 값 심음(`capacity - enrolled`와 의도적으로 다르게).

### `backend/tests/courses.test.js`

`remainingSeats`가 Redis 값이고 MySQL 컬럼값이 응답에서 빠지는지 + 좌석 키 없을 때 `null`(폴백 안 함) + 단건 조회 검증 추가.

## 8-4. 스모크 검증 (라이브)

| 질문 | Before | After |
|---|---|---|
| "독일어 수업 실시간 수강신청 자리 남았어?" | "자리가 없습니다" | "'독일어Ⅰ'(이주은 교수님) 실시간 잔여석은 40석입니다" |
| "데이터베이스설계와질의 몇 명이나 신청했어? 좋아요는 몇 개야?" | (구분 못 함, `enrolled` 1개 값) | "21003183-1: 1명 신청, 관심 등록 1개 / -2: 0명, 0개 / -3: 0명, 0개" |
| "자바프로그래밍 인기 많아? 좋아요 몇 개?" | — | "각 분반 관심 등록 수 모두 0개" (신청자 수와 분리) |

## 8-5. Before/After 재측정 (`gemini-3.1-flash-lite`, 74문항 × 5회 = 430 turn)

- **Before**: 이 커밋 전 `tools.py`(잔여석 = `capacity - enrolled`). API·좌석 픽스처는 After와 동일 — 구 `tools.py`가 Redis 값을 안 읽으므로 답변은 픽스처와 무관.
- **After**: `tools.py` 3-필드 분리 + API 실시간 좌석 + 시스템 프롬프트.
- 라벨은 최종본으로 통일해 양쪽 재채점(`--rescore`). `multiturn-06` 2턴은 `expect_tool: search_courses` → `any`로 완화(#86에서 flash-lite가 1턴 결과의 분반 코드로 `get_course_by_code`를 부르는 쪽으로 이동 — 답변은 정확, 두 경로 다 정답).
- raw: `raw/03-tool-eval-gemini-3.1-flash-lite-before-86-20260827-114042.jsonl` / `...-after-86-20260827-120621.jsonl` (+ `-rescored-*-final-*`)

| 지표 | Before | After | 변화 |
|---|---|---|---|
| Tool 선택 정확도 | 98.7% | **100%** | +1.3%p |
| 파라미터 정확도 | 100% | 100% | 유지 |
| **답변 포함 검사** | **73.7% (70/95)** | **100% (95/95)** | **+26.3%p** |
| **답변 제외 검사** | **80.0% (20/25)** | **100% (25/25)** | **+20%p** |
| 과잉 호출률 | 0% | 0% | 유지 |
| 과소 호출률 | 1.5% (5/330) | **0%** | 해소 |
| 전 rep 통과 시나리오 | 72/73 | **73/73** | +1 |
| turn 오류 | 0 | 0 | 유지 |
| latency p50 / p95 (ms) | 1,651 / 2,822 | 1,721 / 2,319 | p95 개선 |
| turn당 토큰 (in / out) | 1,104 / 129 | 1,438 / 127 | in +334 |
| 1,000 turn 비용 | $0.47 | $0.55 | +17% (gemini-3.6-flash의 1/6) |

벤치마크는 72 → 74(`seats-11`/`seats-12` 추가). Before/After 모두 74문항.

### Before가 틀렸던 시나리오 (전부 5/5 rep 일관)

| 시나리오 | 질문 | Before 답 | 실제(Redis 픽스처) |
|---|---|---|---|
| `seats-02` | "독일어 수업 아직 자리 있어?" | "잔여석 0석, 신청 불가능" | 15석 |
| `seats-05` | "데이터마이닝및분석 자리 남았어?" | "9석" | 60석 |
| `seats-07` | "소프트웨어공학 자리 넉넉한 편이야?" | "14석" | 23석 |
| `seats-09` | "네트워크보안 몇 명이나 더 받을 수 있어?" | "3석" | 17석 |
| `seats-11` | "자바프로그래밍 다른 분반 몇 명 신청했어?" | "37명" (= `enrolled`) | 36명 (= 정원 40 − 잔여석 4) |
| `seats-12` | "자바프로그래밍 분반들 좋아요 몇 개?" | **Tool 호출 거부** ("관심 등록 수는 확인할 수 없습니다") | 각 분반 0개 |

`seats-11`/`seats-12`가 Before에서 실패하는 방식이 핵심 — Before `_summarize`엔 `registered_count`·`interest_count` 자체가 없어, 신청자 수는 `enrolled`(하트 섞인 값)로 답하고 관심 등록 수는 아예 못 답했다.

### 토큰 +334/turn (in) 원인

- 시스템 프롬프트 +2문장(~40토큰)
- Tool 관측값이 과목당 `enrolled` 1개 → `remaining_seats`·`registered_count`·`interest_count` 3개
- `multiturn-06`에서 `get_course_by_code` 2회(각 관측값 포함)로 이동

## 8-6. 결론

<callout icon="✅" color="green_bg">
**챗봇 "잔여석"이 이제 실시간 수강신청 좌석(Redis)을 답한다. 실시간 신청자 수와 관심 등록(하트) 수도 각각 분리해서 답한다.**
</callout>

1. **답변 포함 73.7 → 100%, 답변 제외 80 → 100%.** 잔여석 6개 시나리오가 전부 닫혔고, "잔여석 0석이라 신청 불가"처럼 잘못된 마감 안내(84/85 과목에서 발생하던)가 사라졌다.
2. **`registered_count` / `interest_count` 분리로 "몇 명 신청 vs 좋아요 몇 개"를 다른 소스에서 답한다.** Before는 후자를 아예 거부(과소 호출 1.5%)했다.
3. **회귀는 `multiturn-06` 2턴 tool 선택 이동 1건** — `search_courses` 재검색 → 1턴 결과의 분반 코드로 `get_course_by_code`. 답변은 정확하고 두 경로 다 유효해 라벨을 `any`로 완화(형제 시나리오 `multiturn-03/04/05`도 후속 턴은 이미 `ignore`).
4. **비용 +17%**($0.47 → $0.55 / 1,000 turn) — Tool 관측값이 좌석 3필드로 늘어난 대가. 여전히 `gemini-3.6-flash`($3.26)의 1/6.

**교훈:**
- **"얇은 벤치마크가 조용한 버그를 놓친다"(§6-2)의 재확인.** §1~7을 끝내고 답변 포함 검사 100%였지만, 잔여석 시나리오가 `expect_tool`만 보고 답변 내용(숫자)을 안 봐서 "완전히 틀린 좌석을 자신 있게 답하는" 버그가 통과하고 있었다. `seedBenchmarkSeats.js`로 결정적 좌석을 심고 `answer_must_include`에 실제 숫자를 박아 닫았다.
- **한 도메인 개념에 값이 여러 개면 Tool 출력에서 이름으로 분리한다.** `enrolled` 하나로 뭉쳐 있으면 모델은 그걸 "수강 인원"으로 읽는다 — `remaining_seats`/`registered_count`/`interest_count`로 쪼개니 프롬프트 지시가 거의 필요 없었다.

**챗봇 Tool·프롬프트는 이 상태로 확정.** RAG 결합(Stage 1) 전까지 안 건듦.

