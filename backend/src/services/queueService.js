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

// 최종 확정값은 Stage 2-3/2-4(실험 02, Little's Law 역산 + Valve Tuning 실측)가
// 끝나야 나온다. 그 전까지 쓰는 잠정값의 근거(2026-08-19 논의로 ADR-006 1.5의
// 최초 가설값에서 조정):
// - ACTIVE_TTL_SECONDS(600 = 10분): 원래 120초는 "과목 하나 빠르게 클릭"을
//   가정했는데, 실제 수강신청은 한 세션에 여러 과목(정원 마감 시 대체 과목
//   재시도 포함)을 신청하는 흐름이라 너무 짧다고 판단해 늘렸다.
// - ACTIVE_GATE_LIMIT(300명): 여전히 감으로 정한 숫자가 아니라 Stage 1
//   Group C 스윕 실측(`doc/experiment/01-결과-groupC.md`)에서 "동시 500명이
//   몰려도 handled_rate 100%"였던 걸 근거로, 그보다 충분히 낮게 잡았다 —
//   완전한 정답은 아니고 2-4가 최종 확정한다.
const ACTIVE_GATE_LIMIT = parseEnvInt(process.env.ACTIVE_GATE_LIMIT, 300);
const ACTIVE_TTL_SECONDS = parseEnvInt(process.env.ACTIVE_TTL_SECONDS, 600);
const ACTIVE_TTL_MS = ACTIVE_TTL_SECONDS * 1000;
const PROMOTION_INTERVAL_MS = parseEnvInt(process.env.PROMOTION_INTERVAL_MS, 2000);

const QUEUE_STATE = {
  NOT_ENTERED: 0,
  ACTIVE: 1,
  WAITING: 2,
};

// 대기열 입장. 이미 Active/대기 중이면 기존 상태를 그대로 반환한다(새로고침 시
// 재대기 방지 — ADR-006 1.3).
async function enterQueue(userId) {
  const member = String(userId);
  const now = Date.now();

  const [state, extra] = await redis.enterQueue(ACTIVE_GATE_KEY, WAITING_QUEUE_KEY, WAITING_QUEUE_SEQ_KEY, member, now);

  if (Number(state) === QUEUE_STATE.ACTIVE) {
    return { state: 'active', expiresAt: Number(extra) };
  }
  return { state: 'waiting', rank: Number(extra) + 1 };
}

// 현재 상태 조회(읽기 전용). ZSCORE+ZRANK를 하나의 Lua Script로 묶어, 두 호출 사이에
// 승격 사이클이 끼어들어 방금 승격된 사용자를 여전히 대기 중으로 오응답하는 경쟁
// 상태를 막는다(코드 리뷰 발견 사항, 2026-08-19). 상태 갱신(승격)은 하지 않는다 —
// 오직 runPromotionCycle만 승격시킨다.
//
// 예상 대기 시간(초)은 안 준다(이슈 #48 논의, 2026-08-19) — 실제 학교 수강신청
// 사이트도 앞에 몇 명 있는지만 보여줬고, ACTIVE_GATE_LIMIT/ACTIVE_TTL_SECONDS이
// 아직 실측 전 플레이스홀더라 지금 시간을 계산해 보여주면 부정확한 확신을 줄
// 위험이 있다. 순번만으로 충분하다는 판단.
async function getQueueStatus(userId) {
  const member = String(userId);
  const now = Date.now();

  const [state, extra] = await redis.queueStatus(ACTIVE_GATE_KEY, WAITING_QUEUE_KEY, member, now);
  const stateNum = Number(state);

  if (stateNum === QUEUE_STATE.ACTIVE) {
    return { state: 'active', expiresAt: Number(extra) };
  }
  if (stateNum === QUEUE_STATE.WAITING) {
    return { state: 'waiting', rank: Number(extra) + 1 };
  }
  return { state: 'not_entered' };
}

// Active 슬롯 조기 반납(이슈 #58) — TTL 만료를 기다리지 않고 즉시 자리를 비운다.
// promoteQueue의 ZREMRANGEBYSCORE는 "만료된" 멤버만 지우므로, 아직 안 끝난 TTL을 가진
// 멤버를 지우려면 별도 ZREM이 필요하다. 이미 없는 멤버를 지워도(중복 호출, TTL로 이미
// 빠짐) ZREM은 그냥 0을 반환할 뿐 에러가 아니므로 멱등하다.
async function leaveActive(userId) {
  await redis.zrem(ACTIVE_GATE_KEY, String(userId));
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
  leaveActive,
  runPromotionCycle,
  startPromotionScheduler,
  stopPromotionScheduler,
  ACTIVE_GATE_LIMIT,
  ACTIVE_TTL_SECONDS,
  PROMOTION_INTERVAL_MS,
};
