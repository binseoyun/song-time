import { User, Timetable, Course } from '../App';
import { TimetableView } from './TimetableView'; // 경로 수정
import { useState } from 'react';
import { User as UserIcon, Calendar, Heart, Clock, BookOpen } from 'lucide-react';

type MyPageProps = {
  user: User;
  savedTimetables: Timetable[];
  interestedCourses: string[];
  courses: Course[];
  onDeleteTimetable?: (timetableId: string) => void;
}

export function MyPage({ user, savedTimetables, interestedCourses, courses, onDeleteTimetable }: MyPageProps) {
  const [selectedTimetable, setSelectedTimetable] = useState<Timetable | null>(null);

  const interestedCourseDetails = courses.filter((c) =>
    interestedCourses.includes(c.id)
  );

  // 현재 저장된 시간표 중 첫 번째 시간표의 총 학점을 계산 (대표 학점)
  const totalCredits = savedTimetables[0]?.courses.reduce((sum, c) => sum + c.credits, 0) || 0;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-gray-900 mb-2">마이페이지</h2>
        <p className="text-gray-600">내 정보와 수강신청 기록을 확인하세요</p>
      </div>

      {/* User Info Card (이름, 학과, 학번, 이번 학기 학점 표시) */}
      <div className="bg-gradient-to-r from-blue-600 to-indigo-600 rounded-lg shadow-lg p-8 text-white">
        <div className="flex flex-col sm:flex-row items-start sm:items-center space-y-4 sm:space-y-0 sm:space-x-8 mb-6">
          <div className="flex items-center space-x-4">
            <div className="w-20 h-20 bg-white rounded-full flex items-center justify-center flex-shrink-0">
              <UserIcon className="w-10 h-10 text-blue-600" />
            </div>
            <div>
              {/* 이름과 학과 표시 */}
              <h3 className="mb-1 text-2xl font-bold">{user.name} 학생</h3>
              <p className="text-blue-100 text-lg">{user.department}</p>
            </div>
          </div>
        </div>

        {/* 핵심 정보 요약 (학번, 이번 학기) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 border-t border-white/20 pt-4 mt-4">
          
          <div className="bg-white/10 rounded-lg p-4">
            <div className="flex items-center space-x-2 mb-2">
              <BookOpen className="w-4 h-4" />
              <span className="text-blue-100">학번</span>
            </div>
            <p className="text-xl font-semibold">{user.studentId}</p>
          </div>
          
          <div className="bg-white/10 rounded-lg p-4">
            <div className="flex items-center space-x-2 mb-2">
              <Calendar className="w-4 h-4" />
              <span className="text-blue-100">이번 학기 신청</span>
            </div>
            <p className="text-xl font-semibold">{totalCredits}학점</p>
          </div>

          {/* 빈 공간 처리를 위한 더미 */}
          <div className="hidden lg:block bg-white/10 rounded-lg p-4 opacity-50">
            <div className="flex items-center space-x-2 mb-2">
              <Clock className="w-4 h-4" />
              <span className="text-blue-100">총 강의 수</span>
            </div>
            <p className="text-xl font-semibold">{savedTimetables[0]?.courses.length || 0}개</p>
          </div>
        </div>
      </div>

      {/* Stats (아래 부분은 기존 코드 유지) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="flex items-center justify-between mb-4">
            <Calendar className="w-8 h-8 text-blue-600" />
            <span className="text-blue-600 font-bold">{savedTimetables.length}</span>
          </div>
          <h4 className="text-gray-900">저장된 시간표</h4>
          <p className="text-gray-600 text-sm">생성한 시간표 개수</p>
        </div>

        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="flex items-center justify-between mb-4">
            <Heart className="w-8 h-8 text-red-600" />
            <span className="text-red-600 font-bold">{interestedCourses.length}</span>
          </div>
          <h4 className="text-gray-900">관심 과목</h4>
          <p className="text-gray-600 text-sm">등록한 희망 과목</p>
        </div>

        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="flex items-center justify-between mb-4">
            <Clock className="w-8 h-8 text-green-600" />
            <span className="text-green-600 font-bold">{totalCredits}</span>
          </div>
          <h4 className="text-gray-900">신청 학점</h4>
          <p className="text-gray-600 text-sm">현재 시간표 학점</p>
        </div>
      </div>

      {/* Saved Timetables */}
      <div className="bg-white rounded-lg shadow-md p-6">
        <h3 className="text-gray-900 mb-4">저장된 시간표</h3>
        
        {savedTimetables.length === 0 ? (
          <div className="text-center py-12">
            <Calendar className="w-12 h-12 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-500">저장된 시간표가 없습니다</p>
            <p className="text-gray-400">시간표 생성 페이지에서 시간표를 만들어보세요</p>
          </div>
        ) : (
          <div className="space-y-4">
            {savedTimetables.map((timetable) => (
              <div key={timetable.id} className="border border-gray-200 rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h4 className="text-gray-900">{timetable.name}</h4>
                    <p className="text-gray-600 text-sm">
                      {timetable.courses.length}과목 · {timetable.courses.reduce((sum, c) => sum + c.credits, 0)}학점 · 
                      {' '}{new Date(timetable.createdAt).toLocaleDateString('ko-KR')}
                    </p>
                  </div>
                  <div className="flex items-center space-x-2">
                    {onDeleteTimetable && (
                      <button
                        onClick={() => onDeleteTimetable(timetable.id)}
                        className="px-3 py-2 text-sm text-red-600 border border-red-200 rounded-lg hover:bg-red-50"
                      >
                        삭제
                      </button>
                    )}
                    <button
                      onClick={() => setSelectedTimetable(
                        selectedTimetable?.id === timetable.id ? null : timetable
                      )}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm"
                    >
                      {selectedTimetable?.id === timetable.id ? '접기' : '보기'}
                    </button>
                  </div>
                </div>

                {selectedTimetable?.id === timetable.id && (
                  <div className="mt-4 pt-4 border-t border-gray-200">
                    <TimetableView timetable={timetable} />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Interested Courses */}
      <div className="bg-white rounded-lg shadow-md p-6">
        <h3 className="text-gray-900 mb-4">관심 과목</h3>
        
        {interestedCourseDetails.length === 0 ? (
          <div className="text-center py-12">
            <Heart className="w-12 h-12 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-500">관심 과목이 없습니다</p>
            <p className="text-gray-400">수업 목록에서 관심있는 과목을 추가해보세요</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {interestedCourseDetails.map(course => (
              <div key={course.id} className="border border-gray-200 rounded-lg p-4">
                <h4 className="text-gray-900 mb-2">{course.name}</h4>
                <div className="space-y-1 text-gray-600 text-sm">
                  <p>교수: {course.professor}</p>
                  <p>학점: {course.credits}학점</p>
                  <p>시간: {course.day.join(', ')} {course.time}</p>
                  <p>정원: {course.enrolled}/{course.capacity}명</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      
    </div>
  );
}