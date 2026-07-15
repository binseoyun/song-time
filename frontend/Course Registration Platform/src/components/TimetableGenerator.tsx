// frontend/Course Registration Platform/src/components/TimetableGenerator.tsx

import React, { useMemo, useState } from 'react';
import { Timetable, Course, TimetablePayload } from '../App';
import { TimetableView } from './TimetableView';
import { Loader2, Save, RefreshCw, X, Search } from 'lucide-react';

type TimetableGeneratorProps = {
  courses: Course[];
  onSave: (payload: TimetablePayload) => Promise<void> | void;
  isSaving?: boolean;
};

type TimetableConditions = {
    minCredits: number;
    maxCredits: number;
    preferredDays: string[];
    avoidMorning: boolean;
    avoidEvening: boolean;
    preferLongBreak: boolean;
};

// --- [계산 함수] 시간 충돌 및 시간 변환 로직 (컴포넌트 밖) ---
const parseTime = (timeStr: string) => {
    if (!timeStr) return 0;
    const [h = '0', m = '0'] = timeStr.split(':');
    return parseInt(h, 10) + parseInt(m, 10) / 60;
};

const checkConflict = (courseA: Course, courseB: Course) => {
    // 프론트엔드 충돌 체크 로직은 기존대로 유지
    const sameDays = courseA.day.filter(day => courseB.day.includes(day));
    if (sameDays.length === 0) return false;

    const startA = parseTime(courseA.time);
    const durationA = courseA.day.length >= 2 ? 1.5 : courseA.credits; 
    const endA = startA + durationA;

    const startB = parseTime(courseB.time);
    const durationB = courseB.day.length >= 2 ? 1.5 : courseB.credits;
    const endB = startB + durationB;

    return (startA < endB) && (endA > startB);
};


// -----------------------------------------------------------
// ✅ Schedule을 Python이 이해하는 times 구조로 변환하는 헬퍼 함수
const convertSchedulesToTimes = (schedules: ClassSchedule[] | undefined) => {
    if (!schedules || schedules.length === 0) {
        return [];
    }
    
    const timeToFloat = (timeStr: string | null) => {
        if (!timeStr) return 0;
        const parts = timeStr.split(':').map(Number);
        const h = parts[0] || 0;
        const m = parts[1] || 0;
        if (isNaN(h) || isNaN(m)) return 0;
        return h + m / 60;
    };

    return schedules.map(s => ({
        day: s.weekday, 
        start: timeToFloat(s.start_time),
        end: timeToFloat(s.end_time),
    })).filter(t => t.start < t.end);
};
// -----------------------------------------------------------


