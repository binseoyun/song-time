const express = require('express');
const router = express.Router();
const courseController = require('../controllers/courseController');
const demandController = require('../controllers/demandController');
const authMiddleware = require('./authMiddleware');
const cronAuthMiddleware = require('./cronAuthMiddleware');

router.get('/', courseController.getCourses);
router.get('/interests', authMiddleware, courseController.getMyInterests);
router.post('/:classId/interest', authMiddleware, courseController.toggleInterest);
router.get('/alerts', demandController.getDemandAlerts);
router.post('/aggregate', cronAuthMiddleware, demandController.aggregateDemand);
// AI 챗봇 Tool이 호출할 과목 단건 조회(ADR-010 §8) — 반드시 위 정적 경로들 뒤에 둔다
// (먼저 두면 /interests, /alerts를 :code로 오매칭한다).
router.get('/:code', courseController.getCourseByCode);

module.exports = router;

