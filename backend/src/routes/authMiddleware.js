// authMiddleware.js - JWT 토큰을 검증하고 사용자 ID를 req.user에 삽입하는 미들웨어
const jwt = require('jsonwebtoken');

module.exports = (req, res, next) => {
    // 1. Authorization 헤더에서 토큰을 가져옵니다.
    const authHeader = req.get('Authorization');
    if (!authHeader) {
        // 토큰이 없으면 401 Unauthorized 에러 반환
        return res.status(401).json({ message: '인증 토큰이 누락되었습니다.' });
    }
    
    // 2. 토큰 문자열(Bearer XXXX)에서 XXXX만 추출
    const token = authHeader.split(' ')[1];
    let decodedToken;

    try {
        // 3. 토큰을 해독하고 유효성 검사 (시크릿 키 사용)
        decodedToken = jwt.verify(token, process.env.JWT_SECRET);
        
        if (!decodedToken) {
            return res.status(401).json({ message: '토큰이 유효하지 않습니다.' });
        }
        
        // 4. 추출된 사용자 ID(user.id)를 req 객체에 저장
        req.user = { id: decodedToken.id }; 
        
        // 5. 다음 컨트롤러 함수로 요청을 전달
        next(); 
        
    } catch (err) {
        // 해독 실패 또는 토큰 만료 시
        return res.status(401).json({ message: '토큰 인증 실패 또는 만료되었습니다.' });
    }
};