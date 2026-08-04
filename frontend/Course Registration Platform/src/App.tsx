import React, { useEffect, useState } from 'react';
import { LoginPage } from './components/LoginPage';
import { HomePage } from './components/HomePage';
import { TimetableGenerator } from './components/TimetableGenerator';
import { CourseList } from './components/CourseList';
import { AIRecommendation } from './components/AIRecommendation';
import { MyPage } from './components/MyPage';

export type ClassSchedule = {
  class_id: string;
  weekday: number;
  start_time: string;
  end_time: string | null;
  duration_minutes: number | null;
  location: string | null;
};

export type Course = {
  id: string;
  code: string;
  name: string;
  professor: string;
  credits: number;
  time: string;
  day: string[];
  capacity: number;
  enrolled: number;
  department: string;
  courseType: '전공필수' | '전공선택' | '교양';
  schedules?: ClassSchedule[];
};

export type Timetable = {
  id: string;
  name: string;
  courses: Course[];
  createdAt: Date;
};

export type TimetablePayload = {
  name: string;
  courses: Course[];
};

export type User = {
  id: string;
  email: string;
  name: string;
  studentId: string;
  department: string;
};

export type Page = 'login' | 'home' | 'timetable' | 'courses' | 'ai' | 'mypage';

// ADR-003: frontend는 항상 자신을 서빙한 origin의 상대경로(/api/...)로만 호출한다.
// (Ingress/nginx가 그 요청을 실제 backend로 넘겨준다 — 환경별로 다른 절대주소를 알 필요가 없다)
const API_BASE_URL = '';

