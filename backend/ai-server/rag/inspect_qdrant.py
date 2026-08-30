"""Qdrant `syllabi` 컬렉션 점검 도구.

    python -m rag.inspect_qdrant list
    python -m rag.inspect_qdrant show 21000549
    python -m rag.inspect_qdrant query "동적계획법이랑 그리디 배우는 수업" [-k 5]
"""
from __future__ import annotations

import argparse
import json
import sys

from .config import COLLECTION
from . import store


def _cmd_list() -> int:
    qc = store.client()
    records = store.scroll_all(qc)
    records.sort(key=lambda r: r.payload["chunk_key"])
    print(f"{COLLECTION}: {len(records)} points")
    for r in records:
        p = r.payload
        codes = ", ".join(f"{p['course_code']}-{n}" for n in p["class_no"])
        print(f"  {p['chunk_key']:16} {p['course_name']:22} {p['professor']:8} [{codes}]  {p['source_pdf']}")
    return 0


def _cmd_show(course_code: str) -> int:
    qc = store.client()
    records = store.by_course_code(qc, course_code)
    if not records:
        print(f"(없음) course_code={course_code} — 강의계획서 미등록")
        return 1
    for r in records:
        print(json.dumps(r.payload, ensure_ascii=False, indent=2))
    return 0


def _cmd_query(text: str, k: int) -> int:
    from . import embed

    qc = store.client()
    vec = embed.embed_query(text)
    hits = qc.search(collection_name=COLLECTION, query_vector=vec, limit=k, with_payload=True)
    print(f'query: "{text}"  (top-{k}, RETRIEVAL_QUERY)')
    for rank, h in enumerate(hits, 1):
        p = h.payload
        print(f"  {rank}. {h.score:.4f}  {p['chunk_key']:16} {p['course_name']} — {p['professor']}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("list")
    sp_show = sub.add_parser("show")
    sp_show.add_argument("course_code")
    sp_query = sub.add_parser("query")
    sp_query.add_argument("text")
    sp_query.add_argument("-k", type=int, default=5)
    args = ap.parse_args()

    if args.cmd == "list":
        return _cmd_list()
    if args.cmd == "show":
        return _cmd_show(args.course_code)
    if args.cmd == "query":
        return _cmd_query(args.text, args.k)
    return 2


if __name__ == "__main__":
    sys.exit(main())
