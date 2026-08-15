// Group C(Redis 원자적 연산)용 ioredis 클라이언트.
// backend(API 서버)와 worker.js가 함께 쓴다.
const path = require('path');
const fs = require('fs');
const Redis = require('ioredis');

const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: Number(process.env.REDIS_PORT) || 6379,
  // 재시도 폭주로 애플리케이션이 응답 못 하는 상태에 빠지지 않도록 상한을 둔다.
  maxRetriesPerRequest: 3,
});

redis.on('error', (err) => {
  console.error('Redis 연결 오류:', err.message);
});

// 두 Lua 스크립트를 ioredis 커스텀 커맨드로 등록 — redis.registerAtomic(...), redis.cancelAtomic(...)로 호출.
// EVALSHA 캐싱은 ioredis가 내부적으로 처리한다(스크립트를 매번 새로 보내지 않음).
function loadLua(filename) {
  return fs.readFileSync(path.join(__dirname, '../lua', filename), 'utf8');
}

redis.defineCommand('registerAtomic', {
  numberOfKeys: 4,
  lua: loadLua('registerAtomic.lua'),
});

redis.defineCommand('cancelAtomic', {
  numberOfKeys: 4,
  lua: loadLua('cancelAtomic.lua'),
});

module.exports = redis;
