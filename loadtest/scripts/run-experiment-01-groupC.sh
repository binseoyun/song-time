#!/usr/bin/env bash
# 실험계획서 01 Group C 정식 실행 오케스트레이터 (구현계획 Stage 1-7, 이슈 #29)
#
# run-experiment-01.sh(Group A/B, 이슈 #15)를 Group C용으로 확장한다. A/B와 다른 점 세 가지:
#   1. 매 회차 전 MySQL뿐 아니라 Redis도 같이 리시딩해야 한다(seedRedisRegistrations.js).
#   2. Group C는 MySQL 반영이 RabbitMQ 워커를 통해 비동기로 일어나므로, 부하가 끝난
#      직후 곧바로 DB를 읽으면 안 된다 — 메인 큐 깊이가 0이 될 때까지 기다리고,
#      DLQ(격리된 채 DB에 영영 안 반영된 메시지)가 비어있는지까지 확인한 뒤에야
#      "최종 상태"를 신뢰할 수 있다(실험계획서 7장 4번, "조용한 유실" 방지).
#   3. 좌석 카운터를 MySQL이 아니라 Redis가 들고 있으므로(Class.remainingSeats는
#      Group C 경로에서 아예 안 건드림), 정합성 판정의 "잔여 좌석" 지표를 Redis에서
#      읽는다. registrations 행 수(MySQL)는 A/B와 동일하게 그대로 비교 가능.
#
# 두 가지 실행 모드가 있다:
#   SWEEP: 정합성 스윕(50~12,000명 × 5회, A/B와 동일 조건) — 기본 모드
#   ABUSE: 어뷰징 시나리오(macro/overlap, registration-abuse.js) — ABUSE=1로 켬
#
# 사용법 (프로젝트 루트에서, 전체 스택이 이미 떠 있어야 함):
#   ./loadtest/scripts/run-experiment-01-groupC.sh                # 정합성 스윕
#   ABUSE=1 ./loadtest/scripts/run-experiment-01-groupC.sh         # 어뷰징 시나리오
#
# 부분 실행 예:
#   LEVELS="50 100" REPS=2 ./loadtest/scripts/run-experiment-01-groupC.sh
#   ABUSE=1 ABUSE_LEVELS="3000" ABUSE_REPS=1 ./loadtest/scripts/run-experiment-01-groupC.sh
#
# 중간에 멈춰도 안전: 이미 만들어진 summary JSON이 있는 회차는 건너뛴다.
set -uo pipefail
# -e를 일부러 안 켠다: run-experiment-01.sh와 동일한 이유(회차 하나 실패해도 배치 계속).

export MSYS_NO_PATHCONV=1 # Git Bash가 /api/... 를 윈도우 경로로 오인하는 문제 방지 (트러블슈팅 04)

cd "$(dirname "$0")/../.." || exit 1 # 프로젝트 루트로 이동

COMPOSE="docker compose -f docker-compose.yml -f docker-compose.loadtest.yml"
RAW_DIR="doc/experiment/raw"
CLASS_ID="${CLASS_ID:-21001083-2}"
OVERLAP_CLASS_ID="${OVERLAP_CLASS_ID:-21002144-1}"
BASE_URL="${TARGET_BASE_URL:-http://nginx}"
GRAFANA_URL="${GRAFANA_URL:-http://localhost:3300}"
PAUSE_SECONDS="${PAUSE_SECONDS:-2}"

# RabbitMQ 관리 API(로컬 전용 게스트 계정, docker-compose.yml 주석 참고)
RABBITMQ_MGMT="${RABBITMQ_MGMT:-http://localhost:15672}"
RABBITMQ_AUTH="guest:guest"
QUEUE_MAIN_ENC="registration.persist"
QUEUE_DLQ_ENC="registration.persist.dlq"
DRAIN_TIMEOUT_SECONDS="${DRAIN_TIMEOUT_SECONDS:-120}"

