// 실시간 수강신청 대조 실험용 라우트. 그룹별로 경로를 분리한다 —
// 세 그룹 모두 요청/응답 계약은 동일하고(doc/experiment/01 5장), k6 스크립트는
// 대상 경로만 바꿔서 동일한 시나리오를 재사용한다.
const express = require('express');
const router = express.Router();
const registrationController = require('../controllers/registrationController');
const authMiddleware = require('./authMiddleware');

router.post('/naive', authMiddleware, registrationController.registerNaive);
router.post('/pessimistic', authMiddleware, registrationController.registerPessimistic);
router.post('/redis', authMiddleware, registrationController.registerRedis);
router.delete('/redis/:classId', authMiddleware, registrationController.cancelRedis);
router.get('/redis', authMiddleware, registrationController.listMyRegistrations);
router.get('/redis/seats', authMiddleware, registrationController.getSeatCounts);

module.exports = router;
