#!/usr/bin/env bash
# 실험 02 Step 3(Valve Tuning, 이슈 #57) 한 라운드 실행기.
#
# 계획서(doc/experiment/02-대기열-방어-실험계획.md §4 Step3)는 라운드마다 사람이
# 판정(만족/불만족)하고 다음 Active 인원을 정하는 방식이라, 이 스크립트는 "한 라운드"만
# 맡고 다음 값 결정은 결과를 보고 사람이 한다(전체 8라운드를 자동 실행하지 않음).
#
# 사용법 (프로젝트 루트에서, 전체 스택이 이미 떠 있어야 함):
#   ./loadtest/scripts/run-valve-tuning-round.sh <ACTIVE_GATE_LIMIT> <VUS> [ROUND_LABEL]
#
# 예: ./loadtest/scripts/run-valve-tuning-round.sh 300 12000 r1
set -uo pipefail
export MSYS_NO_PATHCONV=1 # Git Bash가 /api/... 를 윈도우 경로로 오인하는 문제 방지 (트러블슈팅 04)

cd "$(dirname "$0")/../.." || exit 1

ACTIVE_GATE_LIMIT="${1:?사용법: run-valve-tuning-round.sh <ACTIVE_GATE_LIMIT> <VUS> [ROUND_LABEL]}"
VUS="${2:?VUS를 지정하세요}"
ROUND_LABEL="${3:-r$(date +%s)}"

COMPOSE="docker compose -f docker-compose.yml -f docker-compose.loadtest.yml"
RAW_DIR="doc/experiment/raw"
CLASS_ID="VALVE-TUNING-ROUND-${ROUND_LABEL}"
BASE_URL="${TARGET_BASE_URL:-http://nginx}"
THINK_TIME_MIN_S="${THINK_TIME_MIN_S:-15}"
THINK_TIME_MAX_S="${THINK_TIME_MAX_S:-45}"
MAX_WAIT_S="${MAX_WAIT_S:-1800}"

mkdir -p "$RAW_DIR"
log() { echo "[$(date '+%H:%M:%S')] $*"; }

log "=== 라운드 ${ROUND_LABEL}: ACTIVE_GATE_LIMIT=${ACTIVE_GATE_LIMIT}, VUS=${VUS}, CLASS_ID=${CLASS_ID} ==="

log "1) ACTIVE_GATE_LIMIT=${ACTIVE_GATE_LIMIT}로 backend 재기동"
ACTIVE_GATE_LIMIT="$ACTIVE_GATE_LIMIT" $COMPOSE up -d --force-recreate backend_1 backend_2 || exit 1
$COMPOSE restart nginx || exit 1 # nginx가 backend 재기동 시 업스트림 DNS를 재캐싱해야 함(트러블슈팅 05)
sleep 5

log "2) 이번 라운드 전용 과목(${CLASS_ID}) 준비 + 대기열/Active 게이트 초기화"
$COMPOSE exec -T -e CLASS_ID="$CLASS_ID" -e CAPACITY=20000 backend_1 node scripts/setupValveTuningRound.js || exit 1

log "3) 테스트 계정 ${VUS}개 재시딩 (JWT 1시간 만료라 라운드마다 새로 발급)"
$COMPOSE exec -T -e ACCOUNT_COUNT="$VUS" -e CLASS_ID="$CLASS_ID" -e OVERLAP_CLASS_ID="$CLASS_ID" backend_1 \
  node scripts/seedLoadTestAccounts.js || exit 1

log "4) k6 실행 (VUS=${VUS}, Think Time ${THINK_TIME_MIN_S}~${THINK_TIME_MAX_S}초, 최대 대기 ${MAX_WAIT_S}초)"
SUMMARY_FILE="/raw/queue-step3-${ROUND_LABEL}-active${ACTIVE_GATE_LIMIT}.json"
$COMPOSE run --rm \
  -e TARGET_BASE_URL="$BASE_URL" \
  -e CLASS_ID="$CLASS_ID" \
  -e VUS="$VUS" \
  -e THINK_TIME_MIN_S="$THINK_TIME_MIN_S" \
  -e THINK_TIME_MAX_S="$THINK_TIME_MAX_S" \
  -e MAX_WAIT_S="$MAX_WAIT_S" \
  k6 run --out experimental-prometheus-rw --summary-export "$SUMMARY_FILE" /scripts/queue-valve-tuning.js
K6_EXIT=$?

log "=== 라운드 ${ROUND_LABEL} 종료 (k6 exit=${K6_EXIT}). 결과: ${RAW_DIR}/$(basename "$SUMMARY_FILE") ==="
exit $K6_EXIT
