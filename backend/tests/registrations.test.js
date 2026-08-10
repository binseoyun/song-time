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