ABUSE="${ABUSE:-0}"
LEVELS=(${LEVELS:-50 100 300 500 1000 3000 12000})
REPS="${REPS:-5}"
ABUSE_LEVELS=(${ABUSE_LEVELS:-3000 12000})
ABUSE_REPS="${ABUSE_REPS:-3}"
MACRO_REQUESTS="${MACRO_REQUESTS:-5}"

mkdir -p "$RAW_DIR"

log() { echo "[$(date '+%H:%M:%S')] $*"; }

# --- 사전 점검 ---
if ! $COMPOSE ps backend 2>/dev/null | grep -q "Up"; then
  echo "backend 컨테이너가 안 떠 있습니다. 먼저 다음을 실행하세요:"
  echo "  docker compose -f docker-compose.yml -f docker-compose.loadtest.yml up -d"
  exit 1
fi
if ! curl -s -u "$RABBITMQ_AUTH" "$RABBITMQ_MGMT/api/overview" >/dev/null 2>&1; then
  echo "RabbitMQ 관리 API($RABBITMQ_MGMT)에 접속할 수 없습니다. rabbitmq 컨테이너 상태를 확인하세요."
  exit 1
fi

reseed() {
  local vus="$1"
  $COMPOSE exec -T -e ACCOUNT_COUNT="$vus" -e CLASS_ID="$CLASS_ID" -e OVERLAP_CLASS_ID="$OVERLAP_CLASS_ID" \
    backend node scripts/seedLoadTestAccounts.js >/dev/null 2>&1
  $COMPOSE exec -T -e CLASS_ID="$CLASS_ID" -e OVERLAP_CLASS_ID="$OVERLAP_CLASS_ID" \
    backend node scripts/seedRedisRegistrations.js >/dev/null 2>&1
}

# 큐 깊이(messages) 하나를 정수로 반환. 조회 실패 시 빈 문자열.
queue_depth() {
  local queue="$1"
  curl -s -u "$RABBITMQ_AUTH" "$RABBITMQ_MGMT/api/queues/%2f/$queue" 2>/dev/null \
    | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{console.log(JSON.parse(d).messages)}catch(e){console.log('')}})"
}

# 메인 큐가 빌 때까지 폴링 대기. stdout: "<대기시간(초)>,<DLQ깊이>"
# DRAIN_TIMEOUT_SECONDS를 넘기면 대기를 포기하고 그 시점의 값을 그대로 반환한다
# (타임아웃 자체가 "재시도가 안 끝났거나 DLQ로 격리되는 중"이라는 데이터이므로 기록은 남긴다).
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

# stdout: "<redis 잔여좌석>,<MySQL registrations 수>"
final_db_state() {
  local class_id="$1"
  $COMPOSE exec -T -e TARGET_CLASS_ID="$class_id" backend node -e "
    const sequelize = require('./src/config/database');
    const redis = require('./src/config/redis');
    const Registration = require('./src/models/Registration');
    const { classSeatsKey } = require('./src/utils/redisKeys');
    (async () => {
      await sequelize.authenticate();
      const seats = await redis.get(classSeatsKey(process.env.TARGET_CLASS_ID));
      const n = await Registration.count({ where: { class_id: process.env.TARGET_CLASS_ID } });
      console.log(seats + ',' + n);
      await sequelize.close();
      redis.disconnect();
    })();
  " 2>/dev/null | tail -1
}

grafana_link() {
  local started="$1" ended="$2"
  local from_ms=$(( (started - 3) * 1000 ))
  local to_ms=$(( (ended + 5) * 1000 ))
  echo "${GRAFANA_URL}/d/registration-loadtest/experiment-01?orgId=1&from=${from_ms}&to=${to_ms}&var-group=%2Fapi%2Fregistrations%2Fredis"
}

