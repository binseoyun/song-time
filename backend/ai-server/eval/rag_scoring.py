"""RAG hit rate 채점 (이슈 #104, ADR-010 §14).

순수 함수만. `rag_questions.yaml` 항목 + (에이전트 모드) tool_calls·retrieved codes·답변,
또는 (naive 모드) 답변만 받아 turn 점수를 매기고 집계한다. scoring.py(Tool 라우팅)와
분리한 이유는 채점 축이 완전히 달라서다 — retrieval hit@k / 할루시네이션 / 오선택.

expect_kind:
  hit            (의미검색) : search_syllabus top-k 에 정답 course_code 가 드는가
  not_registered (미등록)   : 없는 강의계획서를 지어내지 않는가
  out_of_scope   (범위밖)   : 정확한 값 질문에 강의계획서 Tool 을 안 부르는가
  routing        (라우팅)   : 1-3 회귀 — expect_tool 과 일치하는가 (questions.yaml 과 동일 의미)
"""
from __future__ import annotations

import statistics
from typing import Any, Dict, Iterable, List, Optional

HIT_KS = (1, 3, 5)
SYLLABUS_TOOLS = ("search_syllabus", "get_syllabus")
ROUTING_TOOLS = ("search_courses", "get_course_by_code")


def _expect_codes(item: Dict[str, Any]) -> List[str]:
    raw = item.get("expect_course_code")
    if raw is None:
        return []
    return [str(x) for x in (raw if isinstance(raw, list) else [raw])]


def _called_tools(tool_calls: List[Dict[str, Any]]) -> List[str]:
    return [c.get("tool") for c in (tool_calls or [])]


def _no_forbidden(answer: str, forbidden: Optional[Iterable[str]]) -> Optional[bool]:
    """answer_must_not_include 위반이 없으면 True. 라벨이 없으면 None(자동 채점 불가)."""
    if not forbidden:
        return None
    low = (answer or "")
    return not any(str(f) in low for f in forbidden)


def _mentions_not_registered(answer: str) -> bool:
    a = answer or ""
    return any(k in a for k in ("등록되어 있지 않", "등록되지 않", "미등록", "등록된 강의계획서가 없",
                                "강의계획서가 없", "제공되지 않", "찾을 수 없"))


# --------------------------------------------------------------------------- #
# 에이전트 모드
# --------------------------------------------------------------------------- #
def score_agent(item: Dict[str, Any], tool_calls: List[Dict[str, Any]],
                retrieved_codes: Optional[List[str]], answer: str) -> Dict[str, Any]:
    kind = item.get("expect_kind")
    called = _called_tools(tool_calls)
    called_set = set(called)
    s: Dict[str, Any] = {"expect_kind": kind}

    if kind == "hit":
        codes = _expect_codes(item)
        retr = retrieved_codes or []
        for k in HIT_KS:
            s[f"hit_at_{k}"] = any(c in retr[:k] for c in codes)
        s["search_syllabus_called"] = "search_syllabus" in called_set
        s["answer_no_hallucination"] = _no_forbidden(answer, item.get("answer_must_not_include"))
        s["pass"] = bool(s["hit_at_3"] and s["search_syllabus_called"]
                         and s["answer_no_hallucination"] is not False)

    elif kind == "not_registered":
        nf = _no_forbidden(answer, item.get("answer_must_not_include"))
        s["answer_no_hallucination"] = nf
        s["says_not_registered"] = _mentions_not_registered(answer)
        s["no_syllabus_content_faked"] = "get_syllabus" not in called_set or True  # 관측만
        # 라벨(forbidden)이 있으면 그걸로, 없으면 "미등록이라고 답했는가"로 판정
        s["pass"] = bool(nf) if nf is not None else bool(s["says_not_registered"])

    elif kind == "out_of_scope":
        s["syllabus_tool_called"] = bool(called_set & set(SYLLABUS_TOOLS))
        if item.get("expect_tool") == "none":
            s["any_tool_called"] = len(called) > 0
            s["pass"] = not s["syllabus_tool_called"] and not s["any_tool_called"]
        else:
            s["pass"] = not s["syllabus_tool_called"]

    elif kind == "routing":
        et = item.get("expect_tool")
        if et == "none":
            s["tool_ok"] = len(called) == 0
        elif et == "any":
            s["tool_ok"] = len(called) >= 1
        else:
            s["tool_ok"] = et in called_set
        s["no_syllabus_tool"] = not (called_set & set(SYLLABUS_TOOLS))
        s["pass"] = bool(s["tool_ok"] and s["no_syllabus_tool"])

    else:
        raise ValueError(f"알 수 없는 expect_kind: {kind!r}")

    return s


# --------------------------------------------------------------------------- #
# retrieval 모드 (에이전트 없이 search_syllabus 로직만)
# --------------------------------------------------------------------------- #
def score_retrieval(item: Dict[str, Any], retrieved_codes: List[str]) -> Dict[str, Any]:
    codes = _expect_codes(item)
    s: Dict[str, Any] = {"expect_kind": item.get("expect_kind")}
    for k in HIT_KS:
        s[f"hit_at_{k}"] = any(c in (retrieved_codes or [])[:k] for c in codes)
    s["top1_code"] = (retrieved_codes or [None])[0]
    s["pass"] = bool(s["hit_at_3"])
    return s


