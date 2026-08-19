// Group C가 쓰는 Redis 키 네이밍을 한 곳에 모아, 서비스/워커/시딩 스크립트가
// 서로 다른 형식의 키를 만들어 조용히 어긋나는 사고를 방지한다.
const classSeatsKey = (classId) => `class:${classId}:seats`;
const classSlotsKey = (classId) => `class:${classId}:slots`;
const userRegisteredKey = (userId) => `user:${userId}:registered`;
const userSlotsKey = (userId) => `user:${userId}:slots`;

// 대기열/Active 게이트(ADR-006 1.3 보완 해결, 이슈 #46): 과목별이 아니라
// 전역 1개 — 경쟁의 단위가 특정 과목이 아니라 수강신청 사이트 진입 자체이기 때문.
const WAITING_QUEUE_KEY = 'waiting_queue:global';
// 대기열 score용 시퀀스 카운터. ms 타임스탬프 대신 이걸 쓰는 이유는 enterQueue.lua 참고.
const WAITING_QUEUE_SEQ_KEY = 'waiting_queue:global:seq';
const ACTIVE_GATE_KEY = 'active_gate:global';

module.exports = {
  classSeatsKey,
  classSlotsKey,
  userRegisteredKey,
  userSlotsKey,
  WAITING_QUEUE_KEY,
  WAITING_QUEUE_SEQ_KEY,
  ACTIVE_GATE_KEY,
};