export default function App() {
  const [currentPage, setCurrentPage] = useState<Page>('login');
  const [user, setUser] = useState<User | null>(null);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [courses, setCourses] = useState<Course[]>([]);
  const [coursesLoading, setCoursesLoading] = useState(false);
  const [coursesError, setCoursesError] = useState<string | null>(null);
  const [savedTimetables, setSavedTimetables] = useState<Timetable[]>([]);
  const [interestedCourses, setInterestedCourses] = useState<string[]>([]);
  const [interestError, setInterestError] = useState<string | null>(null);
  const [interestAlerts, setInterestAlerts] = useState<Course[]>([]);
  const [serverAlerts, setServerAlerts] = useState<Course[]>([]);
  const [timetableError, setTimetableError] = useState<string | null>(null);
  const [isSavingTimetable, setIsSavingTimetable] = useState(false);

  const normalizeCourses = (data: any[]): Course[] => {
    const weekdayMap = ['일', '월', '화', '수', '목', '금', '토'];

    return data.map((course, index) => {
      const rawId = course.id ?? course.code ?? `course-${index}`;
      const schedules: ClassSchedule[] = Array.isArray(course.schedules)
        ? course.schedules.map((schedule: any) => ({
            class_id: String(schedule.class_id ?? rawId),
            weekday: schedule.weekday ?? 0,
            start_time: schedule.start_time ?? '',
            end_time: schedule.end_time ?? null,
            duration_minutes: schedule.duration_minutes ?? null,
            location: schedule.location ?? null,
          }))
        : [];

      const day =
        course.day && Array.isArray(course.day) && course.day.length > 0
          ? course.day
          : Array.from(
              new Set(
                schedules
                  .map((schedule) => weekdayMap[schedule.weekday])
                  .filter(Boolean)
              )
            );

      const time =
        course.time ||
        (schedules.length > 0
          ? schedules
              .map((schedule) => {
                const start = schedule.start_time?.slice(0, 5) ?? '';
                const end = schedule.end_time?.slice(0, 5) ?? '';
                return end ? `${start}~${end}` : start;
              })
              .join(', ')
          : '시간 정보 없음');

      const normalizedCourseType = (course.courseType ?? '').replace(/\s+/g, '');
      const courseType: Course['courseType'] =
        normalizedCourseType === '전공필수'
          ? '전공필수'
          : normalizedCourseType === '전공선택'
          ? '전공선택'
          : '교양';

      return {
        id: String(rawId),
        code: course.code ?? String(rawId),
        name: course.name ?? '미정',
        professor: course.professor ?? '미정',
        credits: Number(course.credits ?? 0),
        time,
        day,
        capacity: Number(course.capacity ?? 0),
        enrolled: Number(course.enrolled ?? 0),
        department: course.department ?? '미정',
        courseType,
        schedules,
      };
    });
  };

  const normalizeTimetableFromApi = (data: any): Timetable => ({
    id: String(data.id),
    name: data.name ?? '저장된 시간표',
    courses: Array.isArray(data.courses) ? data.courses : [],
    createdAt: data.createdAt ? new Date(data.createdAt) : new Date(),
  });

  const loadTimetables = async (token: string) => {
    try {
      setTimetableError(null);
      const response = await fetch(`${API_BASE_URL}/api/timetables`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || '시간표를 불러올 수 없습니다.');
      }

      const payload = await response.json();
      const normalized = Array.isArray(payload)
        ? payload.map((item: any) => normalizeTimetableFromApi(item))
        : [];
      setSavedTimetables(normalized);
    } catch (error) {
      setSavedTimetables([]);
      setTimetableError(
        error instanceof Error
          ? error.message
          : '시간표를 불러오는 중 오류가 발생했습니다.'
      );
    }
  };

  const loadInterestedCourses = async (token: string) => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/courses/interests`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || '관심 과목을 불러올 수 없습니다.');
      }

      const payload = await response.json();
      const courseIds: string[] = Array.isArray(payload?.courses)
        ? payload.courses.map((courseId: unknown) => String(courseId))
        : [];
      setInterestedCourses(courseIds);
      setInterestError(null);
    } catch (error) {
      console.error('관심 과목 조회 오류:', error);
      setInterestedCourses([]);
      setInterestError(
        error instanceof Error
          ? error.message
          : '관심 과목을 불러오는 중 오류가 발생했습니다.'
      );
    }
  };

  const loadDemandAlerts = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/courses/alerts`);
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || '수요 알림을 불러올 수 없습니다.');
      }

      const payload = await response.json();
      const normalized = Array.isArray(payload)
        ? normalizeCourses(payload)
        : [];
      setServerAlerts(normalized);
    } catch (error) {
      console.error('수요 알림 조회 오류:', error);
      setServerAlerts([]);
    }
  };

  useEffect(() => {
    const fetchCourses = async () => {
      try {
        setCoursesLoading(true);
        setCoursesError(null);
        const response = await fetch(`${API_BASE_URL}/api/courses`);
        if (!response.ok) {
          throw new Error('수업 데이터를 불러올 수 없습니다.');
        }
        const data = await response.json();
        setCourses(normalizeCourses(data));
      } catch (err) {
        setCoursesError(
          err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.'
        );
      } finally {
        setCoursesLoading(false);
      }
    };

    fetchCourses();
  }, []);

  useEffect(() => {
    loadDemandAlerts();
  }, []);

  useEffect(() => {
    const storedToken = localStorage.getItem('accessToken');
    const storedUserRaw = localStorage.getItem('currentUser');

    if (storedToken && storedUserRaw) {
      try {
        const savedUser = JSON.parse(storedUserRaw) as User;
        setUser(savedUser);
        setAuthToken(storedToken);
        setCurrentPage('home');
        loadTimetables(storedToken);
        loadInterestedCourses(storedToken);
      } catch (error) {
        console.error('세션 복원 실패:', error);
        localStorage.removeItem('accessToken');
        localStorage.removeItem('currentUser');
      }
    }
  }, []);

  useEffect(() => {
    if (!interestedCourses.length) {
      setInterestAlerts([]);
      return;
    }

    const alerts = serverAlerts.filter((course) =>
      interestedCourses.includes(course.id)
    );
    setInterestAlerts(alerts);
  }, [serverAlerts, interestedCourses]);

  const handleLogin = async (userData: User, token: string) => {
    setUser(userData);
    setAuthToken(token);
    localStorage.setItem('accessToken', token);
    localStorage.setItem('currentUser', JSON.stringify(userData));
    await Promise.all([loadTimetables(token), loadInterestedCourses(token)]);
    setInterestError(null);
    setCurrentPage('home');
  };

  // 🔹 로그아웃: 백엔드에 알리고, 토큰/상태만 정리 (시간표는 localStorage에 남김)
  const handleLogout = async () => {
    try {
      if (authToken) {
        await fetch(`${API_BASE_URL}/api/auth/logout`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${authToken}`,
          },
        });
      }
    } catch (error) {
      console.error('Logout failed:', error);
    } finally {
      localStorage.removeItem('accessToken');
      localStorage.removeItem('currentUser');
      setAuthToken(null);
      setUser(null);
      setCurrentPage('login');
      setSavedTimetables([]);
      setInterestedCourses([]);
      setInterestAlerts([]);
      setInterestError(null);
    }
  };

  const handleSaveTimetable = async (payload: TimetablePayload) => {
    if (!authToken || !user) {
      setTimetableError('로그인 후 시간표를 저장할 수 있습니다.');
      setCurrentPage('login');
      throw new Error('로그인이 필요합니다.');
    }

    try {
      setIsSavingTimetable(true);
      setTimetableError(null);
      const response = await fetch(`${API_BASE_URL}/api/timetables`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || '시간표를 저장할 수 없습니다.');
      }

      const saved = await response.json();
      const normalized = normalizeTimetableFromApi(saved);
      setSavedTimetables((prev) => [normalized, ...prev]);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : '시간표 저장 중 오류가 발생했습니다.';
      setTimetableError(message);
      throw new Error(message);
    } finally {
      setIsSavingTimetable(false);
    }
  };

  const handleDeleteTimetable = async (timetableId: string) => {
    if (!authToken) {
      setTimetableError('로그인 후 시간표를 삭제할 수 있습니다.');
      setCurrentPage('login');
      return;
    }

    try {
      setTimetableError(null);
      const response = await fetch(`${API_BASE_URL}/api/timetables/${timetableId}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || '시간표를 삭제할 수 없습니다.');
      }

      setSavedTimetables((prev) => prev.filter((timetable) => timetable.id !== timetableId));
    } catch (error) {
      setTimetableError(
        error instanceof Error
          ? error.message
          : '시간표 삭제 중 오류가 발생했습니다.'
      );
    }
  };

  // 🔹 관심 과목 토글
  const handleToggleInterest = async (courseId: string) => {
    if (!authToken) {
      setInterestError('로그인 후 관심 과목을 관리할 수 있습니다.');
      setCurrentPage('login');
      return;
    }

    try {
      setInterestError(null);
      const response = await fetch(
        `${API_BASE_URL}/api/courses/${courseId}/interest`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${authToken}`,
          },
        }
      );

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          payload?.message || '관심 과목 업데이트에 실패했습니다.'
        );
      }

      const isInterested = payload?.isInterested as boolean | undefined;
      const updatedCourse = payload?.course as
        | { id: string; enrolled: number }
        | undefined;

      if (typeof isInterested === 'boolean') {
        setInterestedCourses((prev) => {
          if (isInterested) {
            if (prev.includes(courseId)) return prev;
            return [...prev, courseId];
          }
          return prev.filter((id) => id !== courseId);
        });
      }

      if (updatedCourse) {
        setCourses((current) =>
          current.map((course) =>
            course.id === updatedCourse.id
              ? { ...course, enrolled: updatedCourse.enrolled }
              : course
          )
        );
      }
    } catch (error) {
      setInterestError(
        error instanceof Error
          ? error.message
          : '관심 과목 처리 중 오류가 발생했습니다.'
      );
    }
  };

  // 로그인 페이지
  if (currentPage === 'login' || !user) {
    return <LoginPage onLogin={handleLogin} />;
  }

  // 나머지 페이지
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Navigation */}
      <nav className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-8">
              <h1
                className="text-blue-600 cursor-pointer"
                onClick={() => setCurrentPage('home')}
              >
                수강신청 도우미
              </h1>
              <div className="hidden md:flex space-x-4">
                <button
                  onClick={() => setCurrentPage('home')}
                  className={`px-3 py-2 rounded-md ${
                    currentPage === 'home'
                      ? 'bg-blue-50 text-blue-600'
                      : 'text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  홈
                </button>
                <button
                  onClick={() => setCurrentPage('timetable')}
                  className={`px-3 py-2 rounded-md ${
                    currentPage === 'timetable'
                      ? 'bg-blue-50 text-blue-600'
                      : 'text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  시간표 생성
                </button>
                <button
                  onClick={() => setCurrentPage('courses')}
                  className={`px-3 py-2 rounded-md ${
                    currentPage === 'courses'
                      ? 'bg-blue-50 text-blue-600'
                      : 'text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  수업 목록
                </button>
                <button
                  onClick={() => setCurrentPage('ai')}
                  className={`px-3 py-2 rounded-md ${
                    currentPage === 'ai'
                      ? 'bg-blue-50 text-blue-600'
                      : 'text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  AI 수업 추천
                </button>
                <button
                  onClick={() => setCurrentPage('mypage')}
                  className={`px-3 py-2 rounded-md ${
                    currentPage === 'mypage'
                      ? 'bg-blue-50 text-blue-600'
                      : 'text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  마이페이지
                </button>
              </div>
            </div>
            <div className="flex items-center space-x-4">
              <span className="text-gray-700">{user?.name}님</span>
              <button
                onClick={handleLogout}
                className="px-4 py-2 text-gray-700 hover:bg-gray-50 rounded-md"
              >
                로그아웃
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {timetableError && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            시간표 처리 중 오류가 발생했습니다. {timetableError}
          </div>
        )}

        {interestError && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            관심 과목 처리 중 오류가 발생했습니다. {interestError}
          </div>
        )}

        {interestAlerts.length > 0 && (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <strong className="block text-base">정원 임박 알림</strong>
            <p className="mt-1">
              관심 과목 중 정원이 90% 이상 찬 과목입니다. 빠르게 신청을 준비하세요.
            </p>
            <ul className="mt-2 list-disc pl-5">
              {interestAlerts.map((course) => (
                <li key={course.id}>
                  {course.name} ({course.enrolled}/{course.capacity})
                </li>
              ))}
            </ul>
          </div>
        )}

        {currentPage === 'home' && user && (
          <HomePage onNavigate={setCurrentPage} user={user} />
        )}
        {currentPage === 'timetable' && (
          <TimetableGenerator
            courses={courses}
            onSave={handleSaveTimetable}
            isSaving={isSavingTimetable}
          />
        )}
        {currentPage === 'courses' && (
          <CourseList
            courses={courses}
            isLoading={coursesLoading}
            error={coursesError}
            interestedCourses={interestedCourses}
            onToggleInterest={handleToggleInterest}
          />
        )}
        {currentPage === 'ai' && user && (
          <AIRecommendation
            user={user}
            onToggleInterest={handleToggleInterest}
            interestedCourses={interestedCourses}
          />
        )}
        {currentPage === 'mypage' && user && (
          <MyPage
            user={user}
            savedTimetables={savedTimetables}
            interestedCourses={interestedCourses}
            courses={courses}
            onDeleteTimetable={handleDeleteTimetable}
          />
        )}
      </main>
    </div>
  );
}
