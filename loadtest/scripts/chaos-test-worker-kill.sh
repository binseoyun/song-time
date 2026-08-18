#!/usr/bin/env bash
# 카오스 테스트: RabbitMQ 워커(worker_1/worker_2) kill — 재전송·멱등성 검증
# (구현계획 Stage 1-8, 이슈 #36)
#
# 목적: 1-7 실험(#29)은 정상 조건에서 Group C의 정합성(Redis Lua 원자성)과
# 비동기 반영 신뢰성(Ghost Decrement 0건)을 검증했다. 이 스크립트는 그 계약이
# "워커 프로세스가 메시지 처리 도중 죽어도" 유지되는지를 실측한다.
#
# 설계가 한 번 바뀌었다: 최초 버전은 registration.js와 같은 스파이크
# 패턴(전원 동시 발사)에 고정된 sleep 뒤 kill을 날렸는데, 실측해보니
# RabbitMQ의 redeliver 카운터가 0으로 나왔다 — 로컬 환경에서 요청 전체가
# 1초 안팎으로 순식간에 끝나버려, kill이 항상 "k6 컨테이너가 아직 뜨는 중"
# 구간에 떨어지고 실제 메시지 처리 구간을 전혀 못 잡았기 때문이다. 그래서
# chaos-worker-kill.js(전용 k6 스크립트)로 바꿔 RATE로 DURATION_SECONDS
# 동안 요청을 균등하게 흘려보내고, 그 몇 초 구간 중간에 kill을 날린다.
#
# 절차 (rep 1회당):
#   1. 계정/Redis 리시딩
#   2. 카오스 테스트 전용: Redis 좌석 카운터를 이번 rep 총 요청 수(RATE*DURATION)
#      만큼 넉넉히 올려서 거의 다 성공해 RabbitMQ에 메시지가 쌓이도록 만든다 —
#      정원 경합(1-7에서 이미 검증)이 아니라 워커 재시작 자체가 목적. MySQL
#      Class.capacity는 안 건드리므로 이 실험 밖에는 영향이 없다.
#   3. chaos-worker-kill.js를 백그라운드로 발사 (RATE개/초 × DURATION_SECONDS초)
#   4. KILL_DELAY_SECONDS 뒤 대상 워커(worker_1 또는 worker_2)를
#      `docker compose kill`(SIGKILL)로 강제 종료
#   5. k6 종료 대기 → 메인 큐 드레인 대기 → DLQ 확인
#   6. 검증: RabbitMQ 큐의 message_stats.redeliver 델타(이 rep 동안 실제로
#      재전송된 메시지 수 — 로그 grep보다 신뢰할 수 있는 브로커 레벨 지표),
#      MySQL registrations 수 == k6 성공 수(메시지 유실 없음), (user_id,
#      class_id) 중복 행 0건(유니크 제약 + 워커의 SequelizeUniqueConstraintError
#      캐치가 실제로 작동했는지)
#
# 사용법 (프로젝트 루트에서, 전체 스택이 이미 떠 있어야 함):
#   ./loadtest/scripts/chaos-test-worker-kill.sh
#   CHAOS_RATE=100 CHAOS_DURATION_SECONDS=15 CHAOS_REPS=5 ./loadtest/scripts/chaos-test-worker-kill.sh
#   KILL_DELAY_SECONDS=7 ./loadtest/scripts/chaos-test-worker-kill.sh
set -uo pipefail

export MSYS_NO_PATHCONV=1

cd "$(dirname "$0")/../.." || exit 1

COMPOSE="docker compose -f docker-compose.yml -f docker-compose.loadtest.yml"
RAW_DIR="doc/experiment/raw"
CLASS_ID="${CLASS_ID:-21001083-2}"
OVERLAP_CLASS_ID="${OVERLAP_CLASS_ID:-21002144-1}"
BASE_URL="${TARGET_BASE_URL:-http://nginx}"

