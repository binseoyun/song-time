// DLQ로 격리된 신청의 좌석을 자동으로 되돌린다(Stage 3-4 축소판, 이슈 #62, ADR-009).
// worker.js가 재시도(MAX_ATTEMPTS)를 다 소진해 메시지를 DLQ로 격리하는 시점에 호출한다.
//
// registrationService.cancelRedisAtomic과 동일한 Redis 되돌리기 연산(cancelAtomic.lua)을
// 그대로 재사용한다 — "MySQL 반영이 영영 안 될 신청"은 사용자가 직접 취소한 것과 Redis
// 상태 관점에서 같은 결과(좌석 반환 + 등록 해제)가 되어야 하기 때문이다. 다만 MySQL에는
// 애초에 이 신청이 INSERT된 적이 없으므로(계속 실패하다 DLQ로 갔으니), cancelRedisAtomic과
// 달리 MySQL 삭제 작업은 필요 없다.
const redis = require('../config/redis');
const { classSeatsKey, classSlotsKey, userRegisteredKey, userSlotsKey } = require('../utils/redisKeys');

async function returnSeatForFailedRegistration({ userId, classId }) {
  const [code] = await redis.cancelAtomic(
    classSeatsKey(classId),
    classSlotsKey(classId),
    userRegisteredKey(userId),
    userSlotsKey(userId),
    classId
  );

  if (code === -1) {
    // 이미 등록 상태가 아님 — 그 사이 사용자가 직접 취소했거나 이미 반환된 경우다.
    // 이중 반환(좌석을 두 번 돌려주는 것)을 막는 정상적인 가드이지 에러가 아니다.
    console.warn(`[compensation] 이미 등록 상태가 아님 — 반환 스킵 userId=${userId} classId=${classId}`);
    return false;
  }

  console.error(`[compensation] DLQ 격리로 인한 좌석 자동 반환 userId=${userId} classId=${classId}`);
  return true;
}

module.exports = { returnSeatForFailedRegistration };
