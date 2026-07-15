// 환경변수 로드 + 필수값 검증 (fail-fast)
// NODE_ENV=test면 .env.test를 읽어 개발용 .env와 테스트 환경을 분리한다.
const path = require('path');

const envFile = process.env.NODE_ENV === 'test' ? '.env.test' : '.env';
require('dotenv').config({ path: path.resolve(__dirname, '../../', envFile) });

// Docker/K8s에서는 .env 파일 없이 컨테이너 환경변수로 주입되므로
// 파일 존재 여부가 아니라 최종 process.env 기준으로 검증한다.
const REQUIRED = ['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD', 'JWT_SECRET'];
const missing = REQUIRED.filter((key) => !process.env[key]);
if (missing.length > 0) {
  throw new Error(
    `필수 환경변수가 설정되지 않았습니다: ${missing.join(', ')} — .env(.test) 파일 또는 컨테이너 환경변수를 확인하세요.`
  );
}

module.exports = {
  JWT_SECRET: process.env.JWT_SECRET,
};
