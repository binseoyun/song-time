"""ADR-010 §10/§11 — POST /api/ai/chat, GET /api/ai/sessions, GET /api/ai/sessions/:id/messages.

Node가 authMiddleware로 인증을 끝낸 뒤 x-user-id 신뢰 헤더를 붙여 프록시한다(§11).
이 헤더를 그대로 신뢰할 수 있는 건 ai-server 포트가 외부에 노출되지 않아(Stage 2-1
반영) Docker 내부망을 거쳐 Node를 통과한 요청만 도달 가능하다는 전제 때문이다.

POST /api/ai/chat는 SSE 스트리밍이다(Stage 2-1, ADR-010 §11). 턴당 응답 생성에 ~2초가
걸려 비-스트리밍이면 그 시간 내내 빈 화면이 유지됐다 — LangGraph 실행 엔진의
`stream_mode=["updates", "messages"]`로 (1) 최종 답변 토큰을 생성되는 대로 흘려보내고
(2) Tool 호출 사실을 별도 이벤트로 알린다. 영구 기록(db-chat)·작업 메모리(redis-chat)
갱신은 스트림이 끝난 뒤 한 번에 한다(비-스트리밍 때와 동일).
"""
import json
from typing import Any, Dict, Iterator, List, Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from fastapi.responses import StreamingResponse
from langchain_core.messages import AIMessage, AIMessageChunk, HumanMessage
from pydantic import BaseModel
from sqlalchemy.orm import Session

from db.session import SessionLocal, get_db

from . import cache, store
from .agent import RECURSION_LIMIT, get_agent
from .message_utils import extract_text, extract_tool_calls

router = APIRouter(prefix="/api/ai", tags=["chat"])


def _sse(event: str, data: Any) -> str:
    """SSE 프레임 1건. data는 항상 JSON으로 실어 프론트 파싱을 단일 경로로 유지한다."""
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def require_user_id(x_user_id: Optional[str] = Header(None, alias="x-user-id")) -> int:
    if not x_user_id:
        raise HTTPException(status_code=401, detail="x-user-id 헤더가 필요합니다.")
    try:
        return int(x_user_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="x-user-id 헤더 형식이 올바르지 않습니다.")


def _require_owned_session(db: Session, session_id: str, user_id: int):
    session = store.get_session(db, session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="세션을 찾을 수 없습니다.")
    if session.user_id != user_id:
        # 세션 ID만 바꿔서 남의 대화를 조회하는 IDOR을 막는다(ADR-010 §10).
        raise HTTPException(status_code=403, detail="본인 세션이 아닙니다.")
    return session


def _to_history_messages(raw_history: List[Dict[str, str]]):
    messages = []
    for item in raw_history:
        if item["role"] == "user":
            messages.append(HumanMessage(content=item["content"]))
        elif item["role"] == "assistant":
            messages.append(AIMessage(content=item["content"]))
    return messages


class ChatRequest(BaseModel):
    session_id: Optional[str] = None
    message: str


