// Group A(무방비)/Group B(비관적 락)의 정상 흐름만 검증한다.
// 레이스 컨디션 자체는 타이밍 의존적이라 Jest로 안정적으로 재현하기 어려워
// k6 부하테스트(doc/experiment/01)가 전담한다 — 여기서는 "혼자 요청했을 때"의
// 정상/에러 응답만 확인한다.
const request = require('supertest');
const { app, resetDatabase, closeDatabase, signupUser, createClass } = require('./helpers');

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
