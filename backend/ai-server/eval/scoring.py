"""AI 챗봇 Tool 라우팅 정확도 채점 로직 (이슈 #74, ADR-010 §14).

순수 함수만 둔다 — 에이전트 호출도 파일 I/O도 없이, "질문 라벨 + 실제 tool_calls +
최종 답변"을 받아 turn 단위 점수를 매기고, turn 결과 리스트를 집계한다. 단위 테스트가
이 모듈만 겨냥할 수 있도록 runner(run_tool_eval.py)와 분리했다.

지표 정의는 doc/experiment/03-ai-tool-라우팅-정확도-측정계획.md 를 따른다.
"""
from __future__ import annotations

import statistics
from typing import Any, Dict, List, Optional

# expect_tool에 올 수 있는 값
SPECIFIC_TOOLS = ("search_courses", "get_course_by_code")
SENTINELS = ("none", "any", "ignore")
#   none   : Tool을 부르면 안 됨 (거절/UI 유도가 정답)
#   any    : 뭐든 하나는 불러야 함 (구체 Tool 종류는 안 따짐)
#   ignore : Tool 차원은 채점하지 않음 (멀티턴 후속처럼 히스토리로 답해도 정답인 경우)


def _norm(text: Any) -> str:
    """부분문자열 매칭 전 공백을 접어 비교 노이즈를 줄인다."""
    return " ".join(str(text).split())


def score_turn(expect: Dict[str, Any], tool_calls: List[Dict[str, Any]], answer: str) -> Dict[str, Any]:
    """turn 1개를 채점한다.

    expect: questions.yaml의 turn 딕셔너리 (expect_tool / expect_args /
            answer_must_include / answer_must_not_include / allow_extra_tools)
    tool_calls: router._extract_tool_calls 형식의 리스트 [{tool, tool_input, observation}, ...]
    answer: 최종 assistant 답변 문자열
    """
    expect_tool = expect.get("expect_tool", "ignore")
    called = [c.get("tool") for c in tool_calls]
    called_set = set(called)

    # --- Tool 선택 ---
    tool_selection: Optional[bool]
    if expect_tool == "ignore":
        tool_selection = None
    elif expect_tool == "none":
        tool_selection = len(tool_calls) == 0
    elif expect_tool == "any":
        tool_selection = len(tool_calls) >= 1
    elif expect_tool in SPECIFIC_TOOLS:
        tool_selection = expect_tool in called_set
    else:
        raise ValueError(f"알 수 없는 expect_tool: {expect_tool!r} (허용: {SPECIFIC_TOOLS + SENTINELS})")

    # 기대한 Tool 외에 추가로 부른 것들 (soft 지표 — 그 자체로 실패 처리하진 않음)
    if expect_tool in SPECIFIC_TOOLS:
        unexpected = [t for t in called if t != expect_tool]
    elif expect_tool == "any":
        unexpected = []
    else:  # none / ignore
        unexpected = list(called)

    # --- 파라미터 ---
    param_match: Optional[bool] = None
    expect_args = expect.get("expect_args") or {}
    if expect_tool in SPECIFIC_TOOLS and expect_args and expect_tool in called_set:
        call = next(c for c in tool_calls if c.get("tool") == expect_tool)
        args = call.get("tool_input") or {}
        param_match = all(
            _norm(needle) in _norm(args.get(key, "")) for key, needle in expect_args.items()
        )

    # --- 답변 정합성 (자동 근사 — 할루시네이션 최종 판정은 수동 샘플링) ---
    answer_norm = _norm(answer)
    must_include = expect.get("answer_must_include") or []
    must_exclude = expect.get("answer_must_not_include") or []
    answer_include: Optional[bool] = (
        all(_norm(s) in answer_norm for s in must_include) if must_include else None
    )
    answer_exclude: Optional[bool] = (
        all(_norm(s) not in answer_norm for s in must_exclude) if must_exclude else None
    )

    # --- 과잉/과소 호출 (turn 단위 플래그, 집계에서 비율로 환산) ---
    over_call: Optional[bool] = (len(tool_calls) >= 1) if expect_tool == "none" else None
    under_call: Optional[bool] = (
        (len(tool_calls) == 0) if expect_tool in SPECIFIC_TOOLS + ("any",) else None
    )

    return {
        "expect_tool": expect_tool,
        "called_tools": called,
        "tool_selection": tool_selection,
        "param_match": param_match,
        "answer_include": answer_include,
        "answer_exclude": answer_exclude,
        "over_call": over_call,
        "under_call": under_call,
        "unexpected_tools": unexpected,
    }