# --------------------------------------------------------------------------- #
# naive 모드 (전문 프롬프트 주입, Tool 없음 — 답변 레벨로만 채점)
# --------------------------------------------------------------------------- #
def score_naive(item: Dict[str, Any], answer: str, name_by_code: Dict[str, str]) -> Dict[str, Any]:
    kind = item.get("expect_kind")
    s: Dict[str, Any] = {"expect_kind": kind}

    if kind == "hit":
        names = [name_by_code.get(c, "") for c in _expect_codes(item)]
        s["answer_names_course"] = any(n and n in (answer or "") for n in names)
        s["answer_no_hallucination"] = _no_forbidden(answer, item.get("answer_must_not_include"))
        s["pass"] = bool(s["answer_names_course"] and s["answer_no_hallucination"] is not False)
    elif kind == "not_registered":
        nf = _no_forbidden(answer, item.get("answer_must_not_include"))
        s["answer_no_hallucination"] = nf
        s["says_not_registered"] = _mentions_not_registered(answer)
        s["pass"] = bool(nf) if nf is not None else bool(s["says_not_registered"])
    else:
        # out_of_scope / routing 은 Tool 이 있어야 의미 있음 — naive 에선 채점 제외
        s["pass"] = None
    return s


# --------------------------------------------------------------------------- #
# 집계
# --------------------------------------------------------------------------- #
def _rate(flags: List[Optional[bool]]) -> Optional[float]:
    vals = [f for f in flags if f is not None]
    return round(sum(1 for v in vals if v) / len(vals), 4) if vals else None


def summarize_rag(rows: List[Dict[str, Any]], n_reps: int, meta: Dict[str, Any]) -> Dict[str, Any]:
    """rows: [{scenario_id, category, expect_kind, rep, error, scores, ...}]"""
    scored = [r for r in rows if not r.get("error")]
    by_kind: Dict[str, List[Dict[str, Any]]] = {}
    for r in scored:
        by_kind.setdefault(r["scores"]["expect_kind"], []).append(r)

    out: Dict[str, Any] = {
        "meta": meta,
        "n_reps": n_reps,
        "n_rows": len(rows),
        "n_errors": sum(1 for r in rows if r.get("error")),
        "by_kind": {},
        "overall_pass_rate": _rate([r["scores"].get("pass") for r in scored]),
    }

    for kind, krows in sorted(by_kind.items()):
        block: Dict[str, Any] = {
            "n": len(krows),
            "pass_rate": _rate([r["scores"].get("pass") for r in krows]),
        }
        if kind in ("hit",):
            for k in HIT_KS:
                block[f"hit_at_{k}"] = _rate([r["scores"].get(f"hit_at_{k}") for r in krows])
            block["search_syllabus_called_rate"] = _rate(
                [r["scores"].get("search_syllabus_called") for r in krows])
            block["answer_names_course_rate"] = _rate(
                [r["scores"].get("answer_names_course") for r in krows])
        if kind in ("not_registered",):
            block["no_hallucination_rate"] = _rate(
                [r["scores"].get("answer_no_hallucination") for r in krows])
            block["says_not_registered_rate"] = _rate(
                [r["scores"].get("says_not_registered") for r in krows])
        if kind in ("out_of_scope",):
            block["syllabus_tool_called_rate"] = _rate(
                [r["scores"].get("syllabus_tool_called") for r in krows])
        if kind in ("routing",):
            block["tool_ok_rate"] = _rate([r["scores"].get("tool_ok") for r in krows])
        out["by_kind"][kind] = block

    # 안정성: 시나리오별 전 rep pass
    by_scenario: Dict[str, List[Optional[bool]]] = {}
    for r in scored:
        by_scenario.setdefault(r["scenario_id"], []).append(r["scores"].get("pass"))
    fully = [sid for sid, ps in by_scenario.items()
             if ps and all(p is True for p in ps)]
    flaky = [sid for sid, ps in by_scenario.items()
             if len(set(p for p in ps if p is not None)) > 1]
    out["stability"] = {
        "scenarios_scored": len(by_scenario),
        "fully_passing_all_reps": len(fully),
        "flaky_scenarios": sorted(flaky),
    }

    # latency / tokens (있으면)
    lat = [r["latency_ms"] for r in scored if r.get("latency_ms")]
    if lat:
        lat.sort()
        out["latency_ms"] = {
            "p50": lat[len(lat) // 2],
            "p95": lat[min(len(lat) - 1, int(len(lat) * 0.95))],
            "mean": round(statistics.mean(lat), 1),
        }
    toks = [r["tokens"]["total"] for r in scored if r.get("tokens")]
    if toks:
        out["tokens"] = {"total": sum(toks), "mean_per_row": round(statistics.mean(toks), 1)}

    return out
