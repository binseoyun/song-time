# 트러블슈팅 07: 대기열 지속 폴링 부하에서 드러난 nginx 업스트림 병목 2건

- 날짜: 2026-08-20
- Phase: Stage 2-5, 이슈 #57(실험 02 Step 3, Valve Tuning) 하네스 실행 중 발견
- 관련 코드: `nginx/default.conf`, `nginx/nginx.conf`
- 관련 문서: `doc/troubleshooting/05-어뷰징-시나리오-로컬-인프라-커넥션-한계와-개선계획.md`(선행 nginx 튜닝), `doc/experiment/02-대기열-방어-실험계획.md`

## 배경 — 이번 부하는 이전과 부하 "모양"이 다르다

트러블슈팅 05는 이미 nginx를 한 차례 튜닝했다(`worker_connections` 1,024→16,384, upstream `keepalive 64` 풀 추가, backend 2 replica). 다만 그 튜닝은 **순간 스파이크**(등록 API에 12,000명이 한 번에 요청 1건씩, 또는 macro 시나리오처럼 VU당 5개를 동시발사하는 짧은 폭발) 기준이었다.

이슈 #57(Valve Tuning) 실험은 부하 모양 자체가 다르다 — 12,000명이 **최대 30분 가까이** 대기열에 머무르며 3~5초마다 `GET /api/queue/status`를 반복 호출한다. "순간 폭발"이 아니라 "오래 유지되는 동시 연결 다수"다. 05에서 검증되지 않은 새로운 부하 패턴이 05의 튜닝만으로는 안 가려지는 지점을 두 개 더 드러냈다.

## 증상

Round 1(ACTIVE_GATE_LIMIT=300, VUS=12,000)을 처음 실행하자 k6가 다음 에러를 대량으로 쏟아냈다.

```
level=warning msg="Request Failed" error="Post \"http://nginx/api/queue/enter\": request timeout"
level=error msg="GoError: the body is null so we can't transform it to JSON..."
```

12분이 지나도 12,000명 중 766명(6%)만 완료됐다 — 이론상 Active 300슬롯 × 평균 체류시간(Think Time 15~45초) 기준으로는 초당 약 10명(10~11분 내 완료)이 나와야 하는데, 실측은 초당 약 1명으로 10배 가까이 느렸다.

## 원인 분석 — 두 가지가 겹쳐 있었다

### 1) nginx→backend keepalive 풀(64)이 폴링 규모에 비해 작았다

`docker compose logs nginx`를 직접 열어보고서야 진짜 원인이 보였다.

```
nginx-1 | [error] upstream timed out (110: Operation timed out) while connecting to upstream,
         client: 172.21.0.14, request: "GET /api/queue/status HTTP/1.1",
         upstream: "http://172.21.0.5:8000/api/queue/status", host: "nginx"
```

"connecting to upstream"이 핵심이다 — backend가 응답을 늦게 준 게 아니라, **nginx가 backend로 가는 새 TCP 연결 자체를 못 맺었다.** 이 시점에 `docker stats`로 확인한 backend_1/backend_2 CPU는 각각 25~44%로 여유가 있었다(요청을 못 받아서 한가한 것이지, 과부하로 응답을 못 준 게 아니었다). `upstream backend_pool { keepalive 64; }`는 재사용 가능한 idle 커넥션을 최대 64개까지만 풀에 유지하는 설정인데, 12,000명이 3~5초 주기로 지속 폴링하면 어느 순간이든 동시에 재사용 가능한 연결 수요가 64를 훨씬 웃돈다 — 05가 튜닝한 값은 "짧은 폭발 한 번"을 버티기엔 충분했지만 "몇 분간 지속되는 수천 단위 동시 연결"엔 턱없이 작았다.

### 2) nginx의 기본 passive health check가 지나치게 민감했다

1번을 keepalive 2048로 완화하고 재실행하자 이번엔 다른 에러가 나왔다.

```
nginx-1 | [error] no live upstreams while connecting to upstream, ...
         upstream: "http://backend_pool/api/queue/status", host: "nginx"
```

