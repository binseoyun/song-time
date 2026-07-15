const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Timetable = sequelize.define(
  'Timetable',
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    user_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    courses: {
      type: DataTypes.JSON,
      allowNull: false,
    },
  },
  {
    tableName: 'timetables',
    timestamps: true,
    underscored: true,
  }
);

module.exports = Timetable;


