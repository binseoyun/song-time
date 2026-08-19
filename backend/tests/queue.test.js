// 전역 대기열/Active 게이트(ADR-006 1.1/1.3 보완 해결, 이슈 #46) 통합 테스트.
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
    expect(res.body).toEqual({ state: 'waiting', rank: 1 });
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

describe('대기열 순번', () => {
  test('순번은 문자열 사전순이 아니라 실제 입장 순서(시퀀스 번호)를 따른다', async () => {
    // userId '9'가 '10'보다 나중에 들어와도, ms 타임스탬프가 우연히 같아 사전순으로
    // 비교되면(과거 버그) '10'이 앞서게 된다 — 시퀀스 카운터 기반이면 항상 입장한
    // 순서 그대로다.
    await queueService.enterQueue('10');
    await queueService.enterQueue('9');

    expect(await queueService.getQueueStatus('10')).toEqual({ state: 'waiting', rank: 1 });
    expect(await queueService.getQueueStatus('9')).toEqual({ state: 'waiting', rank: 2 });
  });
});

describe('runPromotionCycle (배치 폴링 사이클)', () => {
  test('만료된 Active 사용자를 제거하고 빈 슬롯만큼 대기열에서 승격한다', async () => {
    // userA: 이미 만료된 Active 상태를 직접 심는다 — 실시간 TTL 대기 없이 결정적으로 재현.
    await redis.zadd(ACTIVE_GATE_KEY, Date.now() - 1000, 'userA');
    const enterResult = await queueService.enterQueue('userB');
    expect(enterResult).toEqual({ state: 'waiting', rank: 1 });

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

    expect(await queueService.getQueueStatus('userB')).toEqual({ state: 'waiting', rank: 1 });
  });
});
