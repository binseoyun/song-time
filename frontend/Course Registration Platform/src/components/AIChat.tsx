// frontend/Course Registration Platform/src/components/AIChat.tsx
//
// AI 상담 챗봇(ADR-010 §11, Stage 2-2) — 읽기 전용 상담 UI다.
// 잔여석·과목 정보 질의응답과 추천만 하고, 실제 신청·취소 버튼은 없다(write Tool 배제, §9).
// 응답은 SSE 스트림(POST /api/ai/chat)을 fetch 스트림으로 직접 파싱해 타이핑되듯 렌더한다.
// "새 대화" + 왼쪽 세션 목록으로 과거 대화를 다시 열 수 있다(GET /api/ai/sessions,
// GET /api/ai/sessions/:id/messages, 0-4/0-5 API).
//
// 레이아웃은 인라인 style로 짠다 — 이 프로젝트의 src/index.css는 빌드타임에 고정된
// Tailwind v4 산출물이라(툴체인 없음) 새 유틸리티 클래스는 생성되지 않는다. 색/타이포는
// 이미 존재하는 클래스만, 구조(flex 방향·높이·스크롤)는 style로 확실하게.

import React, { useEffect, useRef, useState } from 'react';
import { Bot, Loader2, MessageSquarePlus, Send, User as UserIcon, Wrench } from 'lucide-react';
import type { User } from '../App';

type AIChatProps = {
  user: User;
  authToken: string;
};

type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

type SessionSummary = {
  id: string;
  created_at: string;
  updated_at: string;
};

// ADR-003: 상대경로 — nginx가 같은 origin에서 Node로 라우팅하고, Node가 ai-server SSE를 프록시한다.
const CHAT_URL = '/api/ai/chat';
const SESSIONS_URL = '/api/ai/sessions';

const TOOL_LABELS: Record<string, string> = {
  search_courses: '과목 목록을 살펴보는 중',
  get_course_by_code: '과목 정보를 확인하는 중',
};

const SUGGESTIONS = [
  '자료구조 잔여석 알려줘',
  '알고리즘 과목 정보 알려줘',
  '백엔드 개발이랑 관련된 과목 추천해줘',
  '데이터베이스 수업 언제 하는지 궁금해',
];

function formatSessionLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '대화';
  return date.toLocaleString('ko-KR', {
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function AIChat({ user, authToken }: AIChatProps) {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [toolActivity, setToolActivity] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const authHeaders = { Authorization: `Bearer ${authToken}` };

  const loadSessions = async () => {
    try {
      const res = await fetch(SESSIONS_URL, { headers: authHeaders });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setSessions(Array.isArray(data) ? data : []);
    } catch {
      // 세션 목록 실패는 대화 자체를 막지 않는다 — 조용히 비워둔다.
      setSessions([]);
    }
  };

  useEffect(() => {
    loadSessions();
    return () => abortRef.current?.abort();
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, streamingText, toolActivity]);

  const startNewChat = () => {
    if (streaming) return;
    setCurrentSessionId(null);
    setMessages([]);
    setError(null);
    setStreamingText('');
    setToolActivity(null);
  };

  const openSession = async (sessionId: string) => {
    if (streaming || sessionId === currentSessionId) return;
    setError(null);
    setHistoryLoading(true);
    try {
      const res = await fetch(`${SESSIONS_URL}/${sessionId}/messages`, { headers: authHeaders });
      if (!res.ok) throw new Error('대화 기록을 불러오지 못했습니다.');
      const data = await res.json();
      const restored: ChatMessage[] = Array.isArray(data)
        ? data
            .filter((m: any) => m.role === 'user' || m.role === 'assistant')
            .map((m: any) => ({ role: m.role, content: m.content }))
        : [];
      setMessages(restored);
      setCurrentSessionId(sessionId);
    } catch (err) {
      setError(err instanceof Error ? err.message : '대화 기록을 불러오지 못했습니다.');
    } finally {
      setHistoryLoading(false);
    }
  };

  const handleFrame = (frame: string) => {
    const lines = frame.split('\n');
    let event = 'message';
    const dataLines: string[] = [];
    for (const line of lines) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
    }
    if (dataLines.length === 0) return;
    let payload: any;
    try {
      payload = JSON.parse(dataLines.join('\n'));
    } catch {
      return;
    }

    if (event === 'meta' && payload.session_id) {
      setCurrentSessionId(payload.session_id);
    } else if (event === 'tool_call') {
      setToolActivity(TOOL_LABELS[payload.tool] ?? '정보를 조회하는 중');
    } else if (event === 'token' && typeof payload.text === 'string') {
      setToolActivity(null);
      setStreamingText((prev) => prev + payload.text);
    } else if (event === 'error') {
      setError(payload.detail || 'AI 응답 생성 중 오류가 발생했습니다.');
    }
    // 'done'은 스트림 종료 처리(finally)에서 함께 마무리한다.
  };

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || streaming) return;

    setError(null);
    setInput('');
    setMessages((prev) => [...prev, { role: 'user', content: text }]);
    setStreamingText('');
    setToolActivity(null);
    setStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;

    let finalText = '';
    let hadError = false;
    try {
      const res = await fetch(CHAT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ session_id: currentSessionId, message: text }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        let detail = 'AI 챗봇과 통신 중 오류가 발생했습니다.';
        try {
          const body = await res.json();
          detail = body.message || body.detail || detail;
        } catch {
          /* noop */
        }
        throw new Error(detail);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() ?? '';
        for (const part of parts) {
          if (!part.trim()) continue;
          handleFrame(part);
          // 확정 답변은 상태 갱신 타이밍에 의존하지 않도록 로컬 변수로도 누적한다.
          const dataLines = part
            .split('\n')
            .filter((l) => l.startsWith('data:'))
            .map((l) => l.slice(5).trim());
          if (/^event:\s*token/m.test(part) && dataLines.length) {
            try {
              finalText += JSON.parse(dataLines.join('\n')).text ?? '';
            } catch {
              /* noop */
            }
          }
          if (/^event:\s*error/m.test(part)) hadError = true;
        }
      }
    } catch (err) {
      if ((err as any)?.name === 'AbortError') return;
      hadError = true;
      setError(err instanceof Error ? err.message : 'AI 챗봇과 통신 중 오류가 발생했습니다.');
    } finally {
      setStreaming(false);
      setToolActivity(null);
      setStreamingText('');
      abortRef.current = null;
      if (finalText.trim()) {
        setMessages((prev) => [...prev, { role: 'assistant', content: finalText }]);
      }
      if (!hadError) loadSessions();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const showEmptyState = messages.length === 0 && !streaming && !streamingText;
  const canSend = !streaming && input.trim().length > 0;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-gray-900 mb-2">AI 상담 챗봇</h2>
        <p className="text-gray-600">
          잔여석·과목 정보·시간표 추천을 물어보세요. 실제 신청·취소는 &lsquo;실시간 수강신청 연습&rsquo; 탭에서 직접 진행합니다.
        </p>
      </div>

      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {/* 세션 목록 */}
        <aside
          className="bg-white rounded-lg shadow-md p-3"
          style={{ width: 240, flexShrink: 0, alignSelf: 'stretch' }}
        >
          <button
            onClick={startNewChat}
            disabled={streaming}
            className="bg-blue-600 text-white rounded-md px-3 py-2 mb-3"
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              opacity: streaming ? 0.5 : 1,
              cursor: streaming ? 'not-allowed' : 'pointer',
            }}
          >
            <MessageSquarePlus className="w-4 h-4" />
            새 대화
          </button>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 360, overflowY: 'auto' }}>
            {sessions.length === 0 && (
              <p className="text-gray-400 text-sm text-center py-3">아직 대화 기록이 없습니다.</p>
            )}
            {sessions.map((session) => {
              const active = session.id === currentSessionId;
              return (
                <button
                  key={session.id}
                  onClick={() => openSession(session.id)}
                  disabled={streaming}
                  className={active ? 'bg-blue-50 text-blue-700 rounded-md' : 'text-gray-600 rounded-md hover:bg-gray-50'}
                  style={{
                    textAlign: 'left',
                    padding: '8px 12px',
                    fontSize: 14,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    cursor: streaming ? 'not-allowed' : 'pointer',
                  }}
                >
                  {formatSessionLabel(session.updated_at || session.created_at)}
                </button>
              );
            })}
          </div>
        </aside>

        {/* 대화 영역 */}
        <section
          className="bg-white rounded-lg shadow-md"
          style={{ flex: 1, minWidth: 320, display: 'flex', flexDirection: 'column', height: '65vh' }}
        >
          <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
            {historyLoading && (
              <div className="text-gray-400 text-sm" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Loader2 className="w-4 h-4 animate-spin" />
                대화 기록을 불러오는 중...
              </div>
            )}

            {showEmptyState && !historyLoading && (
              <div
                style={{
                  height: '100%',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  textAlign: 'center',
                }}
              >
                <Bot className="w-12 h-12 text-blue-600 mb-3" />
                <h3 className="text-gray-900 mb-1">무엇을 도와드릴까요?</h3>
                <p className="text-gray-500 text-sm mb-4">{user.name}님, 아래 질문으로 시작해 보세요.</p>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                    gap: 8,
                    width: '100%',
                    maxWidth: 440,
                  }}
                >
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      onClick={() => setInput(s)}
                      className="border border-gray-200 rounded-lg text-gray-600 text-sm hover:border-blue-400"
                      style={{ padding: '8px 12px', textAlign: 'left', cursor: 'pointer' }}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {messages.map((message, index) => (
                <MessageBubble key={index} role={message.role} content={message.content} />
              ))}

              {toolActivity && (
                <div className="text-blue-600 text-sm" style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 44 }}>
                  <Wrench className="w-4 h-4 animate-pulse" />
                  {toolActivity}...
                </div>
              )}

              {streaming && streamingText && (
                <MessageBubble role="assistant" content={streamingText} pending />
              )}

              {streaming && !streamingText && !toolActivity && (
                <div className="text-gray-400 text-sm" style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 44 }}>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  답변을 준비하고 있어요...
                </div>
              )}
            </div>
          </div>

          {error && (
            <div className="bg-red-50 text-red-600 rounded-lg text-sm" style={{ margin: '0 16px 8px', padding: 12 }}>
              {error}
            </div>
          )}

          <div className="border-t border-gray-200" style={{ padding: 12 }}>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                rows={1}
                placeholder="메시지를 입력하세요 (Enter로 전송, Shift+Enter 줄바꿈)"
                className="border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                style={{ flex: 1, resize: 'none', padding: '8px 12px', maxHeight: 128, fontFamily: 'inherit' }}
              />
              <button
                onClick={sendMessage}
                disabled={!canSend}
                className="bg-blue-600 text-white rounded-lg"
                style={{
                  width: 40,
                  height: 40,
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: canSend ? 1 : 0.5,
                  cursor: canSend ? 'pointer' : 'not-allowed',
                }}
              >
                {streaming ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function MessageBubble({
  role,
  content,
  pending,
}: {
  role: 'user' | 'assistant';
  content: string;
  pending?: boolean;
}) {
  const isUser = role === 'user';
  return (
    <div
      style={{
        display: 'flex',
        gap: 12,
        flexDirection: isUser ? 'row-reverse' : 'row',
      } as React.CSSProperties}
    >
      <div
        className={isUser ? 'bg-gray-200 text-gray-600 rounded-full' : 'bg-blue-100 text-blue-600 rounded-full'}
        style={{ width: 32, height: 32, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      >
        {isUser ? <UserIcon className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
      </div>
      <div
        className={isUser ? 'bg-blue-600 text-white rounded-lg text-sm' : 'bg-gray-100 text-gray-900 rounded-lg text-sm'}
        style={{ maxWidth: '80%', padding: '8px 16px', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
      >
        {content}
        {pending && (
          <span
            className="animate-pulse"
            style={{ display: 'inline-block', width: 6, height: 14, marginLeft: 2, verticalAlign: 'middle', background: 'currentColor' }}
          />
        )}
      </div>
    </div>
  );
}
