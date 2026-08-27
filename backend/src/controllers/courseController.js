const { fn, col } = require('sequelize');
const sequelize = require('../config/database');
const redis = require('../config/redis');
const { classSeatsKey } = require('../utils/redisKeys');
const Class = require('../models/Class');
const ClassSchedule = require('../models/ClassSchedule');
const CourseInterest = require('../models/CourseInterest');

// ADR-013: 과목 조회 응답의 좌석/수요 숫자를 한 소스로 통일한다.
// - remainingSeats: 응답에서는 "실시간 잔여석"(Redis class:{id}:seats)을 뜻한다.
//   MySQL Class.remainingSeats 컬럼값(naive/pessimistic 실험용 카운터, Group C에서
//   갱신 안 됨)은 응답에서 제거한다.
// - interestCount: course_interests 테이블 행 수(순수 하트 수). Class.enrolled는
//   시드 가짜 수강생 + 하트 delta가 섞인 하이브리드라 이 용도로 못 쓴다.
// Redis 장애 시 remainingSeats만 null로 두고 200을 반환한다 — 과목 메타 조회까지 막지 않는다.
async function seatSnapshot(classIds) {
  const seats = {};
  const interests = {};
  if (classIds.length === 0) return { seats, interests };

  const [seatValues, interestRows] = await Promise.all([
    redis.mget(classIds.map(classSeatsKey)).catch((error) => {
      console.error('실시간 좌석 조회 실패 (Redis) — remainingSeats는 null로 응답:', error.message);
      return null;
    }),
    CourseInterest.findAll({
      attributes: ['class_id', [fn('COUNT', col('id')), 'count']],
      where: { class_id: classIds },
      group: ['class_id'],
      raw: true,
    }).catch((error) => {
      console.error('관심 등록 수 조회 실패:', error.message);
      return [];
    }),
  ]);

  classIds.forEach((id, index) => {
    const raw = Array.isArray(seatValues) ? seatValues[index] : null;
    seats[id] = raw === null || raw === undefined ? null : Number(raw);
  });
  interestRows.forEach((row) => {
    interests[String(row.class_id)] = Number(row.count) || 0;
  });
  return { seats, interests };
}

// Class 인스턴스 → 응답 객체. remainingSeats를 Redis 값으로 덮고 interestCount를 붙인다.
function serializeCourse(course, seats, interests) {
  const id = String(course.id);
  const plain = course.toJSON();
  delete plain.remainingSeats; // MySQL 컬럼값(stale) 제거 — 아래에서 실시간 좌석으로 대체
  return {
    ...plain,
    remainingSeats: id in seats ? seats[id] : null,
    interestCount: interests[id] ?? 0,
  };
}

exports.getCourses = async (req, res) => {
  try {
    const courses = await Class.findAll({
      include: [{ model: ClassSchedule, as: 'schedules' }],
      order: [['id', 'ASC']],
    });
    const classIds = courses.map((c) => String(c.id));
    const { seats, interests } = await seatSnapshot(classIds);
    res.status(200).json(courses.map((c) => serializeCourse(c, seats, interests)));
  } catch (error) {
    console.error('수업 목록 조회 오류:', error);
    res.status(500).json({ message: '서버 오류가 발생했습니다.' });
  }
};

exports.getCourseByCode = async (req, res) => {
  try {
    const { code } = req.params;

    const course = await Class.findOne({
      where: { code },
      include: [{ model: ClassSchedule, as: 'schedules' }],
    });

    if (!course) {
      return res.status(404).json({ message: '해당 과목 코드를 찾을 수 없습니다.' });
    }

    const { seats, interests } = await seatSnapshot([String(course.id)]);
    res.status(200).json(serializeCourse(course, seats, interests));
  } catch (error) {
    console.error('과목 단건 조회 오류:', error);
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

