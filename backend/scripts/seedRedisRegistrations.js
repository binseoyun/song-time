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
 *   docker compose -f docker-compose.yml -f docker-compose.loadtest.yml exec backend_1 \
 *     node scripts/seedRedisRegistrations.js
 *
 * 환경변수:
 *   CLASS_ID           초기화할 실험 대상 과목 id (기본 '21001083-2', seedLoadTestAccounts.js와 동일)
 *   OVERLAP_CLASS_ID   시간표 겹침 어뷰징 시나리오(1-6)용 두 번째 과목 id (기본 '21002144-1' —
 *                      월/수 11:00~12:50로 CLASS_ID의 월/수 12:00~13:15와 [12:00,12:50) 구간이 겹침)
 *   CLASS_SEATS_OVERRIDE  CLASS_ID의 Redis 좌석 카운터를 course.capacity 대신 이 값으로 시딩
 *                      (미지정 시 기존과 동일하게 capacity 사용). overlap 어뷰징 시나리오는 "이미
 *                      CLASS_ID를 신청해둔 유저가 겹치는 과목을 또 신청"하는 전제가 필요한데,
 *                      VUS가 정원(50)보다 훨씬 크면 대부분의 VU가 첫 신청부터 정원마감으로
 *                      실패해 그 전제 자체를 못 만족한다 — 이 경우 VUS 이상으로 넉넉하게 override
 *                      해서 "첫 신청은 항상 성공"을 보장하고, 실제 검증 대상인 겹침 거부에만
 *                      집중한다(구현계획 Stage 1-7).
 */
const sequelize = require('../src/config/database');
const redis = require('../src/config/redis');
const Class = require('../src/models/Class');
const ClassSchedule = require('../src/models/ClassSchedule');
const { computeSlotIds } = require('../src/utils/scheduleSlots');
const { classSeatsKey, classSlotsKey } = require('../src/utils/redisKeys');

const CLASS_ID = process.env.CLASS_ID || '21001083-2';
const OVERLAP_CLASS_ID = process.env.OVERLAP_CLASS_ID || '21002144-1';
const CLASS_SEATS_OVERRIDE = process.env.CLASS_SEATS_OVERRIDE
  ? Number(process.env.CLASS_SEATS_OVERRIDE)
  : null;

async function seedClass(classId, seatsOverride) {
  const course = await Class.findByPk(classId);
  if (!course) {
    throw new Error(`대상 과목(${classId})을 찾을 수 없습니다. 먼저 backend에서 seedData.js를 실행했는지 확인하세요.`);
  }
  const schedules = await ClassSchedule.findAll({ where: { class_id: classId } });

  const seats = seatsOverride != null ? seatsOverride : course.capacity;
  await redis.set(classSeatsKey(classId), seats);
  console.log(`✓ 좌석 카운터 초기화: ${classSeatsKey(classId)} = ${seats}${seatsOverride != null ? ' (override)' : ''}`);

  const slotIds = schedules.flatMap((s) => computeSlotIds(s.weekday, s.start_time, s.end_time));
  if (slotIds.length > 0) {
    await redis.sadd(classSlotsKey(classId), slotIds);
  }
  console.log(`✓ 시간표 슬롯 등록: ${classSlotsKey(classId)} = ${slotIds.length}개 슬롯`);
}

async function main() {
  await sequelize.authenticate();

  await redis.flushdb();
  console.log('✓ Redis FLUSHDB 완료');

  // CLASS_ID(정합성 스윕 대상)와 OVERLAP_CLASS_ID(1-6 시간표 겹침 어뷰징 시나리오 대상)를
  // 함께 시딩한다 — 정합성 스윕만 도는 실험(0-8/1-7)에서는 OVERLAP_CLASS_ID 쪽은 그냥
  // 아무도 건드리지 않는 여분의 과목일 뿐이라 결과에 영향이 없다.
  await seedClass(CLASS_ID, CLASS_SEATS_OVERRIDE);
  await seedClass(OVERLAP_CLASS_ID, null);

  await sequelize.close();
  redis.disconnect();
}

main().catch((error) => {
  console.error('Redis 시딩 실패:', error);
  process.exitCode = 1;
});
