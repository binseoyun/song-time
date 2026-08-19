// 전역 대기열/Active 게이트(ADR-006 1.1/1.3 보완 해결, 이슈 #46/#48) 통합 테스트.
// 승격 사이클(runPromotionCycle)은 실시간 타이머(TTL 120초)를 기다리지 않고, 만료된
// Active 멤버를 Redis에 직접 심어(score를 과거로) 결정적으로 재현한다.
// ACTIVE_GATE_LIMIT을 1로 좁혀 "슬롯이 없을 때/생겼을 때"의 경계를 쉽게 테스트한다.
process.env.ACTIVE_GATE_LIMIT = '1';
process.env.ACTIVE_TTL_SECONDS = '120';

const request = require('supertest');
const { app, resetDatabase, closeDatabase, signupUser } = require('./helpers');
const redis = require('../src/config/redis');
const queueService = require('../src/services/queueService');
const { WAITING_QUEUE_KEY, WAITING_QUEUE_SEQ_KEY, ACTIVE_GATE_KEY } = require('../src/utils/redisKeys');

afterAll(async () => {
  await closeDatabase();
  // --runInBand로 모든 테스트 파일이 한 프로세스를 공유하므로, 여기서 건드린
  // process.env를 복원하지 않으면 이 파일 뒤에 실행되는 다른 테스트 파일이
  // queueService를 새로 require할 때 이 값을 그대로 물려받는다(코드 리뷰 발견 사항).
  delete process.env.ACTIVE_GATE_LIMIT;
  delete process.env.ACTIVE_TTL_SECONDS;
});

beforeEach(async () => {
  await resetDatabase();
  await redis.del(WAITING_QUEUE_KEY, ACTIVE_GATE_KEY, WAITING_QUEUE_SEQ_KEY);
});

describe('POST /api/queue/enter', () => {
  test('토큰 없이 요청하면 401을 반환한다', async () => {
    const res = await request(app).post('/api/queue/enter');
    expect(res.status).toBe(401);
  });

  test('최초 진입 시 대기 상태와 1번 순번을 반환한다', async () => {
    const { token } = await signupUser();

    const res = await request(app).post('/api/queue/enter').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ state: 'waiting', rank: 1 });
  });

  test('이미 대기 중인 사용자가 다시 요청해도 순번이 유지된다(뒤로 밀리지 않음)', async () => {
    const { token: tokenA } = await signupUser();
    const { token: tokenB } = await signupUser();

    await request(app).post('/api/queue/enter').set('Authorization', `Bearer ${tokenA}`);
    await request(app).post('/api/queue/enter').set('Authorization', `Bearer ${tokenB}`);

    const res = await request(app).post('/api/queue/enter').set('Authorization', `Bearer ${tokenA}`);
    expect(res.body).toMatchObject({ state: 'waiting', rank: 1 });
  });

  test('Active 상태인 사용자가 재요청하면 대기열로 돌아가지 않고 active를 반환한다', async () => {
    const { token } = await signupUser();
    await request(app).post('/api/queue/enter').set('Authorization', `Bearer ${token}`);

    // ACTIVE_GATE_LIMIT=1이므로 이 사이클에서 바로 승격된다.
    const promoted = await queueService.runPromotionCycle();
    expect(promoted).toBe(1);

    const res = await request(app).post('/api/queue/enter').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.state).toBe('active');
    expect(res.body.expiresAt).toBeGreaterThan(Date.now());
  });
});

describe('GET /api/queue/status (이슈 #48, 폴링용 조회 전용 API)', () => {
  test('토큰 없이 요청하면 401을 반환한다', async () => {
    const res = await request(app).get('/api/queue/status');
    expect(res.status).toBe(401);
  });

  test('대기열에 들어간 적 없으면 not_entered를 반환한다', async () => {
    const { token } = await signupUser();

    const res = await request(app).get('/api/queue/status').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ state: 'not_entered' });
  });

  test('대기 중이면 순번을 반환한다(부작용 없이 반복 호출 가능)', async () => {
    const { token } = await signupUser();
    await request(app).post('/api/queue/enter').set('Authorization', `Bearer ${token}`);

    const res1 = await request(app).get('/api/queue/status').set('Authorization', `Bearer ${token}`);
    const res2 = await request(app).get('/api/queue/status').set('Authorization', `Bearer ${token}`);

    expect(res1.body).toEqual({ state: 'waiting', rank: 1 });
    expect(res2.body).toEqual(res1.body); // 반복 호출해도 상태가 안 바뀜(읽기 전용)
  });

  test('Active 상태면 만료 시각을 반환한다', async () => {
    const { token } = await signupUser();
    await request(app).post('/api/queue/enter').set('Authorization', `Bearer ${token}`);
    await queueService.runPromotionCycle(); // ACTIVE_GATE_LIMIT=1이므로 바로 승격

    const res = await request(app).get('/api/queue/status').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.state).toBe('active');
    expect(res.body.expiresAt).toBeGreaterThan(Date.now());
  });
});