export function TimetableGenerator({ courses, onSave, isSaving = false }: TimetableGeneratorProps) {
  const [selectedCourses, setSelectedCourses] = useState<string[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCourseType, setSelectedCourseType] = useState('전체');
  
  const [conditions, setConditions] = useState<TimetableConditions>({
    minCredits: 12,
    maxCredits: 18,
    preferredDays: [],
    avoidMorning: false,
    avoidEvening: false,
    preferLongBreak: false,
  });
  
  const [generatedTimetables, setGeneratedTimetables] = useState<Timetable[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<'A' | 'B' | 'C'>('A');

    const days = ['월', '화', '수', '목', '금'];
    const courseTypes = ['전체', '전공필수', '전공선택', '교양'];

    const selectedCourseDetails = useMemo(
        () => courses.filter((c) => selectedCourses.includes(c.id)),
        [courses, selectedCourses]
    );
    
    const totalSelectedCredits = selectedCourseDetails.reduce((sum, c) => sum + c.credits, 0);

    const filteredCourses = useMemo(() => {
        const searchLower = searchTerm.toLowerCase();
        const normalizeType = (value: string) => value.replace(/\s+/g, '');

        return courses.filter((course) => {
            const matchesSearch =
                course.name.toLowerCase().includes(searchLower) ||
                course.code.toLowerCase().includes(searchLower) ||
                course.professor.toLowerCase().includes(searchLower);

            const matchesCourseType =
                selectedCourseType === '전체' ||
                normalizeType(course.courseType) === normalizeType(selectedCourseType);

            return matchesSearch && matchesCourseType;
        });
    }, [courses, searchTerm, selectedCourseType]);

    // --- [핵심 로직] 과목 선택 시 유효성 검사 ---
    const handleToggleCourse = (courseId: string) => {
        if (selectedCourses.includes(courseId)) {
            setSelectedCourses(selectedCourses.filter((id) => id !== courseId));
            return;
        }

        let isConflict = false;
        let conflictName = "";

        const targetCourse = courses.find((c) => c.id === courseId);
        if (!targetCourse) return;

        selectedCourses.forEach((id) => {
            const existingCourse = courses.find((c) => c.id === id);
            if (existingCourse && checkConflict(targetCourse, existingCourse)) {
                isConflict = true;
                conflictName = existingCourse.name;
            }
        });

        if (isConflict) {
            alert(`'${conflictName}' 수업과 시간이 겹쳐서 선택할 수 없습니다!`);
            return;
        }

        setSelectedCourses([...selectedCourses, courseId]);
    };

    // --- 백엔드 API 호출 ---
    const generateTimetables = async () => {
        if (selectedCourses.length === 0) {
            alert('최소 1개 이상의 과목을 선택해주세요!');
            return;
        }

        setIsGenerating(true);

        // ✅ 1. OR-Tools가 탐색할 수 있도록 전체 courses 배열을 가공 (times 필드 추가)
        const allCoursesForPython = courses
            .filter(course => course.schedules && course.schedules.length > 0) 
            .map(course => ({
                id: course.id,
                code: course.code,
                name: course.name,
                credits: course.credits,
                department: course.department,
                courseType: course.courseType,
                // OR-Tools용 스케줄링 데이터
                times: convertSchedulesToTimes(course.schedules), 
            }));

        if (allCoursesForPython.length === 0) {
            alert("유효한 시간 정보가 있는 과목이 DB에 없습니다.");
            setIsGenerating(false);
            return;
        }
        const SCHEDULER_BASE_URL = import.meta.env.VITE_SCHEDULER_BASE_URL ?? 'http://127.0.0.1:5000/api/schedule';
        // ✅ 2. AI 서버로 요청
        try {
            const response = await fetch(`${SCHEDULER_BASE_URL}`, { 
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    selected_course_ids: selectedCourses,
                    preferences: conditions,
                    courses: allCoursesForPython, // 👈 전체 코스 전송! (OR-Tools가 채울 수 있도록)
                }),
            });

            if (!response.ok) {
                const result = await response.json();
                console.error('API 응답 에러:', response.status, result);
                alert(`시간표 생성 실패 (상태: ${response.status}, 상세: ${result.detail || result.message})`);
                return;
            }

            const result = await response.json();

            if (result.status === 'success') {
                
                // ✅ 3. 핵심 수정: AI 서버의 응답에 렌더링 필드(day, time, schedules) 보강
                const originalCoursesMap = new Map(courses.map(c => [c.id, c]));
                
                const mergeRenderFields = (planCourses: any[]): Course[] => {
                    return planCourses.map(pc => {
                        const original = originalCoursesMap.get(pc.id);
                        
                        // TimetableView가 기대하는 렌더링 필드와 스케줄 필드를 복사
                        return {
                            ...pc,
                            day: original?.day || [],
                            time: original?.time || '',
                            schedules: original?.schedules || [], 
                        } as Course; // 타입 캐스팅으로 Course 타입 보장
                    });
                };

                const planA_Courses = mergeRenderFields(result.data['PLAN A']);
                const planB_Courses = mergeRenderFields(result.data['PLAN B']);
                const planC_Courses = mergeRenderFields(result.data['PLAN C']);
                

                // ✅ 4. Plan A, B, C 세 개 반환!
                const planA: Timetable = {
                    id: 'plan-a', name: 'PLAN A', courses: planA_Courses, createdAt: new Date(),
                };
                const planB: Timetable = {
                    id: 'plan-b', name: 'PLAN B', courses: planB_Courses, createdAt: new Date(),
                };
                const planC: Timetable = {
                    id: 'plan-c', name: 'PLAN C', courses: planC_Courses, createdAt: new Date(),
                };

                setGeneratedTimetables([planA, planB, planC]);
            } else {
                 // OR-Tools가 해를 찾지 못했을 때의 실패 메시지를 프론트에 표시
                alert(`생성 실패: ${result.message}`); 
            }
        } catch (error) {
            console.error('API Error:', error);
            alert('서버와 연결할 수 없습니다. AI 서버(5000)가 실행 중인지 확인해주세요.');
        } finally {
            setIsGenerating(false);
        }
    };

  const handleSave = async () => {
    const timetableToSave = generatedTimetables[selectedPlan === 'A' ? 0 : selectedPlan === 'B' ? 1 : 2];
    if (!timetableToSave) return;

    try {
      await onSave({
        name: `${timetableToSave.name} - ${new Date().toLocaleDateString('ko-KR')}`,
        courses: timetableToSave.courses,
      });
      alert('시간표가 저장되었습니다!');
    } catch (error) {
      alert(
        error instanceof Error
          ? error.message
          : '시간표를 저장하는 중 오류가 발생했습니다.'
      );
    }
  };

    const currentTimetable = generatedTimetables[selectedPlan === 'A' ? 0 : selectedPlan === 'B' ? 1 : 2];
    const totalCredits = currentTimetable?.courses.reduce((sum, c) => sum + c.credits, 0) || 0;

    return (
        <div className="space-y-6">
            {/* ... (JSX 템플릿은 그대로 유지) */}
            <div>
                <h2 className="text-gray-900 mb-2">시간표 생성</h2>
                <p className="text-gray-600">듣고 싶은 수업을 선택하고 조건을 입력하면 AI가 3가지 시간표를 자동으로 생성해드립니다</p>
            </div>

            {/* 1. 과목 선택 영역 */}
            <div className="bg-white rounded-lg shadow-md p-6">
                <h3 className="text-gray-900 mb-4">1. 듣고 싶은 수업 선택</h3>
                
                {/* 선택된 과목 요약 (배지 영역) */}
                <div className="mb-4 p-4 bg-blue-50 rounded-lg">
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-blue-900 font-medium">선택된 과목: {selectedCourses.length}개</span>
                        <span className={`font-medium ${totalSelectedCredits > 21 ? 'text-red-600' : 'text-blue-900'}`}>
                            총 {totalSelectedCredits}학점 / 최대 21학점
                        </span>
                    </div>
                    {selectedCourseDetails.length > 0 && (
                        <div className="flex flex-wrap gap-2 mt-3">
                            {selectedCourseDetails.map(course => (
                                <div key={course.id} className="flex items-center space-x-2 bg-white px-3 py-1 rounded-full text-sm shadow-sm">
                                    <span className="text-gray-700">{course.name} ({course.credits}학점)</span>
                                    <button onClick={() => handleToggleCourse(course.id)} className="text-red-600 hover:text-red-700">
                                        <X className="w-4 h-4" />
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* 검색 및 필터 */}
                <div className="space-y-3 mb-4">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                        <input
                            type="text"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            placeholder="과목명, 과목코드, 교수명으로 검색..."
                            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {courseTypes.map(type => (
                            <button
                                key={type}
                                onClick={() => setSelectedCourseType(type)}
                                className={`px-3 py-1 rounded-lg transition-colors text-sm ${selectedCourseType === type ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
                            >
                                {type}
                            </button>
                        ))}
                    </div>
                </div>

                {/* 과목 리스트 (스크롤 영역) */}
                <div className="max-h-96 overflow-y-auto border border-gray-200 rounded-lg">
                    {filteredCourses.map(course => {
                        const isSelected = selectedCourses.includes(course.id);
                        return (
                            <div
                                key={course.id}
                                className={`p-4 border-b border-gray-200 last:border-b-0 hover:bg-gray-50 cursor-pointer transition-colors ${isSelected ? 'bg-blue-50' : ''}`}
                                onClick={() => handleToggleCourse(course.id)}
                            >
                                <div className="flex items-start justify-between">
                                    <div className="flex items-start space-x-3 flex-1">
                                        <input type="checkbox" checked={isSelected} readOnly className="mt-1 w-4 h-4 text-blue-600" />
                                        <div className="flex-1">
                                            <div className="flex items-center space-x-2 mb-1">
                                                <h4 className="text-gray-900 font-medium">{course.name}</h4>
                                                <span className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded text-xs">{course.code}</span>
                                            </div>
                                            <div className="text-sm text-gray-600 space-x-4">
                                                <span>{course.professor}</span>
                                                <span>{course.credits}학점</span>
                                                <span>{course.day.join(', ')} {course.time}</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* 2. 조건 설정 영역 */}
            <div className="bg-white rounded-lg shadow-md p-6">
                <h3 className="text-gray-900 mb-4">2. 시간표 조건 설정</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                        <label className="block text-gray-700 mb-2">학점 범위</label>
                        <div className="flex items-center space-x-4">
                            <div className="flex-1">
                                <input type="number" value={conditions.minCredits} onChange={(e) => setConditions({ ...conditions, minCredits: parseInt(e.target.value) })} className="w-full px-3 py-2 border border-gray-300 rounded-lg" min="0" max="21" />
                                <span className="text-gray-600">최소 학점</span>
                            </div>
                            <span className="text-gray-400">~</span>
                            <div className="flex-1">
                                <input type="number" value={conditions.maxCredits} onChange={(e) => setConditions({ ...conditions, maxCredits: parseInt(e.target.value) })} className="w-full px-3 py-2 border border-gray-300 rounded-lg" min="0" max="21" />
                                <span className="text-gray-600">최대 학점</span>
                            </div>
                        </div>
                    </div>
                    <div>
                        <label className="block text-gray-700 mb-2">원하는 공강 요일</label>
                        <div className="flex flex-wrap gap-2">
                            {days.map(day => (
                                <button
                                    key={day}
                                    onClick={() => {
                                        // 클릭 시 해당 요일을 조건에 추가/제거
                                        if (conditions.preferredDays.includes(day)) {
                                            setConditions({
                                                ...conditions,
                                                preferredDays: conditions.preferredDays.filter(d => d !== day)
                                            });
                                        } else {
                                            setConditions({
                                                ...conditions,
                                                preferredDays: [...conditions.preferredDays, day]
                                            });
                                        }
                                    }}
                                    className={`px-4 py-2 rounded-lg border transition-colors ${
                                        conditions.preferredDays.includes(day)
                                            ? 'bg-blue-600 text-white border-blue-600'
                                            : 'bg-white text-gray-700 border-gray-300 hover:border-blue-400'
                                    }`}
                                >
                                    {day}
                                </button>
                            ))}
                        </div>
                    </div>
                    <div>
                        <label className="block text-gray-700 mb-2">시간 선호도</label>
                        <div className="space-y-2">
                            <label className="flex items-center space-x-2">
                                <input type="checkbox" checked={conditions.avoidMorning} onChange={(e) => setConditions({ ...conditions, avoidMorning: e.target.checked })} className="w-4 h-4 text-blue-600" />
                                <span className="text-gray-700">오전 수업 피하기 (9시~11시)</span>
                            </label>
                            <label className="flex items-center space-x-2">
                                <input type="checkbox" checked={conditions.avoidEvening} onChange={(e) => setConditions({ ...conditions, avoidEvening: e.target.checked })} className="w-4 h-4 text-blue-600" />
                                <span className="text-gray-700">저녁 수업 피하기 (18시 이후)</span>
                            </label>
                            <label className="flex items-center space-x-2">
                                <input type="checkbox" checked={conditions.preferLongBreak} onChange={(e) => setConditions({ ...conditions, preferLongBreak: e.target.checked })} className="w-4 h-4 text-blue-600" />
                                <span className="text-gray-700">짧은 공강 선호</span>
                            </label>
                        </div>
                    </div>
                </div>
                <button onClick={generateTimetables} disabled={isGenerating || selectedCourses.length === 0} className="mt-6 w-full bg-blue-600 text-white py-3 rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center justify-center space-x-2">
                    {isGenerating ? (<><Loader2 className="w-5 h-5 animate-spin" /><span>AI가 시간표를 계산중입니다...</span></>) : (<><RefreshCw className="w-5 h-5" /><span>AI 시간표 생성하기</span></>)}
                </button>
            </div>

      {/* 3. 생성 결과 표시 */}
      {generatedTimetables.length > 0 && (
        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-gray-900">생성된 시간표</h3>
            <div className="flex items-center space-x-2">
              <span className="text-gray-600">총 {totalCredits}학점</span>
              <button
                onClick={handleSave}
                disabled={isSaving}
                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center space-x-2"
              >
                <Save className="w-4 h-4" /><span>{isSaving ? '저장 중...' : '저장하기'}</span>
              </button>
            </div>
          </div>
          <div className="flex space-x-2 mb-6">
            {(['A', 'B', 'C'] as const).map(plan => (
              <button key={plan} onClick={() => setSelectedPlan(plan)} className={`px-6 py-2 rounded-lg transition-colors ${selectedPlan === plan ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>PLAN {plan}</button>
            ))}
          </div>
          <TimetableView timetable={currentTimetable} />
        </div>
      )}
    </div>
  );
}