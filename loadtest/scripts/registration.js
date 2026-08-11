// 수강신청 동시성 부하테스트 스크립트 (실험계획서 01, 구현계획 Stage 0-7).
//
// Group A/B는 동일 API 계약(POST { classId } → 201)을 가지므로, 이 스크립트는
// TARGET_PATH 환경변수로 호출 대상만 스위치한다(실험계획서 5장 "동일 스크립트, 대상만 스위치").
// 시나리오는 "spike 패턴"(전원 동시 1회 요청) — 정원을 두고 동시에 몰리는 실제 수강신청
// 상황을 재현하기 위해서다. per-vu-iterations executor는 VU가 각자 정확히 1회만 요청하고,
// 모든 VU가 거의 동시에 시작한다.
//
// 사용: docker-compose.loadtest.yml 상단 사용법 주석 참고. 예)
//   docker compose -f docker-compose.yml -f docker-compose.loadtest.yml run --rm \
//     -e TARGET_PATH=/api/registrations/pessimistic -e VUS=500 k6
//
// 주의: VUS는 반드시 seedLoadTestAccounts.js의 ACCOUNT_COUNT 이하여야 한다. VUS가 더 크면
// 토큰이 재사용되어(아래 index 계산의 모듈로) 같은 계정이 중복 신청 → 순수한 정원 경합이
// 아닌 DUPLICATE 응답이 섞여 결과가 오염된다.
import http from 'k6/http';
import { check } from 'k6';
import { Counter } from 'k6/metrics';
import { SharedArray } from 'k6/data';

const TARGET_BASE_URL = __ENV.TARGET_BASE_URL || 'http://localhost:8090';
const TARGET_PATH = __ENV.TARGET_PATH || '/api/registrations/naive';
const CLASS_ID = __ENV.CLASS_ID || '21001083-2';
const TOKENS_FILE = __ENV.TOKENS_FILE || '/loadtest/generated/tokens.json';
const VUS = Number(__ENV.VUS) || 50;
const MAX_DURATION = __ENV.MAX_DURATION || '2m';

const accounts = new SharedArray('accounts', function () {
  return JSON.parse(open(TOKENS_FILE));
});


//"09시 00분 00.000초" 정각에 N명의 서로 다른 학생이 동시에 엔터키를 쳤을 때, 
// 데이터베이스 락(Lock)이나 동시성 제어(Race Condition)가 뚫리는지 확인하는 정밀 타격 테스트를 위한 options 설정
export const options = {
  scenarios: {
    spike: {
      executor: 'per-vu-iterations', //지정된 수의 VU들이 각자 딱 정해진 횟수(iteration)만큼만 실행하고 즉시 종료하는 방식
      vus: VUS,
      iterations: 1, // 각 VU가 정확히 1회만 요청하고 즉시 종료하도록 설정
      maxDuration: MAX_DURATION, 
    },
  },
};

// 정합성 판정은 최종 DB 상태로 하지만(실험계획서 3장), 실행 중에도 응답 분포를
// Prometheus/Grafana로 바로 관찰할 수 있도록 결과를 유형별로 집계한다.
const registered = new Counter('registration_success');       // 201: 신청 성공
const rejectedByBusiness = new Counter('registration_rejected'); // 409: 정원초과/중복 (정상 동작)
const rejectedByServer = new Counter('registration_server_error'); // 5xx/timeout — 서버 붕괴 신호

export default function () {
  const account = accounts[(__VU - 1) % accounts.length];

  const res = http.post(
    `${TARGET_BASE_URL}${TARGET_PATH}`,
    JSON.stringify({ classId: CLASS_ID }),
    {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${account.token}`,
      },
      tags: { group: TARGET_PATH },
    }
  );

  check(res, {
    '201(성공) 또는 409(정원초과/중복)': (r) => r.status === 201 || r.status === 409,
  });

  const counterTags = { group: TARGET_PATH };
  if (res.status === 201) {
    registered.add(1, counterTags);
  } else if (res.status === 409) {
    rejectedByBusiness.add(1, counterTags);
  } else {
    rejectedByServer.add(1, counterTags);
  }
}
