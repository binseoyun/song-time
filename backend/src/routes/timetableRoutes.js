const express = require('express');
const router = express.Router();
const timetableController = require('../controllers/timetableController');
const authMiddleware = require('./authMiddleware');

router.use(authMiddleware);

router.get('/', timetableController.getTimetables);
router.post('/', timetableController.createTimetable);
router.delete('/:id', timetableController.deleteTimetable);

module.exports = router;


