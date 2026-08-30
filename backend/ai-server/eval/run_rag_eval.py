"""RAG hit rate 측정 하네스 (이슈 #104, ADR-010 §14, Stage 1-4).

rag_questions.yaml 을 읽어 3가지 방식으로 측정한다:

    --mode retrieval : 에이전트 없이 search_syllabus 로직만 → 순수 hit rate@1/3/5 (빠름·쌈)
    --mode agent     : 질문마다 에이전트 호출 → tool_calls·retrieved code·답변 채점 (기본)
    --mode naive     : 강의계획서 18개 전문 + 질문 단일 LLM 호출, Tool 없음 (Before 베이스라인)

raw(jsonl) + summary(json) 를 doc/experiment/raw/ 에 남긴다.

실행 (ai-server 컨테이너, backend + qdrant 필요):
    docker compose run --rm --no-deps -v "$PWD/doc/experiment/raw:/out" \
      ai-server python -m eval.run_rag_eval --out-dir /out --mode retrieval
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

import yaml

from eval._harness import (
    default_out_dir,
    invoke_with_retry,
    preflight_backend,
    preflight_qdrant,
    sum_tokens,
)
from eval.rag_scoring import score_agent, score_naive, score_retrieval, summarize_rag

DEFAULT_QUESTIONS = Path(__file__).resolve().parent / "rag_questions.yaml"
DEFAULT_OUT_DIR = default_out_dir()
VALID_KINDS = {"hit", "not_registered", "out_of_scope", "routing"}
_CODE_RE = re.compile(r"'course_code':\s*'(\d{8})'|\"course_code\":\s*\"(\d{8})\"")


def load_items(path: Path) -> List[Dict[str, Any]]:
    raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(raw, list) or not raw:
        sys.exit(f"[오류] {path} 는 비어 있지 않은 리스트여야 합니다.")
    seen = set()
    for i, it in enumerate(raw):
        loc = f"{path.name}[{i}]"
        if not isinstance(it, dict) or not it.get("id"):
            sys.exit(f"[오류] {loc}: id 가 필요합니다.")
        if it["id"] in seen:
            sys.exit(f"[오류] {loc}: id 중복 {it['id']!r}")
        seen.add(it["id"])
        if not it.get("question"):
            sys.exit(f"[오류] {it['id']}: question 이 필요합니다.")
        kind = it.get("expect_kind")
        if kind not in VALID_KINDS:
            sys.exit(f"[오류] {it['id']}: expect_kind={kind!r} (허용: {sorted(VALID_KINDS)})")
        if kind == "hit" and not it.get("expect_course_code"):
            sys.exit(f"[오류] {it['id']}: hit 는 expect_course_code 가 필요합니다.")
        if kind == "routing" and not it.get("expect_tool"):
            sys.exit(f"[오류] {it['id']}: routing 은 expect_tool 이 필요합니다.")
    return raw


def _retrieved_from_calls(tool_calls: List[Dict[str, Any]]) -> Optional[List[str]]:
    """에이전트의 첫 search_syllabus 호출 observation 에서 course_code 를 순서대로 뽑는다."""
    for c in tool_calls or []:
        if c.get("tool") != "search_syllabus":
            continue
        obs = c.get("observation")
        if isinstance(obs, list):
            return [str(d.get("course_code")) for d in obs if isinstance(d, dict)]
        text = obs if isinstance(obs, str) else json.dumps(obs, ensure_ascii=False)
        try:
            data = json.loads(text)
            if isinstance(data, list):
                return [str(d.get("course_code")) for d in data if isinstance(d, dict)]
        except Exception:  # noqa: BLE001
            pass
        return [m[0] or m[1] for m in _CODE_RE.findall(text)]
    return None


# --------------------------------------------------------------------------- #
# naive 코퍼스
# --------------------------------------------------------------------------- #
def build_corpus() -> tuple[str, Dict[str, str]]:
    """강의계획서 18청크 전문을 프롬프트용 텍스트로. (corpus_text, {code: name})."""
    from rag.syllabi import load

    items = load()
    blocks, name_by_code = [], {}
    for s in items:
        name_by_code[s.course_code] = s.course_name
        grading = ", ".join(f"{g['type']} {g['weight']}%" for g in s.grading)
        weeks = " / ".join(f"{w['week']}.{w['theme']}" for w in s.weekly_plan)
        blocks.append(
            f"[{s.course_code}] {s.course_name} ({'/'.join(s.class_codes)}) — {s.professor}\n"
            f"개요: {s.overview.strip()}\n교육목표: {s.objectives.strip()}\n"
            f"선수과목: {s.prerequisites or '없음'} | 강의형태: {s.method} | 학점: {s.credits}\n"
            f"평가: {grading}\n주교재: {s.textbook}\n주차별: {weeks}"
        )
    return "\n\n".join(blocks), name_by_code


NAIVE_SYSTEM = (
    "너는 대학교 수강신청 상담 챗봇이다. 아래 <강의계획서> 안의 정보로만 답한다. "
    "없는 과목이면 '해당 과목 강의계획서는 등록되어 있지 않습니다'라고 답하고 절대 지어내지 않는다.\n\n"
    "<강의계획서>\n{corpus}\n</강의계획서>"
)


# --------------------------------------------------------------------------- #
# 모드별 실행
# --------------------------------------------------------------------------- #
def run_retrieval(items, reps):
    from chat.syllabus_tools import search_syllabus

    rows = []
    for rep in range(1, reps + 1):
        for it in items:
            if it["expect_kind"] != "hit":
                continue
            res = search_syllabus.invoke({"query": it["question"]})
            codes = [str(r["course_code"]) for r in res]
            rows.append({
                "rep": rep, "scenario_id": it["id"], "category": it["category"],
                "error": None, "answer": None, "tool_calls": None,
                "retrieved": codes, "latency_ms": None, "tokens": None,
                "scores": score_retrieval(it, codes),
            })
            print(f"  [{rep}] {it['id']:<10} top1={codes[0] if codes else '-':<9} "
                  f"hit@3={rows[-1]['scores']['hit_at_3']}")
    return rows


def run_agent(items, reps, recursion_limit, retries, retry_wait, sleep):
    from langchain_core.messages import HumanMessage

    from chat.agent import get_agent
    from chat.message_utils import extract_text, extract_tool_calls

    agent = get_agent()
    rows = []
    for rep in range(1, reps + 1):
        print(f"\n[rep {rep}/{reps}]")
        for it in items:
            result, err, latency_ms = invoke_with_retry(
                agent, [HumanMessage(content=it["question"])], recursion_limit, retries, retry_wait)
            base = {"rep": rep, "scenario_id": it["id"], "category": it["category"],
                    "latency_ms": latency_ms}
            if err or result is None:
                rows.append({**base, "error": err or "unknown", "answer": None,
                             "tool_calls": None, "retrieved": None, "tokens": None,
                             "scores": score_agent(it, [], None, "")})
            else:
                new = result["messages"][1:]
                answer = extract_text(result["messages"][-1].content)
                calls = extract_tool_calls(new)
                retrieved = _retrieved_from_calls(calls)
                rows.append({**base, "error": None, "answer": answer, "tool_calls": calls,
                             "retrieved": retrieved, "tokens": sum_tokens(new),
                             "scores": score_agent(it, calls, retrieved, answer)})
            sc = rows[-1]["scores"]
            print(f"  [{rep}] {it['id']:<10} {it['expect_kind']:<15} pass={sc.get('pass')}")
            time.sleep(sleep)
    return rows


def run_naive(items, reps, model, retries, retry_wait, sleep):
    from chat.agent import build_llm

    corpus, name_by_code = build_corpus()
    system = NAIVE_SYSTEM.format(corpus=corpus)
    llm = build_llm(model)
    rows = []
    for rep in range(1, reps + 1):
        print(f"\n[rep {rep}/{reps}]  (naive, corpus {len(corpus)} chars)")
        for it in items:
            if it["expect_kind"] not in ("hit", "not_registered"):
                continue
            msgs = [("system", system), ("human", it["question"])]
            resp, err, latency_ms = None, None, None
            for attempt in range(retries + 1):
                t0 = time.perf_counter()
                try:
                    resp = llm.invoke(msgs)
                    err = None
                    break
                except Exception as exc:  # noqa: BLE001
                    err = str(exc)
                    if attempt < retries and any(m in err.lower() for m in ("429", "quota", "rate")):
                        time.sleep(retry_wait * (attempt + 1))
                        continue
                    break
            latency_ms = round((time.perf_counter() - t0) * 1000, 1)
            base = {"rep": rep, "scenario_id": it["id"], "category": it["category"],
                    "latency_ms": latency_ms, "tool_calls": None, "retrieved": None}
            if err or resp is None:
                rows.append({**base, "error": err or "unknown", "answer": None, "tokens": None,
                             "scores": score_naive(it, "", name_by_code)})
            else:
                from chat.message_utils import extract_text
                answer = extract_text(resp.content)
                rows.append({**base, "error": None, "answer": answer,
                             "tokens": sum_tokens([resp]),
                             "scores": score_naive(it, answer, name_by_code)})
            print(f"  [{rep}] {it['id']:<10} {it['expect_kind']:<15} pass={rows[-1]['scores'].get('pass')}")
            time.sleep(sleep)
    return rows


def print_summary(summary: Dict[str, Any], mode: str) -> None:
    print("\n" + "=" * 66)
    print(f"  mode={mode}  model={summary['meta'].get('model')}  reps={summary['n_reps']}  "
          f"rows={summary['n_rows']}  errors={summary['n_errors']}")
    print("=" * 66)
    print(f"  전체 pass rate : {_pct(summary['overall_pass_rate'])}")
    for kind, b in summary["by_kind"].items():
        print(f"\n  [{kind}]  n={b['n']}  pass={_pct(b['pass_rate'])}")
        for key in ("hit_at_1", "hit_at_3", "hit_at_5", "search_syllabus_called_rate",
                    "answer_names_course_rate", "no_hallucination_rate",
                    "says_not_registered_rate", "syllabus_tool_called_rate", "tool_ok_rate"):
            if key in b:
                print(f"      {key:<28} {_pct(b[key])}")
    st = summary["stability"]
    print(f"\n  전 rep pass 시나리오 : {st['fully_passing_all_reps']}/{st['scenarios_scored']}"
          f"   flaky: {st['flaky_scenarios'] or '없음'}")
    if "latency_ms" in summary:
        L = summary["latency_ms"]
        print(f"  latency ms : p50 {L['p50']}  p95 {L['p95']}  mean {L['mean']}")
    if "tokens" in summary:
        T = summary["tokens"]
        print(f"  토큰 : 총 {T['total']}  row당 평균 {T['mean_per_row']}")
    print("=" * 66 + "\n")


def _pct(v):
    return "  n/a" if v is None else f"{v * 100:5.1f}%"


def main() -> None:
    ap = argparse.ArgumentParser(description="RAG hit rate 측정 (Stage 1-4)")
    ap.add_argument("--mode", choices=["retrieval", "agent", "naive"], default="agent")
    ap.add_argument("--questions", type=Path, default=DEFAULT_QUESTIONS)
    ap.add_argument("--reps", type=int, default=3)
    ap.add_argument("--out-dir", type=Path, default=DEFAULT_OUT_DIR)
    ap.add_argument("--model", default=None, help="CHAT_MODEL 오버라이드")
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--sleep", type=float, default=1.0)
    ap.add_argument("--retries", type=int, default=3)
    ap.add_argument("--retry-wait", type=float, default=30.0)
    ap.add_argument("--label", default="")
    args = ap.parse_args()

    if args.model:
        os.environ["CHAT_MODEL"] = args.model
    model = os.getenv("CHAT_MODEL", "gemini-3.1-flash-lite")

    items = load_items(args.questions)
    if args.limit:
        items = items[: args.limit]

    preflight_qdrant()
    if args.mode == "agent":
        preflight_backend()
    if model.startswith(("gemini", "models/gemini")) and not os.getenv("GEMINI_API_KEY"):
        sys.exit("[오류] GEMINI_API_KEY 가 없습니다.")

    from chat.agent import RECURSION_LIMIT

    print(f"mode={args.mode}  model={model}  items={len(items)}  reps={args.reps}")
    started = datetime.now()

    if args.mode == "retrieval":
        rows = run_retrieval(items, args.reps)
    elif args.mode == "agent":
        rows = run_agent(items, args.reps, RECURSION_LIMIT, args.retries, args.retry_wait, args.sleep)
    else:
        rows = run_naive(items, args.reps, model, args.retries, args.retry_wait, args.sleep)

    meta = {
        "mode": args.mode, "model": model,
        "started_at": started.isoformat(timespec="seconds"),
        "finished_at": datetime.now().isoformat(timespec="seconds"),
        "questions_file": str(args.questions),
    }
    summary = summarize_rag(rows, args.reps, meta)

    args.out_dir.mkdir(parents=True, exist_ok=True)
    stamp = started.strftime("%Y%m%d-%H%M%S")
    tag = f"-{args.label}" if args.label else ""
    stem = f"04-rag-eval-{args.mode}-{model}{tag}-{stamp}"
    (args.out_dir / f"{stem}.jsonl").write_text(
        "\n".join(json.dumps(r, ensure_ascii=False) for r in rows) + "\n", encoding="utf-8")
    (args.out_dir / f"{stem}-summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")

    print_summary(summary, args.mode)
    print(f"raw     : {args.out_dir / (stem + '.jsonl')}")
    print(f"summary : {args.out_dir / (stem + '-summary.json')}")


if __name__ == "__main__":
    main()