parse_summary_counters() {
  # 임의 개수의 카운터 이름을 받아 콤마로 이어붙여 출력한다.
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

# ============ SWEEP 모드 ============
run_sweep_one() {
  local vus="$1" rep="$2"
  local summary_file="$RAW_DIR/groupC-${vus}-${rep}.json"

  if [ -f "$summary_file" ]; then
    log "Group C / VUS=$vus / rep=$rep — 이미 있음, 건너뜀"
    return
  fi

  log "Group C / VUS=$vus / rep=$rep 시작"
  local started; started=$(date +%s)
  reseed "$vus"

  local stdout_log="$RAW_DIR/.last-run-stdout.log"
  $COMPOSE run --rm \
    -e TARGET_PATH="/api/registrations/redis" \
    -e VUS="$vus" \
    -e TARGET_BASE_URL="$BASE_URL" \
    -e CLASS_ID="$CLASS_ID" \
    -e MAX_DURATION=10m \
    k6 run --out experimental-prometheus-rw \
      --summary-export="/raw/groupC-${vus}-${rep}.json" \
      /scripts/registration.js >"$stdout_log" 2>&1
  local exit_code=$?
  local ended; ended=$(date +%s)
  local duration=$((ended - started))

  local status="ok"
  if [ $exit_code -ne 0 ]; then
    status="FAILED(exit=$exit_code)"
    log "  ⚠ k6 실행 실패 (exit=$exit_code, ${duration}s) — 로그: $stdout_log"
  fi

  local parsed; parsed="NA,NA,NA,NA"
  if [ -f "$summary_file" ]; then
    parsed=$(parse_summary_counters "$summary_file" registration_success registration_rejected registration_server_error http_reqs)
  else
    status="FAILED(no-summary)"
  fi
  IFS=',' read -r success rejected servererr reqs <<< "$parsed"

  local drain_result drain_wait dlq_depth
  drain_result=$(wait_for_drain)
  drain_wait=$(echo "$drain_result" | cut -d',' -f1)
  dlq_depth=$(echo "$drain_result" | cut -d',' -f2)
  if [ "$dlq_depth" != "0" ]; then
    log "  ⚠ DLQ에 메시지 $dlq_depth 건 남아있음 — 조용한 유실 가능성"
    status="${status}+DLQ_NONEMPTY($dlq_depth)"
  fi

  local db_state redis_seats mysql_regs
  db_state=$(final_db_state "$CLASS_ID")
  redis_seats=$(echo "$db_state" | cut -d',' -f1)
  mysql_regs=$(echo "$db_state" | cut -d',' -f2)

  local link; link=$(grafana_link "$started" "$ended")
  echo "$vus,$rep,$started,$duration,$success,$rejected,$servererr,$reqs,$redis_seats,$mysql_regs,$dlq_depth,$drain_wait,$status,$link" >> "$SWEEP_LOG"
  log "  완료 (${duration}s, 드레인대기 ${drain_wait}s) success=$success rejected=$rejected error=$servererr | Redis잔여좌석=$redis_seats MySQL등록=$mysql_regs DLQ=$dlq_depth | $status"

  [ "$PAUSE_SECONDS" -gt 0 ] && sleep "$PAUSE_SECONDS"
}

run_sweep() {
  SWEEP_LOG="$RAW_DIR/run-log-groupC-$(date +%Y%m%d-%H%M%S).csv"
  echo "vus,rep,started_at_epoch,duration_s,k6_success,k6_rejected,k6_server_error,http_reqs,redis_remaining_seats,mysql_registrations,dlq_depth,drain_wait_s,status,grafana_url" > "$SWEEP_LOG"
  log "Group C 정합성 스윕 시작 — levels=(${LEVELS[*]}) reps=$REPS"
  log "결과 로그: $SWEEP_LOG"

  local total=$(( ${#LEVELS[@]} * REPS ))
  local done_count=0
  for vus in "${LEVELS[@]}"; do
    for ((rep=1; rep<=REPS; rep++)); do
      run_sweep_one "$vus" "$rep"
      done_count=$((done_count + 1))
      log "진행 ${done_count}/${total}"
    done
  done
  log "정합성 스윕 완료. 결과 로그: $SWEEP_LOG"
}

# ============ ABUSE 모드 ============
run_abuse_one() {
  local scenario="$1" vus="$2" rep="$3"
  local summary_file="$RAW_DIR/groupC-abuse-${scenario}-${vus}-${rep}.json"

  if [ -f "$summary_file" ]; then
    log "Abuse[$scenario] / VUS=$vus / rep=$rep — 이미 있음, 건너뜀"
    return
  fi

  log "Abuse[$scenario] / VUS=$vus / rep=$rep 시작"
  local started; started=$(date +%s)
  reseed "$vus"

  local stdout_log="$RAW_DIR/.last-run-stdout.log"
  $COMPOSE run --rm \
    -e SCENARIO="$scenario" \
    -e VUS="$vus" \
    -e MACRO_REQUESTS="$MACRO_REQUESTS" \
    -e TARGET_BASE_URL="$BASE_URL" \
    -e CLASS_ID="$CLASS_ID" \
    -e OVERLAP_CLASS_ID="$OVERLAP_CLASS_ID" \
    -e MAX_DURATION=10m \
    k6 run --out experimental-prometheus-rw \
      --summary-export="/raw/groupC-abuse-${scenario}-${vus}-${rep}.json" \
      /scripts/registration-abuse.js >"$stdout_log" 2>&1
  local exit_code=$?
  local ended; ended=$(date +%s)
  local duration=$((ended - started))

  local status="ok"
  [ $exit_code -ne 0 ] && status="FAILED(exit=$exit_code)"

  local parsed
  if [ "$scenario" = "macro" ]; then
    parsed=$(parse_summary_counters "$summary_file" abuse_macro_success abuse_macro_duplicate_rejected abuse_macro_unexpected abuse_macro_atomicity_violation)
  else
    parsed=$(parse_summary_counters "$summary_file" abuse_overlap_first_success abuse_overlap_second_rejected abuse_overlap_unexpected)
  fi

  local drain_result drain_wait dlq_depth
  drain_result=$(wait_for_drain)
  drain_wait=$(echo "$drain_result" | cut -d',' -f1)
  dlq_depth=$(echo "$drain_result" | cut -d',' -f2)
  [ "$dlq_depth" != "0" ] && status="${status}+DLQ_NONEMPTY($dlq_depth)"

  local target_regs overlap_regs
  target_regs=$(final_db_state "$CLASS_ID" | cut -d',' -f2)
  overlap_regs=$(final_db_state "$OVERLAP_CLASS_ID" | cut -d',' -f2)

  echo "$scenario,$vus,$rep,$started,$duration,$parsed,$target_regs,$overlap_regs,$dlq_depth,$drain_wait,$status" >> "$ABUSE_LOG"
  log "  완료 (${duration}s, 드레인대기 ${drain_wait}s) [$parsed] | MySQL target=$target_regs overlap=$overlap_regs DLQ=$dlq_depth | $status"

  [ "$PAUSE_SECONDS" -gt 0 ] && sleep "$PAUSE_SECONDS"
}

run_abuse() {
  ABUSE_LOG="$RAW_DIR/run-log-groupC-abuse-$(date +%Y%m%d-%H%M%S).csv"
  echo "scenario,vus,rep,started_at_epoch,duration_s,metric1,metric2,metric3,metric4,mysql_target_registrations,mysql_overlap_registrations,dlq_depth,drain_wait_s,status" > "$ABUSE_LOG"
  log "Group C 어뷰징 시나리오 시작 — levels=(${ABUSE_LEVELS[*]}) reps=$ABUSE_REPS"
  log "결과 로그: $ABUSE_LOG"

  local total=$(( ${#ABUSE_LEVELS[@]} * ABUSE_REPS * 2 ))
  local done_count=0
  for vus in "${ABUSE_LEVELS[@]}"; do
    for ((rep=1; rep<=ABUSE_REPS; rep++)); do
      run_abuse_one "macro" "$vus" "$rep"
      done_count=$((done_count + 1))
      run_abuse_one "overlap" "$vus" "$rep"
      done_count=$((done_count + 1))
      log "진행 ${done_count}/${total}"
    done
  done
  log "어뷰징 시나리오 완료. 결과 로그: $ABUSE_LOG"
}

if [ "$ABUSE" = "1" ]; then
  run_abuse
else
  run_sweep
fi
