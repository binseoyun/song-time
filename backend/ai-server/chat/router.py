"""ADR-010 §10/§11 — POST /api/ai/chat, GET /api/ai/sessions, GET /api/ai/sessions/:id/messages.

Node가 authMiddleware로 인증을 끝낸 뒤 x-user-id 신뢰 헤더를 붙여 프록시한다(§11).
이 헤더를 그대로 신뢰할 수 있는 건 ai-server 포트가 외부에 노출되지 않아(Stage 2-1
반영 예정) Docker 내부망을 거쳐 Node를 통과한 요청만 도달 가능하다는 전제 때문이다.
"""
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage
from pydantic import BaseModel
from sqlalchemy.orm import Session

from db.session import get_db

from . import cache, store
from .agent import RECURSION_LIMIT, get_agent

router = APIRouter(prefix="/api/ai", tags=["chat"])


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


def _extract_text(content: Any) -> str:
    """최신 langchain-google-genai는 AIMessage.content를 항상 문자열로 주지 않고
    [{"type": "text", "text": "..."}, ...] 같은 콘텐츠 블록 리스트로 줄 때가 있다
    (Gemini 3.x 응답 형식). MySQL TEXT 컬럼에 쓰려면 순수 문자열로 평탄화해야 한다."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for block in content:
            if isinstance(block, str):
                parts.append(block)
            elif isinstance(block, dict) and block.get("type") == "text":
                parts.append(block.get("text", ""))
        return "".join(parts)
    return str(content)


def _extract_tool_calls(new_messages) -> List[Dict[str, Any]]:
    """create_agent(langchain 1.x)의 invoke 결과 중 이번 호출에서 새로 생긴 메시지만
    받아, AIMessage.tool_calls와 매칭되는 ToolMessage.content(관측값)를 묶어
    감사 기록용으로 직렬화한다(ADR-010 §14 eval 데이터 원본)."""
    observations: Dict[str, Any] = {}
    for message in new_messages:
        if isinstance(message, ToolMessage):
            observations[message.tool_call_id] = message.content

    calls: List[Dict[str, Any]] = []
    for message in new_messages:
        if isinstance(message, AIMessage) and message.tool_calls:
            for call in message.tool_calls:
                calls.append(
                    {
                        "tool": call.get("name"),
                        "tool_input": call.get("args"),
                        "observation": observations.get(call.get("id")),
                    }
                )
    return calls


class ChatRequest(BaseModel):
    session_id: Optional[str] = None
    message: str


class ChatResponseMessage(BaseModel):
    role: str
    content: str


class ChatResponse(BaseModel):
    session_id: str
    message: ChatResponseMessage
    tool_calls: List[Dict[str, Any]]


@router.post("/chat", response_model=ChatResponse)
def chat(
    request: ChatRequest,
    user_id: int = Depends(require_user_id),
    db: Session = Depends(get_db),
):
    if not request.message or not request.message.strip():
        raise HTTPException(status_code=400, detail="message는 비어 있을 수 없습니다.")

    if request.session_id:
        session = _require_owned_session(db, request.session_id, user_id)
    else:
        session = store.create_session(db, user_id)

    raw_history = cache.read_history(session.id)
    if raw_history is None:
        recent = store.get_recent_messages(db, session.id, limit=cache.MAX_TURNS * 2)
        raw_history = [
            {"role": m.role, "content": m.content} for m in recent if m.role in ("user", "assistant")
        ]
        cache.warm_up(session.id, raw_history)

    agent = get_agent()
    input_messages = _to_history_messages(raw_history) + [HumanMessage(content=request.message)]
    try:
        result = agent.invoke(
            {"messages": input_messages}, config={"recursion_limit": RECURSION_LIMIT}
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"AI 응답 생성 중 오류가 발생했습니다: {exc}")

    new_messages = result["messages"][len(input_messages):]
    answer = _extract_text(result["messages"][-1].content)
    tool_calls = _extract_tool_calls(new_messages)

    store.append_message(db, session.id, role="user", content=request.message)
    store.append_message(db, session.id, role="assistant", content=answer, tool_calls=tool_calls or None)
    cache.append_turn(session.id, request.message, answer)

    return ChatResponse(
        session_id=session.id,
        message=ChatResponseMessage(role="assistant", content=answer),
        tool_calls=tool_calls,
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
