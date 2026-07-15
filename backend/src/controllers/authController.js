//회원가입과 로그인 구현
const User = require('../models/User');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

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
        const token = jwt.sign({ id: newUser.id }, process.env.JWT_SECRET || 'secret', { expiresIn: '1h' });
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
          const token = jwt.sign({ id:user.id}, process.env.JWT_SECRET, { expiresIn: '1h'});
              
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

    //3. 로그아웃 controller
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