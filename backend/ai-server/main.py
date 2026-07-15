# backend/ai-server/main.py
import json
import os
from typing import Dict, Any, List, Optional

import google.generativeai as genai
import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from scheduler import generate_schedule

# .env 파일 로드
load_dotenv()

# 1. Gemini 설정
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)
else:
    print("[WARN] GEMINI_API_KEY 가 설정되어 있지 않습니다.")

GENAI_MODEL = os.getenv("GENAI_MODEL", "models/gemini-pro-latest")
model = genai.GenerativeModel(GENAI_MODEL)

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


# ------------------------------------------------
# AI 수업 추천 API
# ------------------------------------------------
class RecommendationRequest(BaseModel):
    major: Optional[str] = None
    job_interest: str
    courses: List[Dict[str, Any]]


@app.post("/recommend")
def recommend_courses(req: RecommendationRequest):
    try:
        all_courses = req.courses

        courses_text = "\n".join(
            [
                f"- {c['code']} {c['name']} ({c.get('department', '미정')}): "
                f"{c.get('time', '')} {','.join(c.get('day', []))}"
                for c in all_courses
            ]
        )

        if req.major:
            student_intro = f"나는 {req.major} 전공 학생이고,"
        else:
            student_intro = "나는 컴퓨터 과학과 학생이고,"

        prompt = f"""
        너는 대학교 수강신청 도우미 AI야.
        {student_intro} 희망 직무는 '{req.job_interest}'야.

        아래는 우리 학교에 개설된 강의 목록이야:
        {courses_text}

        이 중에서 내 희망 직무와 가장 관련성이 높고 도움이 될만한 강의 3~4개를 추천해줘.

        [중요] 반드시 아래와 같은 순수한 JSON 형식으로만 답변해. 마크다운(```json)이나 다른 말은 절대 넣지 마.
        {{
            "recommended_codes": ["과목코드1", "과목코드2", "과목코드3"]
        }}
        """

        response = model.generate_content(prompt)
        response_text = response.text.replace("```json", "").replace("```", "").strip()
        result_json = json.loads(response_text)

        recommended_codes = result_json.get("recommended_codes", [])
        final_recommendations = [c for c in all_courses if c["code"] in recommended_codes]

        return final_recommendations

    except Exception as e:
        print(f"AI Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=5000, reload=True)
