// registration-abuse.js의 판정 로직을 순수 함수로 분리한 모듈.
//
// k6 스크립트 안에 인라인으로 넣어뒀던 판정 로직(어떤 응답 조합이 "정상"이고 어떤
// 조합이 "원자성 위반"인지)에서 실제로 버그 두 개가 나왔다(구현계획 Stage 1-7, 이슈 #29):
//   1. macro: VUS가 정원보다 크면 대부분 FULL로 거부되는 게 정상인데 전부 위반으로 오판
//   2. overlap: 겹침 검증의 전제(첫 신청 성공)가 정원 부족으로 깨지는 걸 못 걸러냄
// k6 스크립트는 k6/http 등 k6 런타임 모듈에 의존해서 Jest로 직접 테스트할 수 없으므로,
// "이 응답 조합이 정상인가"라는 순수 판정 로직만 이 파일로 떼어내 backend/tests에서
// Jest로 빠르고 결정적으로 검증한다(k6 부하테스트 없이 몇 초 안에 회귀를 잡아낸다).
//
// registration-abuse.js가 이 파일을 require()해서 쓴다 — k6는 로컬 모듈에 대해
// CommonJS require()와 ES import를 둘 다 지원한다.

const DUPLICATE_MESSAGE = '이미 신청한 과목입니다.';
const OVERLAP_MESSAGE = '기존 신청 과목과 시간표가 겹칩니다.';
const FULL_MESSAGE = '정원이 초과되었습니다.';

/**
 * macro(매크로 연타) 시나리오 판정.
 * @param {{status:number, message:string|null}[]} responses - 한 VU가 동시에 쏜 N개 응답
 * @returns {{
 *   successCount:number, duplicateCount:number, fullCount:number, unexpectedCount:number,
 *   gotSeat:boolean, seatAlreadyFull:boolean, isViolation:boolean
 * }}
 */
function classifyMacroBatch(responses) {
  let successCount = 0;
  let duplicateCount = 0;
  let fullCount = 0;
  let unexpectedCount = 0;

  for (const res of responses) {
    if (res.status === 201) {
      successCount += 1;
    } else if (res.status === 409 && res.message === DUPLICATE_MESSAGE) {
      duplicateCount += 1;
    } else if (res.status === 409 && res.message === FULL_MESSAGE) {
      fullCount += 1;
    } else {
      unexpectedCount += 1;
    }
  }

  const total = responses.length;
  // 정상 패턴 (a) 좌석을 받음: 성공 1 + DUPLICATE(N-1) + FULL 0 + unexpected 0
  const gotSeat = successCount === 1 && duplicateCount === total - 1 && fullCount === 0 && unexpectedCount === 0;
  // 정상 패턴 (b) 정원마감으로 전부 거부됨: 성공 0 + DUPLICATE 0 + FULL N + unexpected 0
  const seatAlreadyFull = successCount === 0 && duplicateCount === 0 && fullCount === total && unexpectedCount === 0;

  return {
    successCount,
    duplicateCount,
    fullCount,
    unexpectedCount,
    gotSeat,
    seatAlreadyFull,
    isViolation: !gotSeat && !seatAlreadyFull,
  };
}

/**
 * overlap(시간표 겹침) 시나리오 판정.
 *
 * 이전엔 "CLASS_ID 신청 성공"까지 k6가 라이브 HTTP로 만든 뒤 겹침 요청을 보냈는데
 * (구현계획 Stage 1-7, 이슈 #29), 이 전제 자체가 정합성 스윕과 같은 종류의 부하를
 * 어뷰징 시나리오 안에서 중복 발생시켰다. 이제 그 전제는 seedOverlapPreconditions.js가
 * 라이브 HTTP 없이 Redis에 직접 시딩해두므로, k6는 겹침 요청 하나만 보내고 그 결과만
 * 판정한다(doc/troubleshooting/05 3순위).
 *
 * @param {{status:number, message:string|null}} response - OVERLAP_CLASS_ID 신청 응답
 * @returns {{ rejectedByOverlap:boolean, isViolation:boolean }}
 */
function classifyOverlapAttempt(response) {
  const rejectedByOverlap = response.status === 409 && response.message === OVERLAP_MESSAGE;
  return {
    rejectedByOverlap,
    isViolation: !rejectedByOverlap,
  };
}

module.exports = {
  DUPLICATE_MESSAGE,
  OVERLAP_MESSAGE,
  FULL_MESSAGE,
  classifyMacroBatch,
  classifyOverlapAttempt,
};
