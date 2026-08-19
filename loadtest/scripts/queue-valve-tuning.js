// 실험 02 Step 3(Valve Tuning, 이슈 #57) k6 스크립트.
// doc/experiment/02-대기열-방어-실험계획.md §4 Step 3 설계를 그대로 구현한다:
// 대기열 진입 → (Think Time 없이) 3~5초 주기 폴링으로 순번 확인 → Active 승격 →
// **무작위 Think Time(15~45초)** → 수강신청 API 호출 → Active 슬롯 즉시 반납(이슈 #58).
//
// ⚠️ Think Time을 생략하면 안 된다(계획서 §4 Step3 경고 박스) — k6 VU가 승격 즉시
// API를 부르고 세션을 끝내버리면 실제 학생이 화면을 보고 고르는 체류 시간 동안
// Active 슬롯을 붙잡는 상황이 재현되지 않아 대기열이 비현실적으로 빨리 빠진다.
//
// 사용:
//   docker compose -f docker-compose.yml -f docker-compose.loadtest.yml run --rm \
//     -e VUS=12000 -e CLASS_ID=VALVE-TUNING-ROUND k6 run /scripts/queue-valve-tuning.js
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';
import { SharedArray } from 'k6/data';

const TARGET_BASE_URL = __ENV.TARGET_BASE_URL || 'http://localhost:8090';
const CLASS_ID = __ENV.CLASS_ID || 'VALVE-TUNING-ROUND';
const TOKENS_FILE = __ENV.TOKENS_FILE || '/loadtest/generated/tokens.json';
const VUS = Number(__ENV.VUS) || 500;
const MAX_DURATION = __ENV.MAX_DURATION || '40m';

// 계획서 §5 통제변수: Think Time 분포는 Step 2 가정치(평균 체류 시간)와 동일해야 한다.
const THINK_TIME_MIN_S = Number(__ENV.THINK_TIME_MIN_S) || 15;
const THINK_TIME_MAX_S = Number(__ENV.THINK_TIME_MAX_S) || 45;
// 프론트(RegistrationPractice.tsx)가 실제로 쓰는 폴링 주기(ADR-006 1.4, 3~5초)와 동일하게.
const POLL_MIN_S = Number(__ENV.POLL_MIN_S) || 3;
const POLL_MAX_S = Number(__ENV.POLL_MAX_S) || 5;
// 대기 중 이 시간을 넘기면 "이탈"로 집계하고 세션을 포기한다(계획서 §5 DV "이탈률").
const MAX_WAIT_S = Number(__ENV.MAX_WAIT_S) || 1800;

const accounts = new SharedArray('accounts', function () {
  return JSON.parse(open(TOKENS_FILE));
});

export const options = {
  scenarios: {
    valve_tuning: {
      executor: 'per-vu-iterations',
      vus: VUS,
      iterations: 1,
      maxDuration: MAX_DURATION,
    },
  },
};

// 대기열 자체 오버헤드(계획서 §5 DV) — enter/status/leave 호출 자체의 응답 시간.
const queueEnterDuration = new Trend('queue_enter_duration');
const queueStatusDuration = new Trend('queue_status_duration');
const queueLeaveDuration = new Trend('queue_leave_duration');
// 대기열 진입부터 Active 승격까지 걸린 시간 — "얼마나 기다렸는가".
const queueWaitDuration = new Trend('queue_wait_duration');
// Active 게이트 통과 후 수강신청 API만의 지연 — 계획서 판정 기준(p95 500ms)의 대상.
const registrationDuration = new Trend('registration_duration');
// 대기열 진입부터 신청 완료(반납)까지 End-to-End.
const e2eDuration = new Trend('e2e_duration');

const registered = new Counter('registration_success');
const rejectedByBusiness = new Counter('registration_rejected');
const rejectedByServer = new Counter('registration_server_error');
const queueDropout = new Counter('queue_dropout'); // MAX_WAIT_S 초과로 포기

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

export default function () {
  const account = accounts[(__VU - 1) % accounts.length];
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${account.token}` };
  const sessionStart = Date.now();

  const enterRes = http.post(`${TARGET_BASE_URL}/api/queue/enter`, null, { headers, tags: { name: 'queue_enter' } });
  queueEnterDuration.add(enterRes.timings.duration);
  check(enterRes, { 'enter: 200': (r) => r.status === 200 });

  let state = enterRes.json('state');
  const waitStart = Date.now();

  while (state !== 'active') {
    if ((Date.now() - waitStart) / 1000 > MAX_WAIT_S) {
      queueDropout.add(1);
      return;
    }
    sleep(randomBetween(POLL_MIN_S, POLL_MAX_S));

    const statusRes = http.get(`${TARGET_BASE_URL}/api/queue/status`, { headers, tags: { name: 'queue_status' } });
    queueStatusDuration.add(statusRes.timings.duration);
    check(statusRes, { 'status: 200': (r) => r.status === 200 });

    state = statusRes.json('state');
    // TTL 만료로 대기열에서 밀려났으면(프론트와 동일하게) 재진입한다.
    if (state === 'not_entered') {
      const reenterRes = http.post(`${TARGET_BASE_URL}/api/queue/enter`, null, { headers, tags: { name: 'queue_enter' } });
      queueEnterDuration.add(reenterRes.timings.duration);
      state = reenterRes.json('state');
    }
  }

  queueWaitDuration.add(Date.now() - waitStart);

  // 실제 학생이 화면을 보고 과목을 고르는 체류 시간 — 절대 생략하지 않는다(위 경고 참고).
  sleep(randomBetween(THINK_TIME_MIN_S, THINK_TIME_MAX_S));

  const regRes = http.post(
    `${TARGET_BASE_URL}/api/registrations/redis`,
    JSON.stringify({ classId: CLASS_ID }),
    { headers, tags: { name: 'register' } }
  );
  registrationDuration.add(regRes.timings.duration);
  check(regRes, { '201(성공) 또는 409(정원초과/중복)': (r) => r.status === 201 || r.status === 409 });

  if (regRes.status === 201) {
    registered.add(1);
  } else if (regRes.status === 409) {
    rejectedByBusiness.add(1);
  } else {
    rejectedByServer.add(1);
  }

  // 학생이 신청을 마치고 화면을 벗어남 — Active 슬롯을 TTL을 기다리지 않고 반납(이슈 #58).
  const leaveRes = http.del(`${TARGET_BASE_URL}/api/queue/active`, null, { headers, tags: { name: 'queue_leave' } });
  queueLeaveDuration.add(leaveRes.timings.duration);

  e2eDuration.add(Date.now() - sessionStart);
}
