// 서버 기동 엔트리포인트. 환경변수 검증(fail-fast) → DB sync → 리스닝.
require('./config/env');
const app = require('./app');
const sequelize = require('./config/database');

const PORT = Number(process.env.PORT) || 8000;

sequelize
  .sync({ force: false })
  .then(() => {
    console.log('데이터베이스 연결 및 테이블 생성 완료!');
    app.listen(PORT, () => {
      console.log(`서버 실행 중! PORT: ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('DB 연결 실패:', err);
    process.exit(1);
  });