RABBITMQ_MGMT="${RABBITMQ_MGMT:-http://localhost:15672}"
RABBITMQ_AUTH="guest:guest"
QUEUE_MAIN_ENC="registration.persist"
QUEUE_DLQ_ENC="registration.persist.dlq"
DRAIN_TIMEOUT_SECONDS="${DRAIN_TIMEOUT_SECONDS:-120}"

CHAOS_RATE="${CHAOS_RATE:-50}"                       # 초당 요청 수
CHAOS_DURATION_SECONDS="${CHAOS_DURATION_SECONDS:-10}" # 요청을 흘려보낼 총 시간
CHAOS_REPS="${CHAOS_REPS:-6}"
KILL_DELAY_SECONDS="${KILL_DELAY_SECONDS:-5}"        # DURATION 중간 지점 기본값
PAUSE_SECONDS="${PAUSE_SECONDS:-3}"
CHAOS_TOTAL=$((CHAOS_RATE * CHAOS_DURATION_SECONDS))

mkdir -p "$RAW_DIR"

log() { echo "[$(date '+%H:%M:%S')] $*"; }

if ! $COMPOSE ps backend_1 2>/dev/null | grep -q "Up"; then
  echo "backend_1 컨테이너가 안 떠 있습니다. 먼저 docker compose up -d 를 실행하세요."
  exit 1
fi
if ! curl -s -u "$RABBITMQ_AUTH" "$RABBITMQ_MGMT/api/overview" >/dev/null 2>&1; then
  echo "RabbitMQ 관리 API($RABBITMQ_MGMT)에 접속할 수 없습니다."
  exit 1
fi

reseed() {
  local total="$1"
  $COMPOSE exec -T -e ACCOUNT_COUNT="$total" -e CLASS_ID="$CLASS_ID" -e OVERLAP_CLASS_ID="$OVERLAP_CLASS_ID" \
    backend_1 node scripts/seedLoadTestAccounts.js >/dev/null 2>&1
  $COMPOSE exec -T -e CLASS_ID="$CLASS_ID" -e OVERLAP_CLASS_ID="$OVERLAP_CLASS_ID" \
    backend_1 node scripts/seedRedisRegistrations.js >/dev/null 2>&1
}

# 카오스 테스트 전용: 이번 rep의 총 요청 수만큼 Redis 좌석 카운터를 넉넉히 올린다
# (reseed()가 방금 Class.capacity=50으로 세팅한 값을 덮어씀). MySQL은 안 건드림.
widen_capacity() {
  local class_id="$1" capacity="$2"
  $COMPOSE exec -T -e TARGET_CLASS_ID="$class_id" -e TARGET_CAPACITY="$capacity" backend_1 node -e "
    const redis = require('./src/config/redis');
    const { classSeatsKey } = require('./src/utils/redisKeys');
    (async () => {
      await redis.set(classSeatsKey(process.env.TARGET_CLASS_ID), process.env.TARGET_CAPACITY);
      redis.disconnect();
    })();
  " >/dev/null 2>&1
}

queue_depth() {
  local queue="$1"
  curl -s -u "$RABBITMQ_AUTH" "$RABBITMQ_MGMT/api/queues/%2f/$queue" 2>/dev/null \
    | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{console.log(JSON.parse(d).messages)}catch(e){console.log('')}})"
}

# 브로커가 지금까지 누적으로 재전송(redelivered=true로 다시 배달)한 메시지 수.
# message_stats 자체가 아직 한 번도 안 생겼으면(트래픽 0) 필드가 없을 수 있어 0으로 처리.
redeliver_count() {
  local queue="$1"
  curl -s -u "$RABBITMQ_AUTH" "$RABBITMQ_MGMT/api/queues/%2f/$queue" 2>/dev/null \
    | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const j=JSON.parse(d);console.log((j.message_stats&&j.message_stats.redeliver)||0)}catch(e){console.log(0)}})"
}

