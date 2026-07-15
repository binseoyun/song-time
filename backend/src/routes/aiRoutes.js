//aiRoutes.js
const express = require('express')
const router=express.Router();
const aiController = require('../controllers/aiController');

// POST http://localhost:8000/api/ai/recommend
router.post('/recommend', aiController.getRecommendation);

module.exports=router; 