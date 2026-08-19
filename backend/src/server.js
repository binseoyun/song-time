// 서버 기동 엔트리포인트. 환경변수 검증(fail-fast) → DB sync → 리스닝.
require('./config/env');
const app = require('./app');
const sequelize = require('./config/database');
const { startPromotionScheduler } = require('./services/queueService');

const PORT = Number(process.env.PORT) || 8000;

// 실시간 수강신청 실험(doc/experiment/01 4장)에서 k6 클라이언트 타임아웃과
// 동일하게 맞추기 위해 서버 타임아웃을 암묵적 기본값에 맡기지 않고 명시한다.
const SERVER_TIMEOUT_MS = Number(process.env.SERVER_TIMEOUT_MS) || 10000;

sequelize
  .sync({ force: false })
  .then(() => {
    console.log('데이터베이스 연결 및 테이블 생성 완료!');
    const server = app.listen(PORT, () => {
      console.log(`서버 실행 중! PORT: ${PORT}`);
    });
    server.timeout = SERVER_TIMEOUT_MS;
    startPromotionScheduler();
  })
  .catch((err) => {
    console.error('DB 연결 실패:', err);
    process.exit(1);
  });
