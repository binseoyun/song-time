#!/usr/bin/env bash
# 실험계획서 01 정식 실행 오케스트레이터 (구현계획 Stage 0-8, 이슈 #15)
#
# 그룹(A=naive/B=pessimistic) x 동시성 수준 x 반복 횟수를 실험계획서 7장 절차대로
# A→B 교차 순서로 자동 실행한다. 매 회차: 계정 재시딩+대상 과목 초기화 → k6 실행
# (Prometheus로 실시간 push + --summary-export로 원본 JSON 저장) → 최종 DB 상태 확인
# → doc/experiment/raw/run-log-*.csv에 한 줄 기록.
#
# 사용법 (프로젝트 루트에서, 전체 스택이 이미 떠 있어야 함):
#   ./loadtest/scripts/run-experiment-01.sh
#
# 부분 실행 (예: 낮은 구간만 먼저, 반복 2회로 스모크):
#   LEVELS="50 100 300" REPS=2 ./loadtest/scripts/run-experiment-01.sh
#
# 중간에 멈춰도 안전: 이미 만들어진 summary JSON이 있는 (level, group, rep)는
# 건너뛴다 — 같은 명령을 다시 실행하면 이어서 진행된다.
#
# Grafana 실시간 관찰: 회차 하나가 몇 초 만에 끝나버리고 카운터도 매 회차 리셋되므로
# "화면 앞에서 실시간으로 지켜보기"는 사실상 어렵다. 대신 회차마다 실행 구간을 정확히
# 기록해서, 끝난 뒤 그 구간으로 바로 이동하는 Grafana 링크를 로그/CSV에 남긴다
# (PAUSE_SECONDS로 회차 사이 텀을 늘리면 그 짧은 순간 실시간으로 보는 것도 가능).
set -uo pipefail
# -e를 일부러 안 켠다: 회차 하나가 실패해도(타임아웃 등) 전체 배치를 멈추지 않고
# 실패로 기록한 뒤 다음 회차로 넘어간다 — 12,000명 구간처럼 붕괴가 "기대되는" 실험이라
# 실패 자체가 데이터이기 때문이다.

export MSYS_NO_PATHCONV=1 # Git Bash가 /api/... 를 윈도우 경로로 오인하는 문제 방지 (트러블슈팅 04)

cd "$(dirname "$0")/../.." || exit 1 # 프로젝트 루트로 이동 (loadtest/scripts/에서 두 단계 위)

COMPOSE="docker compose -f docker-compose.yml -f docker-compose.loadtest.yml"
RAW_DIR="doc/experiment/raw"
CLASS_ID="${CLASS_ID:-21001083-2}"
BASE_URL="${TARGET_BASE_URL:-http://nginx}"

# 실험계획서 01 6장: 기본 시나리오(500명 근사치 포함) + 7단계 스윕
LEVELS=(${LEVELS:-50 100 300 500 1000 3000 12000})
REPS="${REPS:-5}"
# 회차 사이 쉬는 시간(초). 기본은 짧게(자동 배치 위주). 직접 눈으로 몇 회차만 보고
# 싶으면 예: PAUSE_SECONDS=20 ./loadtest/scripts/run-experiment-01.sh
PAUSE_SECONDS="${PAUSE_SECONDS:-2}"
GRAFANA_URL="${GRAFANA_URL:-http://localhost:3300}"

mkdir -p "$RAW_DIR"
LOG_FILE="$RAW_DIR/run-log-$(date +%Y%m%d-%H%M%S).csv"
echo "level,group,rep,started_at_epoch,duration_s,k6_success,k6_rejected,k6_server_error,http_reqs,final_remaining_seats,final_registrations,status,grafana_url" > "$LOG_FILE"

# 회차의 실행 구간(약간 여유 포함)으로 바로 이동하는 Grafana 대시보드 링크를 만든다.
# group 변수까지 필터링해서 넘겨 그 회차의 그룹만 딱 보이게 한다.
grafana_link() {
  local group_path="$1" started="$2" ended="$3"
  local from_ms=$(( (started - 3) * 1000 ))
  local to_ms=$(( (ended + 5) * 1000 ))
  local encoded_group
  case "$group_path" in
    "/api/registrations/naive") encoded_group="%2Fapi%2Fregistrations%2Fnaive" ;;
    "/api/registrations/pessimistic") encoded_group="%2Fapi%2Fregistrations%2Fpessimistic" ;;
    *) encoded_group="$group_path" ;;
  esac
  echo "${GRAFANA_URL}/d/registration-loadtest/experiment-01?orgId=1&from=${from_ms}&to=${to_ms}&var-group=${encoded_group}"
}

log() { echo "[$(date '+%H:%M:%S')] $*"; }

# --- 사전 점검: 스택이 떠 있는지 ---
if ! $COMPOSE ps backend 2>/dev/null | grep -q "Up"; then
  echo "backend 컨테이너가 안 떠 있습니다. 먼저 다음을 실행하세요:"
  echo "  docker compose -f docker-compose.yml -f docker-compose.loadtest.yml up -d"
  exit 1
