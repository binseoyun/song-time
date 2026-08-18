// Group C(Redis 원자적 연산) 어뷰징 시나리오 부하테스트 스크립트
// (실험계획서 01 5장 Group C 상세 설계, 구현계획 Stage 1-6/1-7).
//
// registration.js가 다루는 "정합성 스윕"(다수 VU가 같은 과목 하나에 동시에 몰리는 상황)과
// 달리, 이 스크립트는 "한 사용자가 이상 행동을 할 때도 Lua Script의 원자성이 버텨주는가"를
// 검증한다. OVERLAP은 Group C(Redis Lua SINTER)에만 있는 개념이라(Group A/B는 시간표 겹침
// 검증 자체가 없음), 이 스크립트는 항상 Group C 엔드포인트(/api/registrations/redis)를
// 대상으로 한다.
//
// 응답 조합이 "정상"인지 "원자성 위반"인지 판정하는 로직은 abuseClassifiers.js로 분리했다
// — k6 런타임에 의존하지 않는 순수 함수라 backend/tests에서 Jest로 별도 검증한다
// (이슈 #29: 이 판정 로직 자체에 버그가 두 번 있었다 — VUS가 정원보다 크면 정상인
// "전부 FULL" 패턴을 위반으로 오판했던 것, overlap의 "첫 신청 성공" 전제가 정원
// 부족으로 깨지는 걸 못 걸렀던 것. k6 부하테스트로만 검증하면 재현에 몇 분씩 걸려서
// 매번 다시 확인하기 번거로우니, 판정 로직만은 결정적인 단위 테스트로 고정해둔다).
//
// SCENARIO 환경변수로 두 시나리오를 스위치한다. 둘 다 doc/troubleshooting/05 3순위에
// 따라 "검증하려는 지점에만" 순간 부하를 집중시키도록 설계했다 — 예전 버전은 이 두
// 시나리오 자체가 정합성 스윕과 같은 종류의 부하를 중복으로 만들어내서, VUS=12,000급
// 에서 어뷰징 신호가 인프라 노이즈에 묻혔다(구현계획 Stage 1-7 실측).
//
// - macro: 같은 유저가 같은 과목에 매크로/연타 클릭을 재현 — http.batch로 동일 요청을
//   MACRO_REQUESTS개 동시에 발사한다. 정상 패턴은 "성공1+DUPLICATE(N-1)"(좌석을 받음)
//   또는 "전부 FULL"(이 VU 차례가 오기 전에 이미 정원마감) 둘 중 하나뿐이다.
//   MACRO_REQUESTS 기본값을 5→2로 낮췄다 — 중복 클릭 검증에 필요한 최소값(1건 성공+
//   1건 DUPLICATE를 구분하는 데 2개면 충분)만 남기고, 실제 매크로 클릭이 마이크로초
//   단위로 5번씩 동시에 눌리진 않는다는 점을 반영해 불필요한 순간 부하를 줄였다.
//
// - overlap: 유저가 이미 CLASS_ID(월/수 12:00~13:15)를 신청해둔 상태에서, 시간표가
//   겹치는 OVERLAP_CLASS_ID(월/수 11:00~12:50, [12:00,12:50) 구간 겹침)를 신청 시도한다.
//   반드시 OVERLAP(409)으로 거부되어야 한다. "이미 신청해둔 상태"는 라이브 HTTP
//   등록이 아니라 backend/scripts/seedOverlapPreconditions.js가 Redis에 직접
//   시딩해둔다 — 검증하려는 건 SINTER 겹침 체크지 정원 경합이 아니므로, 그 전제를
//   만드는 데 드는 순간 부하 자체를 없앴다(예전엔 여기서 CLASS_ID 좌석을 VUS보다
//   넉넉히 override해야 했는데, 이제 라이브 등록이 없어 그 override도 필요 없다).
//
// 사용 전 준비: 아래 세 스크립트를 순서대로 실행해야 한다.
//   1) backend/scripts/seedLoadTestAccounts.js — 계정 + CLASS_ID/OVERLAP_CLASS_ID MySQL 리셋
//   2) backend/scripts/seedRedisRegistrations.js — CLASS_ID/OVERLAP_CLASS_ID 좌석·슬롯 Redis 시딩
//   3) overlap 시나리오만: backend/scripts/seedOverlapPreconditions.js — "이미 CLASS_ID
//      신청함" 전제를 계정별로 Redis에 직접 시딩(2번이 심어둔 슬롯을 그대로 씀)
//
// 사용: docker-compose.loadtest.yml이 k6 컨테이너의 기본 command를 registration.js로
// 고정해뒀으므로, 이 스크립트를 돌릴 땐 command를 함께 오버라이드해야 한다. 예)
//   docker compose -f docker-compose.yml -f docker-compose.loadtest.yml run --rm \
//     -e SCENARIO=macro -e VUS=200 -e MACRO_REQUESTS=2 k6 \
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
import { classifyMacroBatch, classifyOverlapAttempt } from './abuseClassifiers.js';

