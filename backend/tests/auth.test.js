const request = require('supertest');
const { app, resetDatabase, closeDatabase } = require('./helpers');

beforeAll(resetDatabase);
afterAll(closeDatabase);

describe('POST /api/auth/signup', () => {
  test('회원가입 성공 시 201과 토큰을 반환한다', async () => {
    const res = await request(app).post('/api/auth/signup').send({
      name: '홍길동',
      major: '컴퓨터공학과',
      studentId: '20250001',
      password: 'secret123!',
    });

    expect(res.status).toBe(201);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user).toMatchObject({ studentId: '20250001', name: '홍길동' });
    expect(res.body.user.password).toBeUndefined();
  });

  test('중복 학번이면 400을 반환한다', async () => {
    const res = await request(app).post('/api/auth/signup').send({
      name: '홍길동2',
      major: '컴퓨터공학과',
      studentId: '20250001',
      password: 'secret123!',
    });

    expect(res.status).toBe(400);
  });
});

describe('POST /api/auth/login', () => {
  test('올바른 자격증명이면 200과 토큰을 반환한다', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ studentId: '20250001', password: 'secret123!' });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
  });

  test('비밀번호가 틀리면 400을 반환한다', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ studentId: '20250001', password: 'wrong-password' });

    expect(res.status).toBe(400);
    expect(res.body.token).toBeUndefined();
  });

  test('존재하지 않는 학번이면 400을 반환한다', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ studentId: '99999999', password: 'secret123!' });

    expect(res.status).toBe(400);
  });
});

describe('인증 미들웨어', () => {
  test('토큰 없이 보호된 API 접근 시 401을 반환한다', async () => {
    const res = await request(app).get('/api/courses/interests');
    expect(res.status).toBe(401);
  });

  test('위조된 토큰이면 401을 반환한다', async () => {
    const res = await request(app)
      .get('/api/courses/interests')
      .set('Authorization', 'Bearer invalid.token.value');
    expect(res.status).toBe(401);
  });
});
