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

// 취소(Drop)는 동기 처리: MySQL 삭제를 먼저 하고 Redis 반환을 그 다음에 한다.
// 순서를 반대로(Redis 먼저) 하면, MySQL 삭제가 실패했을 때 "Redis는 좌석이 빈 걸로
// 보여 다른 학생이 새로 신청할 수 있는데 MySQL엔 원래 학생이 여전히 등록된" 이중
// 등록(Ghost Increment)이 생긴다. 지금 순서라면 실패해도 "좌석 하나가 잠겨서 안 풀리는"
// 정도로 그친다 — Ghost Decrement와 같은 성격의, 더 안전한 실패 방향이다.
async function cancelRedisAtomic({ userId, classId }) {
  const deletedCount = await Registration.destroy({ where: { user_id: userId, class_id: classId } });
  if (deletedCount === 0) {
    throw new RegistrationError('NOT_FOUND', '신청 내역이 없습니다.');
  }

  // DB 삭제가 이미 커밋된 뒤이므로, 여기서부터는 "취소 자체는 성공"으로 취급한다.
  // Redis 쪽 반환이 코드상 실패(-1)든 예외(연결 장애 등)든, 사용자에게 되돌릴 수
  // 없는 DB 상태를 놓고 실패 응답을 주면 안 된다 — 대신 좌석이 잠긴 채로 남는
  // 것으로 그친다(Ghost Decrement와 같은 성격의, 관측 가능한 손실).
  try {
    const [code] = await redis.cancelAtomic(
      classSeatsKey(classId),
      classSlotsKey(classId),
      userRegisteredKey(userId),
      userSlotsKey(userId),
      classId
    );
    if (code === -1) {
      console.warn('Redis에 신청 내역이 없어 좌석 반환을 건너뜀 (DB만 삭제됨):', { userId, classId });
    }
  } catch (error) {
    console.error('Redis 좌석 반환 실패 (좌석이 잠긴 채로 남을 수 있음, DB 취소는 이미 완료됨):', {
      userId,
      classId,
      error: error.message,
    });
  }

  return { classId };
}

module.exports = {
  registerNaive,
  registerPessimistic,
  registerRedisAtomic,
  cancelRedisAtomic,
  RegistrationError,
};
