// backend/src/controllers/aiController.js
const axios = require('axios');

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
