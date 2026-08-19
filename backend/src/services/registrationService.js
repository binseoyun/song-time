// 실시간 수강신청(ADR-006) 비즈니스 로직.
// 순수 데이터를 받아 순수 데이터를 반환하거나 RegistrationError를 던진다.
// doc/experiment/01-수강신청-동시성-naive-vs-개선-실험계획.md 의 Group A/B 구현체.
const sequelize = require('../config/database');
const Class = require('../models/Class');
const Registration = require('../models/Registration');
const redis = require('../config/redis');
const { publishToQueue, QUEUE_MAIN } = require('../config/rabbitmq');
const { classSeatsKey, classSlotsKey, userRegisteredKey, userSlotsKey } = require('../utils/redisKeys');

class RegistrationError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code; // 'NOT_FOUND' | 'DUPLICATE' | 'FULL'
  }
}

// Group A: 무방비(No Lock).
// 반드시 "현재 값을 애플리케이션 메모리로 읽어 계산한 새 값을 블라인드 UPDATE"해야
// 레이스가 재현된다. Sequelize의 .decrement()는 SQL 레벨에서 원자적이라 쓰지 않는다.
async function registerNaive({ userId, classId }) {
  const course = await Class.findByPk(classId);
  if (!course) {
    throw new RegistrationError('NOT_FOUND', '해당 과목을 찾을 수 없습니다.');
  }

  const existing = await Registration.findOne({
    where: { user_id: userId, class_id: classId },
  });
  if (existing) {
    throw new RegistrationError('DUPLICATE', '이미 신청한 과목입니다.');
  }

  const currentSeats = course.remainingSeats;
  if (currentSeats <= 0) {
    throw new RegistrationError('FULL', '정원이 초과되었습니다.');
  }

  await Class.update(
    { remainingSeats: currentSeats - 1 },
    { where: { id: classId } }
  );

  try {
    const registration = await Registration.create({ user_id: userId, class_id: classId });
    return { id: registration.id, classId: registration.class_id };
  } catch (error) {
    // 같은 유저가 동시에 두 번 요청하면 위의 findOne 중복 체크도 레이스를 피할 수 없어
    // DB 유니크 제약에서 막힐 수 있다 (Group A는 의도적으로 이 지점까지 보호하지 않는다).
    // 다만 이미 좌석은 차감된 뒤이므로, 원인 불명 500 대신 명확한 DUPLICATE로 응답한다 —
    // 실험의 "에러율" 지표가 이런 사용자 실수성 충돌로 오염되지 않게 하기 위함.
    if (error.name === 'SequelizeUniqueConstraintError') {
      throw new RegistrationError('DUPLICATE', '이미 신청한 과목입니다.');
    }
    throw error;
  }
}

