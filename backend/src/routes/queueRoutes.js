// 전역 대기열/Active 게이트 라우트(ADR-006 1.1/1.3, 이슈 #46).
const express = require('express');
const router = express.Router();
const queueController = require('../controllers/queueController');
const authMiddleware = require('./authMiddleware');

router.post('/enter', authMiddleware, queueController.enter);
router.get('/status', authMiddleware, queueController.status);

module.exports = router;
