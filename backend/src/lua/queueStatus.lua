-- 대기열/Active 상태 조회(읽기 전용). ZSCORE + ZRANK를 하나의 스크립트로 묶어,
-- 두 호출 사이에 승격 사이클(promoteQueue.lua)이 끼어들어 "방금 승격된 사용자를
-- 여전히 대기 중으로 오응답하는" 경쟁 상태를 막는다(코드 리뷰 발견 사항, 2026-08-19).
--
-- KEYS[1] = active_gate:global   Active 사용자 Sorted Set (score = 만료 예정 시각 ms)
-- KEYS[2] = waiting_queue:global 대기 사용자 Sorted Set (score = 입장 시퀀스 번호)
-- ARGV[1] = userId
-- ARGV[2] = now (ms)
--
-- 반환값: {상태코드, 부가값}
--   {1, expiresAt}  Active — 부가값은 만료 예정 시각(ms)
--   {2, rank}       대기 중 — 부가값은 0-indexed 순번(ZRANK)
--   {0, 0}          진입한 적 없음

local activeScore = redis.call('ZSCORE', KEYS[1], ARGV[1])
if activeScore and tonumber(activeScore) > tonumber(ARGV[2]) then
  return {1, activeScore}
end

local waitScore = redis.call('ZSCORE', KEYS[2], ARGV[1])
if waitScore then
  local rank = redis.call('ZRANK', KEYS[2], ARGV[1])
  return {2, rank}
end

return {0, 0}
