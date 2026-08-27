/**
 * 데이터베이스 초기 데이터 삽입 스크립트
 * 사용: node seedData.js
 *
 * 데이터 출처: 숙명여자대학교 2026학년도 2학기 소프트웨어학부 개설과목조회(전공필수/전공선택).
 * 사용자 제공 캡쳐(Notion) + 강의계획서 PDF 19개 대조. (이슈 #89)
 *   - enrolled  = 개설과목조회의 "신청" 인원. 이 앱에서는 관심 등록 수 카운터로 재사용된다
 *                 (수업 목록 UI의 "n/M명"의 n, 챗봇 interest_count 소스 — ADR-013 재검토, #93).
 *   - 챗봇 "잔여석"은 이 값이 아니라 실시간 수강신청 Redis(class:{id}:seats)에서 온다(#86).
 *                 Redis 좌석은 seedAllClassSeats.js가 별도로 (재)시딩한다.
 *   - schedules = 요일별 강의시간 + 강의실(location)
 *   - department = '소프트웨어학부' 단일값
 * 스키마는 기존 그대로(Class / ClassSchedule / seedDatabase()). courseData만 교체했다.
 * 22개 과목 / 37개 분반. 강의계획서 PDF가 있는 17과목 전부 포함(RAG 데모 대상) + 그 외 5과목.
 */

const sequelize = require('./config/database');
const Class = require('./models/Class');
const ClassSchedule = require('./models/ClassSchedule');