def _mean(values: List[bool]) -> Optional[float]:
    vals = [v for v in values if v is not None]
    if not vals:
        return None
    return round(sum(1 for v in vals if v) / len(vals), 4)


def _rate(flags: List[Optional[bool]]) -> Optional[Dict[str, Any]]:
    vals = [v for v in flags if v is not None]
    if not vals:
        return None
    hit = sum(1 for v in vals if v)
    return {"rate": round(hit / len(vals), 4), "hit": hit, "n": len(vals)}


def _percentile(sorted_vals: List[float], q: float) -> float:
    if not sorted_vals:
        return 0.0
    if len(sorted_vals) == 1:
        return sorted_vals[0]
    pos = q * (len(sorted_vals) - 1)
    lo = int(pos)
    frac = pos - lo
    hi = min(lo + 1, len(sorted_vals) - 1)
    return sorted_vals[lo] + (sorted_vals[hi] - sorted_vals[lo]) * frac


def _metric_block(turns: List[Dict[str, Any]]) -> Dict[str, Any]:
    """turn 결과 리스트(여러 rep 섞여 있어도 됨)에 대한 지표 묶음."""
    scored = [t for t in turns if not t.get("error")]
    latencies = sorted(t["latency_ms"] for t in scored if t.get("latency_ms") is not None)
    tokens = [t["tokens"]["total"] for t in scored if t.get("tokens")]
    return {
        "n_turns": len(turns),
        "n_errors": sum(1 for t in turns if t.get("error")),
        "tool_selection_accuracy": _mean([t["scores"]["tool_selection"] for t in scored]),
        "param_accuracy": _mean([t["scores"]["param_match"] for t in scored]),
        "answer_include_pass_rate": _mean([t["scores"]["answer_include"] for t in scored]),
        "answer_exclude_pass_rate": _mean([t["scores"]["answer_exclude"] for t in scored]),
        "over_call": _rate([t["scores"]["over_call"] for t in scored]),
        "under_call": _rate([t["scores"]["under_call"] for t in scored]),
        "unexpected_tool_turns": sum(1 for t in scored if t["scores"]["unexpected_tools"]),
        "latency_ms": {
            "p50": round(_percentile(latencies, 0.5), 1),
            "p95": round(_percentile(latencies, 0.95), 1),
            "mean": round(statistics.fmean(latencies), 1) if latencies else None,
        },
        "tokens": {
            "total": sum(tokens),
            "mean_per_turn": round(statistics.fmean(tokens), 1) if tokens else None,
        },
    }


def summarize(turn_results: List[Dict[str, Any]], n_reps: int, meta: Dict[str, Any]) -> Dict[str, Any]:
    """전체 turn 결과를 집계한다.

    turn_results: 각 원소가 아래 형태
      {rep, scenario_id, category, turn_index, user, answer, latency_ms,
       tokens{input,output,total} | None, error: bool, scores: score_turn(...) 출력}
    """
    by_rep_acc: List[float] = []
    for rep in range(1, n_reps + 1):
        rep_turns = [t for t in turn_results if t["rep"] == rep and not t.get("error")]
        acc = _mean([t["scores"]["tool_selection"] for t in rep_turns])
        if acc is not None:
            by_rep_acc.append(acc)

    overall = _metric_block(turn_results)
    overall["tool_selection_accuracy_sd"] = (
        round(statistics.stdev(by_rep_acc), 4) if len(by_rep_acc) >= 2 else 0.0
    )
    overall["tool_selection_accuracy_by_rep"] = by_rep_acc

    categories = sorted({t["category"] for t in turn_results})
    by_category = {
        cat: _metric_block([t for t in turn_results if t["category"] == cat]) for cat in categories
    }

    # scenario 단위 안정성: rep을 걸쳐 tool_selection이 전부 통과한 시나리오 비율
    scenario_ids = sorted({t["scenario_id"] for t in turn_results})
    fully_stable = 0
    flaky = []
    for sid in scenario_ids:
        sid_turns = [
            t for t in turn_results
            if t["scenario_id"] == sid and not t.get("error")
            and t["scores"]["tool_selection"] is not None
        ]
        if not sid_turns:
            continue
        passes = [t["scores"]["tool_selection"] for t in sid_turns]
        if all(passes):
            fully_stable += 1
        elif any(passes):
            flaky.append(sid)

    return {
        "meta": meta,
        "n_reps": n_reps,
        "n_scenarios": len(scenario_ids),
        "overall": overall,
        "by_category": by_category,
        "stability": {
            "scenarios_fully_passing_all_reps": fully_stable,
            "scenarios_scored": len(scenario_ids),
            "flaky_scenarios": flaky,
        },
    }