const TARGET_BASE_URL = __ENV.TARGET_BASE_URL || 'http://localhost:8090';
const TARGET_PATH = '/api/registrations/redis'; // OVERLAP은 Group C 전용 개념이라 고정
const CLASS_ID = __ENV.CLASS_ID || '21001083-2';
const OVERLAP_CLASS_ID = __ENV.OVERLAP_CLASS_ID || '21002144-1';
const TOKENS_FILE = __ENV.TOKENS_FILE || '/loadtest/generated/tokens.json';
const VUS = Number(__ENV.VUS) || 50;
const MAX_DURATION = __ENV.MAX_DURATION || '2m';
const SCENARIO = __ENV.SCENARIO || 'macro'; // 'macro' | 'overlap'
const MACRO_REQUESTS = Number(__ENV.MACRO_REQUESTS) || 2;

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

const macroSuccess = new Counter('abuse_macro_success');
const macroDuplicateRejected = new Counter('abuse_macro_duplicate_rejected');
const macroFullRejected = new Counter('abuse_macro_full_rejected');
const macroUnexpected = new Counter('abuse_macro_unexpected');
const macroAtomicityViolation = new Counter('abuse_macro_atomicity_violation');

const overlapRejected = new Counter('abuse_overlap_rejected');
const overlapUnexpected = new Counter('abuse_overlap_unexpected');

function toClassifierResponse(res) {
  let message = null;
  try {
    message = JSON.parse(res.body).message;
  } catch (error) {
    message = null;
  }
  return { status: res.status, message };
}

function runMacroScenario(headers) {
  const body = JSON.stringify({ classId: CLASS_ID });
  const requests = Array.from({ length: MACRO_REQUESTS }, () => ({
    method: 'POST',
    url: `${TARGET_BASE_URL}${TARGET_PATH}`,
    body,
    // group 태그는 registration.js와 동일한 관례 — Grafana 대시보드의 Group(TARGET_PATH)
    // 변수가 이 라벨로 필터링한다. 이게 없으면 요청이 실제로 나가도 대시보드엔 안 잡힌다.
    params: { headers, tags: { scenario: 'macro', group: TARGET_PATH } },
  }));

  // http.batch는 이 VU 안에서 MACRO_REQUESTS개를 진짜로 동시에 발사한다 —
  // 순차 요청이면 첫 요청이 끝난 뒤엔 SISMEMBER가 이미 참이라 나머지는 애초에
  // 경쟁이 안 되므로, 매크로 클릭(더블클릭/중복 폼 전송)처럼 진짜 동시 요청을
  // 재현하려면 batch가 필요하다.
  const responses = http.batch(requests).map(toClassifierResponse);
  const result = classifyMacroBatch(responses);

  macroSuccess.add(result.successCount);
  macroDuplicateRejected.add(result.duplicateCount);
  macroFullRejected.add(result.fullCount);
  macroUnexpected.add(result.unexpectedCount);
  if (result.isViolation) {
    macroAtomicityViolation.add(1);
  }

  check(null, {
    '좌석을 받아 성공 1건+나머지 DUPLICATE, 또는 정원마감으로 전부 FULL 중 하나': () => !result.isViolation,
  });
}

function runOverlapScenario(headers) {
  // "이미 CLASS_ID를 신청해둔 상태"는 seedOverlapPreconditions.js가 Redis에 미리
  // 심어둔다 — 이 VU는 겹치는 과목 신청 요청 하나만 보낸다.
  const res = http.post(
    `${TARGET_BASE_URL}${TARGET_PATH}`,
    JSON.stringify({ classId: OVERLAP_CLASS_ID }),
    { headers, tags: { scenario: 'overlap', group: TARGET_PATH } }
  );

  const result = classifyOverlapAttempt(toClassifierResponse(res));

  overlapRejected.add(result.rejectedByOverlap ? 1 : 0);
  if (result.isViolation) {
    overlapUnexpected.add(1);
  }

  check(null, {
    '시간표 겹치는 과목은 OVERLAP(409)로 거부': () => result.rejectedByOverlap,
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
