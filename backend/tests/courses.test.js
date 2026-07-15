const request = require('supertest');
const { app, resetDatabase, closeDatabase, signupUser, createClass } = require('./helpers');

let token;

beforeAll(async () => {
  await resetDatabase();
  await createClass({ id: 'C001', code: 'CS101', name: '자료구조' });
  await createClass({ id: 'C002', code: 'CS102', name: '운영체제' });
  ({ token } = await signupUser());
});
afterAll(closeDatabase);

describe('GET /api/courses', () => {
  test('과목 목록을 반환한다 (인증 불필요)', async () => {
    const res = await request(app).get('/api/courses');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0]).toMatchObject({ id: 'C001', name: '자료구조' });
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