// 새 스키마에 맞는 초기 데이터 (Class 필드 + schedules 배열)
const courseData = [
  // ===== 전공필수 =====
  {
    code: '21001710-1', name: '디지털논리회로', professor: '정영주', credits: 3,
    capacity: 50, enrolled: 50, department: '소프트웨어학부', courseType: '전공필수',
    schedules: [
      { day: '월', start_time: '10:30', end_time: '11:45', location: '명신관319' },
      { day: '수', start_time: '10:30', end_time: '11:45', location: '명신관104' },
    ],
  },
  {
    code: '21001710-2', name: '디지털논리회로', professor: '정영주', credits: 3,
    capacity: 60, enrolled: 60, department: '소프트웨어학부', courseType: '전공필수',
    schedules: [
      { day: '월', start_time: '12:00', end_time: '13:15', location: '명신관423' },
      { day: '수', start_time: '12:00', end_time: '13:15', location: '명신관104' },
    ],
  },
  {
    code: '21000549-1', name: '알고리즘', professor: '안태훈', credits: 3,
    capacity: 100, enrolled: 84, department: '소프트웨어학부', courseType: '전공필수',
    schedules: [
      { day: '화', start_time: '09:00', end_time: '10:15', location: '명신관215' },
      { day: '목', start_time: '09:00', end_time: '10:15', location: '명신관215' },
    ],
  },
  {
    code: '21000549-2', name: '알고리즘', professor: '안태훈', credits: 3,
    capacity: 90, enrolled: 90, department: '소프트웨어학부', courseType: '전공필수',
    schedules: [
      { day: '화', start_time: '10:30', end_time: '11:45', location: '프라임관104' },
      { day: '목', start_time: '10:30', end_time: '11:45', location: '프라임관104' },
    ],
  },

  // ===== 전공선택 =====
  {
    code: '21001083-1', name: '경영정보시스템', professor: '서보밀', credits: 3,
    capacity: 50, enrolled: 22, department: '소프트웨어학부', courseType: '전공선택',
    schedules: [
      { day: '화', start_time: '15:00', end_time: '16:15', location: '명신관525' },
      { day: '목', start_time: '15:00', end_time: '16:15', location: '명신관525' },
    ],
  },
  {
    code: '21001083-2', name: '경영정보시스템', professor: '한은정', credits: 3,
    capacity: 50, enrolled: 25, department: '소프트웨어학부', courseType: '전공선택',
    schedules: [
      { day: '월', start_time: '10:30', end_time: '11:45', location: '명신관505' },
      { day: '수', start_time: '10:30', end_time: '11:45', location: '명신관505' },
    ],
  },
  {
    code: '21001083-3', name: '경영정보시스템', professor: '서보밀', credits: 3,
    capacity: 50, enrolled: 41, department: '소프트웨어학부', courseType: '전공선택',
    schedules: [
      { day: '화', start_time: '13:30', end_time: '14:45', location: '명신관525' },
      { day: '목', start_time: '13:30', end_time: '14:45', location: '명신관525' },
    ],
  },
  {
    code: '21001083-4', name: '경영정보시스템', professor: '한은정', credits: 3,
    capacity: 50, enrolled: 50, department: '소프트웨어학부', courseType: '전공선택',
    schedules: [
      { day: '월', start_time: '13:30', end_time: '14:45', location: '명신관605' },
      { day: '수', start_time: '13:30', end_time: '14:45', location: '명신관605' },
    ],
  },
  {
    code: '21001083-5', name: '경영정보시스템', professor: '한은정', credits: 3,
    capacity: 50, enrolled: 24, department: '소프트웨어학부', courseType: '전공선택',
    schedules: [
      { day: '월', start_time: '15:00', end_time: '16:15', location: '명신관605' },
      { day: '수', start_time: '15:00', end_time: '16:15', location: '명신관605' },
    ],
  },
  {
    code: '21002031-1', name: '네트워크보안', professor: '박영훈', credits: 3,
    capacity: 83, enrolled: 81, department: '소프트웨어학부', courseType: '전공선택',
    schedules: [
      { day: '화', start_time: '09:00', end_time: '10:15', location: '프라임관201' },
      { day: '목', start_time: '09:00', end_time: '10:15', location: '프라임관201' },
    ],
  },
  {
    code: '21009627-1', name: '논리및논술(정보·컴퓨터)', professor: '이현자', credits: 3,
    capacity: 50, enrolled: 10, department: '소프트웨어학부', courseType: '전공선택',
    schedules: [
      { day: '화', start_time: '10:30', end_time: '11:45', location: '명신관313' },
      { day: '목', start_time: '10:30', end_time: '11:45', location: '명신관313' },
    ],
  },
  {
    code: '21003183-1', name: '데이터베이스설계와질의', professor: '심준호', credits: 3,
    capacity: 60, enrolled: 45, department: '소프트웨어학부', courseType: '전공선택',
    schedules: [
      { day: '월', start_time: '10:30', end_time: '11:45', location: '명신관520' },
      { day: '수', start_time: '10:30', end_time: '11:45', location: '명신관520' },
    ],
  },
  {
    code: '21003183-2', name: '데이터베이스설계와질의', professor: '심준호', credits: 3,
    capacity: 60, enrolled: 60, department: '소프트웨어학부', courseType: '전공선택',
    schedules: [
      { day: '월', start_time: '13:30', end_time: '14:45', location: '명신관413' },
      { day: '수', start_time: '13:30', end_time: '14:45', location: '명신관413' },
    ],
  },
  {
    code: '21003183-3', name: '데이터베이스설계와질의', professor: '심준호', credits: 3,
    capacity: 50, enrolled: 36, department: '소프트웨어학부', courseType: '전공선택',
    schedules: [
      { day: '화', start_time: '10:30', end_time: '11:45', location: '명신관602' },
      { day: '목', start_time: '10:30', end_time: '11:45', location: '명신관602' },
    ],
  },
  {
    code: '21105803-1', name: '데이터사이언스응용', professor: '조선영', credits: 3,
    capacity: 40, enrolled: 24, department: '소프트웨어학부', courseType: '전공선택',
    schedules: [
      { day: '월', start_time: '13:30', end_time: '15:20', location: '명신관313' },
      { day: '수', start_time: '13:30', end_time: '15:20', location: '명신관313' },
    ],
  },
  {
    code: '21105625-1', name: '딥러닝개론', professor: '홍기범', credits: 3,
    capacity: 80, enrolled: 80, department: '소프트웨어학부', courseType: '전공선택',
    schedules: [
      { day: '화', start_time: '10:30', end_time: '11:45', location: '프라임관201' },
      { day: '목', start_time: '10:30', end_time: '11:45', location: '프라임관201' },
    ],
  },
  {
    code: '21001713-1', name: '리눅스시스템', professor: '창병모', credits: 3,
    capacity: 70, enrolled: 68, department: '소프트웨어학부', courseType: '전공선택',
    schedules: [
      { day: '월', start_time: '10:00', end_time: '11:50', location: '프라임관104' },
      { day: '수', start_time: '10:00', end_time: '11:50', location: '프라임관104' },
    ],
  },
  {
    code: '21001713-2', name: '리눅스시스템', professor: '창병모', credits: 3,
    capacity: 70, enrolled: 32, department: '소프트웨어학부', courseType: '전공선택',
    schedules: [
      { day: '화', start_time: '15:00', end_time: '16:50', location: '프라임관302' },
      { day: '목', start_time: '15:00', end_time: '16:50', location: '프라임관302' },
    ],
  },
  {
    code: '21003757-1', name: '모바일소프트웨어', professor: '박숙영', credits: 3,
    capacity: 40, enrolled: 25, department: '소프트웨어학부', courseType: '전공선택',
    schedules: [
      { day: '화', start_time: '13:30', end_time: '14:45', location: '명신관101' },
      { day: '목', start_time: '13:30', end_time: '14:45', location: '명신관101' },
    ],
  },
  {
    code: '21000555-1', name: '소프트웨어공학', professor: '김유경', credits: 3,
    capacity: 70, enrolled: 70, department: '소프트웨어학부', courseType: '전공선택',
    schedules: [
      { day: '월', start_time: '15:00', end_time: '16:15', location: '명신관207' },
      { day: '수', start_time: '15:00', end_time: '16:15', location: '명신관207' },
    ],
  },
  {
    code: '21003917-1', name: '소프트웨어의이해', professor: '유석종', credits: 3,
    capacity: 80, enrolled: 50, department: '소프트웨어학부', courseType: '전공선택',
    schedules: [
      { day: '월', start_time: '10:30', end_time: '11:45', location: '명신관421' },
      { day: '수', start_time: '10:30', end_time: '11:45', location: '명신관421' },
    ],
  },
  {
    code: '21003187-1', name: '영상정보처리', professor: '정영주', credits: 3,
    capacity: 50, enrolled: 36, department: '소프트웨어학부', courseType: '전공선택',
    schedules: [
      { day: '월', start_time: '15:30', end_time: '18:20', location: '명신관701' },
      { day: '수', start_time: '15:30', end_time: '18:20', location: '명신관701' },
    ],
  },
  {
    code: '21105589-1', name: '인공지능산업체특강(캡스톤디자인)', professor: '신승준', credits: 3,
    capacity: 40, enrolled: 40, department: '소프트웨어학부', courseType: '전공선택',
    schedules: [
      { day: '수', start_time: '10:00', end_time: '12:50', location: '진리관201' },
    ],
  },
  {
    code: '21000557-1', name: '자바프로그래밍', professor: '박숙영', credits: 3,
    capacity: 40, enrolled: 21, department: '소프트웨어학부', courseType: '전공선택',
    schedules: [
      { day: '화', start_time: '09:00', end_time: '10:50', location: '명신관101' },
      { day: '목', start_time: '09:00', end_time: '10:50', location: '명신관101' },
    ],
  },
  {
    code: '21000557-2', name: '자바프로그래밍', professor: '박숙영', credits: 3,
    capacity: 40, enrolled: 40, department: '소프트웨어학부', courseType: '전공선택',
    schedules: [
      { day: '화', start_time: '11:00', end_time: '12:50', location: '명신관101' },
      { day: '목', start_time: '11:00', end_time: '12:50', location: '명신관101' },
    ],
  },
  {
    code: '21000557-3', name: '자바프로그래밍', professor: '이현자', credits: 3,
    capacity: 40, enrolled: 40, department: '소프트웨어학부', courseType: '전공선택',
    schedules: [
      { day: '화', start_time: '12:00', end_time: '13:50', location: '명신관313' },
      { day: '목', start_time: '12:00', end_time: '13:50', location: '명신관305' },
    ],
  },
  {
    code: '21050161-1', name: '정보·컴퓨터교재연구및지도법', professor: '이현자', credits: 3,
    capacity: 50, enrolled: 16, department: '소프트웨어학부', courseType: '전공선택',
    schedules: [
      { day: '화', start_time: '09:00', end_time: '10:15', location: '명신관313' },
      { day: '목', start_time: '09:00', end_time: '10:15', location: '명신관313' },
    ],
  },
  {
    code: '21000558-1', name: '컴퓨터그래픽스', professor: '유석종', credits: 3,
    capacity: 80, enrolled: 45, department: '소프트웨어학부', courseType: '전공선택',
    schedules: [
      { day: '월', start_time: '15:00', end_time: '16:15', location: '명신관525' },
      { day: '수', start_time: '15:00', end_time: '16:15', location: '명신관525' },
    ],
  },
  {
    code: '21003186-1', name: '컴퓨터네트워크Ⅰ', professor: '김윤희', credits: 3,
    capacity: 70, enrolled: 49, department: '소프트웨어학부', courseType: '전공선택',
    schedules: [
      { day: '화', start_time: '13:30', end_time: '14:45', location: '명신관605' },
      { day: '목', start_time: '13:30', end_time: '14:45', location: '명신관605' },
    ],
  },
  {
    code: '21003186-2', name: '컴퓨터네트워크Ⅰ', professor: '김윤희', credits: 3,
    capacity: 70, enrolled: 23, department: '소프트웨어학부', courseType: '전공선택',
    schedules: [
      { day: '화', start_time: '15:00', end_time: '16:15', location: '명신관605' },
      { day: '목', start_time: '15:00', end_time: '16:15', location: '명신관605' },
    ],
  },
  {
    code: '21002147-1', name: '컴퓨터수학', professor: '채희준', credits: 3,
    capacity: 80, enrolled: 43, department: '소프트웨어학부', courseType: '전공선택',
    schedules: [
      { day: '월', start_time: '09:00', end_time: '10:15', location: '명신관423' },
      { day: '수', start_time: '09:00', end_time: '10:15', location: '명신관423' },
    ],
  },
  {
    code: '21002147-2', name: '컴퓨터수학', professor: '김선필', credits: 3,
    capacity: 80, enrolled: 32, department: '소프트웨어학부', courseType: '전공선택',
    schedules: [
      { day: '화', start_time: '10:30', end_time: '11:45', location: '명신관701' },
      { day: '목', start_time: '10:30', end_time: '11:45', location: '명신관701' },
    ],
  },
  {
    code: '21002147-3', name: '컴퓨터수학', professor: '최영우', credits: 3,
    capacity: 95, enrolled: 93, department: '소프트웨어학부', courseType: '전공선택',
    schedules: [
      { day: '화', start_time: '15:00', end_time: '16:15', location: '명신관423' },
      { day: '목', start_time: '15:00', end_time: '16:15', location: '명신관423' },
    ],
  },
  {
    code: '21003761-1', name: '컴퓨터특강', professor: '김윤진', credits: 3,
    capacity: 50, enrolled: 19, department: '소프트웨어학부', courseType: '전공선택',
    schedules: [
      { day: '월', start_time: '15:00', end_time: '16:15', location: '명신관519' },
      { day: '수', start_time: '15:00', end_time: '16:15', location: '명신관519' },
    ],
  },
  {
    code: '21002144-1', name: '프로그래밍개론', professor: '박수현', credits: 3,
    capacity: 75, enrolled: 75, department: '소프트웨어학부', courseType: '전공선택',
    schedules: [
      { day: '월', start_time: '13:30', end_time: '15:20', location: '명신관701' },
      { day: '수', start_time: '13:30', end_time: '15:20', location: '명신관701' },
    ],
  },
  {
    code: '21002144-2', name: '프로그래밍개론', professor: '조선영', credits: 3,
    capacity: 70, enrolled: 70, department: '소프트웨어학부', courseType: '전공선택',
    schedules: [
      { day: '월', start_time: '11:00', end_time: '12:50', location: '명신관701' },
      { day: '수', start_time: '11:00', end_time: '12:50', location: '명신관701' },
    ],
  },
  {
    code: '21105378-1', name: '학생개설:블록체인', professor: '박영훈', credits: 3,
    capacity: 40, enrolled: 11, department: '소프트웨어학부', courseType: '전공선택',
    schedules: [
      { day: '월', start_time: '13:00', end_time: '14:50', location: '프라임관304' },
      { day: '수', start_time: '13:00', end_time: '14:50', location: '프라임관304' },
    ],
  },
];