fi

reseed() {
  local vus="$1"
  $COMPOSE exec -T -e ACCOUNT_COUNT="$vus" -e CLASS_ID="$CLASS_ID" backend \
    node scripts/seedLoadTestAccounts.js >/dev/null 2>&1
}

# stdout: "<remainingSeats>,<registrationsCount>"
final_db_state() {
  $COMPOSE exec -T -e CLASS_ID="$CLASS_ID" backend node -e "
    const sequelize = require('./src/config/database');
    const Class = require('./src/models/Class');
    const Registration = require('./src/models/Registration');
    (async () => {
      const c = await Class.findByPk(process.env.CLASS_ID);
      const n = await Registration.count({ where: { class_id: process.env.CLASS_ID } });
      console.log(c.remainingSeats + ',' + n);
      await sequelize.close();
    })();
  " 2>/dev/null | tail -1
}

# k6 --summary-export JSON에서 필드를 뽑는다. 카운트가 0인 커스텀 Counter는
# summary JSON에 아예 안 나타나므로(실측 확인) 없으면 0으로 취급한다.
parse_summary() {
  local file="$1"
  node -e "
    const fs = require('fs');
    try {
      const s = JSON.parse(fs.readFileSync('$file', 'utf8'));
      const m = s.metrics || {};
      const get = (name) => (m[name] && m[name].count) || 0;
      console.log([get('registration_success'), get('registration_rejected'), get('registration_server_error'), get('http_reqs')].join(','));
    } catch (e) {
      console.log('NA,NA,NA,NA');
    }
  "
}

run_one() {
  local group_path="$1" group_label="$2" vus="$3" rep="$4"
  local summary_file="$RAW_DIR/group${group_label}-${vus}-${rep}.json"

  if [ -f "$summary_file" ]; then
    log "Group $group_label / VUS=$vus / rep=$rep — 이미 있음, 건너뜀"
    return
  fi

  log "Group $group_label / VUS=$vus / rep=$rep 시작"
  local started
  started=$(date +%s)

  reseed "$vus"

  local stdout_log="$RAW_DIR/.last-run-stdout.log"
  $COMPOSE run --rm \
    -e TARGET_PATH="$group_path" \
    -e VUS="$vus" \
    -e TARGET_BASE_URL="$BASE_URL" \
    -e CLASS_ID="$CLASS_ID" \
    -e MAX_DURATION=10m \
    k6 run --out experimental-prometheus-rw \
      --summary-export="/raw/group${group_label}-${vus}-${rep}.json" \
      /scripts/registration.js >"$stdout_log" 2>&1
  local exit_code=$?

  local ended duration status
  ended=$(date +%s)
  duration=$((ended - started))
  status="ok"
  if [ $exit_code -ne 0 ]; then
    status="FAILED(exit=$exit_code)"
    log "  ⚠ 실행 실패 (exit=$exit_code, ${duration}s) — 로그: $stdout_log (다음 회차로 계속 진행)"
  fi

  local parsed success rejected servererr reqs
  if [ -f "$summary_file" ]; then
    parsed=$(parse_summary "$summary_file")
  else
    parsed="NA,NA,NA,NA"
    status="FAILED(no-summary)"
  fi
  IFS=',' read -r success rejected servererr reqs <<< "$parsed"

  local db_state remaining regs
  db_state=$(final_db_state)
  remaining=$(echo "$db_state" | cut -d',' -f1)
  regs=$(echo "$db_state" | cut -d',' -f2)

  local link
  link=$(grafana_link "$group_path" "$started" "$ended")

  echo "$vus,$group_label,$rep,$started,$duration,$success,$rejected,$servererr,$reqs,$remaining,$regs,$status,$link" >> "$LOG_FILE"
  log "  완료 (${duration}s) success=$success rejected=$rejected error=$servererr | DB: remainingSeats=$remaining registrations=$regs | $status"
  log "  Grafana: $link"

  if [ "$PAUSE_SECONDS" -gt 0 ]; then
    sleep "$PAUSE_SECONDS"
  fi
}

log "실험 01 시작 — levels=(${LEVELS[*]}) reps=$REPS"
log "결과 로그: $LOG_FILE"
log "원본 요약(JSON): $RAW_DIR/group<A|B>-<VUS>-<rep>.json"

total=$(( ${#LEVELS[@]} * REPS * 2 ))
done_count=0

for vus in "${LEVELS[@]}"; do
  for ((rep=1; rep<=REPS; rep++)); do
    run_one "/api/registrations/naive" "A" "$vus" "$rep"
    done_count=$((done_count + 1))
    run_one "/api/registrations/pessimistic" "B" "$vus" "$rep"
    done_count=$((done_count + 1))
    log "진행 ${done_count}/${total}"
  done
done

log "전체 완료. 결과 로그: $LOG_FILE"
log "원본 JSON: $RAW_DIR/group*-*.json"
