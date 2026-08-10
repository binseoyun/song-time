// 실시간 수강신청 내역 테이블. 
// 정원 확인은 Class.remainingSeats 카운터로 하고, 이 테이블은 "누가 신청했는지"의
// 근거(중복 신청 판정, 취소, 목록 조회)로만 쓴다.
const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Registration = sequelize.define('Registration', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  user_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  class_id: {
    type: DataTypes.STRING,
    allowNull: false,
  },
}, {
  tableName: 'registrations',
  timestamps: true,
  underscored: true,
  indexes: [
    {
      unique: true,
      fields: ['user_id', 'class_id'],
    },
  ],
});

module.exports = Registration;
