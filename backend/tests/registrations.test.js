// Group A(무방비)/Group B(비관적 락)의 정상 흐름만 검증한다.
// 레이스 컨디션 자체는 타이밍 의존적이라 Jest로 안정적으로 재현하기 어려워
// k6 부하테스트(doc/experiment/01)가 전담한다 — 여기서는 "혼자 요청했을 때"의
// 정상/에러 응답만 확인한다.
const request = require('supertest');
const { app, resetDatabase, closeDatabase, signupUser, createClass } = require('./helpers');
const redis = require('../src/config/redis');
const { classSeatsKey, userRegisteredKey } = require('../src/utils/redisKeys');

afterAll(closeDatabase);

describe.each([
  ['무방비', '/api/registrations/naive'],
  ['비관적 락', '/api/registrations/pessimistic'],
])('POST %s (%s)', (label, path) => {
  let token;

  beforeEach(async () => {
    await resetDatabase();
    await createClass({ id: 'C001', capacity: 1, remainingSeats: 1 });
    ({ token } = await signupUser());
  });

  test('정상 신청 시 201과 신청 내역을 반환한다', async () => {
    const res = await request(app)
      .post(path)
      .set('Authorization', `Bearer ${token}`)
      .send({ classId: 'C001' });

    expect(res.status).toBe(201);
    expect(res.body.registration).toMatchObject({ classId: 'C001' });
  });

  test('토큰 없이 요청하면 401을 반환한다', async () => {
    const res = await request(app).post(path).send({ classId: 'C001' });
    expect(res.status).toBe(401);
  });

  test('classId 없이 요청하면 400을 반환한다', async () => {
    const res = await request(app)
      .post(path)
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(400);
  });

  test('존재하지 않는 과목이면 404를 반환한다', async () => {
    const res = await request(app)
      .post(path)
      .set('Authorization', `Bearer ${token}`)
      .send({ classId: 'NOPE' });
    expect(res.status).toBe(404);
  });

  test('이미 신청한 과목을 다시 신청하면 409를 반환한다', async () => {
    await request(app).post(path).set('Authorization', `Bearer ${token}`).send({ classId: 'C001' });

    const res = await request(app)
      .post(path)
      .set('Authorization', `Bearer ${token}`)
      .send({ classId: 'C001' });

    expect(res.status).toBe(409);
  });

  test('정원이 없으면 409를 반환한다', async () => {
    await createClass({ id: 'C002', capacity: 1, remainingSeats: 0 });

    const res = await request(app)
      .post(path)
      .set('Authorization', `Bearer ${token}`)
      .send({ classId: 'C002' });

    expect(res.status).toBe(409);
  });
});

