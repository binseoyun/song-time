const { Op } = require('sequelize');
const Class = require('../models/Class');
const CourseInterest = require('../models/CourseInterest');

const DEMAND_STATUS = {
  NORMAL: 'NORMAL',
  NEAR: 'NEAR',
  FULL: 'FULL',
};

const computeStatus = (interestCount, capacity) => {
  if (!capacity || capacity <= 0) {
    return DEMAND_STATUS.NORMAL;
  }

  if (interestCount >= capacity) {
    return DEMAND_STATUS.FULL;
  }

  const ratio = interestCount / capacity;
  if (ratio >= 0.9) {
    return DEMAND_STATUS.NEAR;
  }

  return DEMAND_STATUS.NORMAL;
};

exports.aggregateDemand = async (req, res) => {
  try {
    const classes = await Class.findAll({
      attributes: ['id', 'capacity'],
      order: [['id', 'ASC']],
    });

    const summaries = [];

    for (const klass of classes) {
      const interestCount = await CourseInterest.count({
        where: { class_id: klass.id },
      });

      const demandStatus = computeStatus(interestCount, klass.capacity);
      await klass.update({
        enrolled: interestCount,
        demandStatus,
      });

      summaries.push({
        classId: klass.id,
        interestCount,
        capacity: klass.capacity,
        demandStatus,
      });
    }

    res.status(200).json({
      updated: summaries.length,
      summaries,
    });
  } catch (error) {
    console.error('수요 집계 오류:', error);
    res.status(500).json({ message: '수요를 집계하는 중 오류가 발생했습니다.' });
  }
};

exports.getDemandAlerts = async (req, res) => {
  try {
    const alerts = await Class.findAll({
      where: {
        demandStatus: {
          [Op.in]: [DEMAND_STATUS.NEAR, DEMAND_STATUS.FULL],
        },
      },
      order: [['updated_at', 'DESC']],
    });

    res.status(200).json(alerts);
  } catch (error) {
    console.error('수요 알림 조회 오류:', error);
    res.status(500).json({ message: '수요 알림을 불러오는 중 오류가 발생했습니다.' });
  }
};


