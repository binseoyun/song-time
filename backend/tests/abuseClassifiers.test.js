// loadtest/scripts/abuseClassifiers.js(k6 어뷰징 시나리오의 판정 로직)를 검증한다.
// k6 부하테스트로만 이 로직을 확인하면 재현에 몇 분씩 걸리고 VUS 규모에 따라 결과가
// 달라져서, 판정 로직 자체는 이렇게 결정적인 단위 테스트로 고정해둔다(구현계획 Stage
// 1-7, 이슈 #29 — 실제로 이 로직에 버그가 두 번 있었고 전부 k6 실측 도중 발견됐다).
const {
  classifyMacroBatch,
  classifyOverlapAttempt,
  DUPLICATE_MESSAGE,
  OVERLAP_MESSAGE,
  FULL_MESSAGE,
} = require('../../loadtest/scripts/abuseClassifiers');

describe('classifyMacroBatch', () => {
  test('좌석을 받음: 성공 1건 + 나머지 전부 DUPLICATE → 정상(위반 아님)', () => {
    const responses = [
      { status: 201, message: null },
      { status: 409, message: DUPLICATE_MESSAGE },
      { status: 409, message: DUPLICATE_MESSAGE },
      { status: 409, message: DUPLICATE_MESSAGE },
      { status: 409, message: DUPLICATE_MESSAGE },
    ];

    const result = classifyMacroBatch(responses);

    expect(result).toMatchObject({
      successCount: 1,
      duplicateCount: 4,
      fullCount: 0,
      unexpectedCount: 0,
      gotSeat: true,
      seatAlreadyFull: false,
      isViolation: false,
    });
  });

  test('정원마감: 전부 FULL → 정상(위반 아님) — VUS가 정원보다 클 때의 정상 케이스', () => {
    const responses = Array.from({ length: 5 }, () => ({ status: 409, message: FULL_MESSAGE }));

    const result = classifyMacroBatch(responses);

    expect(result).toMatchObject({
      successCount: 0,
      duplicateCount: 0,
      fullCount: 5,
      gotSeat: false,
      seatAlreadyFull: true,
      isViolation: false,
    });
  });

  test('성공이 2건 이상이면 원자성 위반', () => {
    const responses = [
      { status: 201, message: null },
      { status: 201, message: null },
      { status: 409, message: DUPLICATE_MESSAGE },
      { status: 409, message: DUPLICATE_MESSAGE },
      { status: 409, message: DUPLICATE_MESSAGE },
    ];

    const result = classifyMacroBatch(responses);

    expect(result.successCount).toBe(2);
    expect(result.isViolation).toBe(true);
  });

  test('DUPLICATE와 FULL이 섞이면 위반 (이 유저는 등록된 적이 없어야 하므로 나오면 안 되는 조합)', () => {
    const responses = [
      { status: 201, message: null },
      { status: 409, message: DUPLICATE_MESSAGE },
      { status: 409, message: FULL_MESSAGE },
      { status: 409, message: DUPLICATE_MESSAGE },
      { status: 409, message: DUPLICATE_MESSAGE },
    ];

    const result = classifyMacroBatch(responses);

    expect(result.isViolation).toBe(true);
  });

  test('성공 없이 FULL과 DUPLICATE만 섞여도 위반 (정상 (b) 패턴은 전부 FULL이어야 함)', () => {
    const responses = [
      { status: 409, message: FULL_MESSAGE },
      { status: 409, message: FULL_MESSAGE },
      { status: 409, message: DUPLICATE_MESSAGE },
      { status: 409, message: FULL_MESSAGE },
      { status: 409, message: FULL_MESSAGE },
    ];

    const result = classifyMacroBatch(responses);

    expect(result.seatAlreadyFull).toBe(false);
    expect(result.isViolation).toBe(true);
  });

  test('5xx/타임아웃 등 인식 못한 응답은 unexpected로 집계되고 위반으로 판정', () => {
    const responses = [
      { status: 201, message: null },
      { status: 409, message: DUPLICATE_MESSAGE },
      { status: 409, message: DUPLICATE_MESSAGE },
      { status: 409, message: DUPLICATE_MESSAGE },
      { status: 0, message: null }, // k6에서 커넥션 실패 시 status가 0
    ];

    const result = classifyMacroBatch(responses);

    expect(result.unexpectedCount).toBe(1);
    expect(result.isViolation).toBe(true);
  });
});

describe('classifyOverlapAttempt', () => {
  test('첫 신청 성공 + 겹침 신청이 OVERLAP으로 거부 → 정상(위반 아님)', () => {
    const result = classifyOverlapAttempt(
      { status: 201, message: null },
      { status: 409, message: OVERLAP_MESSAGE }
    );

    expect(result).toEqual({ firstOk: true, secondRejectedByOverlap: true, isViolation: false });
  });

  test('첫 신청부터 실패하면 위반 (겹침 시나리오 전제가 깨진 것 — CLASS_SEATS_OVERRIDE 누락 등)', () => {
    const result = classifyOverlapAttempt(
      { status: 409, message: FULL_MESSAGE },
      { status: 201, message: null }
    );

    expect(result.firstOk).toBe(false);
    expect(result.isViolation).toBe(true);
  });

  test('겹침 신청이 거부되지 않고 성공해버리면 위반 (진짜 SINTER 버그)', () => {
    const result = classifyOverlapAttempt(
      { status: 201, message: null },
      { status: 201, message: null }
    );

    expect(result.secondRejectedByOverlap).toBe(false);
    expect(result.isViolation).toBe(true);
  });

  test('겹침 신청이 OVERLAP이 아니라 다른 사유(FULL 등)로 거부되면 위반', () => {
    const result = classifyOverlapAttempt(
      { status: 201, message: null },
      { status: 409, message: FULL_MESSAGE }
    );

    expect(result.secondRejectedByOverlap).toBe(false);
    expect(result.isViolation).toBe(true);
  });
});
