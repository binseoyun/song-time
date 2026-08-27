const request = require('supertest');
const redis = require('../src/config/redis');
const { classSeatsKey } = require('../src/utils/redisKeys');
const { app, resetDatabase, closeDatabase, signupUser, createClass } = require('./helpers');

let token;

beforeAll(async () => {
  await resetDatabase();
  await createClass({ id: 'C001', code: 'CS101', name: '자료구조' }); // capacity 30, enrolled 0
  await createClass({ id: 'C002', code: 'CS102', name: '운영체제', capacity: 40 });
  await redis.set(classSeatsKey('C001'), 7); // 실시간 잔여석 = 7 (cap-enrolled=30과 다름)
  await redis.del(classSeatsKey('C002')); // 좌석 키 없음 → null
  ({ token } = await signupUser());
});
afterAll(async () => {
  await redis.del(classSeatsKey('C001'), classSeatsKey('C002'));
  await closeDatabase();
});

describe('GET /api/courses', () => {
  test('과목 목록을 반환한다 (인증 불필요)', async () => {
    const res = await request(app).get('/api/courses');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0]).toMatchObject({ id: 'C001', name: '자료구조' });
  });

  test('remainingSeats는 Redis 실시간 좌석이고 MySQL 컬럼값은 응답에서 빠진다 (ADR-013)', async () => {
    const res = await request(app).get('/api/courses');
    const c001 = res.body.find((c) => c.id === 'C001');
    const c002 = res.body.find((c) => c.id === 'C002');

    expect(c001.remainingSeats).toBe(7); // capacity-enrolled(5)가 아니라 Redis 값
    expect(c001.interestCount).toBe(0);
    expect(c002.remainingSeats).toBeNull(); // 좌석 키 없으면 null (capacity로 폴백 안 함)
  });
});

describe('GET /api/courses/:code', () => {
  test('단건 조회도 실시간 좌석/관심 등록 수를 포함한다', async () => {
    const res = await request(app).get('/api/courses/CS101');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ code: 'CS101', remainingSeats: 7, interestCount: 0 });
  });
});

describe('POST /api/courses/:classId/interest (토글)', () => {
  test('관심 과목 등록 시 enrolled가 1 증가한다', async () => {
    const res = await request(app)
      .post('/api/courses/C001/interest')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.isInterested).toBe(true);
    expect(res.body.course).toMatchObject({ id: 'C001', enrolled: 1, capacity: 30 });
  });

  test('등록 후 관심 과목 목록에 나타난다', async () => {
    const res = await request(app)
      .get('/api/courses/interests')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.courses).toEqual(['C001']);
  });

  test('다시 토글하면 해제되고 enrolled가 원복된다', async () => {
    const res = await request(app)
      .post('/api/courses/C001/interest')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.isInterested).toBe(false);
    expect(res.body.course.enrolled).toBe(0);
  });

  test('존재하지 않는 과목이면 404를 반환한다', async () => {
    const res = await request(app)
      .post('/api/courses/NOPE/interest')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
  });

  test('토큰 없이 요청하면 401을 반환한다', async () => {
    const res = await request(app).post('/api/courses/C001/interest');
    expect(res.status).toBe(401);
  });
});
