const request = require('supertest');
const app = require('../src/app');
const sequelize = require('../src/config/database');
const Class = require('../src/models/Class');
const redis = require('../src/config/redis');

// 실수로 개발/운영 DB에 sync({force})가 나가는 사고 방지
function assertTestEnv() {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('테스트는 NODE_ENV=test에서만 실행할 수 있습니다. (npm test 사용)');
  }
}

async function resetDatabase() {
  assertTestEnv();
  await sequelize.sync({ force: true });
}

// app.js가 라우트 체인(registrationRoutes → ... → config/redis.js)을 통해 import 시점에
// 즉시 Redis 연결을 여는데, 이걸 안 끊으면 테스트 파일마다 열린 커넥션이 Node 이벤트
// 루프를 붙잡아 Jest가 영원히 종료되지 않는다 — 모든 테스트 파일이 이미 afterAll에서
// closeDatabase를 부르고 있으므로, DB뿐 아니라 Redis도 여기서 함께 정리한다.
async function closeDatabase() {
  await sequelize.close();
  await redis.quit();
}

// 회원가입 후 { token, user } 반환
async function signupUser(overrides = {}) {
  const payload = {
    name: '테스트유저',
    major: '컴퓨터공학과',
    studentId: `2020${Math.floor(Math.random() * 100000)}`,
    password: 'password123!',
    ...overrides,
  };
  const res = await request(app).post('/api/auth/signup').send(payload);
  if (res.status !== 201) {
    throw new Error(`테스트용 회원가입 실패: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return { token: res.body.token, payload };
}

async function createClass(overrides = {}) {
  return Class.create({
    id: 'C001',
    code: 'CS101',
    name: '자료구조',
    professor: '김교수',
    credits: 3,
    capacity: 30,
    enrolled: 0,
    remainingSeats: overrides.capacity ?? 30,
    department: '컴퓨터공학과',
    courseType: '전공 필수',
    ...overrides,
  });
}

module.exports = { app, sequelize, resetDatabase, closeDatabase, signupUser, createClass };