def _stream_chat(session_id: str, input_messages: list, user_message: str) -> Iterator[str]:
    """LangGraph 실행을 SSE 프레임으로 변환하고, 끝난 뒤 영구 기록/캐시를 갱신한다.

    - meta      : 세션 ID(새 대화면 여기서 프론트가 처음 알게 된다)
    - tool_call : 모델이 Tool을 호출함 (UX 피드백용, 관측값은 싣지 않는다)
    - token     : 최종 답변의 증분 텍스트
    - done      : 최종 tool_calls 목록(관측값 포함) + 세션 ID
    - error     : 스트림 도중 예외. 이미 200을 보냈으므로 상태코드로는 못 알린다.
    """
    yield _sse("meta", {"session_id": session_id})

    agent = get_agent()
    collected: List[Any] = []
    try:
        for mode, chunk in agent.stream(
            {"messages": input_messages},
            config={"recursion_limit": RECURSION_LIMIT},
            stream_mode=["updates", "messages"],
        ):
            if mode == "messages":
                message_chunk, _meta = chunk
                if isinstance(message_chunk, AIMessageChunk):
                    text = extract_text(message_chunk.content)
                    if text:
                        yield _sse("token", {"text": text})
            elif mode == "updates" and isinstance(chunk, dict):
                for node_update in chunk.values():
                    if not isinstance(node_update, dict):
                        continue
                    for message in node_update.get("messages", []) or []:
                        collected.append(message)
                        if isinstance(message, AIMessage) and message.tool_calls:
                            for call in message.tool_calls:
                                yield _sse(
                                    "tool_call",
                                    {"tool": call.get("name"), "tool_input": call.get("args")},
                                )
    except Exception as exc:
        yield _sse("error", {"detail": f"AI 응답 생성 중 오류가 발생했습니다: {exc}"})
        return

    answer = extract_text(collected[-1].content) if collected else ""
    tool_calls = extract_tool_calls(collected)

    # 스트림용으로 새 세션을 연다 — 요청 의존성(get_db)은 이 제너레이터가 실행될 때쯤
    # 이미 닫혔을 수 있어 재사용하지 않는다.
    db = SessionLocal()
    try:
        store.append_message(db, session_id, role="user", content=user_message)
        store.append_message(
            db, session_id, role="assistant", content=answer, tool_calls=tool_calls or None
        )
    finally:
        db.close()
    cache.append_turn(session_id, user_message, answer)

    yield _sse("done", {"session_id": session_id, "tool_calls": tool_calls})


@router.post("/chat")
def chat(
    request: ChatRequest,
    user_id: int = Depends(require_user_id),
    db: Session = Depends(get_db),
):
    if not request.message or not request.message.strip():
        raise HTTPException(status_code=400, detail="message는 비어 있을 수 없습니다.")

    # 세션 검증·이력 로딩은 스트림 시작 전에 끝낸다 — StreamingResponse가 시작되면
    # 상태코드를 못 바꾸므로 401/403/404는 반드시 여기서 난다.
    if request.session_id:
        session = _require_owned_session(db, request.session_id, user_id)
    else:
        session = store.create_session(db, user_id)
    session_id = session.id

    raw_history = cache.read_history(session_id)
    if raw_history is None:
        recent = store.get_recent_messages(db, session_id, limit=cache.MAX_TURNS * 2)
        raw_history = [
            {"role": m.role, "content": m.content} for m in recent if m.role in ("user", "assistant")
        ]
        cache.warm_up(session_id, raw_history)

    input_messages = _to_history_messages(raw_history) + [HumanMessage(content=request.message)]

    return StreamingResponse(
        _stream_chat(session_id, input_messages, request.message),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            # nginx가 이 응답만은 버퍼링하지 않도록(§11) — nginx.conf 설정과 이중 방어.
            "X-Accel-Buffering": "no",
        },
    )


class SessionSummary(BaseModel):
    id: str
    created_at: str
    updated_at: str


@router.get("/sessions", response_model=List[SessionSummary])
def get_sessions(user_id: int = Depends(require_user_id), db: Session = Depends(get_db)):
    sessions = store.list_sessions(db, user_id)
    return [
        SessionSummary(id=s.id, created_at=s.created_at.isoformat(), updated_at=s.updated_at.isoformat())
        for s in sessions
    ]


class MessageOut(BaseModel):
    role: str
    content: str
    tool_calls: Optional[Any] = None
    created_at: str


@router.get("/sessions/{session_id}/messages", response_model=List[MessageOut])
def get_session_messages(
    session_id: str,
    user_id: int = Depends(require_user_id),
    db: Session = Depends(get_db),
):
    session = _require_owned_session(db, session_id, user_id)
    messages = store.get_all_messages(db, session.id)
    return [
        MessageOut(
            role=m.role,
            content=m.content,
            tool_calls=m.tool_calls,
            created_at=m.created_at.isoformat(),
        )
        for m in messages
    ]
