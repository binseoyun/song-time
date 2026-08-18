/**
 * Group C(Redis 원자적 연산) Ghost Decrement 리컨실리에이션 스크립트.
 *
 * 구현계획 Stage 1-9(카오스 테스트: API 서버 kill)에서 쓰기 위해 작성했다.
 * registerRedisAtomic(backend/src/services/registrationService.js)은 Redis
 * 판정 성공 직후 응답하고, RabbitMQ 발행은 await 없이 fire-and-forget으로
 * 처리한다 — 그 사이 API 서버가 죽으면 Redis는 "등록됨" 상태인데 MySQL엔
 * 영영 반영되지 않는 Ghost Decrement가 생길 수 있다(설계상 감수한 리스크,
 * doc/portfolio/01-group-c-redis-설계-결정.md 참고).
 *
 * 이 스크립트는 그 불일치를 후행으로 탐지한다: 대상 과목에 대해 Redis가
 * "등록됨"으로 아는 유저 중 MySQL에 실제 행이 없는 유저를 찾아낸다.
 *
 * 실행:
 *   docker compose -f docker-compose.yml -f docker-compose.loadtest.yml exec backend_1 \
 *     node scripts/reconcileGhostDecrements.js
 *
 * 환경변수:
 *   CLASS_ID   점검할 과목 id (기본 '21001083-2')
 */
const sequelize = require('../src/config/database');
const redis = require('../src/config/redis');
const User = require('../src/models/User');
const Registration = require('../src/models/Registration');
const { userRegisteredKey } = require('../src/utils/redisKeys');

const CLASS_ID = process.env.CLASS_ID || '21001083-2';
const STUDENT_ID_PREFIX = 'loadtest';
const BATCH_SIZE = 500;

async function main() {
  await sequelize.authenticate();

  const users = await User.findAll({
    where: { studentId: { [require('sequelize').Op.like]: `${STUDENT_ID_PREFIX}-%` } },
    attributes: ['id', 'studentId'],
  });

  const registeredRows = await Registration.findAll({
    where: { class_id: CLASS_ID, user_id: users.map((u) => u.id) },
    attributes: ['user_id'],
  });
  const mysqlSet = new Set(registeredRows.map((r) => r.user_id));

  const ghosts = [];
  for (let offset = 0; offset < users.length; offset += BATCH_SIZE) {
    const batch = users.slice(offset, offset + BATCH_SIZE);
    const flags = await Promise.all(batch.map((u) => redis.sismember(userRegisteredKey(u.id), CLASS_ID)));
    batch.forEach((u, i) => {
      if (flags[i] === 1 && !mysqlSet.has(u.id)) {
        ghosts.push({ userId: u.id, studentId: u.studentId });
      }
    });
  }

  console.log(`대상 계정 수: ${users.length}`);
  console.log(`MySQL 등록 수(class=${CLASS_ID}): ${mysqlSet.size}`);
  console.log(`Ghost Decrement 건수: ${ghosts.length}`);
  if (ghosts.length > 0) {
    console.log('상세:', JSON.stringify(ghosts, null, 2));
  }

  await sequelize.close();
  redis.disconnect();
  process.exitCode = ghosts.length > 0 ? 1 : 0;
}

main().catch((error) => {
  console.error('리컨실리에이션 실패:', error);
  process.exitCode = 2;
});
