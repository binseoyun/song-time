// Express 앱 정의 (라우팅/미들웨어/모델 관계).
// 서버 기동(리스닝, DB sync)은 server.js가 담당 — supertest가 앱만 import해서 테스트할 수 있게 분리.
const express = require('express');
const cors = require('cors');
const sequelize = require('./config/database');
const User = require('./models/User');
const Class = require('./models/Class');
const ClassSchedule = require('./models/ClassSchedule');
const CourseInterest = require('./models/CourseInterest');
const Timetable = require('./models/Timetable');
const authRoutes = require('./routes/authRoutes');
const aiRoutes = require('./routes/aiRoutes');
const courseRoutes = require('./routes/courseRoutes');
const timetableRoutes = require('./routes/timetableRoutes');

const app = express();

// 간단한 루트 헬스 체크: livenessProbe가 404로 죽지 않도록 200을 보장한다.
app.get('/', (req, res) => {
  res.status(200).json({ status: 'ok', message: 'backend alive' });
});

app.get('/health', async (req, res) => {
  try {
    await sequelize.authenticate();
    res.status(200).json({ status: 'ok' });
  } catch (error) {
    console.error('Health check failed:', error);
    res.status(500).json({ status: 'error', message: 'Database connection failed' });
  }
});

const allowedOrigins = ['http://127.0.0.1:3000'];
app.use(cors({ origin: allowedOrigins }));
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/courses', courseRoutes);
app.use('/api/timetables', timetableRoutes);

Class.hasMany(ClassSchedule, { foreignKey: 'class_id', as: 'schedules' });
ClassSchedule.belongsTo(Class, { foreignKey: 'class_id' });

User.belongsToMany(Class, {
  through: CourseInterest,
  foreignKey: 'user_id',
  otherKey: 'class_id',
  as: 'interestedClasses',
});
Class.belongsToMany(User, {
  through: CourseInterest,
  foreignKey: 'class_id',
  otherKey: 'user_id',
  as: 'interestedUsers',
});
CourseInterest.belongsTo(User, { foreignKey: 'user_id' });
CourseInterest.belongsTo(Class, { foreignKey: 'class_id' });
User.hasMany(Timetable, { foreignKey: 'user_id', as: 'timetables' });
Timetable.belongsTo(User, { foreignKey: 'user_id' });

app.use((req, res) => {
  console.log(`[404] Not Found: ${req.url}`);
  res.status(404).json({ message: `페이지를 찾을 수 없습니다: ${req.url}` });
});

module.exports = app;
