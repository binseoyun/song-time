"""AI 챗봇 작업 메모리(ADR-010 §10) — redis-chat, 순수 캐시.
소스오브트루스는 항상 MySQL(db-chat, chat_messages)이라 Redis가 비어 있어도(TTL 만료,
재시작 등) 정보 손실이 없다 — 이 모듈의 모든 함수는 Redis 장애 시 예외를 삼키고
호출자가 MySQL 웜업 경로로 계속 진행하게 둔다.
"""
import json
import os
from typing import Dict, List, Optional

import redis

_CHAT_REDIS_HOST = os.getenv("CHAT_REDIS_HOST", "localhost")
_CHAT_REDIS_PORT = int(os.getenv("CHAT_REDIS_PORT", "6380"))
_TTL_SECONDS = int(os.getenv("CHAT_CACHE_TTL_SECONDS", "1800"))
MAX_TURNS = int(os.getenv("CHAT_HISTORY_TURNS", "10"))

_client = redis.Redis(host=_CHAT_REDIS_HOST, port=_CHAT_REDIS_PORT, db=0, decode_responses=True)


def _key(session_id: str) -> str:
    return f"chat:history:{session_id}"


def read_history(session_id: str) -> Optional[List[Dict[str, str]]]:
    """캐시 hit면 [{role, content}, ...]를 반환하고, miss(또는 Redis 장애)면 None을
    반환해 호출자가 MySQL로 웜업하게 한다."""
    try:
        raw = _client.lrange(_key(session_id), 0, -1)
    except redis.RedisError:
        return None
    if not raw:
        return None
    return [json.loads(item) for item in raw]


def warm_up(session_id: str, messages: List[Dict[str, str]]) -> None:
    if not messages:
        return
    key = _key(session_id)
    try:
        pipe = _client.pipeline()
        pipe.delete(key)
        for message in messages:
            pipe.rpush(key, json.dumps(message))
        pipe.expire(key, _TTL_SECONDS)
        pipe.execute()
    except redis.RedisError:
        pass


def append_turn(session_id: str, user_message: str, assistant_message: str) -> None:
    key = _key(session_id)
    try:
        pipe = _client.pipeline()
        pipe.rpush(key, json.dumps({"role": "user", "content": user_message}))
        pipe.rpush(key, json.dumps({"role": "assistant", "content": assistant_message}))
        pipe.ltrim(key, -MAX_TURNS * 2, -1)
        pipe.expire(key, _TTL_SECONDS)
        pipe.execute()
    except redis.RedisError:
        pass
