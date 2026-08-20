// DLQ 격리 시점 좌석 자동 반환(Stage 3-4 축소판, 이슈 #62, ADR-009) 테스트.
// registerRedisAtomic(HTTP 경유)으로 실제 등록 상태를 만든 뒤, 워커가 DLQ로 격리할 때
// 호출하는 것과 동일한 반환 함수를 직접 호출해 Redis 상태가 취소와 동일하게 되돌아가는지
// 확인한다 — worker.js 자체(RabbitMQ 연결 필요)는 통합 테스트 환경에 없으므로, 이 반환
// 로직만 단위로 검증하고 "워커가 실제로 이 함수를 호출하는지"는 카오스 테스트(3-7)로 남긴다.
const request = require('supertest');
const { app, resetDatabase, closeDatabase, signupUser, createClass } = require('./helpers');
const redis = require('../src/config/redis');
const { classSeatsKey, userRegisteredKey } = require('../src/utils/redisKeys');
const { returnSeatForFailedRegistration } = require('../src/services/registrationCompensationService');

afterAll(closeDatabase);

describe('returnSeatForFailedRegistration (이슈 #62)', () => {
  let token;

  beforeEach(async () => {
    await resetDatabase();
    await createClass({ id: 'C001', capacity: 30, remainingSeats: 30 });
    await redis.set(classSeatsKey('C001'), 30);
    await redis.del(userRegisteredKey(1));
    ({ token } = await signupUser());
  });

  test('DLQ로 격리된 신청의 좌석을 반환하고 사용자의 등록 상태를 해제한다', async () => {
    await request(app)
      .post('/api/registrations/redis')
      .set('Authorization', `Bearer ${token}`)
      .send({ classId: 'C001' });

    expect(await redis.get(classSeatsKey('C001'))).toBe('29');
    expect(await redis.sismember(userRegisteredKey(1), 'C001')).toBe(1);

    const result = await returnSeatForFailedRegistration({ userId: 1, classId: 'C001' });

    expect(result).toBe(true);
    expect(await redis.get(classSeatsKey('C001'))).toBe('30');
    expect(await redis.sismember(userRegisteredKey(1), 'C001')).toBe(0);
  });

  test('이미 등록 상태가 아니면 좌석을 건드리지 않고 false를 반환한다 (이중 반환 방지)', async () => {
    const result = await returnSeatForFailedRegistration({ userId: 1, classId: 'C001' });

    expect(result).toBe(false);
    expect(await redis.get(classSeatsKey('C001'))).toBe('30');
  });

  test('사용자가 이미 직접 취소한 뒤에는 반환을 또 하지 않는다', async () => {
    await request(app)
      .post('/api/registrations/redis')
      .set('Authorization', `Bearer ${token}`)
      .send({ classId: 'C001' });
    await request(app)
      .delete('/api/registrations/redis/C001')
      .set('Authorization', `Bearer ${token}`);

    expect(await redis.get(classSeatsKey('C001'))).toBe('30');

    const result = await returnSeatForFailedRegistration({ userId: 1, classId: 'C001' });

    expect(result).toBe(false);
    expect(await redis.get(classSeatsKey('C001'))).toBe('30');
  });
});
