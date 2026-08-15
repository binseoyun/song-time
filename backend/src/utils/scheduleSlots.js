// 시간표 겹침 판정을 위한 5분 단위 슬롯 ID 계산.
// doc/portfolio/01-group-c-redis-설계-결정.md 1장: 실제 시드 데이터의 모든
// 시작/종료 시각이 5분 단위(00/15/30/45/50분)라 5분 그리드로 정확히 나눠떨어진다.
// 반개구간 [시작, 종료)로 슬롯을 잘라, "끝나는 시각에 바로 이어지는 수업"은
// 겹치지 않는 것으로(정확히) 처리한다.
const SLOT_MINUTES = 5;

// start/end: 'HH:MM' 또는 'HH:MM:SS' 문자열(Sequelize TIME 컬럼 형식)
function toMinutes(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
}

function formatSlotId(weekday, minutesFromMidnight) {
  const h = String(Math.floor(minutesFromMidnight / 60)).padStart(2, '0');
  const m = String(minutesFromMidnight % 60).padStart(2, '0');
  return `${weekday}-${h}${m}`;
}

// [startTime, endTime) 구간을 5분 슬롯 ID 배열로 변환한다.
function computeSlotIds(weekday, startTime, endTime) {
  const start = toMinutes(startTime);
  const end = toMinutes(endTime);
  const slots = [];
  for (let t = start; t < end; t += SLOT_MINUTES) {
    slots.push(formatSlotId(weekday, t));
  }
  return slots;
}

module.exports = { computeSlotIds, SLOT_MINUTES };
