"""chat/rate_limit.py 통합 테스트 (이슈 #108).

    docker compose exec ai-server python -m unittest chat.test_rate_limit

실제 redis-chat에 붙어 고정 윈도우 카운터·429 경계·사용자별 독립·fail-open을 검증한다.
키는 테스트 전용 user_id(9000번대)를 쓰고 각 테스트가 정리한다.
"""
import os
import unittest
from unittest.mock import patch

import redis as redis_lib

from chat import rate_limit
from chat.rate_limit import RateLimitExceeded, check_rate_limit


def _key(uid):
    return f"chat:ratelimit:{uid}"


class RateLimitTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        os.environ["CHAT_RATE_LIMIT"] = "3"
        os.environ["CHAT_RATE_WINDOW_SEC"] = "60"

    @classmethod
    def tearDownClass(cls):
        os.environ.pop("CHAT_RATE_LIMIT", None)
        os.environ.pop("CHAT_RATE_WINDOW_SEC", None)

    def tearDown(self):
        rate_limit._client.delete(*[_key(u) for u in (9001, 9002, 9003, 9004, 9005)])

    def test_within_limit_then_429(self):
        for _ in range(3):
            check_rate_limit(9001)  # 예외 없음
        with self.assertRaises(RateLimitExceeded) as ctx:
            check_rate_limit(9001)
        self.assertGreater(ctx.exception.retry_after, 0)
        self.assertEqual(ctx.exception.limit, 3)

    def test_per_user_independent(self):
        for _ in range(4):
            try:
                check_rate_limit(9002)
            except RateLimitExceeded:
                pass
        # 9002는 막혔어도 9003은 영향 없음
        check_rate_limit(9003)  # 예외 없음

    def test_fail_open_on_redis_error(self):
        with patch.object(rate_limit, "_script", side_effect=redis_lib.RedisError("down")):
            check_rate_limit(9004)  # 조용히 통과

    def test_ttl_is_set(self):
        check_rate_limit(9005)
        ttl = rate_limit._client.ttl(_key(9005))
        self.assertTrue(0 < ttl <= 60)


if __name__ == "__main__":
    unittest.main()
