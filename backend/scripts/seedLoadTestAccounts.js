/**
 * 부하테스트용 계정 대량 시딩 + JWT 직접 서명 + 실험 대상 과목 초기화.
 *
 * 실험계획서 01(doc/experiment/01-...) 3장 통제변수, 7장 실험 절차에 대응한다.
 * - HTTP 로그인(bcrypt.compare)을 거치지 않고 authController와 동일한 방식으로
 *   JWT를 직접 서명한다 — 1.2만 계정을 로그인 API로 준비하면 시간이 너무 오래 걸린다.
 * - 매 실험 회차 실행 전에 반드시 다시 실행해서 좌석/신청 내역을 초기 상태로 되돌린다.
 *
 * 실행: (docker-compose.loadtest.yml 사용법 주석 참고)
 *   docker compose -f docker-compose.yml -f docker-compose.loadtest.yml exec backend_1 \
 *     node scripts/seedLoadTestAccounts.js
 *
 * 환경변수:
 *   ACCOUNT_COUNT     생성할 계정 수 (기본 500)
 *   CLASS_ID          초기화할 실험 대상 과목 id (기본 '21001083-2', src/seedData.js 기준)
 *   OVERLAP_CLASS_ID  시간표 겹침 어뷰징 시나리오(1-6)용 두 번째 과목 id (기본 '21002144-1',
 *                     seedRedisRegistrations.js와 동일) — 재실행 시 이전 회차의 신청 내역만 정리한다
 *   OUTPUT_FILE       토큰 JSON 출력 경로 (기본 /loadtest/generated/tokens.json —
 *                     docker-compose.loadtest.yml의 볼륨 마운트와 짝을 이룬다)
 */
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const sequelize = require('../src/config/database');
const { JWT_SECRET } = require('../src/config/env');
const User = require('../src/models/User');
const Class = require('../src/models/Class');
const Registration = require('../src/models/Registration');

const ACCOUNT_COUNT = Number(process.env.ACCOUNT_COUNT) || 500;
const CLASS_ID = process.env.CLASS_ID || '21001083-2';
const OVERLAP_CLASS_ID = process.env.OVERLAP_CLASS_ID || '21002144-1';
const OUTPUT_FILE =
  process.env.OUTPUT_FILE || path.resolve(__dirname, '../../loadtest/generated/tokens.json');
const STUDENT_ID_PREFIX = 'loadtest';
const SHARED_PASSWORD = 'LoadTest!2026'; // 로그인 API를 거치지 않는 더미 계정이므로 전원 동일 비밀번호로 충분하다.
const BATCH_SIZE = 1000;
const JWT_EXPIRES_IN = '1h'; // authController.js와 동일

function studentIdOf(i) {
  return `${STUDENT_ID_PREFIX}-${String(i).padStart(6, '0')}`;
}

async function resetClass(classId) {
  const course = await Class.findByPk(classId);
  if (!course) {
    throw new Error(
      `대상 과목(${classId})을 찾을 수 없습니다. 먼저 backend에서 seedData.js를 실행했는지 확인하세요.`
    );
  }

  await Class.update({ remainingSeats: course.capacity }, { where: { id: classId } });
  const deletedCount = await Registration.destroy({ where: { class_id: classId } });

  console.log(
    `✓ 대상 과목 초기화: ${classId} remainingSeats=${course.capacity}, ` +
      `기존 신청 내역 ${deletedCount}건 삭제`
  );
}

async function seedAccounts() {
  const passwordHash = await bcrypt.hash(SHARED_PASSWORD, 12);
  const studentIds = Array.from({ length: ACCOUNT_COUNT }, (_, i) => studentIdOf(i + 1));

  for (let offset = 0; offset < studentIds.length; offset += BATCH_SIZE) {
    const batch = studentIds.slice(offset, offset + BATCH_SIZE).map((studentId) => ({
      studentId,
      password: passwordHash,
      name: `부하테스트유저-${studentId}`,
      major: '컴퓨터공학',
    }));

    await User.bulkCreate(batch, {
      updateOnDuplicate: ['password', 'name', 'major'],
    });
  }
  console.log(`✓ 계정 ${studentIds.length}개 준비 완료 (studentId: ${studentIds[0]} ~ ${studentIds[studentIds.length - 1]})`);

  const users = await User.findAll({
    where: { studentId: studentIds },
    attributes: ['id', 'studentId'],
    order: [['studentId', 'ASC']],
  });

  return users.map((user) => ({
    studentId: user.studentId,
    token: jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN }),
  }));
}

async function main() {
  await sequelize.authenticate();

  await resetClass(CLASS_ID);
  await resetClass(OVERLAP_CLASS_ID);
  const tokens = await seedAccounts();

  fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(tokens));
  console.log(`✓ 토큰 ${tokens.length}개를 ${OUTPUT_FILE}에 기록했습니다.`);

  await sequelize.close();
}

main().catch((error) => {
  console.error('부하테스트 계정 시딩 실패:', error);
  process.exitCode = 1;
});
