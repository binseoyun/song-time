"""AI 챗봇 Tool 라우팅 정확도 측정 하네스 (이슈 #74, ADR-010 §14).

RAG를 붙이기 전, 순수 function-calling 라우팅의 baseline 수치를 만든다. 질문 세트를
읽어 에이전트를 직접(`chat.agent.get_agent`) 호출하고 — Node 프록시/인증/SSE/DB/Redis는
전부 우회한다, 측정 대상은 "LLM이 맞는 Tool을 고르는가" 하나다 — 실제 tool_calls를
캡처해 자동 채점하고, raw(jsonl) + 요약(json)을 doc/experiment/raw/ 에 남긴다.

실행 (ai-server 컨테이너 안, backend가 떠 있어야 함):
    docker compose run --rm --no-deps ai-server python -m eval.run_tool_eval
멀티 프로바이더 비교(별도 이슈)는 CHAT_MODEL 만 바꿔 이 스크립트를 재실행한다:
    ... python -m eval.run_tool_eval --model gemini-3.6-flash
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List

import requests
import yaml

REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_QUESTIONS = Path(__file__).resolve().parent / "questions.yaml"
# 호스트에서 리포 루트째로 실행하면 doc/experiment/raw 로, 컨테이너 안(WORKDIR=/app)에서
# 실행하면 그 경로가 없으므로 ./eval-out 로 떨어뜨린다(README는 -v 마운트 + --out-dir 권장).
_repo_out = REPO_ROOT / "doc" / "experiment" / "raw"
DEFAULT_OUT_DIR = _repo_out if _repo_out.parent.is_dir() else Path.cwd() / "eval-out"

VALID_EXPECT_TOOLS = {"search_courses", "get_course_by_code", "none", "any", "ignore"}
RATE_LIMIT_MARKERS = ("429", "ResourceExhausted", "RESOURCE_EXHAUSTED", "quota")


# --------------------------------------------------------------------------- #
# 질문 세트 로드 + 스키마 검증
# --------------------------------------------------------------------------- #
def load_scenarios(path: Path) -> List[Dict[str, Any]]:
    raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(raw, list) or not raw:
        sys.exit(f"[오류] {path} 는 비어 있지 않은 리스트여야 합니다.")

    seen_ids = set()
    for i, sc in enumerate(raw):
        loc = f"{path.name}[{i}]"
        if not isinstance(sc, dict):
            sys.exit(f"[오류] {loc}: 매핑이 아닙니다.")
        sid = sc.get("id")
        if not sid:
            sys.exit(f"[오류] {loc}: id 필드가 필요합니다.")
        if sid in seen_ids:
            sys.exit(f"[오류] {loc}: id 중복 — {sid!r}")
        seen_ids.add(sid)
        if not sc.get("category"):
            sys.exit(f"[오류] {sid}: category 필드가 필요합니다.")
        turns = sc.get("turns")
        if not isinstance(turns, list) or not turns:
            sys.exit(f"[오류] {sid}: turns 는 비어 있지 않은 리스트여야 합니다.")
        for j, turn in enumerate(turns):
            tloc = f"{sid}.turns[{j}]"
            if not isinstance(turn, dict) or not turn.get("user"):
                sys.exit(f"[오류] {tloc}: user 발화가 필요합니다.")
            et = turn.get("expect_tool", "ignore")
            if et not in VALID_EXPECT_TOOLS:
                sys.exit(f"[오류] {tloc}: expect_tool={et!r} (허용: {sorted(VALID_EXPECT_TOOLS)})")
            if turn.get("expect_args") and not isinstance(turn["expect_args"], dict):
                sys.exit(f"[오류] {tloc}: expect_args 는 매핑이어야 합니다.")
    return raw


# --------------------------------------------------------------------------- #
# 에이전트 호출
# --------------------------------------------------------------------------- #
def preflight_backend() -> str:
    base = os.getenv("BACKEND_BASE_URL", "http://localhost:8000")
    try:
        resp = requests.get(f"{base}/api/courses", timeout=10)
        resp.raise_for_status()
        n = len(resp.json())
    except Exception as exc:  # noqa: BLE001 - 사용자에게 원인 그대로 보여준다
        sys.exit(
            f"[오류] backend 과목 API에 연결할 수 없습니다: {base}/api/courses\n"
            f"       {exc}\n"
            f"       docker compose up -d backend_1 (+ db 시딩) 후 다시 실행하세요."
        )
    if n == 0:
        sys.exit(f"[오류] {base}/api/courses 가 0개를 반환했습니다 — 시드 데이터를 넣어주세요.")
    return f"{base} ({n}과목)"


def _sum_tokens(messages) -> Dict[str, int] | None:
    total = {"input": 0, "output": 0, "total": 0}
    found = False
    for m in messages:
        meta = getattr(m, "usage_metadata", None)
        if meta:
            found = True
            total["input"] += meta.get("input_tokens", 0)
            total["output"] += meta.get("output_tokens", 0)
            total["total"] += meta.get("total_tokens", 0)
    return total if found else None


def run_scenario(agent, scenario: Dict[str, Any], rep: int, recursion_limit: int,
                 retries: int, retry_wait: float) -> List[Dict[str, Any]]:
    """시나리오 1개(멀티턴 포함)를 rep회차로 1번 실행. turn 결과 리스트를 반환한다.

    production(router.py)과 동일하게 히스토리는 user/assistant 텍스트만 되재생한다
    (ToolMessage는 다음 턴으로 넘기지 않음)."""
    from langchain_core.messages import AIMessage, HumanMessage

    from chat.message_utils import extract_text, extract_tool_calls
    from eval.scoring import score_turn

    history: List[Any] = []  # HumanMessage/AIMessage 텍스트만
    results: List[Dict[str, Any]] = []
    broken = False

    for idx, turn in enumerate(scenario["turns"]):
        base = {
            "rep": rep,
            "scenario_id": scenario["id"],
            "category": scenario["category"],
            "turn_index": idx,
            "user": turn["user"],
        }
        if broken:
            results.append({**base, "error": "이전 turn 실패로 건너뜀", "skipped": True,
                            "answer": None, "latency_ms": None, "tokens": None,
                            "scores": score_turn(turn, [], "")})
            continue

        input_messages = history + [HumanMessage(content=turn["user"])]
        result = None
        err = None
        for attempt in range(retries + 1):
            t0 = time.perf_counter()
            try:
                result = agent.invoke(
                    {"messages": input_messages},
                    config={"recursion_limit": recursion_limit},
                )
                err = None
                break
            except Exception as exc:  # noqa: BLE001
                err = str(exc)
                if any(mark in err for mark in RATE_LIMIT_MARKERS) and attempt < retries:
                    wait = retry_wait * (attempt + 1)
                    print(f"    · rate limit, {wait:.0f}s 대기 후 재시도 ({attempt + 1}/{retries})")
                    time.sleep(wait)
                    continue
                break
        latency_ms = round((time.perf_counter() - t0) * 1000, 1)

        if err is not None or result is None:
            broken = True
            results.append({**base, "error": err or "unknown", "answer": None,
                            "latency_ms": latency_ms, "tokens": None,
                            "scores": score_turn(turn, [], "")})
            continue

        new_messages = result["messages"][len(input_messages):]
        answer = extract_text(result["messages"][-1].content)
        tool_calls = extract_tool_calls(new_messages)
        tokens = _sum_tokens(new_messages)

        history = input_messages + [AIMessage(content=answer)]
        results.append({
            **base,
            "error": None,
            "answer": answer,
            "tool_calls": tool_calls,
            "latency_ms": latency_ms,
            "tokens": tokens,
            "scores": score_turn(turn, tool_calls, answer),
        })
    return results


# --------------------------------------------------------------------------- #
# 출력
# --------------------------------------------------------------------------- #
def print_summary(summary: Dict[str, Any]) -> None:
    o = summary["overall"]
    print("\n" + "=" * 68)
    print(f"  모델: {summary['meta']['model']}   반복: {summary['n_reps']}회   "
          f"시나리오: {summary['n_scenarios']}개   turn: {o['n_turns']}개")
    print("=" * 68)
    print(f"  Tool 선택 정확도      : {_pct(o['tool_selection_accuracy'])}  (rep별 sd {o['tool_selection_accuracy_sd']})")
    print(f"  파라미터 정확도       : {_pct(o['param_accuracy'])}")
    print(f"  답변 포함 검사 통과   : {_pct(o['answer_include_pass_rate'])}")
    print(f"  답변 제외 검사 통과   : {_pct(o['answer_exclude_pass_rate'])}")
    print(f"  과잉 호출(none 기대)  : {_rate_str(o['over_call'])}")
    print(f"  과소 호출(호출 기대)  : {_rate_str(o['under_call'])}")
    print(f"  turn 오류             : {o['n_errors']}개")
    print(f"  latency ms            : p50 {o['latency_ms']['p50']}  p95 {o['latency_ms']['p95']}  mean {o['latency_ms']['mean']}")
    print(f"  토큰                  : 총 {o['tokens']['total']}  turn당 평균 {o['tokens']['mean_per_turn']}")
    st = summary["stability"]
    print(f"  전 rep 통과 시나리오  : {st['scenarios_fully_passing_all_reps']}/{st['scenarios_scored']}"
          f"   flaky: {st['flaky_scenarios'] or '없음'}")
    print("-" * 68)
    print("  카테고리별 Tool 선택 정확도")
    for cat, block in summary["by_category"].items():
        print(f"    {cat:<12} {_pct(block['tool_selection_accuracy'])}   (turn {block['n_turns']}, 오류 {block['n_errors']})")
    print("=" * 68 + "\n")


def _pct(v):
    return "  n/a" if v is None else f"{v * 100:5.1f}%"


def _rate_str(block):
    if not block:
        return "n/a"
    return f"{block['rate'] * 100:.1f}%  ({block['hit']}/{block['n']})"


# --------------------------------------------------------------------------- #
def main() -> None:
    parser = argparse.ArgumentParser(description="AI 챗봇 Tool 라우팅 정확도 측정")
    parser.add_argument("--questions", type=Path, default=DEFAULT_QUESTIONS)
    parser.add_argument("--reps", type=int, default=5, help="질문당 반복 횟수 (기본 5)")
    parser.add_argument("--out-dir", type=Path, default=DEFAULT_OUT_DIR)
    parser.add_argument("--model", default=None, help="CHAT_MODEL 오버라이드")
    parser.add_argument("--sleep", type=float, default=1.0, help="invoke 사이 대기 초 (기본 1.0)")
    parser.add_argument("--retries", type=int, default=3, help="rate limit 재시도 횟수 (기본 3)")
    parser.add_argument("--retry-wait", type=float, default=30.0, help="재시도 기본 대기 초")
    parser.add_argument("--limit", type=int, default=None, help="앞 N개 시나리오만 (스모크용)")
    parser.add_argument("--label", default="", help="파일명에 붙일 태그")
    args = parser.parse_args()

    if args.model:
        os.environ["CHAT_MODEL"] = args.model

    scenarios = load_scenarios(args.questions)
    if args.limit:
        scenarios = scenarios[: args.limit]

    backend_desc = preflight_backend()

    # CHAT_MODEL 확정 후에 import (chat.agent가 import 시점에 모델명을 읽는다)
    from chat.agent import RECURSION_LIMIT, get_agent

    model = os.getenv("CHAT_MODEL", "gemini-3.6-flash")
    if not os.getenv("GEMINI_API_KEY"):
        sys.exit("[오류] GEMINI_API_KEY 가 없습니다.")

    print(f"모델={model}  backend={backend_desc}  시나리오={len(scenarios)}  반복={args.reps}")
    agent = get_agent()

    started = datetime.now()
    turn_results: List[Dict[str, Any]] = []
    for rep in range(1, args.reps + 1):
        print(f"\n[rep {rep}/{args.reps}]")
        for sc in scenarios:
            rows = run_scenario(agent, sc, rep, RECURSION_LIMIT, args.retries, args.retry_wait)
            turn_results.extend(rows)
            ok = sum(1 for r in rows if r["scores"]["tool_selection"] in (True, None) and not r.get("error"))
            print(f"  {sc['id']:<18} turn {len(rows)}  tool선택 {ok}/{len(rows)}")
            time.sleep(args.sleep)

    from eval.scoring import summarize

    meta = {
        "model": model,
        "started_at": started.isoformat(timespec="seconds"),
        "finished_at": datetime.now().isoformat(timespec="seconds"),
        "questions_file": str(args.questions),
        "backend": backend_desc,
        "recursion_limit": RECURSION_LIMIT,
    }
    summary = summarize(turn_results, args.reps, meta)

    args.out_dir.mkdir(parents=True, exist_ok=True)
    stamp = started.strftime("%Y%m%d-%H%M%S")
    tag = f"-{args.label}" if args.label else ""
    stem = f"03-tool-eval-{model}{tag}-{stamp}"
    raw_path = args.out_dir / f"{stem}.jsonl"
    sum_path = args.out_dir / f"{stem}-summary.json"

    with raw_path.open("w", encoding="utf-8") as fh:
        for row in turn_results:
            fh.write(json.dumps(row, ensure_ascii=False) + "\n")
    sum_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")

    print_summary(summary)
    print(f"raw     : {raw_path}")
    print(f"summary : {sum_path}")


if __name__ == "__main__":
    main()
