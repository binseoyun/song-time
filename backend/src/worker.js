// RabbitMQ 워커 — registration.persist 큐를 소비해 Redis에서 이미 확정된 신청을
// MySQL에 반영한다. backend API 서버와는 별도 프로세스(같은 이미지, 다른 command)로
// docker-compose에 worker_1/worker_2 두 개가 뜬다.
// 관련: doc/portfolio/01-group-c-redis-설계-결정.md 3장, 구현계획 Stage 1 1-4/1-5.
require('./config/env');
const sequelize = require('./config/database');
const Registration = require('./models/Registration');
const { getChannel, publishToQueue, QUEUE_MAIN, QUEUE_DLQ } = require('./config/rabbitmq');

// 12,000 VU 스파이크 중 DB 풀이 잠깐 꽉 차는 것은 정상적인 일시 과부하이므로,
// 임계값을 낮게 잡으면 이런 상황을 영구 실패로 오판해 DLQ 지표가 부풀려진다
// (doc/portfolio/01-group-c-redis-설계-결정.md 3장에서 확정한 값).
const MAX_ATTEMPTS = 5;

// 워커가 2개이므로, 한 워커가 미리 여러 메시지를 채가서 다른 워커가 노는 상황을
// 막아야 "워커 하나를 죽여도 나머지가 계속 처리한다"는 카오스 테스트(1-8)의 전제가
// 성립한다. 그래서 한 번에 하나씩만 가져가게(prefetch=1) 한다.
const PREFETCH_COUNT = 1;

// 카오스 테스트(1-8) 전용 디버그 훅: 기본값 0이면 평소 동작에 전혀 영향이 없다.
// 로컬 환경은 INSERT 한 건이 수십 ms 안에 끝나버려서, 외부에서 docker kill로
// "메시지 처리 도중"을 정확히 맞히는 게 사실상 불가능하다(셸/Docker CLI 반응
// 속도가 그보다 느림) — 그래서 이 실험에서만 명시적으로 CHAOS_TEST_DELAY_MS를
// 켜서 ack 전 구간을 인위적으로 늘려, kill 타이밍을 확정적으로 재현한다.
const CHAOS_TEST_DELAY_MS = Number(process.env.CHAOS_TEST_DELAY_MS) || 0;

async function persist({ userId, classId, publishedAt }) {
  if (CHAOS_TEST_DELAY_MS > 0) {
    await new Promise((resolve) => setTimeout(resolve, CHAOS_TEST_DELAY_MS));
  }
  await Registration.create({ user_id: userId, class_id: classId });
  const leadTimeMs = Date.now() - publishedAt;
  console.log(`[worker] MySQL 반영 완료 userId=${userId} classId=${classId} leadTimeMs=${leadTimeMs}ms`);
}

async function handleMessage(channel, msg) {
  const payload = JSON.parse(msg.content.toString());
  const { userId, classId, attempts = 0 } = payload;

  try {
    await persist(payload);
    channel.ack(msg);
    return;
  } catch (error) {
    if (error.name === 'SequelizeUniqueConstraintError') {
      // 워커 kill 이후 재전송(redelivery)으로 같은 메시지를 다시 받은 경우 —
      // (user_id, class_id) 유니크 제약이 "이미 반영됨"을 보장해주므로 실패가 아니다.
      console.warn(`[worker] 이미 반영된 신청 — 재전송으로 판단, 스킵 userId=${userId} classId=${classId}`);
      channel.ack(msg);
      return;
    }

    const nextAttempts = attempts + 1;
    console.error(`[worker] MySQL 반영 실패 (attempts=${nextAttempts}/${MAX_ATTEMPTS}):`, {
      userId,
      classId,
      error: error.message,
    });

    // nack+requeue는 메시지 바디를 못 바꿔서 attempts를 못 늘린 채 큐 맨 앞으로
    // 돌아가 무한 재시도 루프가 된다. 그래서 attempts를 늘린 새 메시지를 발행하고
    // 원본은 ack로 소비 처리한다 — 큐 안에는 항상 attempts가 올바른 메시지 하나만 있다.
    if (nextAttempts >= MAX_ATTEMPTS) {
      await publishToQueue(QUEUE_DLQ, { ...payload, attempts: nextAttempts, lastError: error.message });
      console.error(`[worker] DLQ로 격리 userId=${userId} classId=${classId}`);
    } else {
      await publishToQueue(QUEUE_MAIN, { ...payload, attempts: nextAttempts });
    }
    channel.ack(msg);
  }
}

async function main() {
  await sequelize.authenticate();
  console.log('[worker] MySQL 연결 완료');

  const channel = await getChannel();
  await channel.prefetch(PREFETCH_COUNT);
  console.log(`[worker] ${QUEUE_MAIN} 소비 시작 (prefetch=${PREFETCH_COUNT})`);

  channel.consume(QUEUE_MAIN, (msg) => {
    if (!msg) return;
    // handleMessage 자체가 실패를 전부 삼켜 재발행/DLQ로 돌리지만, 그 재발행(publishToQueue)
    // 자체가 실패하는 경우(예: RabbitMQ 연결 끊김)까지는 못 잡는다 — 이 경우 메시지를
    // 버리지 않고 requeue해서 연결이 복구된 뒤 다시 시도할 기회를 준다.
    handleMessage(channel, msg).catch((error) => {
      console.error('[worker] 메시지 처리 중 처리되지 않은 오류 — requeue:', error.message);
      channel.nack(msg, false, true);
    });
  });
}

main().catch((error) => {
  console.error('[worker] 기동 실패:', error);
  process.exit(1);
});
