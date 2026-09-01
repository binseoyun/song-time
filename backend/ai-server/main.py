# backend/ai-server/main.py
import logging
from typing import Dict, Any, List

import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from chat.router import router as chat_router
from scheduler import generate_schedule

# .env 파일 로드
load_dotenv()

# 챗봇 장애 로깅(Stage 3-2) — raw 예외는 클라이언트로 안 보내고 여기로만 남긴다.
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s [%(name)s] %(message)s")

# Gemini 설정은 각 소비자가 자체적으로 한다: 챗봇 에이전트는 langchain_google_genai에
# google_api_key를 직접 넘기고(chat/agent.py), RAG 임베딩은 rag/embed.py가
# genai.configure를 자체 호출한다. 옛 /recommend(Stage 3-4에서 제거)만 이 모듈의
# 전역 genai 설정에 의존했다.

# ------------------------------------------------
# FastAPI 앱 생성
# ------------------------------------------------
app = FastAPI()

# ✅ CORS 설정 (여기가 지금 에러 나던 부분)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],        # 개발용: 다 허용
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# AI 챗봇 라우트(ADR-010, Stage 0-5) — POST /api/ai/chat, GET /api/ai/sessions,
# GET /api/ai/sessions/:id/messages
app.include_router(chat_router)


# 프론트엔드 요청 데이터 구조 정의
class ScheduleRequest(BaseModel):
    selected_course_ids: List[str]
    preferences: Dict[str, Any]
    courses: List[Dict[str, Any]]  # 프론트에서 보내주는 과목 리스트


@app.post("/api/schedule")
def create_schedule_endpoint(request: ScheduleRequest):
    courses = request.courses

    if not request.selected_course_ids:
        raise HTTPException(status_code=400, detail="최소 1개 이상의 과목을 선택해주세요.")

    # 디버깅: times 필드 있는지 검사
    for c in courses:
        if "times" not in c:
            raise HTTPException(
                status_code=400,
                detail=f"과목 '{c.get('name')}' 에 times 정보가 없습니다.",
            )

    try:
        plan_a = generate_schedule(courses, request.selected_course_ids, request.preferences, seed=10)
        plan_b = generate_schedule(courses, request.selected_course_ids, request.preferences, seed=20)
        plan_c = generate_schedule(courses, request.selected_course_ids, request.preferences, seed=30)
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"시간표 생성 중 오류가 발생했습니다: {e}")

    if not plan_a:
        return {
            "status": "fail",
            "message": "조건에 맞는 시간표를 생성할 수 없습니다. 학점 범위를 확인해주세요.",
        }

    return {
        "status": "success",
        "data": {
            "PLAN A": plan_a,
            "PLAN B": plan_b,
            "PLAN C": plan_c,
        },
    }


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=5000, reload=True)
