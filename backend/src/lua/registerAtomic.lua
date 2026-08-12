-- Group C(Redis 원자적 연산) 수강신청 등록 스크립트.
-- ADR-006 2.1(좌석 차감)+2.2(중복/시간표 겹침 검증)을 하나의 스크립트로 묶어
-- Redis 싱글 스레드 특성으로 Check-Then-Act 틈을 원천 차단한다(별도 요청으로
-- 분리하면 안 됨 — ADR-006 2.1 하단 경고 참고).
--
-- KEYS[1] = class:{classId}:seats   잔여 좌석 카운터 (String, 정수)
-- KEYS[2] = class:{classId}:slots   그 과목이 점유하는 5분 단위 시간표 슬롯 Set
--                                   (doc/portfolio/01-group-c-redis-설계-결정.md 1장)
-- KEYS[3] = user:{userId}:registered  이 학생이 신청한 classId Set
-- KEYS[4] = user:{userId}:slots       이 학생이 이미 점유 중인 시간표 슬롯 Set
-- ARGV[1] = classId
--
-- 반환값: {코드, 메시지}
--   {1, "OK"}          성공 — 좌석 차감 + 신청자/슬롯 등록 완료
--   {-1, "DUPLICATE"}  이미 신청한 과목
--   {-2, "OVERLAP"}    기존 신청 과목과 시간표 겹침
--   {-3, "FULL"}       정원 마감(실제로 0석)
--   {-4, "NOT_FOUND"}  좌석 카운터 자체가 없음(시딩 누락 또는 잘못된 classId) —
--                      Group A/B가 이 경우 404를 주는 것과 계약을 맞추기 위해
--                      "정원마감"과는 다른 코드로 구분한다.

local classId = ARGV[1]

if redis.call('SISMEMBER', KEYS[3], classId) == 1 then
  return {-1, 'DUPLICATE'}
end

-- SINTER는 두 Set 중 하나가 없어도(신규 학생·시간표 없는 과목) 빈 결과를 반환하므로
-- 별도 존재 체크가 필요 없다.
local overlap = redis.call('SINTER', KEYS[4], KEYS[2])
if #overlap > 0 then
  return {-2, 'OVERLAP'}
end

local rawSeats = redis.call('GET', KEYS[1])
if rawSeats == false then
  return {-4, 'NOT_FOUND'}
end

local seats = tonumber(rawSeats)
if seats <= 0 then
  return {-3, 'FULL'}
end

redis.call('DECR', KEYS[1])
redis.call('SADD', KEYS[3], classId)

local slotMembers = redis.call('SMEMBERS', KEYS[2])
if #slotMembers > 0 then
  redis.call('SADD', KEYS[4], unpack(slotMembers))
end

return {1, 'OK'}
