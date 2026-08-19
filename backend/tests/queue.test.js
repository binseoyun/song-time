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

  test('최초 진입 시 대기 상태와 1번 순번, 예상 대기 시간을 반환한다', async () => {
    const { token } = await signupUser();

    const res = await request(app).post('/api/queue/enter').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    // ACTIVE_GATE_LIMIT=1, ACTIVE_TTL_SECONDS=120 → ceil((1/1)*120) = 120
    expect(res.body).toEqual({ state: 'waiting', rank: 1, estimatedWaitSeconds: 120 });
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

  test('대기 중이면 순번과 예상 대기 시간을 반환한다(부작용 없이 반복 호출 가능)', async () => {
    const { token } = await signupUser();
    await request(app).post('/api/queue/enter').set('Authorization', `Bearer ${token}`);

    const res1 = await request(app).get('/api/queue/status').set('Authorization', `Bearer ${token}`);
    const res2 = await request(app).get('/api/queue/status').set('Authorization', `Bearer ${token}`);

    expect(res1.body).toEqual({ state: 'waiting', rank: 1, estimatedWaitSeconds: 120 });
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

describe('estimateWaitSeconds (Littles Law 기반 근사, 이슈 #48)', () => {
  test('rank가 ACTIVE_GATE_LIMIT 배수 경계를 넘을 때마다 TTL만큼 늘어난다', () => {
    // ACTIVE_GATE_LIMIT=1, ACTIVE_TTL_SECONDS=120이므로 순번 하나당 정확히 120초씩.
    expect(queueService.estimateWaitSeconds(1)).toBe(120);
    expect(queueService.estimateWaitSeconds(2)).toBe(240);
    expect(queueService.estimateWaitSeconds(5)).toBe(600);
  });

  test('같은 승격 세대 안에서는 선형이 아니라 배치(TTL) 단위로 계단식으로 늘어난다', async () => {
    // LIMIT=1로는 rank/LIMIT가 항상 정수라 선형 근사와 배치 근사가 구분이 안 된다.
    // 이 테스트만 LIMIT=50인 별도 모듈 인스턴스로 실제 세대 경계를 재현한다 —
    // 고정 TTL + 배치 폴링이라 같은 사이클에 승격된 사람들은 전부 같은 시각에
    // 만료되므로, rank 1~50(첫 세대)은 전부 한 TTL(120초) 뒤, 51등(다음 세대)은
    // 두 TTL(240초) 뒤에 승격된다 — 선형 공식이었다면 51등을 약 123초로
    // 과소추정했을 것(사용자 지적으로 발견해 수정, 2026-08-19).
    const originalLimit = process.env.ACTIVE_GATE_LIMIT;
    const originalTtl = process.env.ACTIVE_TTL_SECONDS;
    process.env.ACTIVE_GATE_LIMIT = '50';
    process.env.ACTIVE_TTL_SECONDS = '120';

    let freshQueueService;
    let freshRedis;
    jest.isolateModules(() => {
      freshQueueService = require('../src/services/queueService');
      freshRedis = require('../src/config/redis');
    });

    process.env.ACTIVE_GATE_LIMIT = originalLimit;
    process.env.ACTIVE_TTL_SECONDS = originalTtl;

    try {
      expect(freshQueueService.estimateWaitSeconds(1)).toBe(120);
      expect(freshQueueService.estimateWaitSeconds(50)).toBe(120);
      expect(freshQueueService.estimateWaitSeconds(51)).toBe(240);
    } finally {
      await freshRedis.quit();
    }
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
