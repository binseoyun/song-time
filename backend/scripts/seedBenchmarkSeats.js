/**
 * AI 챗봇 Tool 라우팅 평가(backend/ai-server/eval)용 결정적 좌석 픽스처.
 *
 * 평가 하네스는 실제 Node API → Redis `class:{id}:seats`를 그대로 읽는다(ADR-013).
 * 그런데 실사용 Redis 상태는 "실시간 수강신청 연습" 탭 사용량에 따라 들쭉날쭉하고,
 * `seedAllClassSeats.js` 직후엔 대부분 과목이 정원=잔여석(등록이 거의 없음)이라
 * "잔여석/분반비교" 시나리오가 변별력을 잃는다.
 *
 * 이 스크립트는 questions.yaml의 잔여석/분반비교 시나리오가 참조하는 과목들에
 * 고정된 좌석 값을 심는다. 값은 의도적으로 `capacity - enrolled`(구 챗봇이 잘못
 * 쓰던 소스)와 다르게 잡아, Before/After 측정에서 "구 방식은 틀린 좌석을 답한다"가
 * 드러나도록 했다.
 *
 * 실행 (docker-compose 스택이 떠 있어야 함):
 *   docker compose exec backend_1 node scripts/seedBenchmarkSeats.js
 *
 * 멱등하다. 평가 재현 시 seedAllClassSeats.js → 이 스크립트 순으로 실행한다.
 * 픽스처에 없는 과목은 건드리지 않는다.
 */
const redis = require('../src/config/redis');
const { classSeatsKey } = require('../src/utils/redisKeys');

// code -> 실시간 잔여석. 주석은 (정원, capacity-enrolled=구 챗봇이 답하던 값).
const FIXTURE = {
  '21003735-1': 8,   // 클라우드시스템        (40, 1)
  '21000203-1': 15,  // 독일어Ⅰ              (40, 0)  ← 구 방식은 "마감"이라 답함
  '21003683-1': 6,   // 프로그래밍방법론       (93, 1)
  '21105364-1': 30,  // 인공지능입문          (97, 1)
  '21102905-1': 60,  // 데이터마이닝및분석     (132, 9)
  '21105229-1': 20,  // 파이썬데이터분석       (103, 4)
  '21000555-1': 23,  // 소프트웨어공학        (80, 14)
  '21003187-1': 25,  // 영상정보처리          (50, 13)
  '21002031-1': 17,  // 네트워크보안          (92, 3)
  // 분반비교 세트 — note의 "자리 제일 많은 분반" 결론이 유지되도록 잡음
  '21003183-1': 40,  // 데이터베이스설계와질의 1  (60, 19)  → 최다
  '21003183-2': 3,   // 데이터베이스설계와질의 2  (61, 2)
  '21003183-3': 22,  // 데이터베이스설계와질의 3  (50, 19)
  '21000557-1': 25,  // 자바프로그래밍 1(창병모)  (50, 20)  → 최다
  '21000557-2': 4,   // 자바프로그래밍 2         (40, 3)  → 신청자 36 (enrolled 37과 다름)
  '21000557-3': 12,  // 자바프로그래밍 3         (40, 1)
  '21002147-1': 30,  // 컴퓨터수학 1            (60, 44)
  '21002147-2': 12,  // 컴퓨터수학 2            (100, 6)
  '21002147-3': 4,   // 컴퓨터수학 3            (80, 20)
  '21102525-1': 8,   // 공학수학I 1            (60, 13)
  '21102525-2': 40,  // 공학수학I 2            (60, 31)  → 최다
  '21102525-3': 2,   // 공학수학I 3            (60, 7)
};

async function main() {
  for (const [code, seats] of Object.entries(FIXTURE)) {
    await redis.set(classSeatsKey(code), seats);
    console.log(`✓ ${code}: 잔여석 ${seats}`);
  }
  console.log(`\n픽스처 ${Object.keys(FIXTURE).length}개 과목 반영 완료.`);
  redis.disconnect();
}

main().catch((error) => {
  console.error('벤치마크 좌석 픽스처 실패:', error);
  process.exitCode = 1;
});
