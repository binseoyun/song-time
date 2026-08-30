"""Gemini 비대칭 임베딩 (ADR-010 §5).

`gemini-embedding-001` + task_type — 문서는 RETRIEVAL_DOCUMENT, 쿼리는 RETRIEVAL_QUERY.
벡터는 우리가 직접 계산해 Qdrant에 넣는다(스토어 임베딩 함수 안 씀 → task_type 제어 유지).
"""
from __future__ import annotations

import time

import google.generativeai as genai

from .config import EMBED_DIM, EMBED_MODEL, GEMINI_API_KEY

_configured = False


def _ensure_configured() -> None:
    global _configured
    if _configured:
        return
    if not GEMINI_API_KEY:
        raise RuntimeError("GEMINI_API_KEY 가 없습니다 (.env.docker).")
    genai.configure(api_key=GEMINI_API_KEY)
    _configured = True


def _embed(texts: list[str], task_type: str) -> list[list[float]]:
    _ensure_configured()
    model = EMBED_MODEL if EMBED_MODEL.startswith("models/") else f"models/{EMBED_MODEL}"
    out: list[list[float]] = []
    # embed_content 는 content=list 도 받지만, 한 건씩 호출해 부분 실패를 분리하고
    # 429 backoff 를 건별로 건다(적재는 17건 배치라 처리량 무관).
    for i, text in enumerate(texts):
        for attempt in range(5):
            try:
                res = genai.embed_content(
                    model=model,
                    content=text,
                    task_type=task_type,
                    output_dimensionality=EMBED_DIM,
                )
                out.append(list(res["embedding"]))
                break
            except Exception as exc:  # noqa: BLE001 — 재시도 후 그대로 전파
                if attempt == 4:
                    raise RuntimeError(f"임베딩 실패 (텍스트 {i}): {exc}") from exc
                time.sleep(2 ** attempt)
    return out


def embed_documents(texts: list[str]) -> list[list[float]]:
    return _embed(texts, "retrieval_document")


def embed_query(text: str) -> list[float]:
    return _embed([text], "retrieval_query")[0]
