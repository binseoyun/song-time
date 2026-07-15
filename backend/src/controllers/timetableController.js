const Timetable = require('../models/Timetable');

exports.getTimetables = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ message: '인증이 필요합니다.' });
    }

    const timetables = await Timetable.findAll({
      where: { user_id: userId },
      order: [['created_at', 'DESC']],
    });

    res.status(200).json(timetables);
  } catch (error) {
    console.error('시간표 조회 오류:', error);
    res.status(500).json({ message: '시간표를 불러오는 중 오류가 발생했습니다.' });
  }
};

exports.createTimetable = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ message: '인증이 필요합니다.' });
    }

    const { name, courses } = req.body;
    if (!name || !Array.isArray(courses) || courses.length === 0) {
      return res.status(400).json({ message: '시간표 이름과 과목 정보가 필요합니다.' });
    }

    const newTimetable = await Timetable.create({
      user_id: userId,
      name,
      courses,
    });

    res.status(201).json(newTimetable);
  } catch (error) {
    console.error('시간표 저장 오류:', error);
    res.status(500).json({ message: '시간표를 저장하는 중 오류가 발생했습니다.' });
  }
};

exports.deleteTimetable = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { id } = req.params;

    if (!userId) {
      return res.status(401).json({ message: '인증이 필요합니다.' });
    }

    const timetable = await Timetable.findOne({
      where: { id, user_id: userId },
    });

    if (!timetable) {
      return res.status(404).json({ message: '시간표를 찾을 수 없습니다.' });
    }

    await timetable.destroy();
    res.status(200).json({ message: '시간표가 삭제되었습니다.' });
  } catch (error) {
    console.error('시간표 삭제 오류:', error);
    res.status(500).json({ message: '시간표를 삭제하는 중 오류가 발생했습니다.' });
  }
};