// Group B: 비관적 락(Pessimistic Lock). SELECT ... FOR UPDATE로 과목 행을 잠근다.
async function registerPessimistic({ userId, classId }) {
  let result;

  await sequelize.transaction(async (t) => {
    const course = await Class.findByPk(classId, {
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    if (!course) {
      throw new RegistrationError('NOT_FOUND', '해당 과목을 찾을 수 없습니다.');
    }

    const existing = await Registration.findOne({
      where: { user_id: userId, class_id: classId },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    if (existing) {
      throw new RegistrationError('DUPLICATE', '이미 신청한 과목입니다.');
    }

    if (course.remainingSeats <= 0) {
      throw new RegistrationError('FULL', '정원이 초과되었습니다.');
    }

    await course.decrement('remainingSeats', {
      by: 1,
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    const registration = await Registration.create(
      { user_id: userId, class_id: classId },
      { transaction: t }
    );
    result = { id: registration.id, classId: registration.class_id };
  });

  return result;
}

// Group C: Redis 원자적 연산(DECR + Lua Script) + RabbitMQ 비동기 영속화.
// doc/experiment/01-수강신청-동시성-naive-vs-개선-실험계획.md 5장,
// doc/portfolio/01-group-c-redis-설계-결정.md 참고.
const REDIS_ATOMIC_RESULT = {
  DUPLICATE: -1,
  OVERLAP: -2,
  FULL: -3,
  NOT_FOUND: -4,
};

async function registerRedisAtomic({ userId, classId }) {
  const [code] = await redis.registerAtomic(
    classSeatsKey(classId),
    classSlotsKey(classId),
    userRegisteredKey(userId),
    userSlotsKey(userId),
    classId
  );

  if (code === REDIS_ATOMIC_RESULT.DUPLICATE) {
    throw new RegistrationError('DUPLICATE', '이미 신청한 과목입니다.');
  }
  if (code === REDIS_ATOMIC_RESULT.OVERLAP) {
    throw new RegistrationError('OVERLAP', '기존 신청 과목과 시간표가 겹칩니다.');
  }
  if (code === REDIS_ATOMIC_RESULT.FULL) {
    throw new RegistrationError('FULL', '정원이 초과되었습니다.');
  }
  if (code === REDIS_ATOMIC_RESULT.NOT_FOUND) {
    // Redis에 좌석 카운터 자체가 없는 경우 — 시딩 누락 또는 잘못된 classId.
    // Group A/B가 과목을 못 찾으면 404를 주는 것과 계약을 맞춘다.
    throw new RegistrationError('NOT_FOUND', '해당 과목을 찾을 수 없습니다.');
  }

  // 응답 시점 결정(즉시 응답): Redis 판정이 곧 API의 성공 판정이다. 이 발행이
  // 실패해도(네트워크 순간 장애 등) 클라이언트에게는 이미 성공으로 응답한 뒤이므로
  // 여기서 실패해도 요청 자체를 실패로 되돌리지 않는다 — Ghost Decrement를 감수하는
  // 대신 얻는 응답 속도가 이 설계의 핵심이다(위 문서 2장).
  publishToQueue(QUEUE_MAIN, {
    userId,
    classId,
    publishedAt: Date.now(),
    attempts: 0,
  }).catch((error) => {
    console.error('RabbitMQ 발행 실패 (Ghost Decrement 위험):', { userId, classId, error: error.message });
  });

  return { classId };
}

// 취소(Drop)는 Redis를 먼저 확인/반환하고 MySQL 삭제를 그다음에 시도한다.
// (doc/troubleshooting/02-취소-후-재신청-DUPLICATE-오탐.md 에서 원래는 MySQL을
// 먼저 지웠으나, 등록이 RabbitMQ로 "비동기" 반영되는 것과 충돌해 재현되는 버그였다:
// 등록 직후 곧바로 취소하면 워커가 아직 MySQL에 반영하기 전이라 destroy()가 0건을
// 지우고 NOT_FOUND로 끝나버려 Redis 쪽(user:{userId}:registered)이 전혀 안 풀리고,
// 다음 재신청이 registerAtomic.lua의 SISMEMBER에 걸려 "이미 신청한 과목입니다"로
// 오탐하는 원인이었다. Redis가 register/cancel 양쪽 모두에서 "지금 신청 중인가"의
// 유일한 실시간 판정 기준이 되도록 순서를 맞춘다.
//
// 이 순서에서 남는 위험은 "Redis는 풀렸는데 MySQL 삭제가 실패/지연"이다 — 이 경우
// worker.js의 persist()가 INSERT 직전 Redis를 다시 확인해 이미 취소된 신청이면
// 스킵하므로, 취소가 등록 메시지 처리보다 먼저/나중이어도 MySQL에 취소된 신청이
// 고아 행으로 남지 않는다. MySQL 삭제 자체가 실패하는 나머지 경우(연결 장애 등)는
// 로그로만 남긴다 — Redis가 이미 "취소됨"으로 확정했으므로 사용자에게는 성공으로
// 응답하는 것이 실사용 관점에서 맞다(관측 가능한 손실은 DB 정합성 배치/모니터링으로
// 다룰 문제이지, 사용자 응답을 막을 이유는 아니다).
async function cancelRedisAtomic({ userId, classId }) {
  const [code] = await redis.cancelAtomic(
    classSeatsKey(classId),
    classSlotsKey(classId),
    userRegisteredKey(userId),
    userSlotsKey(userId),
    classId
  );

  if (code === -1) {
    throw new RegistrationError('NOT_FOUND', '신청 내역이 없습니다.');
  }

  try {
    const deletedCount = await Registration.destroy({ where: { user_id: userId, class_id: classId } });
    if (deletedCount === 0) {
      console.warn('MySQL에 아직 반영되지 않은 신청을 취소함 (워커가 나중에 반영을 스킵함):', { userId, classId });
    }
  } catch (error) {
    console.error('MySQL 취소 반영 실패 (Redis는 이미 취소됨):', { userId, classId, error: error.message });
  }

  return { classId };
}

// 개설과목조회 화면의 "여석" 표시용. MySQL Class.enrolled는 Group C 경로에서
// 아예 건드리지 않으므로(doc/portfolio/01-group-c-redis-설계-결정.md 2장), Group C로
// 등록/취소해도 절대 바뀌지 않는다 — 실시간 좌석의 유일한 진실은 Redis
// class:{classId}:seats이므로 화면도 여기서 읽어야 한다.
async function getSeatCounts(classIds) {
  if (!Array.isArray(classIds) || classIds.length === 0) return {};
  const values = await redis.mget(classIds.map(classSeatsKey));
  const result = {};
  classIds.forEach((classId, index) => {
    const value = values[index];
    result[classId] = value === null ? null : Number(value);
  });
  return result;
}

// 내 수강신청 내역 조회(이슈 #54 — "실시간 수강신청 연습" UI가 필요로 함).
// Registration 모델 주석에 "목록 조회"가 원래 용도로 명시돼 있었는데 지금까지
// 엔드포인트가 없었다. 좌석 카운터(Redis)는 안 건드리는 순수 조회라 그룹 구분 없이
// 공통으로 쓴다.
async function listMyRegistrations(userId) {
  const registrations = await Registration.findAll({
    where: { user_id: userId },
    include: [{ model: Class, attributes: ['id', 'code', 'name', 'professor', 'credits', 'courseType'], include: ['schedules'] }],
    order: [['createdAt', 'ASC']],
  });

  return registrations.map((registration) => {
    const course = registration.Class;
    return {
      classId: registration.class_id,
      registeredAt: registration.createdAt,
      course: course
        ? {
            id: course.id,
            code: course.code,
            name: course.name,
            professor: course.professor,
            credits: course.credits,
            courseType: course.courseType,
            schedules: Array.isArray(course.schedules) ? course.schedules : [],
          }
        : null,
    };
  });
}

module.exports = {
  registerNaive,
  registerPessimistic,
  registerRedisAtomic,
  cancelRedisAtomic,
  listMyRegistrations,
  getSeatCounts,
  RegistrationError,
};