"no live upstreams"는 nginx가 업스트림 그룹(backend_1 **그리고** backend_2) **전부**를 죽었다고 판단했다는 뜻이다. `upstream { server ...; }`에 `max_fails`/`fail_timeout`을 명시하지 않으면 nginx 기본값(`max_fails=1 fail_timeout=10s`)이 적용된다 — 즉 **연결 시도가 단 한 번만 실패해도** 그 서버를 10초간 풀에서 제외한다. 지속 폴링 부하에서는 순간적인 지연으로 backend_1과 backend_2가 거의 동시에 한 번씩 실패를 기록하기 쉽고, 그러면 둘 다 10초간 제외되어 "살아있는 백엔드가 하나도 없는" 상태가 된다 — 실제로는 두 인스턴스 다 멀쩡히 살아 있는데도.

### 3) (부수적으로 고친) k6 스크립트 자체의 크래시 버그

위 두 문제로 요청이 실패하면 응답 바디가 없는데, `res.json('state')`를 그대로 호출해 k6 VU 자체가 `GoError`로 죽어버렸다 — 실패를 정상적으로 카운트하는 대신 VU 하나를 통째로 잃는 구조였다. 인프라 문제와는 별개의, 스크립트 자체의 결함이라 같이 고쳤다(아래 코드 참고).

## 수정

```nginx
# nginx/default.conf
upstream backend_pool {
    server backend_1:8000 max_fails=10 fail_timeout=3s;  # 기본값(1회/10초)이 너무 민감
    server backend_2:8000 max_fails=10 fail_timeout=3s;
    keepalive 2048;  # 64 → 2048, 지속 폴링 규모에 맞춤
}
...
location /api/ {
    proxy_pass http://backend_pool/api/;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_connect_timeout 10s;
}
```

```js
// loadtest/scripts/queue-valve-tuning.js — 응답 실패를 크래시 대신 카운터로
function safeState(res) {
  if (!res || res.status === 0 || !res.body) {
    queueRequestError.add(1);
    return null;
  }
  try {
    return res.json('state');
  } catch (error) {
    queueRequestError.add(1);
    return null;
  }
}
```

## 결과 (Before/After)

| 규모 | 조건 | 결과 |
|---|---|---|
| VUS=12,000 (Round 1 최초 시도) | keepalive 64, health check 기본값 | 12분에 6%(766명)만 완료, `request timeout`/`GoError` 대량 발생 |
| VUS=2,000 (keepalive만 수정 후 검증) | keepalive 2048, health check 기본값 | 1분 50초에 100% 완료, `http_req_failed` 0.00%, 신청 API p95 168ms |
| VUS=12,000 (keepalive 수정 후 재시도) | keepalive 2048, health check 기본값 | 12분에 6%만 완료 — **동일한 정체**, `no live upstreams` 대량 발생 (health check가 새 병목이었음을 재확인) |
| VUS=3,000 (health check까지 수정 후 검증) | keepalive 2048, `max_fails=10 fail_timeout=3s` | 40초에 6%(169명), 에러 0건 — 정상 속도로 복귀 |

같은 12,000-VU 부하가 "1번만 고친 상태"에서도 여전히 정체됐다는 게 이 트러블슈팅에서 가장 중요한 대목이다 — 겉보기 증상(느린 처리 속도)은 같아도 원인이 두 개 겹쳐 있었고, 하나를 고쳐도 나머지 하나가 그대로 남아 있으면 증상 자체는 거의 안 바뀐다. 원인을 하나씩 nginx 에러 로그로 직접 확인하고서야 각각을 분리해낼 수 있었다.

## 교훈

- **"느리다"는 증상 하나에 원인이 여러 개 겹쳐 있을 수 있다.** 첫 번째 수정 후 증상이 그대로라고 해서 그 수정이 틀렸다는 뜻은 아니다 — 로그를 다시 보지 않았다면 keepalive 수정이 무의미했다고 오판했을 것이다.
- **부하의 "모양"(shape)이 바뀌면 이전에 검증된 튜닝값도 다시 검증해야 한다.** 트러블슈팅 05의 keepalive 64는 "순간 폭발" 조건에서 나온 값이었고, "지속 폴링" 조건에서는 처음부터 다시 재는 게 맞았다.
- **nginx의 조용한 기본값을 의심하라.** `max_fails`/`fail_timeout`을 명시적으로 설정한 적이 없다는 것 자체가, 이 값이 검증된 적 없는 기본값이라는 신호였다.
