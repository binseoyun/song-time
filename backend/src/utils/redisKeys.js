// Group C가 쓰는 Redis 키 네이밍을 한 곳에 모아, 서비스/워커/시딩 스크립트가
// 서로 다른 형식의 키를 만들어 조용히 어긋나는 사고를 방지한다.
const classSeatsKey = (classId) => `class:${classId}:seats`;
const classSlotsKey = (classId) => `class:${classId}:slots`;
const userRegisteredKey = (userId) => `user:${userId}:registered`;
const userSlotsKey = (userId) => `user:${userId}:slots`;

module.exports = { classSeatsKey, classSlotsKey, userRegisteredKey, userSlotsKey };
