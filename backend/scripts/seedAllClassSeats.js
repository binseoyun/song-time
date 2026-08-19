/**
 * 전체 과목의 Redis 좌석 카운터/시간표 슬롯을 현재 MySQL 상태 기준으로 (재)동기화한다.
 *
 * `seedRedisRegistrations.js`는 Stage 1 부하테스트 전용이라 대상 과목 1~2개만
 * 다루고 매번 FLUSHDB로 Redis를 통째로 비운다 — 실사용(이슈 #54 "실시간 수강신청
 * 연습" 탭)에는 전체 과목이 필요하고, 이미 진행 중인 다른 신청 상태를 지우면 안 된다.
 * 이 스크립트는 그래서 별도로 둔다: FLUSHDB 없이, Class 전체를 순회하며 잔여 좌석을
 * "정원 - 현재 MySQL 등록 건수"로 계산해 채우고, 이미 등록된 사람들의
 * user:{userId}:registered / user:{userId}:slots도 함께 복구한다(안 하면 이미
 * MySQL엔 등록돼 있는데 Redis는 모르는 상태가 되어, 같은 과목에 중복 신청이 통과되는
 * 사고로 이어진다).
 *
 * 실행 (docker-compose 스택이 떠 있어야 함):
 *   docker compose exec backend_1 node scripts/seedAllClassSeats.js
 *
 * 여러 번 실행해도 안전하다(멱등) — 매번 MySQL의 현재 상태를 그대로 다시 반영할 뿐이다.
 */
const sequelize = require('../src/config/database');
const redis = require('../src/config/redis');
const Class = require('../src/models/Class');
const ClassSchedule = require('../src/models/ClassSchedule');
const Registration = require('../src/models/Registration');
const { computeSlotIds } = require('../src/utils/scheduleSlots');
const { classSeatsKey, classSlotsKey, userRegisteredKey, userSlotsKey } = require('../src/utils/redisKeys');

async function main() {
  await sequelize.authenticate();

  // app.js가 설정하는 Sequelize 연관관계(Class.hasMany(ClassSchedule, ...))는 이
  // 독립 스크립트에선 로드되지 않는다 — include로 조인하는 대신 ClassSchedule을
  // class_id로 직접 조회한다(seedRedisRegistrations.js와 동일한 방식).
  const classes = await Class.findAll();
  console.log(`대상 과목 ${classes.length}개`);

  for (const course of classes) {
    const [registrations, schedules] = await Promise.all([
      Registration.findAll({ where: { class_id: course.id } }),
      ClassSchedule.findAll({ where: { class_id: course.id } }),
    ]);
    const remaining = Math.max(course.capacity - registrations.length, 0);

    await redis.set(classSeatsKey(course.id), remaining);

    const slotIds = schedules.flatMap((s) => computeSlotIds(s.weekday, s.start_time, s.end_time));
    await redis.del(classSlotsKey(course.id));
    if (slotIds.length > 0) {
      await redis.sadd(classSlotsKey(course.id), slotIds);
    }

    for (const reg of registrations) {
      await redis.sadd(userRegisteredKey(reg.user_id), course.id);
      if (slotIds.length > 0) {
        await redis.sadd(userSlotsKey(reg.user_id), slotIds);
      }
    }

    console.log(`✓ ${course.id} (${course.name}): 잔여 ${remaining}/${course.capacity}, 기존 신청자 ${registrations.length}명 동기화`);
  }

  await sequelize.close();
  redis.disconnect();
}

main().catch((error) => {
  console.error('전체 좌석 시딩 실패:', error);
  process.exitCode = 1;
});
