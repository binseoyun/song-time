// backend/src/controllers/aiController.js
const axios = require('axios');
const Class = require('../models/Class'); // 실제 수업 모델
const ClassSchedule = require('../models/ClassSchedule'); // ✅ 1. ClassSchedule 모델 추가

// 도커 환경이면 보통 http://ai-server:5000 으로 통신
const AI_SERVER_URL = process.env.AI_SERVER_URL || 'http://localhost:5000';

// AI 챗봇 프록시(ADR-010 §3/§11) — Node은 authMiddleware로 인증만 하고, 실제 대화
// 상태(Redis/MySQL)와 Tool 호출 루프는 전부 ai-server가 직접 소유·처리한다.
// req.user.id를 x-user-id 신뢰 헤더에 실어 그대로 전달한다 — ai-server 포트가
// 외부에 노출되지 않는다는 전제(§11) 하에 이 헤더를 신뢰할 수 있다.
//
// 응답은 SSE 스트림(Stage 2-1). Node는 ai-server의 스트림을 버퍼링 없이 그대로
// 흘려보낸다 — axios responseType:'stream'으로 청크를 받는 즉시 res로 pipe한다.
// nginx `proxy_buffering off`만으로는 부족하고 이 구간(Node↔ai-server, Node↔클라)도
// 버퍼링하지 않아야 타이핑되듯 답이 나온다(§11).
exports.chat = async (req, res) => {
  try {
    const upstream = await axios.post(`${AI_SERVER_URL}/api/ai/chat`, req.body, {
      headers: { 'x-user-id': String(req.user.id), Accept: 'text/event-stream' },
      responseType: 'stream',
    });

    res.status(200);
    res.set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();

    // 클라이언트가 끊으면 상류 스트림도 즉시 닫아 Gemini 토큰 낭비를 막는다.
    req.on('close', () => upstream.data.destroy());

    upstream.data.pipe(res);
    upstream.data.on('error', () => res.end());
  } catch (error) {
    // 스트림 시작 전(연결 실패·4xx/5xx) 에러만 여기로 온다 — 아직 헤더를 안 보냈다.
    let detail = error.message;
    if (error.response?.data && typeof error.response.data.pipe === 'function') {
      detail = await streamToString(error.response.data).catch(() => error.message);
    } else if (error.response?.data) {
      detail = error.response.data;
    }
    const status = error.response?.status || 500;

    // ai-server의 rate limit(§15, #108) 429는 사용자에게 그대로 전달한다 — ai-server가
    // FastAPI HTTPException으로 {"detail": "...초 후에..."} + Retry-After를 준다.
    if (status === 429) {
      let userMessage = '메시지를 너무 자주 보냈어요. 잠시 후 다시 시도해 주세요.';
      try {
        const parsed = typeof detail === 'string' ? JSON.parse(detail) : detail;
        if (parsed?.detail) userMessage = parsed.detail;
      } catch (_) { /* 파싱 실패 시 기본 문구 */ }
      const retryAfter = error.response?.headers?.['retry-after'];
      if (retryAfter) res.set('Retry-After', retryAfter);
      return res.status(429).json({ message: userMessage });
    }

    console.error('AI 챗봇 통신 에러:', detail);
    res.status(status).json({
      message: 'AI 챗봇과 통신 중 오류가 발생했습니다.',
      detail,
    });
  }
};

// axios가 responseType:'stream'일 때는 에러 응답 본문도 스트림이라 문자열로 모은다.
function streamToString(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', (c) => chunks.push(Buffer.from(c)));
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    stream.on('error', reject);
  });
}

exports.getSessions = async (req, res) => {
  try {
    const response = await axios.get(`${AI_SERVER_URL}/api/ai/sessions`, {
      headers: { 'x-user-id': String(req.user.id) },
    });
    res.status(200).json(response.data);
  } catch (error) {
    const detail = error.response?.data || error.message;
    console.error('AI 챗봇 세션 목록 조회 에러:', detail);
    res.status(error.response?.status || 500).json({
      message: '세션 목록을 불러오는 중 오류가 발생했습니다.',
      detail,
    });
  }
};

exports.getSessionMessages = async (req, res) => {
  try {
    const { id } = req.params;
    const response = await axios.get(`${AI_SERVER_URL}/api/ai/sessions/${id}/messages`, {
      headers: { 'x-user-id': String(req.user.id) },
    });
    res.status(200).json(response.data);
  } catch (error) {
    const detail = error.response?.data || error.message;
    console.error('AI 챗봇 세션 메시지 조회 에러:', detail);
    res.status(error.response?.status || 500).json({
      message: '대화 기록을 불러오는 중 오류가 발생했습니다.',
      detail,
    });
  }
};

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