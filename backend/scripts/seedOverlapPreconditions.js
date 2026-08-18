/**
 * overlap 어뷰징 시나리오(구현계획 Stage 1-6)의 "이미 CLASS_ID를 신청해둔 상태"라는
 * 전제를 라이브 HTTP 등록 없이 Redis에 직접 시딩한다.
 *
 * 배경(doc/troubleshooting/05 3순위): 예전엔 이 전제를 k6가 매 VU마다 실제
 * POST /api/registrations/redis로 만들었는데, 이건 정합성 스윕과 똑같은 종류의
 * 부하(정원 경합)를 어뷰징 시나리오 안에서 중복으로 만들어내는 설계였다. 검증하려는
 * 건 두 번째 요청(SINTER 겹침 체크)이지 첫 번째 등록의 정원 경합이 아니므로, 그
 * 전제 자체를 라이브 트래픽 없이 만들어 어뷰징 시나리오의 순간 부하를 절반으로 줄인다.
 *
 * registerAtomic.lua가 신청 성공 시 하는 일(SADD user:{id}:registered, SADD
 * user:{id}:slots) 중 좌석 차감(DECR)만 뺀 나머지를 그대로 재현한다 — 이 시나리오가
 * 검증하는 SINTER 겹침 체크는 좌석 카운터를 전혀 참조하지 않으므로 안전하게 생략 가능.
 *
 * 실행: (seedRedisRegistrations.js로 CLASS_ID의 슬롯이 이미 시딩되어 있어야 함)
 *   docker compose -f docker-compose.yml -f docker-compose.loadtest.yml exec backend_1 \
 *     node scripts/seedOverlapPreconditions.js
 *
 * 환경변수:
 *   ACCOUNT_COUNT  전제를 시딩할 계정 수 (기본 500, seedLoadTestAccounts.js와 동일하게 맞춰야 함)
 *   CLASS_ID       "이미 신청해둔" 것으로 만들 대상 과목 id (기본 '21001083-2')
 */
const sequelize = require('../src/config/database');
const redis = require('../src/config/redis');
const User = require('../src/models/User');
const { classSlotsKey, userRegisteredKey, userSlotsKey } = require('../src/utils/redisKeys');

const ACCOUNT_COUNT = Number(process.env.ACCOUNT_COUNT) || 500;
const CLASS_ID = process.env.CLASS_ID || '21001083-2';
const STUDENT_ID_PREFIX = 'loadtest';
const BATCH_SIZE = 1000;

function studentIdOf(i) {
  return `${STUDENT_ID_PREFIX}-${String(i).padStart(6, '0')}`;
}

async function main() {
  await sequelize.authenticate();

  const slotMembers = await redis.smembers(classSlotsKey(CLASS_ID));
  if (slotMembers.length === 0) {
    throw new Error(
      `${classSlotsKey(CLASS_ID)}에 슬롯이 없습니다. seedRedisRegistrations.js를 먼저 실행했는지 확인하세요.`
    );
  }

  const studentIds = Array.from({ length: ACCOUNT_COUNT }, (_, i) => studentIdOf(i + 1));
  const users = await User.findAll({
    where: { studentId: studentIds },
    attributes: ['id'],
  });
  if (users.length !== ACCOUNT_COUNT) {
    throw new Error(
      `계정 ${ACCOUNT_COUNT}개를 기대했으나 ${users.length}개만 찾았습니다. seedLoadTestAccounts.js를 먼저 실행했는지 확인하세요.`
    );
  }

  for (let offset = 0; offset < users.length; offset += BATCH_SIZE) {
    const batch = users.slice(offset, offset + BATCH_SIZE);
    const pipeline = redis.pipeline();
    for (const user of batch) {
      pipeline.sadd(userRegisteredKey(user.id), CLASS_ID);
      pipeline.sadd(userSlotsKey(user.id), ...slotMembers);
    }
    await pipeline.exec();
  }

  console.log(
    `✓ ${users.length}개 계정에 "${CLASS_ID} 이미 신청함" 전제를 Redis에 직접 시딩했습니다` +
      `(슬롯 ${slotMembers.length}개, 라이브 HTTP 등록 없음).`
  );

  await sequelize.close();
  redis.disconnect();
}

main().catch((error) => {
  console.error('overlap 전제 시딩 실패:', error);
  process.exitCode = 1;
});
