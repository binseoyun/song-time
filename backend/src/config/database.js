//sequelize가 MySQL에 접속할 수 있도록 설정해주는 파일

const { Sequelize } = require('sequelize');
require('./env'); // 환경변수 로드 + 필수값 검증

// new Sequelize('DB이름', '유저명', '비밀번호', { 옵션 })
const sequelize = new Sequelize(
  process.env.DB_NAME,
  process.env.DB_USER,
  process.env.DB_PASSWORD,
  {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 3306,
    dialect: 'mysql',
    timezone: '+09:00', // 한국 시간 설정
    logging: false,     // 콘솔에 SQL 로그 너무 많이 뜨는 것 방지
    // 실시간 수강신청 실험(doc/experiment/01)에서 Group B(비관적 락)의 붕괴 지점을
    // 재현 가능하게 만들기 위해 커넥션 풀 크기를 암묵적 기본값에 맡기지 않고 명시한다.
    // acquire는 server.js의 SERVER_TIMEOUT_MS와 같은 값으로 맞춘다 — 서로 다르면
    // HTTP 응답은 서버 타임아웃으로 끊기는데 Sequelize 내부는 그보다 훨씬 오래(기본 60초)
    // 커넥션 획득을 계속 시도하며 스레드를 붙들고 있게 된다.
    pool: {
      max: Number(process.env.DB_POOL_MAX) || 5,
      min: 0,
      idle: 10000,
      acquire: Number(process.env.SERVER_TIMEOUT_MS) || 10000,
    },
  }
);

module.exports = sequelize;