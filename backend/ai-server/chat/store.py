"""AI 챗봇 영구 대화 이력(ADR-010 §10) — db-chat을 ai-server가 직접 소유·쿼리한다."""
from typing import Any, List, Optional

from sqlalchemy import func, update
from sqlalchemy.orm import Session

from db.models import ChatMessage, ChatSession


def create_session(db: Session, user_id: int) -> ChatSession:
    session = ChatSession(user_id=user_id)
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


def get_session(db: Session, session_id: str) -> Optional[ChatSession]:
    return db.get(ChatSession, session_id)


def list_sessions(db: Session, user_id: int) -> List[ChatSession]:
    return (
        db.query(ChatSession)
        .filter(ChatSession.user_id == user_id)
        .order_by(ChatSession.updated_at.desc())
        .all()
    )


def get_recent_messages(db: Session, session_id: str, limit: int) -> List[ChatMessage]:
    """최근 limit개를 최신순으로 가져온 뒤 시간순으로 뒤집어 반환한다(대화 맥락 구성용)."""
    messages = (
        db.query(ChatMessage)
        .filter(ChatMessage.session_id == session_id)
        .order_by(ChatMessage.created_at.desc())
        .limit(limit)
        .all()
    )
    return list(reversed(messages))


def get_all_messages(db: Session, session_id: str) -> List[ChatMessage]:
    return (
        db.query(ChatMessage)
        .filter(ChatMessage.session_id == session_id)
        .order_by(ChatMessage.created_at.asc())
        .all()
    )


def append_message(
    db: Session,
    session_id: str,
    role: str,
    content: str,
    tool_calls: Optional[Any] = None,
) -> ChatMessage:
    message = ChatMessage(session_id=session_id, role=role, content=content, tool_calls=tool_calls)
    db.add(message)
    db.execute(update(ChatSession).where(ChatSession.id == session_id).values(updated_at=func.now()))
    db.commit()
    db.refresh(message)
    return message
