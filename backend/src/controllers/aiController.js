// backend/src/controllers/aiController.js
const axios = require('axios');
const Class = require('../models/Class'); // 실제 수업 모델
const ClassSchedule = require('../models/ClassSchedule'); // ✅ 1. ClassSchedule 모델 추가

// 도커 환경이면 보통 http://ai-server:5000 으로 통신
const AI_SERVER_URL = process.env.AI_SERVER_URL || 'http://localhost:5000';

exports.getRecommendation = async (req, res) => {
  try {
    const { jobInterest, major } = req.body;

    if (!jobInterest ) {
      return res.status(400).json({
        message: 'jobInterest 와 major 값이 필요합니다.',
      });
    }

    // 1. DB에서 전체 강의 목록 가져오기 (스케줄 정보를 포함하여 가져옴)
    const allClasses = await Class.findAll({
      attributes: [
        'id',
        'code',
        'name',
        'professor',
        'credits',
        'capacity',
        'enrolled',
        'department',
        'courseType',
      ],
      // ✅ 2. ClassSchedule 모델을 'schedules' 별칭으로 포함 (app.js의 관계 설정과 동일)
      include: [{ model: ClassSchedule, as: 'schedules' }] 
    });

    // ✅ 3. 스케줄 정보를 기반으로 day와 time 필드를 생성하는 헬퍼 매핑 함수
    const weekdayMap = ['일', '월', '화', '수', '목', '금', '토'];

    // 4. Sequelize 객체를 순수 JSON으로 변환하고 프론트 렌더링 필드를 추가
    const courses = allClasses.map((c) => {
        const schedules = c.schedules || [];

        // day 필드 생성: 스케줄에서 요일 숫자를 문자열로 변환하고 중복 제거
        const day = Array.from(
            new Set(schedules.map((schedule) => weekdayMap[schedule.weekday]).filter(Boolean))
        );

        // time 필드 생성: 시작 시간 ~ 종료 시간을 문자열로 합침
        const time = 
            schedules.length > 0
                ? schedules
                    .map((schedule) => {
                        const start = schedule.start_time?.slice(0, 5) ?? '';
                        const end = schedule.end_time?.slice(0, 5) ?? '';
                        return end ? `${start}~${end}` : start;
                    })
                    .join(', ')
                : '시간 정보 없음';

        return {
            id: c.id,
            code: c.code,
            name: c.name,
            professor: c.professor,
            credits: c.credits,
            capacity: c.capacity,
            enrolled: c.enrolled,
            department: c.department,
            courseType: c.courseType,
            
            // ✅ 5. 프론트 렌더링에 필수적인 필드 추가
            day: day,
            time: time,
        };
    });

    // 6. Python AI 서버로 요청 보내기 (이 데이터에는 day와 time 필드가 포함됨)
    const response = await axios.post(`${AI_SERVER_URL}/recommend`, {
      major,
      job_interest: jobInterest,
      courses,
    });

    // 7. Python에서 추천 결과를 그대로 프론트로 전달
    res.status(200).json(response.data);
  } catch (error) {
    const detail = error.response?.data || error.message;
    console.error('AI 추천 에러:', detail);
    res.status(500).json({
      message: 'AI 분석 중 오류가 발생했습니다.',
      detail,
    });
  }
};