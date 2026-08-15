/**
 * Group C(Redis 원자적 연산) 부하테스트 전 Redis 워밍업.
 *
 * doc/실시간-수강신청-구현계획.md Stage 1-2. 매 실험 회차 실행 전에 반드시
 * 다시 실행해서 좌석/신청자/시간표 슬롯을 초기 상태로 되돌린다 —
 * backend/scripts/seedLoadTestAccounts.js가 MySQL 쪽을 리셋하는 것과 짝을 이룬다.
 *
 * 이 Redis 인스턴스는 이 실험 전용이므로(다른 기능이 아직 Redis를 안 씀),
 * 매 회차 FLUSHDB로 완전히 비우고 대상 과목만 다시 채워 넣는다 — 이전 회차의
 * 학생 등록 상태나 다른 과목 데이터가 섞여 들어갈 여지를 원천 차단한다.
 *
 * 실행: (docker-compose.loadtest.yml 사용법 주석 참고)
 *   docker compose -f docker-compose.yml -f docker-compose.loadtest.yml exec backend \
 *     node scripts/seedRedisRegistrations.js
 *
 * 환경변수:
 *   CLASS_ID  초기화할 실험 대상 과목 id (기본 '21001083-2', seedLoadTestAccounts.js와 동일)
 */
const sequelize = require('../src/config/database');
const redis = require('../src/config/redis');
const Class = require('../src/models/Class');
const ClassSchedule = require('../src/models/ClassSchedule');
const { computeSlotIds } = require('../src/utils/scheduleSlots');
const { classSeatsKey, classSlotsKey } = require('../src/utils/redisKeys');

const CLASS_ID = process.env.CLASS_ID || '21001083-2';

async function main() {
  await sequelize.authenticate();

  const course = await Class.findByPk(CLASS_ID);
  if (!course) {
    throw new Error(`대상 과목(${CLASS_ID})을 찾을 수 없습니다. 먼저 backend에서 seedData.js를 실행했는지 확인하세요.`);
  }
  const schedules = await ClassSchedule.findAll({ where: { class_id: CLASS_ID } });

  await redis.flushdb();
  console.log('✓ Redis FLUSHDB 완료');

  await redis.set(classSeatsKey(CLASS_ID), course.capacity);
  console.log(`✓ 좌석 카운터 초기화: ${classSeatsKey(CLASS_ID)} = ${course.capacity}`);

  const slotIds = schedules.flatMap((s) => computeSlotIds(s.weekday, s.start_time, s.end_time));
  if (slotIds.length > 0) {
    await redis.sadd(classSlotsKey(CLASS_ID), slotIds);
  }
  console.log(`✓ 시간표 슬롯 등록: ${classSlotsKey(CLASS_ID)} = ${slotIds.length}개 슬롯`);

  await sequelize.close();
  redis.disconnect();
}

main().catch((error) => {
  console.error('Redis 시딩 실패:', error);
  process.exitCode = 1;
});
