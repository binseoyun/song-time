// 실시간 수강신청 컨트롤러 — HTTP 통신만 전담한다 (요청 파싱/검증, 응답 매핑).
// 비즈니스 로직은 services/registrationService.js에 있다.
const registrationService = require('../services/registrationService');
const { RegistrationError } = registrationService;

const STATUS_BY_CODE = {
  NOT_FOUND: 404,
  DUPLICATE: 409,
  FULL: 409,
  // Lua 스크립트의 실패 사유(중복/시간표겹침/정원마감)는 전부 409로 통일한다.
  // 실험 01의 k6 스크립트가 success/rejected/server_error 3분류만 쓰므로,
  // 세부 사유는 HTTP status가 아니라 응답 바디로만 구분해 기존 실험과 비교 가능하게 한다.
  // (doc/experiment/03-낙관적락-fail-fast-재시도-실험계획.md 3장과 동일한 원칙)
  OVERLAP: 409,
};

// classId는 등록(body)과 취소(params) 요청에서 오는 위치가 다르므로 호출부에서 넘긴다.
function parseRequest(req, res, classId) {
  const userId = req.user?.id;

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
  const input = parseRequest(req, res, req.body.classId);
  if (!input) return;

  try {
    const registration = await registrationService.registerNaive(input);
    res.status(201).json({ message: '수강신청이 완료되었습니다.', registration });
  } catch (error) {
    handleError(error, res, '수강신청(무방비)');
  }
};

exports.registerPessimistic = async (req, res) => {
  const input = parseRequest(req, res, req.body.classId);
  if (!input) return;

  try {
    const registration = await registrationService.registerPessimistic(input);
    res.status(201).json({ message: '수강신청이 완료되었습니다.', registration });
  } catch (error) {
    handleError(error, res, '수강신청(비관적 락)');
  }
};

exports.registerRedis = async (req, res) => {
  const input = parseRequest(req, res, req.body.classId);
  if (!input) return;

  try {
    const registration = await registrationService.registerRedisAtomic(input);
    res.status(201).json({ message: '수강신청이 완료되었습니다.', registration });
  } catch (error) {
    handleError(error, res, '수강신청(Redis 원자적 연산)');
  }
};

exports.cancelRedis = async (req, res) => {
  const input = parseRequest(req, res, req.params.classId);
  if (!input) return;

  try {
    await registrationService.cancelRedisAtomic(input);
    res.status(200).json({ message: '수강신청이 취소되었습니다.' });
  } catch (error) {
    handleError(error, res, '수강신청 취소(Redis)');
  }
};
