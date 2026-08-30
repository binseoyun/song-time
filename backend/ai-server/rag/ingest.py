"""syllabi.yaml → Gemini 임베딩 → Qdrant 적재.

완전 수동 실행, 전체 wipe-and-reload (ADR-010 §4 재검토).

    python -m rag.ingest --dry-run     # 파싱·검증·청크 텍스트만, 임베딩/쓰기 없음
    python -m rag.ingest               # 임베딩 + recreate_collection + upsert + 요약
"""
from __future__ import annotations

import argparse
import sys

from qdrant_client import models

from .config import COLLECTION, EMBED_DIM, EMBED_MODEL, QDRANT_URL
from .syllabi import SyllabusValidationError, _check_cross_entry, load


def _print_chunk(s) -> None:
    text = s.embedding_text()
    print(f"\n─── {s.chunk_key}  ({', '.join(s.class_codes)})  [{s.point_id}]")
    print(f"    {s.course_name} · {s.professor} · {s.credits}학점 · {s.method}")
    print(f"    grading: {[(g['type'], g['weight']) for g in s.grading]}")
    print(f"    source_pdf: {s.source_pdf}")
    print("    ┌─ embedding_text ({} chars) ─".format(len(text)))
    for line in text.splitlines():
        print(f"    │ {line}")
    print("    └─")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--dry-run", action="store_true", help="파싱·검증만. 임베딩/Qdrant 쓰기 없음")
    args = ap.parse_args()

    try:
        items = load()
    except (SyllabusValidationError, FileNotFoundError) as exc:
        print(f"✗ syllabi.yaml 검증 실패: {exc}")
        return 1

    warnings = _check_cross_entry(items)
    for w in warnings:
        print(f"⚠ {w}")

    total_classes = sum(len(s.class_no) for s in items)
    codes = sorted({s.course_code for s in items})
    print(f"청크 {len(items)}개 / 분반 {total_classes}개 / 과목코드 {len(codes)}개")

    if args.dry_run:
        for s in items:
            _print_chunk(s)
        print(f"\n[dry-run] 임베딩·적재 안 함. 검증 {'경고 있음' if warnings else 'OK'}.")
        return 1 if warnings else 0

    # --- 실제 적재 ---
    from . import embed, store

    print(f"\n임베딩 {len(items)}건 ({EMBED_MODEL}, dim={EMBED_DIM}, RETRIEVAL_DOCUMENT)...")
    vectors = embed.embed_documents([s.embedding_text() for s in items])
    if any(len(v) != EMBED_DIM for v in vectors):
        print(f"✗ 임베딩 차원 불일치: {[len(v) for v in vectors]}")
        return 1

    points = [
        models.PointStruct(id=s.point_id, vector=v, payload=s.payload())
        for s, v in zip(items, vectors)
    ]

    print(f"Qdrant recreate_collection('{COLLECTION}') @ {QDRANT_URL} ...")
    qc = store.client()
    store.recreate(qc)
    store.upsert(qc, points)

    n = store.count(qc)
    print("\n─── 적재 요약 ───")
    print(f"  컬렉션      : {COLLECTION}  (distance=COSINE, dim={EMBED_DIM})")
    print(f"  포인트      : {n}  (기대 {len(items)})")
    print(f"  과목코드    : {len(codes)}  {codes}")
    merged = [s.chunk_key for s in items if len(s.class_no) > 1]
    print(f"  병합 청크   : {merged or '없음'}")
    if n != len(items):
        print("  ✗ 포인트 수가 청크 수와 다름!")
        return 1
    print("  ✓ 완료")
    return 0


if __name__ == "__main__":
    sys.exit(main())
