// 실시간 수강신청 연습 탭(이슈 #54) — ADR-006 목표인 "실제 학교 수강신청 사이트와
// 동일한 UI/UX"를 재현한다. 화면 구조는 숙명여자대학교 포털 캡쳐본을 근거로 했다.
//
// 대기열(이슈 #46/#48) → Active 상태 → 학생기본정보/수강신청내역/개설과목조회(Stage 1
// 좌석 API) 순서로 이어진다. 개설과목조회의 12개 탭은 실제 사이트와 동일한 이름/배치를
// 쓰되, 우리 과목 데이터 모델이 구분을 지원하지 않는 탭(교직/공통·마이크로디그리 등)은
// 가짜 데이터를 만드는 대신 실제 사이트도 쓰는 빈 상태 문구를 그대로 보여준다.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search, Loader2, Clock, AlertTriangle } from 'lucide-react';
import type { Course, User } from '../App';

const API_BASE_URL = '';
const STATUS_POLL_INTERVAL_MS = 4000; // ADR-006 1.4: 3~5초 폴링
const EXPIRY_WARNING_MS = 30_000; // ADR-006 1.3: 만료 임박 경고

type QueueStatus =
  | { state: 'waiting'; rank: number }
  | { state: 'active'; expiresAt: number }
  | { state: 'not_entered' };

type MyRegistration = {
  classId: string;
  registeredAt: string;
  course: {
    id: string;
    code: string;
    name: string;
    professor: string;
    credits: number;
    courseType: string;
    schedules: Array<{ weekday: number; start_time: string; end_time: string | null; location: string | null }>;
  } | null;
};

type TabKey =
  | '직접입력'
  | '교양필수'
  | '교양선택'
  | '전공'
  | '타학과'
  | '교직'
  | '공통마이크로디그리'
  | '강의유형'
  | '과목검색'
  | '학부신설과목'
  | '집중학기'
  | '특성화영역별과목';

const TABS: { key: TabKey; label: string }[] = [
  { key: '직접입력', label: '직접입력' },
  { key: '교양필수', label: '교양필수' },
  { key: '교양선택', label: '교양선택' },
  { key: '전공', label: '전공' },
  { key: '타학과', label: '타학과' },
  { key: '교직', label: '교직' },
  { key: '공통마이크로디그리', label: '공통/마이크로디그리' },
  { key: '강의유형', label: '강의유형' },
  { key: '과목검색', label: '과목검색' },
  { key: '학부신설과목', label: '학부 신설과목' },
  { key: '집중학기', label: '집중학기' },
  { key: '특성화영역별과목', label: '특성화 영역별 과목' },
];

// 우리 데이터 모델(department/courseType)로 구분 가능한 탭만 실제 필터를 적용한다.
// 나머지는 대응하는 필드가 없어 빈 상태로 둔다 — 실제 사이트도 조건에 맞는 과목이
// 없으면 "해당 테이블에 데이터가 없습니다"를 보여주므로, 이 표시가 거짓은 아니다.
const DATA_BACKED_TABS: TabKey[] = ['교양필수', '교양선택', '전공', '타학과', '과목검색'];

const weekdayMap = ['일', '월', '화', '수', '목', '금', '토'];

function formatSchedules(schedules: MyRegistration['course'] extends infer C ? (C extends null ? never : C['schedules']) : never) {
  if (!schedules || schedules.length === 0) return '시간 정보 없음';
  return schedules
    .map((s) => {
      const day = weekdayMap[s.weekday] ?? s.weekday;
      const start = s.start_time?.slice(0, 5) ?? '';
      const end = s.end_time?.slice(0, 5) ?? '';
      return end ? `${day} ${start}~${end}` : `${day} ${start}`;
    })
    .join(', ');
}

function formatCourseSchedule(course: Course) {
  if (course.day && course.day.length > 0) {
    return `${course.day.join(', ')} ${course.time || ''}`.trim();
  }
  if (course.schedules && course.schedules.length > 0) {
    return course.schedules
      .map((s) => {
        const day = weekdayMap[s.weekday] ?? s.weekday;
        const start = s.start_time?.slice(0, 5) ?? '';
        const end = s.end_time?.slice(0, 5) ?? '';
        return end ? `${day} ${start}~${end}` : `${day} ${start}`;
      })
      .join(', ');
  }
  return '시간 정보 없음';
}

