//sequelize가 MySQL에 접속할 수 있도록 설정해주는 파일

const { Sequelize } = require('sequelize');
require('dotenv').config(); // 환경변수(.env) 불러오기

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
    logging: false      // 콘솔에 SQL 로그 너무 많이 뜨는 것 방지
  }
);

module.exports = sequelize;