const request = require('supertest');
const { app, resetDatabase, closeDatabase, signupUser } = require('./helpers');

const sampleCourses = [{ id: 'C001', name: '자료구조', times: [{ weekday: 1, start: '09:00' }] }];

let tokenA;
let tokenB;

beforeAll(async () => {
  await resetDatabase();
  ({ token: tokenA } = await signupUser({ studentId: '20250001' }));
  ({ token: tokenB } = await signupUser({ studentId: '20250002' }));
});
afterAll(closeDatabase);

describe('POST /api/timetables', () => {
  test('시간표를 저장하면 201과 생성된 시간표를 반환한다', async () => {
    const res = await request(app)
      .post('/api/timetables')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ name: '1학기 시간표', courses: sampleCourses });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: '1학기 시간표' });
    expect(res.body.id).toBeTruthy();
  });

  test('과목이 비어 있으면 400을 반환한다', async () => {
    const res = await request(app)
      .post('/api/timetables')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ name: '빈 시간표', courses: [] });

    expect(res.status).toBe(400);
  });
});

describe('GET /api/timetables', () => {
  test('본인 시간표만 조회된다', async () => {
    const resA = await request(app)
      .get('/api/timetables')
      .set('Authorization', `Bearer ${tokenA}`);
    const resB = await request(app)
      .get('/api/timetables')
      .set('Authorization', `Bearer ${tokenB}`);

    expect(resA.status).toBe(200);
    expect(resA.body).toHaveLength(1);
    expect(resB.status).toBe(200);
    expect(resB.body).toHaveLength(0);
  });

  test('토큰 없이 조회하면 401을 반환한다', async () => {
    const res = await request(app).get('/api/timetables');
    expect(res.status).toBe(401);
  });
});

describe('DELETE /api/timetables/:id', () => {
  test('다른 사용자의 시간표는 삭제할 수 없다 (404)', async () => {
    const list = await request(app)
      .get('/api/timetables')
      .set('Authorization', `Bearer ${tokenA}`);
    const timetableId = list.body[0].id;

    const res = await request(app)
      .delete(`/api/timetables/${timetableId}`)
      .set('Authorization', `Bearer ${tokenB}`);

    expect(res.status).toBe(404);
  });

  test('본인 시간표는 삭제된다', async () => {
    const list = await request(app)
      .get('/api/timetables')
      .set('Authorization', `Bearer ${tokenA}`);
    const timetableId = list.body[0].id;

    const res = await request(app)
      .delete(`/api/timetables/${timetableId}`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(200);

    const after = await request(app)
      .get('/api/timetables')
      .set('Authorization', `Bearer ${tokenA}`);
    expect(after.body).toHaveLength(0);
  });
});