// 데이터 삽입 함수
async function seedDatabase() {
  try {
    // DB 동기화 (테이블 생성)
    await sequelize.sync({ force: false });
    console.log('✓ 데이터베이스 동기화 완료');

    // 기존 데이터가 있는지 확인
    const existingCourses = await Class.count();
    if (existingCourses > 0) {
      console.log(`✓ 이미 ${existingCourses}개의 수업이 존재합니다. 부족한 스케줄만 채웁니다.`);
    }

    // 헬퍼 함수: 두 시간의 차이를 분 단위로 계산
    function calculateDurationMinutes(startTime, endTime) {
      const [startHour, startMin] = startTime.split(':').map(Number);
      const [endHour, endMin] = endTime.split(':').map(Number);
      return (endHour * 60 + endMin) - (startHour * 60 + startMin);
    }

    const dayMap = { '일': 0, '월': 1, '화': 2, '수': 3, '목': 4, '금': 5, '토': 6 };

    // 클래스 생성 및 스케줄 생성
    for (const c of courseData) {
      // upsert-like: find or create by course code (use code as Class.id)
      const [createdClass, created] = await Class.findOrCreate({
        where: { id: c.code },
        defaults: {
          id: c.code,
          code: c.code,
          name: c.name,
          professor: c.professor,
          credits: c.credits,
          capacity: c.capacity,
          enrolled: c.enrolled,
          remainingSeats: c.capacity,
          department: c.department,
          courseType: c.courseType
        }
      });

      // schedules 배열 처리
      const schedulesList = c.schedules || [];
      const schedules = schedulesList.map(sched => {
        const weekday = dayMap[sched.day] ?? null;
        if (weekday === null) {
          console.warn(`경고: 인식할 수 없는 요일 "${sched.day}" - ${c.code} ${c.name}`);
          return null;
        }

        // start_time과 end_time이 직접 주어짐
        const durationMinutes = calculateDurationMinutes(sched.start_time, sched.end_time);

        return {
          class_id: createdClass.id,
          weekday,
          start_time: sched.start_time,
          end_time: sched.end_time,
          duration_minutes: durationMinutes,
          location: sched.location || null
        };
      }).filter(s => s !== null);

      // 스케줄 삽입 (중복 방지)
      if (schedules.length > 0) {
        const existingSchedules = await ClassSchedule.count({ where: { class_id: createdClass.id } });
        if (existingSchedules === 0) {
          await ClassSchedule.bulkCreate(schedules);
        }
      }
    }

    const totalCourses = await Class.count();
    const totalSchedules = await ClassSchedule.count();
    console.log(`✓ 클래스 테이블: ${totalCourses}개, 스케줄 테이블: ${totalSchedules}개`);

    await sequelize.close();
    console.log('\n✓ 데이터 삽입 및 스케줄 생성 완료. 연결 종료됨.');
  } catch (error) {
    console.error('❌ 데이터 삽입 오류:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

seedDatabase();
