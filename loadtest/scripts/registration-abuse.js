// Group C(Redis 원자적 연산) 어뷰징 시나리오 부하테스트 스크립트
// (실험계획서 01 5장 Group C 상세 설계, 구현계획 Stage 1-6).
//
// registration.js가 다루는 "정합성 스윕"(다수 VU가 같은 과목 하나에 동시에 몰리는 상황)과
// 달리, 이 스크립트는 "한 사용자가 이상 행동을 할 때도 Lua Script의 원자성이 버텨주는가"를
// 검증한다. OVERLAP은 Group C(Redis Lua SINTER)에만 있는 개념이라(Group A/B는 시간표 겹침
// 검증 자체가 없음), 이 스크립트는 항상 Group C 엔드포인트(/api/registrations/redis)를
// 대상으로 한다.
//
// SCENARIO 환경변수로 두 시나리오를 스위치한다:
//
// - macro: 같은 유저가 같은 과목에 매크로/연타 클릭을 재현 — http.batch로 동일 요청을
//   MACRO_REQUESTS개 동시에 발사한다. Lua Script가 진짜 원자적이라면 몇 개를 동시에
//   던지든 정확히 1개만 성공(201)하고 나머지는 전부 DUPLICATE(409)여야 한다. 성공이
//   0개거나 2개 이상이면 SISMEMBER+DECR+SADD 통합 Lua Script의 원자성이 깨졌다는 뜻이다.
//
// - overlap: 유저가 CLASS_ID(월/수 12:00~13:15)를 먼저 신청해 성공시킨 뒤, 곧바로 시간표가
//   겹치는 OVERLAP_CLASS_ID(월/수 11:00~12:50, [12:00,12:50) 구간 겹침)를 신청 시도한다.
//   두 번째 요청은 반드시 OVERLAP(409)으로 거부되어야 한다.
//
// 사용 전 준비: backend/scripts/seedRedisRegistrations.js와 seedLoadTestAccounts.js를
// 먼저 실행해서 CLASS_ID/OVERLAP_CLASS_ID 둘 다 시딩해야 한다(둘 다 기본값으로 이미
// 이 두 과목을 함께 초기화하도록 되어 있음).
//
// 사용: docker-compose.loadtest.yml이 k6 컨테이너의 기본 command를 registration.js로
// 고정해뒀으므로, 이 스크립트를 돌릴 땐 command를 함께 오버라이드해야 한다. 예)
//   docker compose -f docker-compose.yml -f docker-compose.loadtest.yml run --rm \
//     -e SCENARIO=macro -e VUS=200 -e MACRO_REQUESTS=5 k6 \
//     run --out experimental-prometheus-rw /scripts/registration-abuse.js
//   docker compose -f docker-compose.yml -f docker-compose.loadtest.yml run --rm \
//     -e SCENARIO=overlap -e VUS=200 k6 \
//     run --out experimental-prometheus-rw /scripts/registration-abuse.js
//
// 주의: registration.js와 마찬가지로 VUS는 seedLoadTestAccounts.js의 ACCOUNT_COUNT
// 이하여야 한다(계정이 재사용되면 시나리오 전제 자체가 깨진다).
import http from 'k6/http';
import { check } from 'k6';
import { Counter } from 'k6/metrics';
import { SharedArray } from 'k6/data';

const TARGET_BASE_URL = __ENV.TARGET_BASE_URL || 'http://localhost:8090';
const TARGET_PATH = '/api/registrations/redis'; // OVERLAP은 Group C 전용 개념이라 고정
const CLASS_ID = __ENV.CLASS_ID || '21001083-2';
const OVERLAP_CLASS_ID = __ENV.OVERLAP_CLASS_ID || '21002144-1';
const TOKENS_FILE = __ENV.TOKENS_FILE || '/loadtest/generated/tokens.json';
const VUS = Number(__ENV.VUS) || 50;
const MAX_DURATION = __ENV.MAX_DURATION || '2m';
const SCENARIO = __ENV.SCENARIO || 'macro'; // 'macro' | 'overlap'
const MACRO_REQUESTS = Number(__ENV.MACRO_REQUESTS) || 5;

// 컨트롤러(registrationController.js)가 실패 사유를 전부 409로 통일하고 세부 사유는
// 응답 바디의 message로만 구분하기 때문에(설계 결정: 실험 01과 비교 가능하게 유지),
// 이 스크립트도 message 문자열로 "어떤 이유로 거부됐는지"를 판별한다. 백엔드 메시지가
// 바뀌면 이 상수도 같이 바꿔야 한다.
const DUPLICATE_MESSAGE = '이미 신청한 과목입니다.';
const OVERLAP_MESSAGE = '기존 신청 과목과 시간표가 겹칩니다.';

