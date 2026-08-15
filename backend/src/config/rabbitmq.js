// Group C 비동기 영속화용 RabbitMQ 커넥션/채널.
// 재시도는 브로커의 DLX 플러그인 설정 대신, 메시지 바디에 담긴 attempts 카운터를
// worker.js가 직접 증가시켜 재발행하는 방식(애플리케이션 레벨)으로 구현한다 —
// doc/portfolio/01-group-c-redis-설계-결정.md 3장 참고. 그래서 큐 자체엔 DLX
// 설정이 없고, DLQ_QUEUE도 그냥 평범한 큐다(최종 격리소로만 쓰임).
const amqp = require('amqplib');

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://localhost';

const QUEUE_MAIN = 'registration.persist';
const QUEUE_DLQ = 'registration.persist.dlq';

let channelPromise = null;

async function connect() {
  const connection = await amqp.connect(RABBITMQ_URL);
  // createChannel/assertQueue가 끝나기 전에 연결이 끊기는 경우까지 커버하도록
  // 리스너를 가장 먼저 붙인다 — EventEmitter는 'error' 리스너가 하나도 없는 상태로
  // error 이벤트가 발생하면 프로세스 전체가 죽는다(unhandled 'error' event).
  connection.on('error', (err) => {
    console.error('RabbitMQ 연결 오류:', err.message);
    channelPromise = null; // 다음 호출이 재연결을 시도하도록 캐시를 비운다
  });
  connection.on('close', () => {
    channelPromise = null;
  });

  const channel = await connection.createChannel();
  // durable: 브로커 재시작에도 큐 정의가 살아남는다. 메시지 자체의 영속성은
  // publish 시 persistent:true 옵션으로 별도 지정한다(publishToQueue 참고).
  await channel.assertQueue(QUEUE_MAIN, { durable: true });
  await channel.assertQueue(QUEUE_DLQ, { durable: true });
  return channel;
}

async function getChannel() {
  if (!channelPromise) {
    // connect() 자체가 실패하면(예: 브로커가 아직 안 떴음) 그 즉시 캐시를 비워서
    // 다음 호출이 다시 connect()를 시도하게 한다 — 그대로 두면 실패한(rejected)
    // Promise가 영구히 캐시되어 이후 모든 발행이 재시도 없이 계속 실패한다.
    channelPromise = connect().catch((err) => {
      channelPromise = null;
      throw err;
    });
  }
  return channelPromise;
}

async function publishToQueue(queueName, messageObj) {
  const channel = await getChannel();
  channel.sendToQueue(queueName, Buffer.from(JSON.stringify(messageObj)), {
    persistent: true,
  });
}

module.exports = { getChannel, publishToQueue, QUEUE_MAIN, QUEUE_DLQ };
