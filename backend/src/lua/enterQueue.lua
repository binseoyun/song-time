-- 대기열 입장(ADR-006 1.3 보완 해결, 이슈 #46).
-- 이미 Active/대기 중인지 먼저 확인해, 새로고침이나 중복 요청이 대기 순번을
-- 뒤로 미루지 않게 한다(ZADD는 기존 멤버의 score를 덮어써 순번을 초기화하므로,
-- 여기서 미리 걸러내지 않으면 재요청마다 줄 맨 뒤로 밀려나는 문제가 생긴다).
--
-- 순번 score는 도착 시각(ms)이 아니라 KEYS[3]의 INCR 시퀀스 번호를 쓴다 — 같은
-- 밀리초에 여러 요청이 몰리면(이 기능이 막으려는 바로 그 상황) ms 타임스탬프가
-- 동률이 되어 Redis가 멤버 문자열 사전순으로 순서를 정해버리는데(userId '10'이
-- '9'보다 먼저 취급됨), Redis가 싱글 스레드로 이 스크립트를 순차 실행하므로
-- INCR로 부여한 시퀀스 번호는 실제 처리 순서와 항상 정확히 일치한다(코드 리뷰
-- 발견 사항, 2026-08-19).
--
-- KEYS[1] = active_gate:global       Active 사용자 Sorted Set (score = 만료 예정 시각 ms)
-- KEYS[2] = waiting_queue:global     대기 사용자 Sorted Set (score = 입장 시퀀스 번호)
-- KEYS[3] = waiting_queue:global:seq 대기열 시퀀스 카운터 (String, 정수)
-- ARGV[1] = userId
-- ARGV[2] = now (ms) — Active 만료 여부 판정에만 쓰인다
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

local seq = redis.call('INCR', KEYS[3])
redis.call('ZADD', KEYS[2], seq, ARGV[1])
local rank = redis.call('ZRANK', KEYS[2], ARGV[1])
return {2, rank}