const accounts = new SharedArray('accounts', function () {
  return JSON.parse(open(TOKENS_FILE));
});

export const options = {
  scenarios: {
    abuse: {
      executor: 'per-vu-iterations',
      vus: VUS,
      iterations: 1,
      maxDuration: MAX_DURATION,
    },
  },
};

// macro 시나리오 지표. "정확히 1건 성공"이 깨지는 순간(0건 또는 2건 이상)이 진짜
// 버그 신호라서, 그 위반 자체를 별도 카운터(macroAtomicityViolation)로 잡는다.
const macroSuccess = new Counter('abuse_macro_success');
const macroDuplicateRejected = new Counter('abuse_macro_duplicate_rejected');
const macroUnexpected = new Counter('abuse_macro_unexpected');
const macroAtomicityViolation = new Counter('abuse_macro_atomicity_violation');

// overlap 시나리오 지표.
const overlapFirstSuccess = new Counter('abuse_overlap_first_success');
const overlapSecondRejected = new Counter('abuse_overlap_second_rejected');
const overlapUnexpected = new Counter('abuse_overlap_unexpected');

function bodyMessage(res) {
  try {
    return JSON.parse(res.body).message;
  } catch (error) {
    return null;
  }
}

function runMacroScenario(headers) {
  const body = JSON.stringify({ classId: CLASS_ID });
  const requests = Array.from({ length: MACRO_REQUESTS }, () => ({
    method: 'POST',
    url: `${TARGET_BASE_URL}${TARGET_PATH}`,
    body,
    params: { headers, tags: { scenario: 'macro' } },
  }));

  // http.batch는 이 VU 안에서 MACRO_REQUESTS개를 진짜로 동시에 발사한다 —
  // 순차 요청이면 첫 요청이 끝난 뒤엔 SISMEMBER가 이미 참이라 나머지는 애초에
  // 경쟁이 안 되므로, 매크로 클릭(더블클릭/중복 폼 전송)처럼 진짜 동시 요청을
  // 재현하려면 batch가 필요하다.
  const responses = http.batch(requests);

  let successCount = 0;
  let duplicateCount = 0;
  let unexpectedCount = 0;

  for (const res of responses) {
    if (res.status === 201) {
      successCount += 1;
    } else if (res.status === 409 && bodyMessage(res) === DUPLICATE_MESSAGE) {
      duplicateCount += 1;
    } else {
      unexpectedCount += 1;
    }
  }

  macroSuccess.add(successCount);
  macroDuplicateRejected.add(duplicateCount);
  macroUnexpected.add(unexpectedCount);
  if (successCount !== 1) {
    macroAtomicityViolation.add(1);
  }

  check(null, {
    '동시 연타 중 정확히 1건만 성공(201)': () => successCount === 1,
    '나머지는 전부 DUPLICATE(409)로 거부': () => duplicateCount === MACRO_REQUESTS - successCount,
  });
}

function runOverlapScenario(headers) {
  const firstRes = http.post(
    `${TARGET_BASE_URL}${TARGET_PATH}`,
    JSON.stringify({ classId: CLASS_ID }),
    { headers, tags: { scenario: 'overlap', step: 'first' } }
  );

  // 두 번째 요청은 첫 번째가 Redis에 반영된 뒤여야 SINTER가 겹침을 잡아낼 수 있다.
  // k6 VU의 iteration 함수는 동기적으로 순서대로 실행되므로 별도 대기 없이도
  // firstRes 응답을 받은 시점엔 이미 첫 신청이 Redis에 반영되어 있다.
  const secondRes = http.post(
    `${TARGET_BASE_URL}${TARGET_PATH}`,
    JSON.stringify({ classId: OVERLAP_CLASS_ID }),
    { headers, tags: { scenario: 'overlap', step: 'second' } }
  );

  const firstOk = firstRes.status === 201;
  const secondRejectedByOverlap = secondRes.status === 409 && bodyMessage(secondRes) === OVERLAP_MESSAGE;

  overlapFirstSuccess.add(firstOk ? 1 : 0);
  overlapSecondRejected.add(secondRejectedByOverlap ? 1 : 0);
  if (!firstOk || !secondRejectedByOverlap) {
    overlapUnexpected.add(1);
  }

  check(null, {
    '먼저 신청한 과목은 성공(201)': () => firstOk,
    '시간표 겹치는 과목은 OVERLAP(409)로 거부': () => secondRejectedByOverlap,
  });
}

export default function () {
  const account = accounts[(__VU - 1) % accounts.length];
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${account.token}`,
  };

  if (SCENARIO === 'overlap') {
    runOverlapScenario(headers);
  } else {
    runMacroScenario(headers);
  }
}
