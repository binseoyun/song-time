// homepage.tsx
import { Calendar, BookOpen, Sparkles, User } from 'lucide-react';
import { User as UserType, Page } from '../App';

type HomePageProps = {
  onNavigate: (page: Page) => void;
  user: UserType;
};

export function HomePage({ onNavigate, user }: HomePageProps) {
  const features = [
    {
      icon: Calendar,
      title: '시간표 생성',
      description: '조건에 맞는 3가지 시간표를 자동으로 생성해드립니다',
      color: 'bg-blue-500',
      page: 'timetable' as Page,
    },
    {
      icon: BookOpen,
      title: '수업 목록',
      description: '수강 희망 과목을 등록하고 정원 현황을 확인하세요',
      color: 'bg-green-500',
      page: 'courses' as Page,
    },
    {
      icon: Sparkles,
      title: 'AI 수업 추천',
      description: '직무별로 적합한 과목을 AI가 추천해드립니다',
      color: 'bg-purple-500',
      page: 'ai' as Page,
    },
    {
      icon: User,
      title: '마이페이지',
      description: '저장한 시간표와 수요조사 기록을 확인하세요',
      color: 'bg-orange-500',
      page: 'mypage' as Page,
    },
  ];

  return (
    <div className="space-y-8">
      {/* Welcome Section */}
      <div className="bg-gradient-to-r from-blue-600 to-indigo-600 rounded-lg shadow-lg p-8 text-white">
        <h2 className="mb-2">환영합니다, {user.name}님!</h2>
        <p className="text-blue-100">
          {user.department} · {user.studentId}
        </p>
        <p className="mt-4">
          수강신청 준비를 시작해보세요. 최적의 시간표를 만들어드립니다.
        </p>
      </div>

      {/* Quick Tips (위로 올림) */}
      <div className="bg-yellow-50 border-l-4 border-yellow-400 p-6 rounded">
        <h4 className="text-yellow-800 mb-2">💡 팁</h4>
        <ul className="text-yellow-700 space-y-1">
          <li>• 시간표 생성 전에 수업 목록에서 관심 과목을 먼저 등록해보세요</li>
          <li>• AI 수업 추천으로 자신의 진로에 맞는 과목을 찾아보세요</li>
          <li>• 여러 시간표를 저장해두고 비교해보세요</li>
        </ul>
      </div>

      {/* Feature Cards */}
      <div>
        <h3 className="mb-4 text-gray-900">주요 기능</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {features.map((feature, index) => (
            <button
              key={index}
              onClick={() => onNavigate(feature.page)}
              className="bg-white rounded-lg shadow-md p-6 hover:shadow-lg transition-all text-left group"
            >
              <div className="flex items-start space-x-4">
                <div
                  className={`${feature.color} rounded-lg p-3 group-hover:scale-110 transition-transform`}
                >
                  <feature.icon className="w-6 h-6 text-white" />
                </div>
                <div className="flex-1">
                  <h4 className="text-gray-900 mb-2">{feature.title}</h4>
                  <p className="text-gray-600">{feature.description}</p>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
