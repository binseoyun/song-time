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
    }
  },
  {
    timestamps: true,
    underscored: true, // created_at, updated_at
  }
);

module.exports = Class;
