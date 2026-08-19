// 전역 대기열 + Active 게이트(ADR-006 1.1/1.3 보완 해결, 이슈 #46) 비즈니스 로직.
// 과목별 좌석 경쟁(Stage 1, registrationService.js)과는 별개 관심사다 — 이 모듈은
// "수강신청 화면 진입 자체"를 조절할 뿐, 좌석 카운터(class:*:seats)는 건드리지 않는다.
const redis = require('../config/redis');
const { WAITING_QUEUE_KEY, ACTIVE_GATE_KEY } = require('../utils/redisKeys');

// 실제 값은 Stage 2-3/2-4(실험 02, Little's Law 역산)가 끝나야 확정된다.
// 그때까지는 ADR-006 1.5가 제시한 보수적 초기값으로 시작한다.
const ACTIVE_GATE_LIMIT = Number(process.env.ACTIVE_GATE_LIMIT) || 50;
const ACTIVE_TTL_SECONDS = Number(process.env.ACTIVE_TTL_SECONDS) || 120;
const ACTIVE_TTL_MS = ACTIVE_TTL_SECONDS * 1000;
const PROMOTION_INTERVAL_MS = Number(process.env.PROMOTION_INTERVAL_MS) || 2000;

const QUEUE_STATE = {
  ACTIVE: 1,
  WAITING: 2,
};

// 대기열 입장. 이미 Active/대기 중이면 기존 상태를 그대로 반환한다(새로고침 시
// 재대기 방지 — ADR-006 1.3).
async function enterQueue(userId) {
  const member = String(userId);
  const now = Date.now();

  const [state, extra] = await redis.enterQueue(ACTIVE_GATE_KEY, WAITING_QUEUE_KEY, member, now);

  if (Number(state) === QUEUE_STATE.ACTIVE) {
    return { state: 'active', expiresAt: Number(extra) };
  }
  return { state: 'waiting', rank: Number(extra) + 1 };
}

// 현재 상태 조회(읽기 전용). 상태 갱신(승격)은 하지 않는다 — 오직 runPromotionCycle만 승격시킨다.
async function getQueueStatus(userId) {
  const member = String(userId);
  const now = Date.now();

  const activeScore = await redis.zscore(ACTIVE_GATE_KEY, member);
  if (activeScore !== null && Number(activeScore) > now) {
    return { state: 'active', expiresAt: Number(activeScore) };
  }

  const waitScore = await redis.zscore(WAITING_QUEUE_KEY, member);
  if (waitScore !== null) {
    const rank = await redis.zrank(WAITING_QUEUE_KEY, member);
    return { state: 'waiting', rank: rank + 1 };
  }

  return { state: 'not_entered' };
}

// 배치 폴링 사이클(ADR-006 1.3 보완 해결) — 만료자 제거 + 빈 슬롯만큼 승격을 원자 처리.
// 승격된 인원 수를 반환한다(테스트/로깅용).
async function runPromotionCycle() {
  const now = Date.now();
  const promoted = await redis.promoteQueue(ACTIVE_GATE_KEY, WAITING_QUEUE_KEY, now, ACTIVE_TTL_MS, ACTIVE_GATE_LIMIT);
  return Number(promoted);
}

let promotionIntervalHandle = null;

// server.js에서만 호출한다(app.js는 supertest가 그대로 import하므로, 여기서 타이머를
// 시작하면 Jest 프로세스가 안 끝나거나 테스트 간 상태가 오염된다).
function startPromotionScheduler() {
  if (promotionIntervalHandle) return;
  promotionIntervalHandle = setInterval(() => {
    runPromotionCycle().catch((error) => {
      console.error('대기열 승격 사이클 실패:', error.message);
    });
  }, PROMOTION_INTERVAL_MS);
}

function stopPromotionScheduler() {
  if (promotionIntervalHandle) {
    clearInterval(promotionIntervalHandle);
    promotionIntervalHandle = null;
  }
}

module.exports = {
  enterQueue,
  getQueueStatus,
  runPromotionCycle,
  startPromotionScheduler,
  stopPromotionScheduler,
  ACTIVE_GATE_LIMIT,
  ACTIVE_TTL_SECONDS,
  PROMOTION_INTERVAL_MS,
};