// 학과명 문자열이 완전히 같지 않아도(예: 사용자 소속 "컴퓨터과학과" vs 과목 소속
// "컴퓨터공학") 같은 분야로 취급한다 — 학과명 앞부분(핵심 키워드)이 실제 분야를
// 가장 잘 나타내고, "학과/학부/공학/과학" 같은 접미사만 다른 경우가 흔하기 때문.
function isSameField(userDepartment: string, courseDepartment: string) {
  if (!userDepartment || !courseDepartment) return false;
  if (userDepartment === courseDepartment) return true;
  const keyword = userDepartment.slice(0, 2);
  return courseDepartment.includes(keyword);
}

function formatRemaining(ms: number) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

type RegistrationPracticeProps = {
  user: User;
  authToken: string;
  courses: Course[];
};

export function RegistrationPractice({ user, authToken, courses }: RegistrationPracticeProps) {
  const [queue, setQueue] = useState<QueueStatus | { state: 'loading' } | { state: 'error'; message: string }>({
    state: 'loading',
  });
  const [now, setNow] = useState(Date.now());
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [myRegistrations, setMyRegistrations] = useState<MyRegistration[]>([]);
  const [registrationsError, setRegistrationsError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>('직접입력');
  const [searchTerm, setSearchTerm] = useState('');
  const [directCode, setDirectCode] = useState('');
  const [directSection, setDirectSection] = useState('');
  const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [pendingClassId, setPendingClassId] = useState<string | null>(null);

  const authHeaders = useMemo(
    () => ({ Authorization: `Bearer ${authToken}` }),
    [authToken]
  );

  const fetchMyRegistrations = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/registrations/redis`, { headers: authHeaders });
      if (!res.ok) throw new Error('수강신청 내역을 불러올 수 없습니다.');
      const payload = await res.json();
      setMyRegistrations(Array.isArray(payload.registrations) ? payload.registrations : []);
      setRegistrationsError(null);
    } catch (error) {
      setRegistrationsError(error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.');
    }
  };

  const enterQueue = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/queue/enter`, {
        method: 'POST',
        headers: authHeaders,
      });
      if (!res.ok) throw new Error('대기열 진입에 실패했습니다.');
      const payload: QueueStatus = await res.json();
      setQueue(payload);
    } catch (error) {
      setQueue({ state: 'error', message: error instanceof Error ? error.message : '알 수 없는 오류' });
    }
  };

  const pollStatus = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/queue/status`, { headers: authHeaders });
      if (!res.ok) throw new Error('대기열 상태 조회에 실패했습니다.');
      const payload: QueueStatus = await res.json();
      if (payload.state === 'not_entered') {
        // TTL 만료 등으로 빠졌으면 자동으로 다시 대기열에 넣는다.
        await enterQueue();
        return;
      }
      setQueue(payload);
    } catch (error) {
      // 폴링 실패는 조용히 다음 주기에 재시도한다(사용자에게 매번 에러를 띄우면 소란스러움).
      console.error('대기열 상태 폴링 오류:', error);
    }
  };

  // 최초 진입
  useEffect(() => {
    enterQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 대기 중일 때만 폴링
  useEffect(() => {
    if (queue.state === 'waiting') {
      pollRef.current = setInterval(pollStatus, STATUS_POLL_INTERVAL_MS);
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue.state]);

  // Active 상태 진입 시 내 신청 내역 로드 + 1초마다 남은 시간 갱신
  useEffect(() => {
    if (queue.state === 'active') {
      fetchMyRegistrations();
      tickRef.current = setInterval(() => setNow(Date.now()), 1000);
    }
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue.state]);

  // TTL 만료 감지 → 대기열로 자동 복귀
  useEffect(() => {
    if (queue.state === 'active' && now >= queue.expiresAt) {
      enterQueue();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now, queue.state]);

  const applyToClass = async (classId: string) => {
    if (!classId) return;
    setPendingClassId(classId);
    setActionMessage(null);
    try {
      const res = await fetch(`${API_BASE_URL}/api/registrations/redis`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ classId }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload?.message || '수강신청에 실패했습니다.');
      }
      setActionMessage({ type: 'success', text: payload?.message || '수강신청이 완료되었습니다.' });
      await fetchMyRegistrations();
    } catch (error) {
      setActionMessage({
        type: 'error',
        text: error instanceof Error ? error.message : '수강신청 처리 중 오류가 발생했습니다.',
      });
    } finally {
      setPendingClassId(null);
    }
  };

  const cancelClass = async (classId: string) => {
    setPendingClassId(classId);
    setActionMessage(null);
    try {
      const res = await fetch(`${API_BASE_URL}/api/registrations/redis/${classId}`, {
        method: 'DELETE',
        headers: authHeaders,
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload?.message || '수강신청 취소에 실패했습니다.');
      }
      setActionMessage({ type: 'success', text: payload?.message || '수강신청이 취소되었습니다.' });
      await fetchMyRegistrations();
    } catch (error) {
      setActionMessage({
        type: 'error',
        text: error instanceof Error ? error.message : '취소 처리 중 오류가 발생했습니다.',
      });
    } finally {
      setPendingClassId(null);
    }
  };

  const handleDirectApply = (e: React.FormEvent) => {
    e.preventDefault();
    if (!directCode.trim() || !directSection.trim()) return;
    applyToClass(`${directCode.trim()}-${Number(directSection)}`);
  };

  const filteredCourses = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    switch (activeTab) {
      case '교양필수':
      case '교양선택':
        return courses.filter((c) => c.courseType === '교양');
      case '전공':
        return courses.filter(
          (c) => isSameField(user.department, c.department) && (c.courseType === '전공필수' || c.courseType === '전공선택')
        );
      case '타학과':
        return courses.filter((c) => !isSameField(user.department, c.department));
      case '과목검색':
        if (!term) return courses;
        return courses.filter(
          (c) =>
            c.name.toLowerCase().includes(term) ||
            c.code.toLowerCase().includes(term) ||
            c.professor.toLowerCase().includes(term)
        );
      default:
        return [];
    }
  }, [activeTab, courses, searchTerm, user.department]);

  // --- 렌더링 ---

  if (queue.state === 'loading') {
    return (
      <div className="flex items-center justify-center py-24 text-gray-500">
        <Loader2 className="w-5 h-5 mr-2 animate-spin" />
        대기열 확인 중...
      </div>
    );
  }

  if (queue.state === 'error') {
    return (
      <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-6">
        대기열 처리 중 오류가 발생했습니다: {queue.message}
      </div>
    );
  }

  if (queue.state === 'waiting') {
    return (
      <div className="max-w-xl mx-auto bg-white rounded-lg shadow-md p-10 text-center space-y-4">
        <Clock className="w-10 h-10 mx-auto text-blue-500" />
        <h2 className="text-gray-900">대기 중입니다</h2>
        <p className="text-gray-600">
          현재 대기 순번: <span className="text-blue-600 text-xl font-semibold">{queue.rank}번</span>
        </p>
        <p className="text-sm text-gray-400">잠시 후 자동으로 입장됩니다. 새로고침해도 순번은 유지됩니다.</p>
      </div>
    );
  }

  // queue.state === 'active'
  const remainingMs = queue.expiresAt - now;
  const isExpiringSoon = remainingMs <= EXPIRY_WARNING_MS;

  return (
    <div className="space-y-6">
      {/* TTL 배너 */}
      <div
        className={`rounded-lg p-4 flex items-center justify-between ${
          isExpiringSoon ? 'bg-red-50 border border-red-200 text-red-700' : 'bg-blue-50 border border-blue-200 text-blue-700'
        }`}
      >
        <div className="flex items-center space-x-2">
          {isExpiringSoon && <AlertTriangle className="w-5 h-5" />}
          <span>{isExpiringSoon ? '입장 시간이 곧 만료됩니다! 서둘러 신청을 완료하세요.' : '입장 완료 — 아래에서 수강신청을 진행하세요.'}</span>
        </div>
        <span className="font-mono text-lg">{formatRemaining(remainingMs)}</span>
      </div>

      {actionMessage && (
        <div
          className={`rounded-lg p-4 text-sm ${
            actionMessage.type === 'success' ? 'bg-green-50 border border-green-200 text-green-700' : 'bg-red-50 border border-red-200 text-red-700'
          }`}
        >
          {actionMessage.text}
        </div>
      )}

      {/* 학생기본정보 */}
      <div className="bg-white rounded-lg shadow-md p-6">
        <h3 className="text-gray-900 mb-4">학생기본정보</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <span className="text-gray-500 block">학번</span>
            {user.studentId}
          </div>
          <div>
            <span className="text-gray-500 block">성명</span>
            {user.name}
          </div>
          <div>
            <span className="text-gray-500 block">소속</span>
            {user.department}
          </div>
          <div>
            <span className="text-gray-500 block">총 신청 과목수</span>
            {myRegistrations.length}과목
          </div>
        </div>
      </div>

      {/* 수강신청내역 */}
      <div className="bg-white rounded-lg shadow-md p-6">
        <h3 className="text-gray-900 mb-4">수강신청내역</h3>
        {registrationsError && <p className="text-sm text-red-600 mb-2">{registrationsError}</p>}
        {myRegistrations.length === 0 ? (
          <p className="text-gray-500 text-sm">신청한 과목이 없습니다.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b">
                  <th className="py-2 pr-4">과목명</th>
                  <th className="py-2 pr-4">과목번호</th>
                  <th className="py-2 pr-4">교과구분</th>
                  <th className="py-2 pr-4">강의시간</th>
                  <th className="py-2 pr-4">학점</th>
                  <th className="py-2"></th>
                </tr>
              </thead>
              <tbody>
                {myRegistrations.map((reg) => (
                  <tr key={reg.classId} className="border-b last:border-0">
                    <td className="py-2 pr-4">{reg.course?.name ?? reg.classId}</td>
                    <td className="py-2 pr-4">{reg.course?.code ?? reg.classId}</td>
                    <td className="py-2 pr-4">{reg.course?.courseType ?? '-'}</td>
                    <td className="py-2 pr-4">{formatSchedules(reg.course?.schedules ?? [])}</td>
                    <td className="py-2 pr-4">{reg.course?.credits ?? '-'}</td>
                    <td className="py-2">
                      <button
                        onClick={() => cancelClass(reg.classId)}
                        disabled={pendingClassId === reg.classId}
                        className="px-3 py-1 text-red-600 border border-red-200 rounded hover:bg-red-50 disabled:opacity-50"
                      >
                        취소
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 개설과목조회 */}
      <div className="bg-white rounded-lg shadow-md p-6">
        <h3 className="text-gray-900 mb-4">개설과목조회</h3>

        <div className="flex flex-wrap gap-1 border-b mb-4">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-3 py-2 text-sm rounded-t ${
                activeTab === tab.key ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === '직접입력' ? (
          <form onSubmit={handleDirectApply} className="flex items-center gap-2">
            <span className="text-gray-500 text-sm">*과목번호:</span>
            <input
              value={directCode}
              onChange={(e) => setDirectCode(e.target.value)}
              placeholder="예) 21001083"
              className="border border-gray-300 rounded px-3 py-2 w-40 text-sm"
            />
            <span>-</span>
            <input
              value={directSection}
              onChange={(e) => setDirectSection(e.target.value)}
              placeholder="분반"
              className="border border-gray-300 rounded px-3 py-2 w-20 text-sm"
            />
            <button
              type="submit"
              disabled={pendingClassId !== null}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 text-sm"
            >
              바로신청
            </button>
            <span className="text-gray-400 text-xs">과목번호 - 분반을 입력하여 직접 신청할 수 있습니다.</span>
          </form>
        ) : !DATA_BACKED_TABS.includes(activeTab) ? (
          <div className="text-center text-gray-500 text-sm py-10 bg-gray-50 rounded">해당 테이블에 데이터가 없습니다.</div>
        ) : (
          <div>
            {activeTab === '과목검색' && (
              <div className="relative mb-4">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
                <input
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="과목명, 과목코드, 교수명으로 검색..."
                  className="w-full pl-9 pr-4 py-2 border border-gray-300 rounded-lg text-sm"
                />
              </div>
            )}

            {filteredCourses.length === 0 ? (
              <div className="text-center text-gray-500 text-sm py-10 bg-gray-50 rounded">해당 테이블에 데이터가 없습니다.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-500 border-b">
                      <th className="py-2 pr-4">과목명</th>
                      <th className="py-2 pr-4">과목번호</th>
                      <th className="py-2 pr-4">교과구분</th>
                      <th className="py-2 pr-4">강의시간</th>
                      <th className="py-2 pr-4">담당교수</th>
                      <th className="py-2 pr-4">학점</th>
                      <th className="py-2 pr-4">정원</th>
                      <th className="py-2 pr-4">신청</th>
                      <th className="py-2 pr-4">여석</th>
                      <th className="py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredCourses.map((course) => {
                      const remaining = course.capacity - course.enrolled;
                      const alreadyRegistered = myRegistrations.some((r) => r.classId === course.id);
                      return (
                        <tr key={course.id} className="border-b last:border-0">
                          <td className="py-2 pr-4">{course.name}</td>
                          <td className="py-2 pr-4">{course.code}</td>
                          <td className="py-2 pr-4">{course.courseType}</td>
                          <td className="py-2 pr-4">{formatCourseSchedule(course)}</td>
                          <td className="py-2 pr-4">{course.professor}</td>
                          <td className="py-2 pr-4">{course.credits}</td>
                          <td className="py-2 pr-4">{course.capacity}</td>
                          <td className="py-2 pr-4">{course.enrolled}</td>
                          <td className={`py-2 pr-4 ${remaining <= 0 ? 'text-red-600' : 'text-gray-700'}`}>{remaining}</td>
                          <td className="py-2">
                            <button
                              onClick={() => applyToClass(course.id)}
                              disabled={pendingClassId !== null || alreadyRegistered}
                              className="px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 text-xs"
                            >
                              {alreadyRegistered ? '신청됨' : '신청'}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
