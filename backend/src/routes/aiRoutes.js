//aiRoutes.js
const express = require('express')
const router=express.Router();
const aiController = require('../controllers/aiController');
const authMiddleware = require('./authMiddleware');

// AI 챗봇 프록시(ADR-010 §3/§11) — 로그인 필수, ai-server로 인증+프록시만 한다.
router.post('/chat', authMiddleware, aiController.chat);
router.get('/sessions', authMiddleware, aiController.getSessions);
router.get('/sessions/:id/messages', authMiddleware, aiController.getSessionMessages);

module.exports=router;