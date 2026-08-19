// 대기열 컨트롤러 — HTTP 통신만 전담한다. 비즈니스 로직은 services/queueService.js.
const queueService = require('../services/queueService');

// 입장(진입) — 이미 Active/대기 중이면 기존 상태를 그대로 반환하므로 재호출해도 안전하다.
exports.enter = async (req, res) => {
  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({ message: '인증이 필요합니다.' });
  }

  try {
    const status = await queueService.enterQueue(userId);
    res.status(200).json(status);
  } catch (error) {
    console.error('대기열 입장 오류:', error);
    res.status(500).json({ message: '대기열 처리 중 오류가 발생했습니다.' });
  }
};

// 순번 조회(폴링, 이슈 #48) — 읽기 전용, 부작용 없음. 프론트엔드가 3~5초 주기로
// 반복 호출한다(ADR-006 1.4).
exports.status = async (req, res) => {
  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({ message: '인증이 필요합니다.' });
  }

  try {
    const status = await queueService.getQueueStatus(userId);
    res.status(200).json(status);
  } catch (error) {
    console.error('대기열 상태 조회 오류:', error);
    res.status(500).json({ message: '대기열 상태 조회 중 오류가 발생했습니다.' });
  }
};

// Active 슬롯 조기 반납(이슈 #58) — TTL 만료 전에 자발적으로 자리를 비운다.
// 대기 중이었거나 이미 빠진 상태에서 호출해도(중복/새로고침) 안전하므로 인증만 확인한다.
exports.leave = async (req, res) => {
  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({ message: '인증이 필요합니다.' });
  }

  try {
    await queueService.leaveActive(userId);
    res.status(200).json({ state: 'not_entered' });
  } catch (error) {
    console.error('Active 슬롯 반납 오류:', error);
    res.status(500).json({ message: 'Active 슬롯 반납 중 오류가 발생했습니다.' });
  }
};
