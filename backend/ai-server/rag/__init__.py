"""강의계획서 RAG 적재 파이프라인 (ADR-010 §4/§5/§6 재검토/§13, Stage 1-2).

`syllabi.yaml`(수기 single source of truth, 파싱 방식 A3) → 검증 → Gemini 비대칭
임베딩(RETRIEVAL_DOCUMENT) → Qdrant `syllabi` 컬렉션.

- `validate_syllabi.py` : 스키마 검증 (독립 실행 가능, ingest도 내부 호출)
- `ingest.py`           : YAML → 임베딩 → Qdrant. `--dry-run` / 적재 후 요약
- `inspect_qdrant.py`   : list / show <course_code> / query "<text>"
"""
