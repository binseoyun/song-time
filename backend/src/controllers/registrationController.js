// 실시간 수강신청 컨트롤러 — HTTP 통신만 전담한다 (요청 파싱/검증, 응답 매핑).
// 비즈니스 로직은 services/registrationService.js에 있다.
const registrationService = require('../services/registrationService');
const { RegistrationError } = registrationService;

const STATUS_BY_CODE = {
  NOT_FOUND: 404,
  DUPLICATE: 409,
  FULL: 409,
};

function parseRequest(req, res) {
  const userId = req.user?.id;
  const { classId } = req.body;

  if (!userId) {
    res.status(401).json({ message: '인증이 필요합니다.' });
    return null;
  }
  if (!classId) {
    res.status(400).json({ message: '과목 ID가 필요합니다.' });
    return null;
  }
  return { userId, classId };
}

function handleError(error, res, logLabel) {
  if (error instanceof RegistrationError) {
    return res.status(STATUS_BY_CODE[error.code] || 409).json({ message: error.message });
  }
  console.error(`${logLabel} 오류:`, error);
  res.status(500).json({ message: '수강신청 처리 중 오류가 발생했습니다.' });
}

exports.registerNaive = async (req, res) => {
  const input = parseRequest(req, res);
  if (!input) return;

  try {
    const registration = await registrationService.registerNaive(input);
    res.status(201).json({ message: '수강신청이 완료되었습니다.', registration });
  } catch (error) {
    handleError(error, res, '수강신청(무방비)');
  }
};

exports.registerPessimistic = async (req, res) => {
  const input = parseRequest(req, res);
  if (!input) return;

  try {
    const registration = await registrationService.registerPessimistic(input);
    res.status(201).json({ message: '수강신청이 완료되었습니다.', registration });
  } catch (error) {
    handleError(error, res, '수강신청(비관적 락)');
  }
};
