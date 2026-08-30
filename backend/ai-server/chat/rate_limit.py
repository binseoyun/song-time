"""챗봇 사용자 단위 rate limit (ADR-010 §15 재검토 — Stage 3-0, 이슈 #108).

§15는 원래 "Node 게이트웨이 계층 + Group C Redis"로 정했으나, 완전 MSA 분리 방향에서
**챗봇의 비용(Gemini 토큰)은 챗봇 서비스가 책임진다**로 재검토했다. Node는 인증만 하고
x-user-id를 넘기며, rate limit은 여기 ai-server에서 `redis-chat`(이 서비스가 소유)으로
건다. 향후 전용 API Gateway(Kong 등) 도입 시 거기에 "요청 수" 기준 coarse 계층을
추가로 얹을 수 있다(defense in depth).

- 고정 윈도우 카운터. `INCR` + `EXPIRE`를 Lua로 원자적으로 — 두 명령 사이에
  프로세스가 죽어 "만료 없는 영구 카운터"가 남는 경우를 없앤다.
- Redis 장애 시 fail-open (가드레일이 죽었다고 챗봇을 아예 막지 않는다).
- 허용 횟수·윈도우는 env(요청 시점 읽기 — 재시작 없이 조정·테스트 오버라이드).
  현재 값은 placeholder — 실호출 분포를 보고 Stage 3-3에서 확정한다(§15).
"""
from __future__ import annotations

import os

import redis

_CHAT_REDIS_HOST = os.getenv("CHAT_REDIS_HOST", "localhost")
_CHAT_REDIS_PORT = int(os.getenv("CHAT_REDIS_PORT", "6380"))

_DEFAULT_LIMIT = 20
_DEFAULT_WINDOW_SEC = 60

# cache.py의 _client(작업 메모리)와 물리적으로 같은 redis-chat이지만 관심사가 달라
# 별도 커넥션을 둔다. 키 네임스페이스도 분리(chat:ratelimit:* vs chat:history:*).
_client = redis.Redis(host=_CHAT_REDIS_HOST, port=_CHAT_REDIS_PORT, db=0, decode_responses=True)

# INCR + (첫 히트면) EXPIRE. TTL이 음수면(orphan 키) 그 자리에서 다시 건다 → self-heal.
_LUA = """
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('TTL', KEYS[1])
if ttl < 0 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return {count, ttl}
"""
_script = _client.register_script(_LUA)


class RateLimitExceeded(Exception):
    """허용 횟수 초과. retry_after(초)를 담는다 — router가 429 + Retry-After로 변환."""

    def __init__(self, retry_after: int, limit: int):
        super().__init__(f"rate limit 초과 (limit={limit}/window)")
        self.retry_after = retry_after
        self.limit = limit


def _config() -> tuple[int, int]:
    limit = int(os.getenv("CHAT_RATE_LIMIT") or _DEFAULT_LIMIT)
    window = int(os.getenv("CHAT_RATE_WINDOW_SEC") or _DEFAULT_WINDOW_SEC)
    return limit, window


def check_rate_limit(user_id: int) -> None:
    """이번 요청을 카운트하고, 윈도우 허용치를 넘었으면 RateLimitExceeded를 던진다.
    Redis 장애 시 조용히 통과(fail-open)."""
    limit, window = _config()
    key = f"chat:ratelimit:{user_id}"
    try:
        count, ttl = _script(keys=[key], args=[window])
    except redis.RedisError as exc:
        print(f"[WARN] rate limit 우회 (redis-chat 오류): {exc}")
        return
    if int(count) > limit:
        raise RateLimitExceeded(retry_after=int(ttl), limit=limit)
