//라우터 연결

const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const authMiddleware = require('./authMiddleware');

console.log('authRoutes 파일이 로드 되었습니다')

// POST http://localhost:3000/api/auth/signup
router.post('/signup', authController.register);

// POST http://localhost:3000/api/auth/login
router.post('/login', authController.login);

// POST http://localhost:3000/api/auth/reset-password
router.post('/reset-password', authController.resetPassword);

//POST hyttp://localhost:3000/api/auth/logout
router.post('/logout', authController.logout);

// DELETE http://localhost:3000/api/auth/account (회원 탈퇴, 로그인 필요)
router.delete('/account', authMiddleware, authController.deleteAccount);

module.exports = router;