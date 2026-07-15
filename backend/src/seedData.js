/**
 * 데이터베이스 초기 데이터 삽입 스크립트
 * 사용: node seedData.js
 */

const sequelize = require('./config/database');
const Class = require('./models/Class');
const ClassSchedule = require('./models/ClassSchedule');

// 새 스키마에 맞는 초기 데이터 (Class 필드 + schedules 배열)
const courseData = [

  {
code: '21001083-2',
name: '경영정보시스템',
professor: '한은정',
credits: 3,
capacity: 50,
enrolled: 44,
department: '컴퓨터공학',
courseType: '전공선택',
schedules: [{day: '월', start_time: '12:00', end_time: '13:15'},
{ day: '수', start_time: '12:00', end_time: '13:15'}]},
{
code: '21001083-3',
name: '경영정보시스템',
professor: '한은정',
credits: 3,
capacity: 51,
enrolled: 50,
department: '컴퓨터공학',
courseType: '전공선택',
schedules: [{day: '월', start_time: '13:30', end_time: '14:45'},
{ day: '수', start_time: '13:30', end_time: '14:45'}]},
{
code: '21001083-4',
name: '경영정보시스템',
professor: '한은정',
credits: 3,
capacity: 51,
enrolled: 43,
department: '컴퓨터공학',
courseType: '전공선택',
schedules: [{day: '월', start_time: '15:00', end_time: '16:15'},
{ day: '수', start_time: '15:00', end_time: '16:15'}]},
{
code: '21002031-1',
name: '네트워크보안',
professor: '박영훈',
credits: 3,
capacity: 92,
enrolled: 88,
department: '컴퓨터공학',
courseType: '전공선택',
schedules: [{day: '화', start_time: '13:30', end_time: '14:45'},
{ day: '목', start_time: '13:30', end_time: '14:45'}]},
{
code: '21009627-1',
name: '논리및논술(정보·컴퓨터)',
professor: '이현자',
credits: 3,
capacity: 30,
enrolled: 13,
department: '컴퓨터공학',
courseType: '전공선택',
schedules: [{day: '수', start_time: '16:30', end_time: '19:15'},
]},
{
code: '21003183-1',
name: '데이터베이스설계와질의',
professor: '심준호',
credits: 3,
capacity: 60,
enrolled: 40,
department: '컴퓨터공학',
courseType: '전공선택',
schedules: [{day: '월', start_time: '10:30', end_time: '11:45'},
{ day: '수', start_time: '10:30', end_time: '11:45'}]},
{
code: '21003183-2',
name: '데이터베이스설계와질의',
professor: '심준호',
credits: 3,
capacity: 61,
enrolled: 59,
department: '컴퓨터공학',
courseType: '전공선택',
schedules: [{day: '월', start_time: '13:30', end_time: '14:45'},
{ day: '수', start_time: '13:30', end_time: '14:45'}]},
{
code: '21003183-3',
name: '데이터베이스설계와질의',
professor: '심준호',
credits: 3,
capacity: 50,
enrolled: 31,
department: '컴퓨터공학',
courseType: '전공선택',
schedules: [{day: '화', start_time: '10:30', end_time: '11:45'},
{ day: '목', start_time: '10:30', end_time: '11:45'}]},
{
code: '21001710-1',
name: '디지털논리회로',
professor: '박영훈',
credits: 3,
capacity: 80,
enrolled: 71,
department: '컴퓨터공학',
courseType: '전공필수',
schedules: [{day: '화', start_time: '15:00', end_time: '16:15'},
{ day: '목', start_time: '15:00', end_time: '16:15'}]},
{
code: '21001710-2',
name: '디지털논리회로',
professor: '박영훈',
credits: 3,
capacity: 60,
enrolled: 42,
department: '컴퓨터공학',
courseType: '전공필수',
schedules: [{day: '화', start_time: '15:00', end_time: '16:15'},
{ day: '목', start_time: '15:00', end_time: '16:15'}]},
{
code: '21001713-1',
name: '리눅스시스템',
professor: '창병모',
credits: 3,
capacity: 90,
enrolled: 84,
department: '컴퓨터공학',
courseType: '전공선택',
schedules: [{day: '월', start_time: '10:00', end_time: '11:50'},
{ day: '수', start_time: '10:00', end_time: '11:50'}]},
{
code: '21001713-2',
name: '리눅스시스템',
professor: '창병모',
credits: 3,
capacity: 80,
enrolled: 21,
department: '컴퓨터공학',
courseType: '전공선택',
schedules: [{day: '화', start_time: '10:00', end_time: '11:50'},
{ day: '목', start_time: '10:00', end_time: '11:50'}]},
{
code: '21003757-1',
name: '모바일소프트웨어',
professor: '박숙영',
credits: 3,
capacity: 40,
enrolled: 30,
department: '컴퓨터공학',
courseType: '전공선택',
schedules: [{day: '화', start_time: '13:30', end_time: '14:45'},
{ day: '목', start_time: '13:30', end_time: '14:45'}]},
{
code: '21000555-1',
name: '소프트웨어공학',
professor: '김유경',
credits: 3,
capacity: 80,
enrolled: 66,
department: '컴퓨터공학',
courseType: '전공선택',
schedules: [{day: '월', start_time: '15:00', end_time: '16:15'},
{ day: '수', start_time: '15:00', end_time: '16:15'}]},
{
code: '21003917-1',
name: '소프트웨어의이해',
professor: '최영우',
credits: 3,
capacity: 50,
enrolled: 48,
department: '컴퓨터공학',
courseType: '전공선택',
schedules: [{day: '월', start_time: '15:00', end_time: '16:15'},
]},
{
code: '21000549-1',
name: '알고리즘',
professor: '안태훈',
credits: 3,
capacity: 90,
enrolled: 75,
department: '컴퓨터공학',
courseType: '전공필수',
schedules: [{day: '화', start_time: '09:00', end_time: '10:15'},
{ day: '목', start_time: '09:00', end_time: '10:15'}]},
{
code: '21000549-2',
name: '알고리즘',
professor: '안태훈',
credits: 3,
capacity: 80,
enrolled: 65,
department: '컴퓨터공학',
courseType: '전공필수',
schedules: [{day: '화', start_time: '10:30', end_time: '11:45'},
{ day: '목', start_time: '10:30', end_time: '11:45'}]},
{
code: '21003187-1',
name: '영상정보처리',
professor: '정영주',
credits: 3,
capacity: 50,
enrolled: 37,
department: '컴퓨터공학',
courseType: '전공선택',
schedules: [{day: '월', start_time: '15:00', end_time: '17:50'},
{ day: '수', start_time: '15:00', end_time: '17:50'}]},
{
code: '21105589-1',
name: '인공지능산업체특강',
professor: '이종우',
credits: 3,
capacity: 40,
enrolled: 31,
department: '컴퓨터공학',
courseType: '전공선택',
schedules: [{day: '목', start_time: '10:00', end_time: '12:50'},
]},
{
code: '21000557-1',
name: '자바프로그래밍',
professor: '창병모',
credits: 3,
capacity: 50,
enrolled: 30,
department: '컴퓨터공학',
courseType: '전공선택',
schedules: [{day: '화', start_time: '15:00', end_time: '16:50'},
{ day: '목', start_time: '15:00', end_time: '16:50'}]},
{
code: '21000557-2',
name: '자바프로그래밍',
professor: '박숙영',
credits: 3,
capacity: 40,
enrolled: 37,
department: '컴퓨터공학',
courseType: '전공선택',
schedules: [{day: '화', start_time: '9:00', end_time: '10:50'}]},
{
code: '21000557-3',
name: '자바프로그래밍',
professor: '박숙영',
credits: 3,
capacity: 40,
enrolled: 39,
department: '컴퓨터공학',
courseType: '전공선택',
schedules: [{day: '화', start_time: '11:00', end_time: '12:50'},
]},
{
code: '21050161-1',
name: '정보·컴퓨터교재연구및지도법',
professor: '이현자',
credits: 3,
capacity: 30,
enrolled: 7,
department: '컴퓨터공학',
courseType: '전공선택',
schedules: [{day: '화', start_time: '10:30', end_time: '11:45'},
{ day: '목', start_time: '10:30', end_time: '11:45'}]},
{
code: '21000558-1',
name: '컴퓨터그래픽스',
professor: '정영주',
credits: 3,
capacity: 51,
enrolled: 46,
department: '컴퓨터공학',
courseType: '전공선택',
schedules: [{day: '월', start_time: '10:30', end_time: '11:45'},
{ day: '수', start_time: '10:30', end_time: '11:45'}]},
{
code: '21000558-2',
name: '컴퓨터그래픽스',
professor: '정영주',
credits: 3,
capacity: 54,
enrolled: 52,
department: '컴퓨터공학',
courseType: '전공선택',
schedules: [{day: '월', start_time: '13:30', end_time: '14:45'},
{ day: '수', start_time: '13:30', end_time: '14:45'}]},
{
code: '21003186-1',
name: '컴퓨터네트워크Ⅰ',
professor: '최종원',
credits: 3,
capacity: 75,
enrolled: 67,
department: '컴퓨터공학',
courseType: '전공선택',
schedules: [{day: '월', start_time: '10:30', end_time: '11:45'},
{ day: '수', start_time: '10:30', end_time: '11:45'}]},
{
code: '21003186-2',
name: '컴퓨터네트워크Ⅰ',
professor: '최종원',
credits: 3,
capacity: 60,
enrolled: 58,
department: '컴퓨터공학',
courseType: '전공선택',
schedules: [{day: '화', start_time: '10:30', end_time: '11:45'},
{ day: '목', start_time: '10:30', end_time: '11:45'}]},
{
code: '21002147-1',
name: '컴퓨터수학',
professor: '채희준',
credits: 3,
capacity: 60,
enrolled: 16,
department: '컴퓨터공학',
courseType: '전공선택',
schedules: [{day: '화', start_time: '09:00', end_time: '10:15'},
{ day: '목', start_time: '09:00', end_time: '10:15'}]},
{
code: '21002147-2',
name: '컴퓨터수학',
professor: '최영우',
credits: 3,
capacity: 100,
enrolled: 94,
department: '컴퓨터공학',
courseType: '전공선택',
schedules: [{day: '화', start_time: '10:30', end_time: '11:45'},
{ day: '목', start_time: '10:30', end_time: '11:45'}]},
{
code: '21002147-3',
name: '컴퓨터수학',
professor: '최영우',
credits: 3,
capacity: 80,
enrolled: 60,
department: '컴퓨터공학',
courseType: '전공선택',
schedules: [{day: '화', start_time: '15:00', end_time: '16:15'},
{ day: '목', start_time: '15:00', end_time: '16:15'}]},
{
code: '21003735-1',
name: '클라우드시스템',
professor: '김윤희, 김서영',
credits: 3,
capacity: 40,
enrolled: 39,
department: '컴퓨터공학',
courseType: '전공선택',
schedules: [{day: '화', start_time: '12:00', end_time: '14:50'}]},
{
code: '21002144-1',
name: '프로그래밍개론',
professor: '조선영',
credits: 3,
capacity: 45,
enrolled: 40,
department: '컴퓨터공학',
courseType: '전공선택',
schedules: [{day: '월', start_time: '11:00', end_time: '12:50'},
{ day: '수', start_time: '11:00', end_time: '12:50'}]},
{
code: '21002144-2',
name: '프로그래밍개론',
professor: '조선영',
credits: 3,
capacity: 40,
enrolled: 19,
department: '컴퓨터공학',
courseType: '전공선택',
schedules: [{day: '월', start_time: '14:00', end_time: '15:50'},
{ day: '수', start_time: '14:00', end_time: '15:50'}]},
{
code: '21002144-3',
name: '프로그래밍개론',
professor: '박수현',
credits: 3,
capacity: 51,
enrolled: 50,
department: '컴퓨터공학',
courseType: '전공선택',
schedules: [{day: '화', start_time: '15:00', end_time: '16:50'},
{ day: '목', start_time: '15:00', end_time: '16:50'}]},

// 인공지능공학과

{
code: '21105588-1',
name: 'AR/VR게임프로그래밍',
professor: '박화진',
credits: 3,
capacity: 38,
enrolled: 20,
department: '컴퓨터공학',
courseType: '전공선택',
schedules: [{day: '월', start_time: '15:00', end_time: '16:15'},
{ day: '수', start_time: '15:00', end_time: '16:15'}]},
{
code: '21102525-1',
name: '공학수학I',
professor: '박화진',
credits: 3,
capacity: 60,
enrolled: 47,
department: '컴퓨터공학',
courseType: '전공필수',
schedules: [{day: '화', start_time: '13:30', end_time: '14:45'},
{ day: '목', start_time: '13:30', end_time: '14:45'}]},
{
code: '21102525-2',
name: '공학수학I',
professor: '박화진',
credits: 3,
capacity: 60,
enrolled: 28,
department: '컴퓨터공학',
courseType: '전공필수',
schedules: [{day: '화', start_time: '15:00', end_time: '16:15'},
{ day: '목', start_time: '15:00', end_time: '16:15'}]},
{
code: '21102525-3',
name: '공학수학I',
professor: '박화진',
credits: 3,
capacity: 60,
enrolled: 52,
department: '컴퓨터공학',
courseType: '전공필수',
schedules: [{day: '월', start_time: '13:30', end_time: '14:45'},
{ day: '수', start_time: '13:30', end_time: '14:45'}]},
{
code: '21100722-1',
name: '네트워크(캡스톤디자인)',
professor: '윤용익',
credits: 3,
capacity: 100,
enrolled: 25,
department: '컴퓨터공학',
courseType: '전공선택',
schedules: [{day: '월', start_time: '12:00', end_time: '13:15'},
{ day: '수', start_time: '12:00', end_time: '13:15'}]},
{
code: '21102538-1',
name: '데이터베이스',
professor: '박영호',
credits: 3,
capacity: 100,
enrolled: 98,
department: '컴퓨터공학',
courseType: '전공선택',
schedules: [{day: '월', start_time: '12:00', end_time: '13:15'},
{ day: '수', start_time: '12:00', end_time: '13:15'}]},
{
code: '21102538-2',
name: '데이터베이스',
professor: '박영호',
credits: 3,
capacity: 75,
enrolled: 69,
department: '컴퓨터공학',
courseType: '전공선택',
schedules: [{day: '월', start_time: '13:30', end_time: '14:45'},
{ day: '수', start_time: '13:30', end_time: '14:45'}]},
{
code: '21105586-1',
name: '딥러닝원리와응용',
professor: '임유진',
credits: 3,
capacity: 68,
enrolled: 60,
department: '컴퓨터공학',
courseType: '전공선택',
schedules: [{day: '월', start_time: '10:30', end_time: '11:45'},
{ day: '수', start_time: '10:30', end_time: '11:45'}]},
{
code: '21003076-1',
name: '모바일프로그래밍(캡스톤디자인)',
professor: '윤용익',
credits: 3,
capacity: 26,
enrolled: 8,
department: '컴퓨터공학',
courseType: '전공선택',
schedules: [{day: '월', start_time: '10:00', end_time: '11:50'},
{ day: '수', start_time: '10:00', end_time: '11:50'}]},
{
code: '21102529-1',
name: '센서프로그래밍(캡스톤디자인)',
professor: '강지우',
credits: 3,
capacity: 26,
enrolled: 21,
department: '컴퓨터공학',
courseType: '전공선택',
schedules: [{day: '화', start_time: '14:00', end_time: '15:50'},
{ day: '목', start_time: '14:00', end_time: '15:50'}]},
{
code: '21105590-1',
name: '시스템보안',
professor: '정성훈',
credits: 3,
capacity: 60,
enrolled: 28,
department: '컴퓨터공학',
courseType: '전공선택',
schedules: [{day: '월', start_time: '16:30', end_time: '17:45'},
{ day: '수', start_time: '16:30', end_time: '17:45'}]},
{
code: '21100720-1',
name: '알고리즘입문',
professor: '강지우',
credits: 3,
capacity: 70,
enrolled: 57,
department: '컴퓨터공학',
courseType: '전공선택',
schedules: [{day: '화', start_time: '12:00', end_time: '13:15'},
{ day: '목', start_time: '12:00', end_time: '13:15'}]},
{
code: '21100720-2',
name: '알고리즘입문',
professor: '강지우',
credits: 3,
capacity: 80,
enrolled: 62,
department: '컴퓨터공학',
courseType: '전공선택',
schedules: [{day: '화', start_time: '10:30', end_time: '11:45'},
{ day: '목', start_time: '10:30', end_time: '11:45'}]},
{
code: '21100720-3',
name: '알고리즘입문',
professor: '정성훈',
credits: 3,
capacity: 60,
enrolled: 32,
department: '컴퓨터공학',
courseType: '전공선택',
schedules: [{day: '월', start_time: '15:00', end_time: '16:15'},
{ day: '수', start_time: '15:00', end_time: '16:15'}]},
{
code: '21105365-1',
name: '웹프로그래밍(캡스톤디자인)',
professor: '김상연',
credits: 3,
capacity: 81,
enrolled: 77,
department: '컴퓨터공학',
courseType: '전공필수',
schedules: [{day: '화', start_time: '13:30', end_time: '14:45'},
{ day: '목', start_time: '13:30', end_time: '14:45'}]},
{
code: '21105365-2',
name: '웹프로그래밍(캡스톤디자인)',
professor: '김상연',
credits: 3,
capacity: 70,
enrolled: 15,
department: '컴퓨터공학',
courseType: '전공필수',
schedules: [{day: '화', start_time: '15:00', end_time: '16:15'},
{ day: '목', start_time: '15:00', end_time: '16:15'}]},
{
code: '21105589-1',
name: '인공지능산업체특강',
professor: '이종우',
credits: 3,
capacity: 40,
enrolled: 31,
department: '컴퓨터공학',
courseType: '전공선택',
schedules: [{day: '목', start_time: '10:00', end_time: '12:50'}]},
{
code: '21105364-1',
name: '인공지능입문',
professor: '최윤혁',
credits: 3,
capacity: 97,
enrolled: 96,
department: '컴퓨터공학',
courseType: '전공필수',
schedules: [{day: '화', start_time: '09:00', end_time: '10:15'},
{ day: '목', start_time: '09:00', end_time: '10:15'}]},
{
code: '21003683-1',
name: '프로그래밍방법론',
professor: '최윤혁',
credits: 3,
capacity: 93,
enrolled: 92,
department: '컴퓨터공학',
courseType: '전공필수',
schedules: [{day: '화', start_time: '10:30', end_time: '11:45'},
{ day: '목', start_time: '10:30', end_time: '11:45'}]},
{
code: '21105395-1',
name: '학생개설:지능형언어처리',
professor: '김철연',
credits: 3,
capacity: 90,
enrolled: 39,
department: '컴퓨터공학',
courseType: '전공선택',
schedules: [{day: '화', start_time: '15:00', end_time: '16:15'},
{ day: '목', start_time: '15:00', end_time: '16:15'}]},
{
code: '21102983-1',
name: 'CAD및3D프린팅(캡스톤디자인)',
professor: '이준호',
credits: 3,
capacity: 40,
enrolled: 36,
department: '컴퓨터공학',
courseType: '전공선택',
schedules: [{day: '화', start_time: '13:00', end_time: '14:50'},
{ day: '목', start_time: '13:00', end_time: '14:50'}]},
{
code: '21102983-2',
name: 'CAD및3D프린팅(캡스톤디자인)',
professor: '이준호',
credits: 3,
capacity: 40,
enrolled: 26,
department: '컴퓨터공학',
courseType: '전공선택',
schedules: [{day: '화', start_time: '15:00', end_time: '16:50'},
{ day: '목', start_time: '15:00', end_time: '16:50'}]},
{
code: '21001083-2',
name: '경영정보시스템',
professor: '한은정',
credits: 3,
capacity: 50,
enrolled: 44,
department: '컴퓨터공학',
courseType: '전공선택',
schedules: [{day: '월', start_time: '12:00', end_time: '13:15'},
{ day: '수', start_time: '12:00', end_time: '13:15'}]},
{
code: '21001083-3',
name: '경영정보시스템',
professor: '한은정',
credits: 3,
capacity: 51,
enrolled: 50,
department: '컴퓨터공학',
courseType: '전공선택',
schedules: [{day: '월', start_time: '13:30', end_time: '14:45'},
{ day: '수', start_time: '13:30', end_time: '14:45'}]},
{
code: '21001083-4',
name: '경영정보시스템',
professor: '한은정',
credits: 3,
capacity: 51,
enrolled: 43,
department: '컴퓨터공학',
courseType: '전공선택',
schedules: [{day: '월', start_time: '15:00', end_time: '16:15'},
{ day: '수', start_time: '15:00', end_time: '16:15'}]},
{
code: '21102965-1',
name: '논리회로실험',
professor: '정준원',
credits: 2,
capacity: 30,
enrolled: 26,
department: '컴퓨터공학',
courseType: '전공선택',
schedules: [{day: '화', start_time: '15:00', end_time: '18:50'}]},
{
code: '21102965-2',
name: '논리회로실험',
professor: '정준원',
credits: 2,
capacity: 30,
enrolled: 25,
department: '컴퓨터공학',
courseType: '전공선택',
schedules: [{day: '목', start_time: '15:00', end_time: '18:50'}]},
{
code: '21102990-1',
name: '빅데이터와수치해석입문및실습',
professor: '심주용',
credits: 3,
capacity: 63,
enrolled: 59,
department: '컴퓨터공학',
courseType: '전공선택',
schedules: [{day: '월', start_time: '15:00', end_time: '16:50'},
{ day: '수', start_time: '15:00', end_time: '16:50'}]},
{
code: '21102993-1',
name: '융합캡스톤디자인(캡스톤디자인)',
professor: '임용훈',
credits: 3,
capacity: 35,
enrolled: 19,
department: '컴퓨터공학',
courseType: '전공선택',
schedules: [{day: '월', start_time: '18:00', end_time: '20:50'},
{ day: '수', start_time: '18:00', end_time: '20:50'}]},
{
code: '21102993-2',
name: '융합캡스톤디자인(캡스톤디자인)',
professor: '임용훈',
credits: 3,
capacity: 35,
enrolled: 11,
department: '컴퓨터공학',
courseType: '전공선택',
schedules: [{day: '화', start_time: '18:00', end_time: '20:50'},
{ day: '목', start_time: '18:00', end_time: '20:50'}]},
{
code: '21102955-1',
name: '전자공학도를위한프로그래밍기초',
professor: '김주엽',
credits: 3,
capacity: 80,
enrolled: 64,
department: '컴퓨터공학',
courseType: '전공선택',
schedules: [{day: '화', start_time: '15:00', end_time: '16:50'},
{ day: '목', start_time: '15:00', end_time: '16:50'}]},
{
code: '21003682-1',
name: '졸업프로젝트',
professor: '강지우',
credits: 3,
capacity: 80,
enrolled: 27,
department: '컴퓨터공학',
courseType: '전공선택',
schedules: [{day: '목', start_time: '16:30', end_time: '20:20'}]},
{
code: '21102528-1',
name: '컴퓨터비전',
professor: '김병규',
credits: 3,
capacity: 30,
enrolled: 15,
department: '컴퓨터공학',
courseType: '전공선택',
schedules: [{day: '월', start_time: '13:00', end_time: '14:50'},
{ day: '수', start_time: '13:00', end_time: '14:50'}]},
{
code: '21105229-1',
name: '파이썬데이터분석',
professor: '홍기범',
credits: 3,
capacity: 103,
enrolled: 99,
department: '컴퓨터공학',
courseType: '전공선택',
schedules: [{day: '월', start_time: '15:00', end_time: '16:15'},
{ day: '수', start_time: '15:00', end_time: '16:15'}]},
{
code: '21102639-1',
name: '화공기초물리Ⅱ',
professor: '성영준',
credits: 3,
capacity: 160,
enrolled: 121,
department: '컴퓨터공학',
courseType: '전공선택',
schedules: [{day: '화', start_time: '13:30', end_time: '14:45'},
{ day: '목', start_time: '13:30', end_time: '14:45'}]},
{
code: '21102627-1',
name: '화공기초화학Ⅰ',
professor: '권대선',
credits: 3,
capacity: 80,
enrolled: 50,
department: '컴퓨터공학',
courseType: '전공선택',
schedules: [{day: '월', start_time: '12:00', end_time: '13:15'},
{ day: '수', start_time: '12:00', end_time: '13:15'}]},
{
code: '21102640-1',
name: '화공기초화학Ⅱ',
professor: '권대선',
credits: 3,
capacity: 160,
enrolled: 129,
department: '컴퓨터공학',
courseType: '전공선택',
schedules: [{day: '월', start_time: '10:30', end_time: '11:45'},
{ day: '수', start_time: '10:30', end_time: '11:45'}]},


//교양
{
code: '21002301-2',
name: '신화의이해',
professor: '조혜란',
credits: 3,
capacity: 70,
enrolled: 69,
department: '컴퓨터공학',
courseType: '교양',
schedules: [{day: '화', start_time: '12:00', end_time: '13:15'},
{ day: '목', start_time: '12:00', end_time: '13:15'}]},
{
code: '21101712-1',
name: '아동과법',
professor: '김용화',
credits: 3,
capacity: 60,
enrolled: 53,
department: '컴퓨터공학',
courseType: '교양',
schedules: [{day: '월', start_time: '15:00', end_time: '16:15'},
{ day: '수', start_time: '15:00', end_time: '16:15'}]},
{
code: '21104406-1',
name: '여성건강과생명과학',
professor: '김민정',
credits: 3,
capacity: 60,
enrolled: 57,
department: '컴퓨터공학',
courseType: '교양',
schedules: [{day: '화', start_time: '13:30', end_time: '14:45'},
{ day: '목', start_time: '13:30', end_time: '14:45'}]},
{
code: '21103834-1',
name: '여성과리더십Ⅱ',
professor: '이화영',
credits: 3,
capacity: 60,
enrolled: 34,
department: '컴퓨터공학',
courseType: '교양',
schedules: [{day: '월', start_time: '12:00', end_time: '13:15'},
{ day: '수', start_time: '12:00', end_time: '13:15'}]},
{
code: '21003738-1',
name: '영화로읽는이상심리학',
professor: '신민진',
credits: 3,
capacity: 90,
enrolled: 80,
department: '컴퓨터공학',
courseType: '교양',
schedules: [{day: '수', start_time: '16:30', end_time: '19:20'}]},
{
code: '21009897-1',
name: '국가안보론',
professor: '박원호',
credits: 3,
capacity: 52,
enrolled: 51,
department: '컴퓨터공학',
courseType: '교양',
schedules: [{day: '월', start_time: '12:00', end_time: '13:15'},
{ day: '수', start_time: '12:00', end_time: '13:15'}]},
{
code: '21000762-1',
name: '글로벌패션문화',
professor: '장희경',
credits: 3,
capacity: 55,
enrolled: 30,
department: '컴퓨터공학',
courseType: '교양',
schedules: [{day: '월', start_time: '10:30', end_time: '11:45'},
{ day: '수', start_time: '10:30', end_time: '11:45'}]},
{
code: '21102510-1',
name: '대중서사와B급문화',
professor: '김병길',
credits: 3,
capacity: 60,
enrolled: 58,
department: '컴퓨터공학',
courseType: '교양',
schedules: [{day: '화', start_time: '13:30', end_time: '14:45'},
{ day: '목', start_time: '13:30', end_time: '14:45'}]},
{
code: '21105424-1',
name: '디지털사회와공공철학',
professor: '서정혁',
credits: 3,
capacity: 40,
enrolled: 36,
department: '컴퓨터공학',
courseType: '교양',
schedules: [{day: '화', start_time: '16:30', end_time: '17:45'},
{ day: '목', start_time: '16:30', end_time: '17:45'}]},
{
code: '21102511-1',
name: '만물학개론',
professor: '임상욱',
credits: 3,
capacity: 50,
enrolled: 48,
department: '컴퓨터공학',
courseType: '교양',
schedules: [{day: '월', start_time: '13:30', end_time: '14:45'},
{ day: '수', start_time: '13:30', end_time: '14:45'}]},
{
code: '21003767-1',
name: '무용치료',
professor: '최희정',
credits: 2,
capacity: 40,
enrolled: 37,
department: '컴퓨터공학',
courseType: '교양',
schedules: [{day: '금', start_time: '12:00', end_time: '13:50'}]},
{
code: '21102856-1',
name: '문화예술체험',
professor: '윤하영',
credits: 2,
capacity: 40,
enrolled: 39,
department: '컴퓨터공학',
courseType: '교양',
schedules: [{day: '수', start_time: '14:00', end_time: '15:50'}]},
{
code: '21000165-2',
name: '기초생활중국어',
professor: '강수정',
credits: 3,
capacity: 31,
enrolled: 30,
department: '컴퓨터공학',
courseType: '교양',
schedules: [{day: '화', start_time: '12:00', end_time: '13:15'},
{ day: '목', start_time: '12:00', end_time: '13:15'}]},
{
code: '21104408-1',
name: '다양성사회와가치갈등',
professor: '박승억',
credits: 3,
capacity: 40,
enrolled: 36,
department: '컴퓨터공학',
courseType: '교양',
schedules: [{day: '월', start_time: '10:30', end_time: '11:45'},
{ day: '수', start_time: '10:30', end_time: '11:45'}]},
{
code: '21000203-1',
name: '독일어Ⅰ',
professor: '이주은',
credits: 3,
capacity: 40,
enrolled: 40,
department: '컴퓨터공학',
courseType: '교양',
schedules: [{day: '화', start_time: '10:30', end_time: '11:45'},
{ day: '목', start_time: '10:30', end_time: '11:45'}]},


//데사
{
code: '21105367-1',
name: 'AI수학',
professor: '박수현',
credits: 3,
capacity: 70,
enrolled: 67,
department: '컴퓨터공학',
courseType: '전공선택',
schedules: [{day: '월', start_time: '13:30', end_time: '14:45'},
{ day: '수', start_time: '13:30', end_time: '14:45'}]},
{
code: '21102905-1',
name: '데이터마이닝및분석',
professor: '이기용',
credits: 3,
capacity: 132,
enrolled: 123,
department: '컴퓨터공학',
courseType: '전공필수',
schedules: [{day: '화', start_time: '15:00', end_time: '16:15'},
{ day: '목', start_time: '15:00', end_time: '16:15'}]},
{
code: '21105625-1',
name: '딥러닝개론',
professor: '홍기범',
credits: 3,
capacity: 70,
enrolled: 57,
department: '컴퓨터공학',
courseType: '전공선택',
schedules: [{day: '화', start_time: '15:00', end_time: '16:15'},
{ day: '목', start_time: '15:00', end_time: '16:15'}]},
{
code: '21105229-1',
name: '파이썬데이터분석',
professor: '홍기범',
credits: 3,
capacity: 103,
enrolled: 99,
department: '컴퓨터공학',
courseType: '전공선택',
schedules: [{day: '월', start_time: '15:00', end_time: '16:15'},
{ day: '수', start_time: '15:00', end_time: '16:15'}]}

  // 컴퓨터공학 - 전공 필수
  /*
  {
    code: 'CS301',
    name: '데이터베이스 시스템',
    professor: '김교수',
    credits: 3,
    capacity: 40,
    enrolled: 38,
    department: '컴퓨터공학',
    courseType: '전공 필수',
    schedules: [
      { day: '월', start_time: '09:00', end_time: '10:00' },
      { day: '수', start_time: '09:00', end_time: '10:00' }
    ]
  },
  {
    code: 'CS302',
    name: '운영체제',
    professor: '이교수',
    credits: 3,
    capacity: 45,
    enrolled: 45,
    department: '컴퓨터공학',
    courseType: '전공 필수',
    schedules: [
      { day: '화', start_time: '11:00', end_time: '12:00' },
      { day: '목', start_time: '11:00', end_time: '12:00' }
    ]
  },
  {
    code: 'CS303',
    name: '머신러닝 기초',
    professor: '박교수',
    credits: 3,
    capacity: 35,
    enrolled: 42,
    department: '컴퓨터공학',
    courseType: '전공 선택',
    schedules: [
      { day: '월', start_time: '14:00', end_time: '15:30' },
      { day: '수', start_time: '14:00', end_time: '15:30' }
    ]
  },
  {
    code: 'CS304',
    name: '웹 프로그래밍',
    professor: '최교수',
    credits: 3,
    capacity: 40,
    enrolled: 28,
    department: '컴퓨터공학',
    courseType: '전공 선택',
    schedules: [
      { day: '화', start_time: '16:00', end_time: '17:15' },
      { day: '목', start_time: '16:00', end_time: '17:15' }
    ]
  },
  {
    code: 'CS305',
    name: '인공지능',
    professor: '정교수',
    credits: 3,
    capacity: 30,
    enrolled: 35,
    department: '컴퓨터공학',
    courseType: '전공 선택',
    schedules: [
      { day: '금', start_time: '13:00', end_time: '14:00' }
    ]
  },

  // 경영학 - 전공 필수
  {
    code: 'MGT301',
    name: '재무관리',
    professor: '강교수',
    credits: 3,
    capacity: 50,
    enrolled: 48,
    department: '경영학',
    courseType: '전공 필수',
    schedules: [
      { day: '월', start_time: '10:00', end_time: '11:00' },
      { day: '수', start_time: '10:00', end_time: '11:00' }
    ]
  },
  {
    code: 'MGT302',
    name: '마케팅 전략',
    professor: '윤교수',
    credits: 3,
    capacity: 45,
    enrolled: 40,
    department: '경영학',
    courseType: '전공 선택',
    schedules: [
      { day: '화', start_time: '14:00', end_time: '15:15' },
      { day: '목', start_time: '14:00', end_time: '15:15' }
    ]
  },
  {
    code: 'MGT303',
    name: '경영정보시스템',
    professor: '장교수',
    credits: 3,
    capacity: 40,
    enrolled: 25,
    department: '경영학',
    courseType: '전공 선택',
    schedules: [
      { day: '월', start_time: '16:00', end_time: '17:30' },
      { day: '수', start_time: '16:00', end_time: '17:30' }
    ]
  },

  // 경제학 - 전공 필수
  {
    code: 'ECON301',
    name: '미시경제학',
    professor: '임교수',
    credits: 3,
    capacity: 60,
    enrolled: 55,
    department: '경제학',
    courseType: '전공 필수',
    schedules: [
      { day: '화', start_time: '09:00', end_time: '10:00' },
      { day: '목', start_time: '09:00', end_time: '10:00' }
    ]
  },
  {
    code: 'ECON302',
    name: '거시경제학',
    professor: '한교수',
    credits: 3,
    capacity: 60,
    enrolled: 58,
    department: '경제학',
    courseType: '전공 필수',
    schedules: [
      { day: '월', start_time: '11:00', end_time: '12:00' },
      { day: '수', start_time: '11:00', end_time: '12:00' }
    ]
  },
  {
    code: 'ECON303',
    name: '계량경제학',
    professor: '오교수',
    credits: 3,
    capacity: 35,
    enrolled: 30,
    department: '경제학',
    courseType: '전공 선택',
    schedules: [
      { day: '화', start_time: '15:00', end_time: '16:15' },
      { day: '목', start_time: '15:00', end_time: '16:15' }
    ]
  },

  // 통계학 - 전공 필수
  {
    code: 'STAT301',
    name: '통계학개론',
    professor: '서교수',
    credits: 3,
    capacity: 50,
    enrolled: 46,
    department: '통계학',
    courseType: '전공 필수',
    schedules: [
      { day: '화', start_time: '10:00', end_time: '11:00' },
      { day: '목', start_time: '10:00', end_time: '11:00' }
    ]
  },
  {
    code: 'STAT302',
    name: '데이터마이닝',
    professor: '권교수',
    credits: 3,
    capacity: 40,
    enrolled: 38,
    department: '통계학',
    courseType: '전공 선택',
    schedules: [
      { day: '월', start_time: '13:00', end_time: '14:30' },
      { day: '수', start_time: '13:00', end_time: '14:30' }
    ]
  },
  {
    code: 'STAT303',
    name: '회귀분석',
    professor: '남교수',
    credits: 3,
    capacity: 35,
    enrolled: 20,
    department: '통계학',
    courseType: '전공 선택',
    schedules: [
      { day: '금', start_time: '15:00', end_time: '16:00' }
    ]
  },

  // 심리학
  {
    code: 'PSY301',
    name: '소비자심리학',
    professor: '배교수',
    credits: 3,
    capacity: 45,
    enrolled: 42,
    department: '심리학',
    courseType: '전공 선택',
    schedules: [
      { day: '화', start_time: '11:00', end_time: '12:15' },
      { day: '목', start_time: '11:00', end_time: '12:15' }
    ]
  },
  {
    code: 'PSY302',
    name: '조직심리학',
    professor: '신교수',
    credits: 3,
    capacity: 40,
    enrolled: 35,
    department: '심리학',
    courseType: '전공 선택',
    schedules: [
      { day: '월', start_time: '14:00', end_time: '15:00' },
      { day: '수', start_time: '14:00', end_time: '15:00' }
    ]
  },
  {
    code: 'PSY303',
    name: '인지심리학',
    professor: '유교수',
    credits: 3,
    capacity: 30,
    enrolled: 28,
    department: '심리학',
    courseType: '전공 선택',
    schedules: [
      { day: '금', start_time: '16:00', end_time: '17:30' }
    ]
  },

  // 교양
  {
    code: 'GEN101',
    name: '글쓰기와 의사소통',
    professor: '문교수',
    credits: 2,
    capacity: 80,
    enrolled: 75,
    department: '교양',
    courseType: '교양',
    schedules: [
      { day: '금', start_time: '09:00', end_time: '10:00' }
    ]
  },
  {
    code: 'GEN102',
    name: '비판적 사고',
    professor: '철교수',
    credits: 2,
    capacity: 60,
    enrolled: 55,
    department: '교양',
    courseType: '교양',
    schedules: [
      { day: '금', start_time: '11:00', end_time: '12:00' }
    ]
  },
  {
    code: 'GEN103',
    name: '영어회화',
    professor: '영교수',
    credits: 2,
    capacity: 30,
    enrolled: 30,
    department: '교양',
    courseType: '교양',
    schedules: [
      { day: '수', start_time: '10:00', end_time: '11:00' }
    ]
  },
  {
    code: 'GEN104',
    name: '세계문화의 이해',
    professor: '역교수',
    credits: 3,
    capacity: 70,
    enrolled: 68,
    department: '교양',
    courseType: '교양',
    schedules: [
      { day: '화', start_time: '13:00', end_time: '14:30' },
      { day: '목', start_time: '13:00', end_time: '14:30' }
    ]
  },
  */
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