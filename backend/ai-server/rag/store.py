"""Qdrant `syllabi` 컬렉션 접근.

재적재 = 전체 wipe-and-reload, `recreate_collection` 방식 (ADR-010 §4 재검토 (a)안).
학기당 1회·수동이라 재생성 중 수 초 빈결과는 감수한다. 무중단 alias 스왑(b안)은
이 빈도에 과함 — 필요해지면 그때.
"""
from __future__ import annotations

from qdrant_client import QdrantClient, models

from .config import COLLECTION, EMBED_DIM, QDRANT_URL


def client() -> QdrantClient:
    return QdrantClient(url=QDRANT_URL, timeout=30)


def recreate(qc: QdrantClient) -> None:
    qc.recreate_collection(
        collection_name=COLLECTION,
        vectors_config=models.VectorParams(size=EMBED_DIM, distance=models.Distance.COSINE),
    )
    # course_code 는 get_syllabus 의 주 필터키 (ADR-010 §13) — 인덱스를 명시적으로 만든다.
    qc.create_payload_index(
        collection_name=COLLECTION,
        field_name="course_code",
        field_schema=models.PayloadSchemaType.KEYWORD,
    )


def upsert(qc: QdrantClient, points: list[models.PointStruct]) -> None:
    qc.upsert(collection_name=COLLECTION, points=points, wait=True)


def count(qc: QdrantClient) -> int:
    return qc.count(collection_name=COLLECTION, exact=True).count


def scroll_all(qc: QdrantClient) -> list[models.Record]:
    records, _ = qc.scroll(
        collection_name=COLLECTION, limit=1000, with_payload=True, with_vectors=False
    )
    return records


def search(qc: QdrantClient, query_vector: list[float], limit: int = 3):
    """유사도 검색 — search_syllabus Tool·inspect_qdrant query 공용."""
    return qc.search(
        collection_name=COLLECTION,
        query_vector=query_vector,
        limit=limit,
        with_payload=True,
    )


def by_course_code(qc: QdrantClient, course_code: str) -> list[models.Record]:
    records, _ = qc.scroll(
        collection_name=COLLECTION,
        scroll_filter=models.Filter(
            must=[models.FieldCondition(key="course_code", match=models.MatchValue(value=course_code))]
        ),
        limit=16,
        with_payload=True,
        with_vectors=False,
    )
    return records
