const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const ClassSchedule = sequelize.define('ClassSchedule', {
  class_id: {
    type: DataTypes.STRING,
    primaryKey: true,
    allowNull: false,
    references: {
      model: 'classes',
      key: 'id'
    }
  },
  weekday: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    allowNull: false
    //comment: '0=일,1=월,...6=토'
  },
  start_time: {
    type: DataTypes.TIME,
    allowNull: false
  },
  end_time: {
    type: DataTypes.TIME,
    allowNull: true
  },
  duration_minutes: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: '수업 길이 (분)'
  },
  location: {
    type: DataTypes.STRING,
    allowNull: true
  }
}, {
  underscored: true,
  timestamps: false,
  tableName: 'class_schedules'
});

module.exports = ClassSchedule;
