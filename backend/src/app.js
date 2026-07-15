const express = require('express');
const cors = require('cors');
const sequelize = require('./config/database');
require('dotenv').config();
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

const PORT = 8000;

sequelize
  .sync({ force : false })
  .then(() => {
    console.log('데이터베이스 연결 및 테이블 생성 완료!');
    app.listen(PORT, () => {
      console.log(`서버 실행 중! PORT: ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('DB 연결 실패:', err);
  });

module.exports = app;