describe('POST/DELETE /api/registrations/redis (Group C, 이슈 #54)', () => {
  let token;

  beforeEach(async () => {
    await resetDatabase();
    await createClass({ id: 'C001', capacity: 30, remainingSeats: 30 });
    await redis.set(classSeatsKey('C001'), 30);
    // resetDatabase()는 MySQL AUTO_INCREMENT를 1로 되돌리지만 Redis는 건드리지 않는다
    // — user:1:registered 같은 유저 스코프 키가 이전 테스트 상태를 그대로 물려받아
    // "신청한 적 없는데 이미 등록된 것처럼" 오염되는 걸 막기 위해 명시적으로 지운다.
    await redis.del(userRegisteredKey(1));
    ({ token } = await signupUser());
  });

  // 취소 API를 호출하는 시점엔 아직 워커(별도 프로세스, 테스트 환경에는 없음)가
  // MySQL에 반영하지 않은 상태 — "등록 직후 곧바로 취소"하는 사용자 시나리오와
  // 정확히 같은 조건이다. doc/troubleshooting/02-취소-후-재신청-DUPLICATE-오탐.md
  // 에서 재현한 버그: 이 상태에서 취소하면(구현이 MySQL 삭제를 먼저 시도했을 때)
  // NOT_FOUND로 실패하며 Redis가 전혀 안 풀려, 재신청이 DUPLICATE로 오탐했다.
  test('워커가 MySQL에 반영하기 전에 취소해도 성공하고, 재신청도 막히지 않는다', async () => {
    const registerRes = await request(app)
      .post('/api/registrations/redis')
      .set('Authorization', `Bearer ${token}`)
      .send({ classId: 'C001' });
    expect(registerRes.status).toBe(201);

    const cancelRes = await request(app)
      .delete('/api/registrations/redis/C001')
      .set('Authorization', `Bearer ${token}`);
    expect(cancelRes.status).toBe(200);

    const reregisterRes = await request(app)
      .post('/api/registrations/redis')
      .set('Authorization', `Bearer ${token}`)
      .send({ classId: 'C001' });
    expect(reregisterRes.status).toBe(201);
  });

  test('신청한 적 없는 과목을 취소하면 404를 반환한다', async () => {
    const res = await request(app)
      .delete('/api/registrations/redis/C001')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  test('이미 신청한 과목을 다시 신청하면 409를 반환한다', async () => {
    await request(app).post('/api/registrations/redis').set('Authorization', `Bearer ${token}`).send({ classId: 'C001' });

    const res = await request(app)
      .post('/api/registrations/redis')
      .set('Authorization', `Bearer ${token}`)
      .send({ classId: 'C001' });
    expect(res.status).toBe(409);
  });
});

describe('GET /api/registrations/redis/seats (이슈 #54, 여석 조회)', () => {
  let token;

  beforeEach(async () => {
    await resetDatabase();
    await createClass({ id: 'C001', capacity: 30, remainingSeats: 30 });
    await redis.set(classSeatsKey('C001'), 25);
    ({ token } = await signupUser());
  });

  test('Redis 좌석 카운터를 그대로 반환한다 (MySQL enrolled가 아니라)', async () => {
    const res = await request(app)
      .get('/api/registrations/redis/seats?classIds=C001')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ seats: { C001: 25 } });
  });

  test('Redis에 시딩되지 않은 과목은 null을 반환한다', async () => {
    const res = await request(app)
      .get('/api/registrations/redis/seats?classIds=UNSEEDED')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ seats: { UNSEEDED: null } });
  });

  test('토큰 없이 요청하면 401을 반환한다', async () => {
    const res = await request(app).get('/api/registrations/redis/seats?classIds=C001');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/registrations/redis (이슈 #54, 내 수강신청 내역 조회)', () => {
  let token;

  beforeEach(async () => {
    await resetDatabase();
    await createClass({ id: 'C001', capacity: 30, remainingSeats: 30 });
    ({ token } = await signupUser());
  });

  test('토큰 없이 요청하면 401을 반환한다', async () => {
    const res = await request(app).get('/api/registrations/redis');
    expect(res.status).toBe(401);
  });

  test('신청 내역이 없으면 빈 배열을 반환한다', async () => {
    const res = await request(app)
      .get('/api/registrations/redis')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ registrations: [] });
  });

  test('신청한 과목의 상세 정보를 함께 반환한다', async () => {
    const res = await request(app)
      .post('/api/registrations/naive')
      .set('Authorization', `Bearer ${token}`)
      .send({ classId: 'C001' });
    expect(res.status).toBe(201);

    const listRes = await request(app)
      .get('/api/registrations/redis')
      .set('Authorization', `Bearer ${token}`);

    expect(listRes.status).toBe(200);
    expect(listRes.body.registrations).toHaveLength(1);
    expect(listRes.body.registrations[0]).toMatchObject({
      classId: 'C001',
      course: { id: 'C001', name: '자료구조' },
    });
  });

  test('다른 사용자의 신청 내역은 보이지 않는다', async () => {
    await request(app)
      .post('/api/registrations/naive')
      .set('Authorization', `Bearer ${token}`)
      .send({ classId: 'C001' });

    const { token: otherToken } = await signupUser();
    const res = await request(app)
      .get('/api/registrations/redis')
      .set('Authorization', `Bearer ${otherToken}`);

    expect(res.body).toEqual({ registrations: [] });
  });
});
