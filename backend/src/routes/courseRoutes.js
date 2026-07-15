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

module.exports = router;

