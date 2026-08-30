"""RAG 파이프라인 환경설정 (env.chat.docker 계열)."""
import os
from pathlib import Path

QDRANT_URL = os.getenv("QDRANT_URL", "http://localhost:6333")
COLLECTION = os.getenv("SYLLABUS_COLLECTION", "syllabi")

# ADR-010 §5: gemini-embedding-001 — task_type으로 문서/쿼리 비대칭 임베딩.
EMBED_MODEL = os.getenv("EMBED_MODEL", "gemini-embedding-001")
EMBED_DIM = int(os.getenv("EMBED_DIM", "3072"))

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

# syllabi.yaml 은 이 패키지와 같은 디렉토리 (커밋되는 single source of truth).
SYLLABI_YAML = Path(__file__).with_name("syllabi.yaml")

# uuid5 결정론적 point ID 용 고정 네임스페이스 (ADR-010 §13 재검토).
# 절대 바꾸지 말 것 — 바꾸면 wipe-and-reload 시 전 point ID가 갈린다.
UUID_NAMESPACE = "6f9619ff-8b86-d011-b42d-00cf4fc964ff"
