// 실시간 수강신청(ADR-006) 비즈니스 로직. 
// 순수 데이터를 받아 순수 데이터를 반환하거나 RegistrationError를 던진다.
// doc/experiment/01-수강신청-동시성-naive-vs-개선-실험계획.md 의 Group A/B 구현체.
const sequelize = require('../config/database');
const Class = require('../models/Class');
const Registration = require('../models/Registration');

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

module.exports = { registerNaive, registerPessimistic, RegistrationError };
