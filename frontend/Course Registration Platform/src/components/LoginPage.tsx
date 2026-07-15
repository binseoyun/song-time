import { useState } from 'react';
import { User } from '../App';
import { LogIn, UserPlus, Loader2 } from 'lucide-react';

type LoginPageProps = {
  onLogin: (user: User, token: string) => Promise<void> | void;
};

// 백엔드 API 주소 (Docker 환경: 8000번 포트)
// 로컬 환경에 맞춰 주소를 수정해주세요 (예: http://localhost:3000/api/auth)
const API_BASE_URL = import.meta.env.VITE_AUTH_BASE_URL ?? 'http://127.0.0.1:8000/api/auth'

export function LoginPage({ onLogin }: LoginPageProps) {
  
  const [isSignup, setIsSignup] = useState(false);
  const [formData, setFormData] = useState({
    studentId: '',
    password: '',
    name: '',
    department: '',
  });
  
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      // 1. 로그인/회원가입 분기 처리
      const endpoint = isSignup ? 'signup' : 'login'; 
      
      // 2. 백엔드로 보낼 데이터 준비
      const requestBody = isSignup 
        ? { // 회원가입 시: 이름, 학과 포함 전송
            studentId: formData.studentId,
            password: formData.password,
            name: formData.name,
            major: formData.department // 백엔드는 'major'로 받음
          }
        : { // 로그인 시: 학번, 비번만 전송
            studentId: formData.studentId,
            password: formData.password
          };

      // 3. 백엔드 API 호출 (진짜 DB 확인)
      const response = await fetch(`${API_BASE_URL}/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      const result = await response.json();

      if (!response.ok) {
        // 실패 시 백엔드에서 보낸 에러 메시지 출력
        throw new Error(result.message || '요청 처리에 실패했습니다.');
      }

      // 4. 성공 처리
      if (isSignup) {
        // 회원가입 성공 -> 로그인 화면으로 전환
        alert('회원가입이 완료되었습니다! 로그인해주세요.');
        setIsSignup(false);
        // 폼 초기화 (학번은 남겨두면 편함)
        setFormData(prev => ({ ...prev, password: '', name: '', department: '' }));
      } else {
        // 로그인 성공 -> 백엔드에서 받은 '진짜 유저 정보' 사용!
        const { user, token } = result;
        
        // App.tsx에 전달할 유저 객체 생성
        const realUser: User = {
          id: user.id || 'temp-id',
          email: `${user.studentId}@university.ac.kr`,
          name: user.name,             // DB에 저장된 진짜 이름
          studentId: user.studentId,   // DB에 저장된 진짜 학번
          department: user.department || user.major, // DB에 저장된 진짜 학과
        };

        await onLogin(realUser, token); 
      }

    } catch (err: any) {
      console.error('Login Error:', err);
      setError(err.message || '서버 연결 실패. 백엔드가 켜져 있나요?');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl p-8 w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-blue-600 mb-2">수강신청 도우미</h1>
          <p className="text-gray-600">개인화된 시간표 관리 서비스</p>
        </div>

        <div className="flex gap-2 mb-6">
          <button
            onClick={() => { setIsSignup(false); setError(''); }}
            className={`flex-1 py-2 rounded-lg transition-colors ${
              !isSignup
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
            disabled={isLoading}
          >
            <LogIn className="inline-block w-4 h-4 mr-2" />
            로그인
          </button>
          <button
            onClick={() => { setIsSignup(true); setError(''); }}
            className={`flex-1 py-2 rounded-lg transition-colors ${
              isSignup
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
            disabled={isLoading}
          >
            <UserPlus className="inline-block w-4 h-4 mr-2" />
            회원가입
          </button>
        </div>

        {/* 에러 메시지 표시 영역 */}
        {error && (
          <div className="mb-4 p-3 bg-red-50 text-red-600 text-sm rounded-lg border border-red-100">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {isSignup && (
            <>
              <div>
                <label className="block text-gray-700 mb-2">이름</label>
                <input
                  type="text"
                  name="name" // name 속성 추가
                  value={formData.name}
                  onChange={handleChange}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="홍길동"
                  required
                />
              </div>

              <div>
                <label className="block text-gray-700 mb-2">학과</label>
                <input
                  type="text"
                  name="department" // name 속성 추가
                  value={formData.department}
                  onChange={handleChange}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="컴퓨터공학과"
                  required
                />
              </div>
            </>
          )}

          <div>
            <label className="block text-gray-700 mb-2">학번</label>
            <input
              type="text"
              name="studentId" // name 속성 추가
              value={formData.studentId}
              onChange={handleChange}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="20240001"
              required
            />
          </div>

          <div>
            <label className="block text-gray-700 mb-2">비밀번호</label>
            <input
              type="password"
              name="password" // name 속성 추가
              value={formData.password}
              onChange={handleChange}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="••••••••"
              required
            />
          </div>

          <button
            type="submit"
            className="w-full bg-blue-600 text-white py-3 rounded-lg hover:bg-blue-700 transition-colors flex items-center justify-center"
            disabled={isLoading}
          >
            {isLoading ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin mr-2" />
                <span>처리 중...</span>
              </>
            ) : (
              <span>{isSignup ? '회원가입' : '로그인'}</span>
            )}
          </button>
        </form>

        {!isSignup && (
          <div className="mt-4 text-center">
            <button className="text-blue-600 hover:underline">
              비밀번호를 잊으셨나요?
            </button>
          </div>
        )}
      </div>
    </div>
  );
}