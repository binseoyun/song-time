-- Group C 수강신청 취소(Drop) 스크립트.
-- doc/portfolio/01-group-c-redis-설계-결정.md 4장 결정: 취소는 동기 처리하되,
-- Redis 쪽 좌석 반환/슬롯 해제는 원자성을 위해 Lua로 묶는다. MySQL Registration
-- 삭제는 이 스크립트 호출 "이전"에 애플리케이션 레이어에서 먼저 수행한다 —
-- 실패 시 "정원은 안 돌아왔지만 신청 기록도 없는" 상태보다, "신청 기록은 지워졌는데
-- 정원 반환만 실패"해 좌석 하나가 잠기는 쪽(Ghost Decrement와 같은 성격의, 관측
-- 가능한 손실)이 이중 등록보다 안전한 실패 방향이기 때문이다.
--
-- KEYS[1] = class:{classId}:seats
-- KEYS[2] = class:{classId}:slots
-- KEYS[3] = user:{userId}:registered
-- KEYS[4] = user:{userId}:slots
-- ARGV[1] = classId
--
-- 반환값: {1, "OK"} 성공 / {-1, "NOT_REGISTERED"} 애초에 Redis 기준 신청 내역 없음

local classId = ARGV[1]

if redis.call('SISMEMBER', KEYS[3], classId) == 0 then
  return {-1, 'NOT_REGISTERED'}
end

redis.call('SREM', KEYS[3], classId)

local slotMembers = redis.call('SMEMBERS', KEYS[2])
if #slotMembers > 0 then
  redis.call('SREM', KEYS[4], unpack(slotMembers))
end

redis.call('INCR', KEYS[1])

return {1, 'OK'}
