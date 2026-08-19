-- 대기열 입장(ADR-006 1.3 보완 해결, 이슈 #46).
-- 이미 Active/대기 중인지 먼저 확인해, 새로고침이나 중복 요청이 대기 순번을
-- 뒤로 미루지 않게 한다(ZADD는 기존 멤버의 score를 덮어써 순번을 초기화하므로,
-- 여기서 미리 걸러내지 않으면 재요청마다 줄 맨 뒤로 밀려나는 문제가 생긴다).
--
-- KEYS[1] = active_gate:global   Active 사용자 Sorted Set (score = 만료 예정 시각 ms)
-- KEYS[2] = waiting_queue:global 대기 사용자 Sorted Set (score = 최초 진입 시각 ms)
-- ARGV[1] = userId
-- ARGV[2] = now (ms)
--
-- 반환값: {상태코드, 부가값}
--   {1, expiresAt}  이미 Active 상태 — 부가값은 만료 예정 시각(ms)
--   {2, rank}       대기 중(신규 진입 포함) — 부가값은 0-indexed 순번(ZRANK)

local activeScore = redis.call('ZSCORE', KEYS[1], ARGV[1])
if activeScore and tonumber(activeScore) > tonumber(ARGV[2]) then
  return {1, activeScore}
end

local waitScore = redis.call('ZSCORE', KEYS[2], ARGV[1])
if waitScore then
  local rank = redis.call('ZRANK', KEYS[2], ARGV[1])
  return {2, rank}
end

redis.call('ZADD', KEYS[2], ARGV[2], ARGV[1])
local rank = redis.call('ZRANK', KEYS[2], ARGV[1])
return {2, rank}
