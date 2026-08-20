/**
 * 실험 02 Step 3(Valve Tuning, 이슈 #57) 라운드 준비 스크립트.
 *
 * 매 라운드마다 정원 경합(Stage 1이 이미 검증한 관심사)이 아니라 "대기열 게이트
 * 자체의 한계"만 순수하게 재려면, 정원이 병목이 되면 안 된다. 그래서 라운드마다
 * capacity가 충분히 큰(기본 20,000 ≥ 최대 VUS) 전용 과목을 새로 만든다 — 라운드마다
 * 다른 CLASS_ID를 쓰면 이전 라운드에서 등록한 유저 상태(Redis user:{id}:registered,
 * MySQL Registration)를 정리할 필요 자체가 없어진다(회차 간 오염 원천 차단).
 *
 * 대기열 자체 상태(waiting_queue:global, active_gate:global, 시퀀스 카운터)는
 * 라운드마다 공유되므로 매번 리셋한다 — 안 하면 이전 라운드에 못 빠져나간 인원이
 * 다음 라운드의 Active 게이트를 미리 차지한 채로 시작해 결과가 오염된다.
 *
 * 실행 (docker-compose 스택이 떠 있어야 함):
 *   docker compose exec backend_1 node scripts/setupValveTuningRound.js
 *
 * 환경변수:
 *   CLASS_ID   이번 라운드 전용 과목 id (기본 'VALVE-TUNING-ROUND')
 *   CAPACITY   정원 (기본 20000 — 이 실험의 최대 VUS 12,000보다 넉넉히 크게)
 */
const sequelize = require('../src/config/database');
const redis = require('../src/config/redis');
const Class = require('../src/models/Class');
const Registration = require('../src/models/Registration');
const { classSeatsKey, classSlotsKey, WAITING_QUEUE_KEY, WAITING_QUEUE_SEQ_KEY, ACTIVE_GATE_KEY } = require('../src/utils/redisKeys');

const CLASS_ID = process.env.CLASS_ID || 'VALVE-TUNING-ROUND';
const CAPACITY = Number(process.env.CAPACITY) || 20000;

async function main() {
  await sequelize.authenticate();

  await Class.upsert({
    id: CLASS_ID,
    code: CLASS_ID,
    name: '실험용(Valve Tuning, 이슈 #57)',
    professor: '-',
    credits: 0,
    capacity: CAPACITY,
    enrolled: 0,
    department: '-',
    courseType: '실험용',
    remainingSeats: CAPACITY,
  });
  await Registration.destroy({ where: { class_id: CLASS_ID } });

  await redis.set(classSeatsKey(CLASS_ID), CAPACITY);
  await redis.del(classSlotsKey(CLASS_ID));
  await redis.del(WAITING_QUEUE_KEY, WAITING_QUEUE_SEQ_KEY, ACTIVE_GATE_KEY);

  console.log(`✓ 라운드 준비 완료: CLASS_ID=${CLASS_ID} CAPACITY=${CAPACITY}, 대기열/Active 게이트 초기화됨`);

  await sequelize.close();
  redis.disconnect();
}

main().catch((error) => {
  console.error('라운드 준비 실패:', error);
  process.exitCode = 1;
});
