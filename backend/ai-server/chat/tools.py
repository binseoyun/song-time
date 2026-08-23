"""AI 챗봇 Tool 인벤토리(ADR-010 §8) — read-only 2개만 연동한다.
대기열 순번 조회는 설계상 의도적으로 제외됐다(§8) — Tool 파라미터에도 사용자 식별자가
필요 없어, 여기 두 Tool은 로그인 여부와 무관하게 항상 같은 답을 반환하는 공개 데이터다.
"""
import os
from typing import Any, Dict, List

import requests
from langchain_core.tools import tool

BACKEND_BASE_URL = os.getenv("BACKEND_BASE_URL", "http://localhost:8000")
_WEEKDAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"]


def _remaining_seats(course: Dict[str, Any]) -> int:
    capacity = course.get("capacity") or 0
    enrolled = course.get("enrolled") or 0
    return max(capacity - enrolled, 0)


def _summarize(course: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "code": course.get("code"),
        "name": course.get("name"),
        "professor": course.get("professor"),
        "department": course.get("department"),
        "credits": course.get("credits"),
        "capacity": course.get("capacity"),
        "enrolled": course.get("enrolled"),
        "remaining_seats": _remaining_seats(course),
    }


def _weekday_label(weekday: Any) -> Any:
    if isinstance(weekday, int) and 0 <= weekday < len(_WEEKDAY_LABELS):
        return _WEEKDAY_LABELS[weekday]
    return weekday


@tool
def search_courses(keyword: str = "") -> List[Dict[str, Any]]:
    """과목명 또는 학과명에 keyword가 포함된 과목들의 잔여석 정보를 조회한다.
    keyword를 비우면 개설된 전체 과목을 반환한다. 과목 코드를 정확히 알고 있을
    때는 이 Tool 대신 get_course_by_code를 사용한다."""
    response = requests.get(f"{BACKEND_BASE_URL}/api/courses", timeout=10)
    response.raise_for_status()
    courses = response.json()
    if keyword:
        courses = [
            c
            for c in courses
            if keyword in (c.get("name") or "") or keyword in (c.get("department") or "")
        ]
    return [_summarize(c) for c in courses]


@tool
def get_course_by_code(code: str) -> Dict[str, Any]:
    """과목 코드(예: CS301)로 특정 과목 하나를 정확히 조회한다. 담당 교수, 학점,
    요일/시간, 잔여석 등 상세 정보를 반환한다."""
    response = requests.get(f"{BACKEND_BASE_URL}/api/courses/{code}", timeout=10)
    if response.status_code == 404:
        return {"error": f"과목 코드 '{code}'를 찾을 수 없습니다."}
    response.raise_for_status()
    course = response.json()

    summary = _summarize(course)
    summary["schedule"] = [
        {
            "weekday": _weekday_label(s.get("weekday")),
            "start_time": s.get("start_time"),
            "end_time": s.get("end_time"),
        }
        for s in course.get("schedules") or []
    ]
    return summary


TOOLS = [search_courses, get_course_by_code]