wait_for_drain() {
  local waited=0
  while true; do
    local depth
    depth=$(queue_depth "$QUEUE_MAIN_ENC")
    if [ "$depth" = "0" ]; then
      break
    fi
    if [ "$waited" -ge "$DRAIN_TIMEOUT_SECONDS" ]; then
      log "  ⚠ 메인 큐 드레인 타임아웃(${DRAIN_TIMEOUT_SECONDS}s, 마지막 depth=$depth)"
      break
    fi
    sleep 1
    waited=$((waited + 1))
  done
  local dlq_depth
  dlq_depth=$(queue_depth "$QUEUE_DLQ_ENC")
  echo "${waited},${dlq_depth}"
}

parse_summary_counters() {
  local file="$1"; shift
  local names_js
  names_js=$(node -e "console.log(JSON.stringify(process.argv.slice(1)))" "$@")
  node -e "
    const fs = require('fs');
    const names = $names_js;
    try {
      const s = JSON.parse(fs.readFileSync('$file', 'utf8'));
      const m = s.metrics || {};
      console.log(names.map((n) => (m[n] && m[n].count) || 0).join(','));
    } catch (e) {
      console.log(names.map(() => 'NA').join(','));
    }
  "
}

# stdout: "<mysql 등록 수>,<중복(user_id,class_id) 행 수>"
final_state_with_dupe_check() {
  local class_id="$1"
  $COMPOSE exec -T -e TARGET_CLASS_ID="$class_id" backend_1 node -e "
    const sequelize = require('./src/config/database');
    const Registration = require('./src/models/Registration');
    (async () => {
      await sequelize.authenticate();
      const n = await Registration.count({ where: { class_id: process.env.TARGET_CLASS_ID } });
      const [rows] = await sequelize.query(
        'SELECT COUNT(*) AS c FROM (SELECT user_id FROM registrations WHERE class_id = ? GROUP BY user_id HAVING COUNT(*) > 1) t',
        { replacements: [process.env.TARGET_CLASS_ID] }
      );
      console.log(n + ',' + rows[0].c);
      await sequelize.close();
    })();
  " 2>/dev/null | tail -1
}

