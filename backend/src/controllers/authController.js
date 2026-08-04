//회원가입과 로그인 구현
const User = require('../models/User');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../config/env');

const sequelize = require('../config/database');
const Class = require('../models/Class');
const CourseInterest = require('../models/CourseInterest');

//1. 회원가입 controller
exports.register = async (req, res) => {
    try{
        const{  name, major,studentId,password} = req.body;
        //이미 존재하는 학생ID인지 확인
        const existingUser = await User.findOne({ where: { studentId } });
        if(existingUser){
            return res.status(400).json({ message: '이미 존재하는 학생ID입니다.'});
        }

        //비밀번호 암호화
        const hashedPassword = await bcrypt.hash(password, 12);

        //새로운 사용자 생성
        const newUser= await User.create({
            studentId,
            password: hashedPassword,
            name,
            major
        });
        // 3. 회원가입 성공 시 바로 토큰 발급! 
        const token = jwt.sign({ id: newUser.id }, JWT_SECRET, { expiresIn: '1h' });
        res.status(201).json({
            message: '회원가입이 완료되었습니다.',
            token,
            user: {
                name: newUser.name,
                studentId: newUser.studentId,
                department: newUser.major,
            },
        });
    } catch (error){
        console.error('회원가입 오류:', error);
        res.status(500).json({ message: '서버 오류가 발생했습니다.'});

    }
    };
    

    //2. 로그인 controller
exports.login = async (req, res) => {
    try{
        const{studentId, password} = req.body;
        //유저 찾기
        const user = await User.findOne({ where: { studentId } });
        if(!user){
            return res.status(400).json({ message: '존재하지 않는 학번입니다.'});
        }
        //비밀번호 확인
        const isMatch = await bcrypt.compare(password, user.password);
        if(!isMatch){
            return res.status(400).json({ message: '비밀번호가 올바르지 않습니다.'});
        }

           //JWT 생성
           //유저 DB ID인 user.id를 토큰에 담아줌
          const token = jwt.sign({ id:user.id}, JWT_SECRET, { expiresIn: '1h'});
              
              res.status(200).json({
                message: '로그인 성공',
                token,
                user: {
                  name: user.name,
                  studentId: user.studentId,
                  department: user.major,
                },
              });
        } catch (error){
            console.error('로그인 오류:', error);
            res.status(500).json({ message: '서버 오류가 발생했습니다.'});
        }
    };

    //3. 비밀번호 재설정 controller (학번+이름으로 본인확인 후 새 비밀번호로 교체)
exports.resetPassword = async (req, res) => {
    try {
        const { studentId, name, newPassword } = req.body;

        if (!studentId || !name || !newPassword) {
            return res.status(400).json({ message: '학번, 이름, 새 비밀번호를 모두 입력해주세요.' });
        }

        // 학번과 이름이 동시에 일치하는 사용자만 찾음 — 어느 쪽이 틀렸는지는 알려주지 않음(계정 존재 여부 유추 방지)
        const user = await User.findOne({ where: { studentId, name } });
        if (!user) {
            return res.status(400).json({ message: '학번 또는 이름이 일치하지 않습니다.' });
        }

        const hashedPassword = await bcrypt.hash(newPassword, 12);
        user.password = hashedPassword;
        await user.save();

        res.status(200).json({ message: '비밀번호가 재설정되었습니다. 새 비밀번호로 로그인해주세요.' });
    } catch (error) {
        console.error('비밀번호 재설정 오류:', error);
        res.status(500).json({ message: '서버 오류가 발생했습니다.' });
    }
};

    //4. 회원 탈퇴 controller
exports.deleteAccount = async (req, res) => {
    try {
        const userId = req.user?.id;
        const { password } = req.body;

        if (!userId) {
            return res.status(401).json({ message: '인증이 필요합니다.' });
        }
        if (!password) {
            return res.status(400).json({ message: '비밀번호를 입력해주세요.' });
        }

        const user = await User.findByPk(userId);
        if (!user) {
            return res.status(404).json({ message: '사용자 정보를 찾을 수 없습니다.' });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(400).json({ message: '비밀번호가 올바르지 않습니다.' });
        }

        await sequelize.transaction(async (t) => {
            // 탈퇴 전, 이 유저가 관심 등록해둔 과목들의 enrolled 카운터를 먼저 되돌려놓는다.
            // Users 행을 바로 지우면 course_interests는 ON DELETE CASCADE로 같이 지워지지만,
            // 그건 DB 레벨 삭제라 courseController.toggleInterest의 enrolled 증감 로직을 안 거친다 —
            // 그대로 두면 탈퇴한 유저의 관심 카운트가 Class.enrolled에 유령처럼 남는다.
            const interests = await CourseInterest.findAll({
                where: { user_id: userId },
                transaction: t,
                lock: t.LOCK.UPDATE,
            });

            for (const interest of interests) {
                await Class.decrement('enrolled', {
                    by: 1,
                    where: { id: interest.class_id },
                    transaction: t,
                    lock: t.LOCK.UPDATE,
                });
            }

            // Users 행 삭제 — course_interests, timetables는 ON DELETE CASCADE로 함께 정리됨
            await user.destroy({ transaction: t });
        });

        res.status(200).json({ message: '회원 탈퇴가 완료되었습니다.' });
    } catch (error) {
        console.error('회원 탈퇴 오류:', error);
        res.status(500).json({ message: '서버 오류가 발생했습니다.' });
    }
};

    //5. 로그아웃 controller
    exports.logout = async (req, res) => {
        try {
            // 클라이언트 측에서 토큰을 삭제하도록 안내
            res.status(200).json({ message: '로그아웃 성공' });
        } catch (error) {
            console.error('로그아웃 오류:', error);
            res.status(500).json({ message: '서버 오류가 발생했습니다.' });
        }

    };

//3.mypage
exports.getUserInfo = async (req, res) => {
    try {
        // authMiddleware가 토큰을 검증하고 req.user.id에 사용자 ID를 넣어줬다고 가정
        const userId = req.user.id; 

        const user = await User.findOne({ 
            where: { id: userId }, 
            attributes: ['id', 'name', 'studentId', 'major'] 
        }); 

        if (!user) {
            return res.status(404).json({ message: '사용자 정보를 찾을 수 없습니다.' });
        }

        res.status(200).json({
            status: 'success',
            name: user.name,
            studentId: user.studentId,
            department: user.major
        });
    } catch (error) {
        console.error('사용자 정보 조회 오류:', error);
        res.status(500).json({ message: '서버 오류가 발생했습니다.' });
    }
};