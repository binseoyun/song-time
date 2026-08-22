import os

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker


def get_chat_db_url() -> str:
    host = os.getenv("CHAT_DB_HOST", "db-chat")
    port = os.getenv("CHAT_DB_PORT", "3306")
    name = os.getenv("CHAT_DB_NAME", "chat_db")
    user = os.getenv("CHAT_DB_USER")
    password = os.getenv("CHAT_DB_PASSWORD")
    return f"mysql+mysqlconnector://{user}:{password}@{host}:{port}/{name}"


engine = create_engine(get_chat_db_url(), pool_pre_ping=True)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