run_one() {
  local rep="$1" worker="$2"
  local summary_file="$RAW_DIR/chaos-worker-kill-${CHAOS_TOTAL}-${rep}.json"

  log "rep=$rep (kill target=$worker, rate=$CHAOS_RATE/s, duration=${CHAOS_DURATION_SECONDS}s, kill_delay=${KILL_DELAY_SECONDS}s) 시작"
  reseed "$CHAOS_TOTAL"
  widen_capacity "$CLASS_ID" "$CHAOS_TOTAL"

  local redeliver_before; redeliver_before=$(redeliver_count "$QUEUE_MAIN_ENC")
  local started; started=$(date +%s)
  local k6_log="$RAW_DIR/.chaos-k6-stdout.log"

  $COMPOSE run --rm \
    -e RATE="$CHAOS_RATE" \
    -e DURATION_SECONDS="$CHAOS_DURATION_SECONDS" \
    -e TARGET_BASE_URL="$BASE_URL" \
    -e CLASS_ID="$CLASS_ID" \
    -e MAX_DURATION=10m \
    k6 run --out experimental-prometheus-rw \
      --summary-export="/raw/chaos-worker-kill-${CHAOS_TOTAL}-${rep}.json" \
      /scripts/chaos-worker-kill.js >"$k6_log" 2>&1 &
  local k6_pid=$!

  sleep "$KILL_DELAY_SECONDS"
  $COMPOSE kill -s SIGKILL "$worker" >/dev/null 2>&1
  log "  → $worker SIGKILL 발사 (트래픽 시작 후 ${KILL_DELAY_SECONDS}s, 목표 구간 ${CHAOS_DURATION_SECONDS}s)"

  wait "$k6_pid"
  local k6_exit=$?
  local ended; ended=$(date +%s)
  local duration=$((ended - started))

  # 실측 결과: 이 로컬 Docker Desktop 환경에서는 restart: unless-stopped 정책이
  # SIGKILL 후 자동으로 재기동하지 않는다(순정 alpine 컨테이너로도 재현 확인 —
  # doc/troubleshooting 참고). 그래서 자동 재기동을 기다리지 않고, 자동 재기동
  # 여부 자체를 auto_restarted로 기록한 뒤 다음 rep을 위해 수동으로 재기동한다.
  local auto_restarted="no"
  if $COMPOSE ps "$worker" 2>/dev/null | grep -q "Up"; then
    auto_restarted="yes"
  else
    $COMPOSE start "$worker" >/dev/null 2>&1
    sleep 2
  fi

  local status="ok"
  [ $k6_exit -ne 0 ] && status="k6_FAILED(exit=$k6_exit)"
  [ "$auto_restarted" = "no" ] && status="${status}+NO_AUTO_RESTART(manually-restarted)"

  local success="NA"
  if [ -f "$summary_file" ]; then
    success=$(parse_summary_counters "$summary_file" registration_success)
  fi

  local drain_result drain_wait dlq_depth
  drain_result=$(wait_for_drain)
  drain_wait=$(echo "$drain_result" | cut -d',' -f1)
  dlq_depth=$(echo "$drain_result" | cut -d',' -f2)
  [ "$dlq_depth" != "0" ] && status="${status}+DLQ_NONEMPTY($dlq_depth)"

  local redeliver_after redeliver_delta
  redeliver_after=$(redeliver_count "$QUEUE_MAIN_ENC")
  redeliver_delta=$((redeliver_after - redeliver_before))

  local db_state mysql_regs dupe_rows
  db_state=$(final_state_with_dupe_check "$CLASS_ID")
  mysql_regs=$(echo "$db_state" | cut -d',' -f1)
  dupe_rows=$(echo "$db_state" | cut -d',' -f2)
  [ "$dupe_rows" != "0" ] && status="${status}+DUPLICATE_ROWS($dupe_rows)"
  [ "$success" != "NA" ] && [ "$mysql_regs" != "$success" ] && status="${status}+COUNT_MISMATCH(success=$success,mysql=$mysql_regs)"
  [ "$redeliver_delta" -eq 0 ] && status="${status}+NO_REDELIVERY_OBSERVED(kill 타이밍이 처리 구간을 못 잡음)"

  echo "$rep,$worker,$CHAOS_TOTAL,$CHAOS_RATE,$CHAOS_DURATION_SECONDS,$KILL_DELAY_SECONDS,$started,$duration,$success,$mysql_regs,$dupe_rows,$redeliver_delta,$auto_restarted,$dlq_depth,$drain_wait,$status" >> "$CHAOS_LOG"
  log "  완료 (${duration}s, 드레인대기 ${drain_wait}s) k6성공=$success MySQL등록=$mysql_regs 중복행=$dupe_rows redeliver델타=$redeliver_delta 자동재기동=$auto_restarted DLQ=$dlq_depth | $status"

  [ "$PAUSE_SECONDS" -gt 0 ] && sleep "$PAUSE_SECONDS"
}

CHAOS_LOG="$RAW_DIR/run-log-chaos-worker-kill-$(date +%Y%m%d-%H%M%S).csv"
echo "rep,killed_worker,total_requests,rate_per_s,duration_s_planned,kill_delay_s,started_at_epoch,duration_s,k6_success,mysql_registrations,duplicate_rows,redeliver_delta,worker_auto_restarted,dlq_depth,drain_wait_s,status" > "$CHAOS_LOG"
log "카오스 테스트(워커 kill) 시작 — total=$CHAOS_TOTAL(rate=$CHAOS_RATE/s×${CHAOS_DURATION_SECONDS}s) reps=$CHAOS_REPS kill_delay=${KILL_DELAY_SECONDS}s"
log "결과 로그: $CHAOS_LOG"

for ((rep=1; rep<=CHAOS_REPS; rep++)); do
  # 홀수 rep은 worker_1, 짝수 rep은 worker_2를 죽여 양쪽 다 검증한다.
  if [ $((rep % 2)) -eq 1 ]; then
    target_worker="worker_1"
  else
    target_worker="worker_2"
  fi
  run_one "$rep" "$target_worker"
  log "진행 $rep/$CHAOS_REPS"
done

log "카오스 테스트 완료. 결과 로그: $CHAOS_LOG"
