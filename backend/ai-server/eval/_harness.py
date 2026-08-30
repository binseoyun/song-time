"""eval 러너 공용 헬퍼 (이슈 #104, Stage 1-4).

run_tool_eval.py(Tool 라우팅)와 run_rag_eval.py(RAG hit rate)가 같은 방식으로
backend 프리플라이트 / 에이전트 invoke + 429 backoff / 토큰 합산 / 산출물 경로를
써야 해서 뽑아냈다. 채점 로직은 각자 scoring.py / rag_scoring.py 에 둔다.
"""
from __future__ import annotations

import os
import sys
import time
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

import requests

_PARENTS = Path(__file__).resolve().parents
# 호스트에서 리포 루트째로 실행하면 .../backend/ai-server/eval 라 parents[3]=리포 루트지만,
# 컨테이너 안에선 /app/eval/... 라 parents가 3개뿐 — 안전하게 클램프.
REPO_ROOT = _PARENTS[3] if len(_PARENTS) > 3 else _PARENTS[-1]


def default_out_dir() -> Path:
    """호스트에서 리포 루트째로 실행하면 doc/experiment/raw, 컨테이너 안(WORKDIR=/app)이면
    그 경로가 없으므로 ./eval-out (README는 -v 마운트 + --out-dir 권장)."""
    repo_out = REPO_ROOT / "doc" / "experiment" / "raw"
    return repo_out if repo_out.parent.is_dir() else Path.cwd() / "eval-out"


# str(exc)를 소문자로 낮춰 부분 매칭.
RATE_LIMIT_MARKERS = ("429", "resourceexhausted", "resource_exhausted", "quota",
                      "rate limit", "rate_limit", "ratelimit", "too many requests")


def is_rate_limit(err: str) -> bool:
    low = err.lower()
    return any(mark in low for mark in RATE_LIMIT_MARKERS)


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


def preflight_qdrant() -> str:
    """RAG eval 전용 — syllabi 컬렉션에 포인트가 있는지 확인."""
    from rag import store

    try:
        n = store.count(store.client())
    except Exception as exc:  # noqa: BLE001
        sys.exit(
            f"[오류] Qdrant syllabi 컬렉션에 연결할 수 없습니다: {exc}\n"
            f"       docker compose up -d qdrant && "
            f"docker compose exec ai-server python -m rag.ingest 후 다시 실행하세요."
        )
    if n == 0:
        sys.exit("[오류] syllabi 컬렉션이 비어 있습니다 — rag.ingest 를 먼저 실행하세요.")
    return f"syllabi ({n} points)"


def sum_tokens(messages) -> Optional[Dict[str, int]]:
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


def invoke_with_retry(
    agent, input_messages, recursion_limit: int, retries: int, retry_wait: float
) -> Tuple[Optional[Any], Optional[str], float]:
    """에이전트 invoke 1회 + rate-limit backoff. (result, err, latency_ms) 반환.

    result 가 None 이고 err 가 있으면 호출 실패. rate limit 이 아니면 첫 실패에 바로 반환.
    """
    result = None
    err: Optional[str] = None
    t0 = time.perf_counter()
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
            if is_rate_limit(err) and attempt < retries:
                wait = retry_wait * (attempt + 1)
                print(f"    · rate limit, {wait:.0f}s 대기 후 재시도 ({attempt + 1}/{retries})")
                time.sleep(wait)
                continue
            break
    latency_ms = round((time.perf_counter() - t0) * 1000, 1)
    return result, err, latency_ms
