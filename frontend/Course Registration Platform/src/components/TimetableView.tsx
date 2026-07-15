import { Timetable } from '../App';

type TimetableViewProps = {
  timetable: Timetable;
};

const timeSlots = [
  '09:00',
  '10:00',
  '11:00',
  '12:00',
  '13:00',
  '14:00',
  '15:00',
  '16:00',
  '17:00',
  '18:00',
];

const days = ['월', '화', '수', '목', '금'];

const colors = [
  'bg-blue-100 border-blue-300 text-blue-900',
  'bg-green-100 border-green-300 text-green-900',
  'bg-purple-100 border-purple-300 text-purple-900',
  'bg-orange-100 border-orange-300 text-orange-900',
  'bg-pink-100 border-pink-300 text-pink-900',
  'bg-indigo-100 border-indigo-300 text-indigo-900',
  'bg-yellow-100 border-yellow-300 text-yellow-900',
  'bg-red-100 border-red-300 text-red-900',
];

// 시간 범위 설정
const START_HOUR = 9;
const END_HOUR = 18;
const SLOT_HEIGHT = 64; // 1시간당 높이(px)

// "12:00" -> 12.0, "14:50" -> 14.833...
const parseHour = (t: string): number | null => {
  const m = t.match(/(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  return h + min / 60;
};

// "12:00-14:50" / "12:00~14:50" -> { start, end }
const parseTimeRange = (
  timeStr: string
): { start: number; end: number } | null => {
  if (!timeStr) return null;

  const parts = timeStr.split(/[-~]/); // -, ~ 둘 다 허용
  if (parts.length < 2) return null;

  const start = parseHour(parts[0].trim());
  const end = parseHour(parts[1].trim());
  if (start == null || end == null) return null;

  return { start, end };
};

export function TimetableView({ timetable }: TimetableViewProps) {
  const getCourseColor = (courseId: string) => {
    const hash = courseId
      .split('')
      .reduce((acc, char) => acc + char.charCodeAt(0), 0);
    return colors[hash % colors.length];
  };

  const totalHeight = (END_HOUR - START_HOUR) * SLOT_HEIGHT;

  return (
    <div className="space-y-4">
      {/* 수업 목록 */}
      <div className="bg-gray-50 rounded-lg p-4">
        <h4 className="text-gray-900 mb-3">수업 목록</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {timetable.courses.map((course) => (
            <div key={course.id} className="flex items-center space-x-2">
              <div
                className={`w-3 h-3 rounded ${getCourseColor(course.id)}`}
              ></div>
              <span className="text-gray-700">
                {course.name} ({course.credits}학점)
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* 시간표 */}
      <div className="border border-gray-300 rounded-lg overflow-hidden">
        {/* 헤더 (요일) */}
        <div className="grid grid-cols-6 bg-gray-100 border-b border-gray-300">
          <div className="p-3 text-center border-r border-gray-300">
            <span className="text-gray-600">시간</span>
          </div>
          {days.map((day) => (
            <div
              key={day}
              className="p-3 text-center border-r border-gray-300 last:border-r-0"
            >
              <span className="text-gray-900">{day}</span>
            </div>
          ))}
        </div>

        {/* 본문 */}
        <div className="grid grid-cols-6">
          {/* 시간 라벨 */}
          <div
            className="relative border-r border-gray-300 bg-gray-50"
            style={{ height: totalHeight }}
          >
            {timeSlots.map((time, idx) => (
              <div
                key={time}
                className="absolute left-0 right-0 border-t border-gray-200 flex justify-center"
                style={{
                  top: idx * SLOT_HEIGHT,
                  height: SLOT_HEIGHT,
                }}
              >
                <span className="text-xs text-gray-600 mt-1">{time}</span>
              </div>
            ))}
          </div>

          {/* 요일별 칼럼 */}
          {days.map((day) => (
            <div
              key={day}
              className="relative border-r border-gray-300 last:border-r-0 bg-white"
              style={{ height: totalHeight }}
            >
              {/* 격자 라인 */}
              {timeSlots.map((_, idx) => (
                <div
                  key={idx}
                  className="absolute left-0 right-0 border-t border-gray-200"
                  style={{ top: idx * SLOT_HEIGHT }}
                />
              ))}

              {/* 이 요일에 해당하는 수업들 */}
              {timetable.courses
                .filter((course) => course.day.includes(day))
                .map((course) => {
                  const range = parseTimeRange(course.time);
                  if (!range) return null;

                  const { start, end } = range;

                  const clampedStart = Math.max(start, START_HOUR);
                  const clampedEnd = Math.min(end, END_HOUR);
                  const top = (clampedStart - START_HOUR) * SLOT_HEIGHT;
                  const height = Math.max(
                    (clampedEnd - clampedStart) * SLOT_HEIGHT,
                    SLOT_HEIGHT / 2
                  );

                  return (
                    <div
                      key={course.id + day}
                      className={`absolute rounded border-2 p-2 text-xs text-center ${getCourseColor(
                        course.id
                      )}`}
                      style={{
                        top,
                        height,
                        left: '50%',
                        transform: 'translateX(-50%)',
                        width: '80%', // ✅ 모든 블록 가로폭 동일 + 가운데 정렬
                      }}
                    >
                      <div className="font-medium truncate">
                        {course.name}
                      </div>
                      <div className="opacity-75">{course.professor}</div>
                      <div className="opacity-70 text-[10px] mt-1">
                        {course.time}
                      </div>
                    </div>
                  );
                })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
