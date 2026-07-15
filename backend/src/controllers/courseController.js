const sequelize = require('../config/database');
const Class = require('../models/Class');
const ClassSchedule = require('../models/ClassSchedule');
const CourseInterest = require('../models/CourseInterest');

exports.getCourses = async (req, res) => {
  try {
    const courses = await Class.findAll({
      include: [{ model: ClassSchedule, as: 'schedules' }],
      order: [['id', 'ASC']],
    });
    res.status(200).json(courses);
  } catch (error) {
    console.error('수업 목록 조회 오류:', error);
    res.status(500).json({ message: '서버 오류가 발생했습니다.' });
  }
};

exports.getMyInterests = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ message: '인증이 필요합니다.' });
    }

    const interests = await CourseInterest.findAll({
      where: { user_id: userId },
      attributes: ['class_id'],
      order: [['class_id', 'ASC']],
    });

    res.status(200).json({
      courses: interests.map((interest) => String(interest.class_id)),
    });
  } catch (error) {
    console.error('관심 과목 조회 오류:', error);
    res.status(500).json({ message: '관심 과목을 불러오는 중 오류가 발생했습니다.' });
  }
};

exports.toggleInterest = async (req, res) => {
  const userId = req.user?.id;
  const { classId } = req.params;

  if (!userId) {
    return res.status(401).json({ message: '인증이 필요합니다.' });
  }

  if (!classId) {
    return res.status(400).json({ message: '과목 ID가 필요합니다.' });
  }

  try {
    const course = await Class.findByPk(classId);
    if (!course) {
      return res.status(404).json({ message: '해당 과목을 찾을 수 없습니다.' });
    }

    let isInterested;
    let updatedCourse;

    await sequelize.transaction(async (t) => {
      const existing = await CourseInterest.findOne({
        where: { user_id: userId, class_id: classId },
        transaction: t,
        lock: t.LOCK.UPDATE,
      });

      if (existing) {
        await existing.destroy({ transaction: t });
        await course.decrement('enrolled', {
          by: 1,
          transaction: t,
          lock: t.LOCK.UPDATE,
        });
        isInterested = false;
      } else {
        await CourseInterest.create(
          { user_id: userId, class_id: classId },
          { transaction: t }
        );
        await course.increment('enrolled', {
          by: 1,
          transaction: t,
          lock: t.LOCK.UPDATE,
        });
        isInterested = true;
      }

      updatedCourse = await Class.findByPk(classId, { transaction: t });
    });

    res.status(200).json({
      message: isInterested ? '관심 과목에 추가되었습니다.' : '관심 과목에서 제거되었습니다.',
      isInterested,
      course: {
        id: updatedCourse.id,
        enrolled: updatedCourse.enrolled,
        capacity: updatedCourse.capacity,
      },
    });
  } catch (error) {
    console.error('관심 과목 토글 오류:', error);
    res.status(500).json({ message: '관심 과목 처리 중 오류가 발생했습니다.' });
  }
};

