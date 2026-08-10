// backend/models/Class.js
const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Class = sequelize.define(
  'Class',
  {
    id: {
      type: DataTypes.STRING,
      primaryKey: true,
      allowNull: false,
    },

    // 과목 코드 (PK와 별도, 우리가 DB에 추가한 code 컬럼)
    code: {
      type: DataTypes.STRING,
      allowNull: false,
    },

    name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    professor: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    credits: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    capacity: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    enrolled: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    department: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    courseType: {
      type: DataTypes.STRING,
      allowNull: false,
      comment: '전공 필수, 전공 선택, 교양',
    },
    demandStatus: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'NORMAL',
      comment: '수요 상태: NORMAL, NEAR, FULL 등'
    },
    // 실시간 수강신청(ADR-006) 전용 잔여좌석 카운터.
    // enrolled는 "관심 과목" 토글이 트랜잭션+락으로 관리하는 별개 필드이므로 여기서 건드리지 않는다.
    // defaultValue가 없으면 기존에 데이터가 있는 classes 테이블에 컬럼을 추가하는
    // sequelize.sync() ALTER TABLE이 MySQL strict mode에서 실패할 수 있다.
    remainingSeats: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
  },
  {
    timestamps: true,
    underscored: true, // created_at, updated_at
  }
);

module.exports = Class;
