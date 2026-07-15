const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const CourseInterest = sequelize.define('CourseInterest', {
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
  tableName: 'course_interests',
  timestamps: true,
  underscored: true,
  indexes: [
    {
      unique: true,
      fields: ['user_id', 'class_id'],
    },
  ],
});

module.exports = CourseInterest;

