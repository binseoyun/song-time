const { DataTypes } = require('sequelize');
// 나중에 config/database.js에서 만든 sequelize 객체를 가져와야 합니다.
const sequelize = require('../config/database'); 

const User = sequelize.define('User', {
  // 여기가 바로 "사용자의 형태"를 정의하는 곳입니다.
  studentId: { 
    type: DataTypes.STRING,
    allowNull: false,
    unique: true
  },
  password: {
    type: DataTypes.STRING,
    allowNull: false
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false
  },
  major: {
    type: DataTypes.STRING,
    allowNull: false
  }
});

module.exports = User;