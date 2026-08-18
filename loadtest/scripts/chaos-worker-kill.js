// 카오스 테스트(워커 kill, 구현계획 Stage 1-8, 이슈 #36) 전용 k6 스크립트.
//
// registration.js/registration-abuse.js는 전원이 거의 동시에 발사되는 스파이크
// 패턴(per-vu-iterations)이라, 로컬 환경에서는 요청 전체가 1초 안팎으로
// 순식간에 처리돼버려 "워커를 정확히 메시지 처리 도중에 죽이는" 타이밍을
// 맞추기 어렵다(chaos-test-worker-kill.sh 최초 시도에서 실측 — RabbitMQ
// redeliver 카운터가 0으로 나와, 킬이 항상 트래픽 시작 전에 끝나버렸음을 확인).
//
// 그래서 이 스크립트는 스파이크 대신 RATE(초당 요청 수)로 DURATION 동안
// 균등하게 흘려보낸다(constant-arrival-rate) — 처리 구간을 몇 초로 늘려서
// 오케스트레이터가 그 사이 아무 때나 워커를 죽여도 확실히 "처리 중인 메시지"를
// 잡아낼 수 있게 한다.
import http from 'k6/http';
import exec from 'k6/execution';
import { SharedArray } from 'k6/data';
import { Counter } from 'k6/metrics';

const TARGET_BASE_URL = __ENV.TARGET_BASE_URL || 'http://localhost:8090';
const TARGET_PATH = '/api/registrations/redis';
const CLASS_ID = __ENV.CLASS_ID || '21001083-2';
const TOKENS_FILE = __ENV.TOKENS_FILE || '/loadtest/generated/tokens.json';
const RATE = Number(__ENV.RATE) || 50;
const DURATION_SECONDS = Number(__ENV.DURATION_SECONDS) || 10;
const PRE_ALLOCATED_VUS = Number(__ENV.PRE_ALLOCATED_VUS) || 50;

const accounts = new SharedArray('accounts', function () {
  return JSON.parse(open(TOKENS_FILE));
});

export const options = {
  scenarios: {
    trickle: {
      executor: 'constant-arrival-rate',
      rate: RATE,
      timeUnit: '1s',
      duration: `${DURATION_SECONDS}s`,
      preAllocatedVUs: PRE_ALLOCATED_VUS,
      maxVUs: PRE_ALLOCATED_VUS * 4,
    },
  },
};

// run-experiment-01-groupC.sh의 parse_summary_counters()가 그대로 재사용할 수
// 있도록 registration.js와 동일한 카운터 이름을 쓴다.
const registered = new Counter('registration_success');
const rejectedByBusiness = new Counter('registration_rejected');
const rejectedByServer = new Counter('registration_server_error');

export default function () {
  // iterationInTest는 시나리오 전체에서 유일하게 증가하는 카운터라, VU가
  // 재사용돼도 계정이 겹치지 않는다 — seedLoadTestAccounts.js가 RATE*DURATION
  // 개 이상의 계정을 만들어뒀다는 전제(오케스트레이터가 보장).
  const idx = exec.scenario.iterationInTest % accounts.length;
  const account = accounts[idx];
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${account.token}`,
  };
  const res = http.post(
    `${TARGET_BASE_URL}${TARGET_PATH}`,
    JSON.stringify({ classId: CLASS_ID }),
    { headers, tags: { group: TARGET_PATH } }
  );

  if (res.status === 201) {
    registered.add(1);
  } else if (res.status === 409) {
    rejectedByBusiness.add(1);
  } else {
    rejectedByServer.add(1);
  }
}
