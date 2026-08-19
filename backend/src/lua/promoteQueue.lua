-- 대기열 승격 사이클(ADR-006 1.3 보완 해결, 이슈 #46) — 배치 폴링 방식.
-- 만료자 제거 → 빈 슬롯 계산 → 대기열 앞순위를 그만큼 승격, 세 단계를 하나의
-- Lua Script로 원자 처리한다(서버가 주기적으로 이 스크립트를 호출).
--
-- KEYS[1] = active_gate:global   Active 사용자 Sorted Set (score = 만료 예정 시각 ms)
-- KEYS[2] = waiting_queue:global 대기 사용자 Sorted Set (score = 최초 진입 시각 ms)
-- ARGV[1] = now (ms)
-- ARGV[2] = TTL(ms) — 승격 시 새로 부여할 고정 TTL
-- ARGV[3] = Active 동시 인원 한도
--
-- 반환값: 이번 사이클에서 승격된 인원 수(정수)

redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])

local activeCount = redis.call('ZCARD', KEYS[1])
local freeSlots = tonumber(ARGV[3]) - activeCount
if freeSlots <= 0 then
  return 0
end

local promoted = redis.call('ZRANGE', KEYS[2], 0, freeSlots - 1)
if #promoted == 0 then
  return 0
end

local expiresAt = tonumber(ARGV[1]) + tonumber(ARGV[2])
for i = 1, #promoted do
  local member = promoted[i]
  redis.call('ZADD', KEYS[1], expiresAt, member)
  redis.call('ZREM', KEYS[2], member)
end

return #promoted
