// 전역 대기열 + Active 게이트(ADR-006 1.1/1.3 보완 해결, 이슈 #46) 비즈니스 로직.
// 과목별 좌석 경쟁(Stage 1, registrationService.js)과는 별개 관심사다 — 이 모듈은
// "수강신청 화면 진입 자체"를 조절할 뿐, 좌석 카운터(class:*:seats)는 건드리지 않는다.
const redis = require('../config/redis');
const { WAITING_QUEUE_KEY, WAITING_QUEUE_SEQ_KEY, ACTIVE_GATE_KEY } = require('../utils/redisKeys');

// `Number(env) || fallback`은 env가 의도적으로 '0'(예: ACTIVE_GATE_LIMIT=0으로 신규
// 입장을 잠그는 운영 킬스위치)일 때도 fallback으로 되돌아가는 함정이 있다(코드 리뷰
// 발견 사항, 2026-08-19) — undefined일 때만 fallback을 쓰도록 명시적으로 구분한다.
function parseEnvInt(value, fallback) {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

// 실제 값은 Stage 2-3/2-4(실험 02, Little's Law 역산)가 끝나야 확정된다.
// 그때까지는 ADR-006 1.5가 제시한 보수적 초기값으로 시작한다.
const ACTIVE_GATE_LIMIT = parseEnvInt(process.env.ACTIVE_GATE_LIMIT, 50);
const ACTIVE_TTL_SECONDS = parseEnvInt(process.env.ACTIVE_TTL_SECONDS, 120);
const ACTIVE_TTL_MS = ACTIVE_TTL_SECONDS * 1000;
const PROMOTION_INTERVAL_MS = parseEnvInt(process.env.PROMOTION_INTERVAL_MS, 2000);

const QUEUE_STATE = {
  NOT_ENTERED: 0,
  ACTIVE: 1,
  WAITING: 2,
};

// 예상 대기 시간(초) 추정(이슈 #48). Little's Law(W = L/λ)를 대기열 자체를
// 하위 시스템 삼아 적용한 것이다 — L(대기 인원) = rank, λ(승격 처리율) =
// ACTIVE_GATE_LIMIT/ACTIVE_TTL_SECONDS.
//
// 승격이 매끄럽게 연속적으로 일어난다고 가정하면 W = (rank/LIMIT)*TTL(선형)이지만,
// 이 시스템은 고정 TTL + 배치 폴링이라 실제로는 그렇지 않다 — 특히 이 기능이
// 막으려는 상황(신청 오픈 순간 대량 동시 진입)에서는 같은 승격 사이클에 들어간
// 사람들이 전부 같은 시각에 만료되어, 승격이 TTL 주기 단위로 뭉텅이(batch)로
// 일어난다. 그래서 "rank번째까지 가려면 몇 번의 승격 배치(세대)를 거쳐야 하는가"
// = ceil(rank/LIMIT)로 계산하고 TTL을 곱한다. 이 값은 선형 근사치보다 항상
// 크거나 같아(ceil(x) >= x) 매끄러운 정상상태에서도 안전한 상한이고, 몰림
// 시나리오에서는 실제 배치 타이밍과 정확히 일치한다(2026-08-19, 사용자 지적으로
// 선형 공식이 뭉침 시나리오를 과소추정하는 문제를 발견해 수정).
//
// ACTIVE_GATE_LIMIT/ACTIVE_TTL_SECONDS이 아직 Stage 2-3/2-4 실측 전 플레이스홀더라
// 이 추정치도 그 값이 실측으로 교체되면 자동으로 더 정확해진다.
function estimateWaitSeconds(rank) {
  return Math.ceil(rank / ACTIVE_GATE_LIMIT) * ACTIVE_TTL_SECONDS;
}

// 대기열 입장. 이미 Active/대기 중이면 기존 상태를 그대로 반환한다(새로고침 시
// 재대기 방지 — ADR-006 1.3).
async function enterQueue(userId) {
  const member = String(userId);
  const now = Date.now();

  const [state, extra] = await redis.enterQueue(ACTIVE_GATE_KEY, WAITING_QUEUE_KEY, WAITING_QUEUE_SEQ_KEY, member, now);

  if (Number(state) === QUEUE_STATE.ACTIVE) {
    return { state: 'active', expiresAt: Number(extra) };
  }
  const rank = Number(extra) + 1;
  return { state: 'waiting', rank, estimatedWaitSeconds: estimateWaitSeconds(rank) };
}

// 현재 상태 조회(읽기 전용). ZSCORE+ZRANK를 하나의 Lua Script로 묶어, 두 호출 사이에
// 승격 사이클이 끼어들어 방금 승격된 사용자를 여전히 대기 중으로 오응답하는 경쟁
// 상태를 막는다(코드 리뷰 발견 사항, 2026-08-19). 상태 갱신(승격)은 하지 않는다 —
// 오직 runPromotionCycle만 승격시킨다.
async function getQueueStatus(userId) {
  const member = String(userId);
  const now = Date.now();

  const [state, extra] = await redis.queueStatus(ACTIVE_GATE_KEY, WAITING_QUEUE_KEY, member, now);
  const stateNum = Number(state);

  if (stateNum === QUEUE_STATE.ACTIVE) {
    return { state: 'active', expiresAt: Number(extra) };
  }
  if (stateNum === QUEUE_STATE.WAITING) {
    const rank = Number(extra) + 1;
    return { state: 'waiting', rank, estimatedWaitSeconds: estimateWaitSeconds(rank) };
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

let promotionTimeoutHandle = null;
let promotionSchedulerRunning = false;

// setInterval 대신 "이전 사이클이 끝난 뒤에만 다음 사이클을 예약"하는 방식을 쓴다 —
// 고정 setInterval은 Redis가 느려져 한 사이클이 주기보다 오래 걸리면 다음 tick이
// 그래도 발사돼 승격 호출이 겹쳐 쌓인다(코드 리뷰 발견 사항, 2026-08-19).
function scheduleNextPromotion() {
  promotionTimeoutHandle = setTimeout(async () => {
    try {
      await runPromotionCycle();
    } catch (error) {
      console.error('대기열 승격 사이클 실패:', error.message);
    }
    if (promotionSchedulerRunning) {
      scheduleNextPromotion();
    }
  }, PROMOTION_INTERVAL_MS);
}

// server.js에서만 호출한다(app.js는 supertest가 그대로 import하므로, 여기서 타이머를
// 시작하면 Jest 프로세스가 안 끝나거나 테스트 간 상태가 오염된다).
function startPromotionScheduler() {
  if (promotionSchedulerRunning) return;
  promotionSchedulerRunning = true;
  scheduleNextPromotion();
}

function stopPromotionScheduler() {
  promotionSchedulerRunning = false;
  if (promotionTimeoutHandle) {
    clearTimeout(promotionTimeoutHandle);
    promotionTimeoutHandle = null;
  }
}

module.exports = {
  enterQueue,
  getQueueStatus,
  estimateWaitSeconds,
  runPromotionCycle,
  startPromotionScheduler,
  stopPromotionScheduler,
  ACTIVE_GATE_LIMIT,
  ACTIVE_TTL_SECONDS,
  PROMOTION_INTERVAL_MS,
};