describe('DELETE /api/queue/active (이슈 #58, Active 슬롯 조기 반납)', () => {
  test('토큰 없이 요청하면 401을 반환한다', async () => {
    const res = await request(app).delete('/api/queue/active');
    expect(res.status).toBe(401);
  });

  test('Active 상태에서 반납하면 즉시 not_entered로 돌아간다 (TTL을 기다리지 않음)', async () => {
    const { token } = await signupUser();
    await request(app).post('/api/queue/enter').set('Authorization', `Bearer ${token}`);
    await queueService.runPromotionCycle(); // ACTIVE_GATE_LIMIT=1이므로 바로 승격

    const statusBefore = await request(app).get('/api/queue/status').set('Authorization', `Bearer ${token}`);
    expect(statusBefore.body.state).toBe('active');

    const leaveRes = await request(app).delete('/api/queue/active').set('Authorization', `Bearer ${token}`);
    expect(leaveRes.status).toBe(200);
    expect(leaveRes.body).toEqual({ state: 'not_entered' });

    const statusAfter = await request(app).get('/api/queue/status').set('Authorization', `Bearer ${token}`);
    expect(statusAfter.body).toEqual({ state: 'not_entered' });
  });

  test('반납한 슬롯은 다음 대기자에게 즉시 승격된다', async () => {
    const { token: tokenA } = await signupUser();
    const { token: tokenB } = await signupUser();

    await request(app).post('/api/queue/enter').set('Authorization', `Bearer ${tokenA}`);
    await queueService.runPromotionCycle(); // ACTIVE_GATE_LIMIT=1 — A만 승격, B는 대기

    await request(app).post('/api/queue/enter').set('Authorization', `Bearer ${tokenB}`);
    const bWaiting = await request(app).get('/api/queue/status').set('Authorization', `Bearer ${tokenB}`);
    expect(bWaiting.body.state).toBe('waiting');

    await request(app).delete('/api/queue/active').set('Authorization', `Bearer ${tokenA}`);
    const promoted = await queueService.runPromotionCycle();
    expect(promoted).toBe(1);

    const bAfter = await request(app).get('/api/queue/status').set('Authorization', `Bearer ${tokenB}`);
    expect(bAfter.body.state).toBe('active');
  });

  test('대기 중이거나 애초에 들어간 적 없는 상태에서 반납해도 에러 없이 멱등하다', async () => {
    const { token } = await signupUser();

    const res1 = await request(app).delete('/api/queue/active').set('Authorization', `Bearer ${token}`);
    expect(res1.status).toBe(200);

    await request(app).post('/api/queue/enter').set('Authorization', `Bearer ${token}`); // 대기 중(승격 안 됨)
    const res2 = await request(app).delete('/api/queue/active').set('Authorization', `Bearer ${token}`);
    expect(res2.status).toBe(200);

    // Active가 아니라 대기 중이었으므로 반납 호출과 무관하게 여전히 대기 중이어야 한다.
    const statusRes = await request(app).get('/api/queue/status').set('Authorization', `Bearer ${token}`);
    expect(statusRes.body.state).toBe('waiting');
  });
});

describe('대기열 순번', () => {
  test('순번은 문자열 사전순이 아니라 실제 입장 순서(시퀀스 번호)를 따른다', async () => {
    // userId '9'가 '10'보다 나중에 들어와도, ms 타임스탬프가 우연히 같아 사전순으로
    // 비교되면(과거 버그) '10'이 앞서게 된다 — 시퀀스 카운터 기반이면 항상 입장한
    // 순서 그대로다.
    await queueService.enterQueue('10');
    await queueService.enterQueue('9');

    expect(await queueService.getQueueStatus('10')).toMatchObject({ state: 'waiting', rank: 1 });
    expect(await queueService.getQueueStatus('9')).toMatchObject({ state: 'waiting', rank: 2 });
  });
});

describe('runPromotionCycle (배치 폴링 사이클)', () => {
  test('만료된 Active 사용자를 제거하고 빈 슬롯만큼 대기열에서 승격한다', async () => {
    // userA: 이미 만료된 Active 상태를 직접 심는다 — 실시간 TTL 대기 없이 결정적으로 재현.
    await redis.zadd(ACTIVE_GATE_KEY, Date.now() - 1000, 'userA');
    const enterResult = await queueService.enterQueue('userB');
    expect(enterResult).toMatchObject({ state: 'waiting', rank: 1 });

    const promoted = await queueService.runPromotionCycle();
    expect(promoted).toBe(1);

    expect(await queueService.getQueueStatus('userA')).toEqual({ state: 'not_entered' });
    const statusB = await queueService.getQueueStatus('userB');
    expect(statusB.state).toBe('active');
  });

  test('Active 슬롯이 이미 다 찼으면 승격하지 않는다', async () => {
    await redis.zadd(ACTIVE_GATE_KEY, Date.now() + 60000, 'userA'); // 아직 안 만료
    await queueService.enterQueue('userB');

    const promoted = await queueService.runPromotionCycle();
    expect(promoted).toBe(0);

    expect(await queueService.getQueueStatus('userB')).toMatchObject({ state: 'waiting', rank: 1 });
  });
});
