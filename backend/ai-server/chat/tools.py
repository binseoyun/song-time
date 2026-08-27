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


# ADR-013: 이 앱에는 "수강 인원"을 뜻하는 값이 여러 개 있고 서로 다른 저장소에 산다.
# 챗봇은 아래 3개를 분리해서 답한다 — 섞으면 "잔여석 0인데 실제로는 비어 있음" 같은 오답이 난다.
#   - remaining_seats  : 실시간 수강신청 잔여석 (Node가 Redis class:{id}:seats에서 읽어 응답).
#                        None이면 실시간 좌석 정보 확인 불가 → 지어내지 말고 모른다고 답한다.
#   - registered_count : 실시간 수강신청 신청자 수 = 정원 - 잔여석.
#   - interest_count   : 관심 등록(하트) 수. course_interests 테이블 행 수로, 실시간 신청과 무관하다.
def _seat_fields(course: Dict[str, Any]) -> tuple:
    capacity = course.get("capacity")
    remaining = course.get("remainingSeats")  # Redis 실시간 잔여석 or None
    registered = None
    if isinstance(capacity, int) and isinstance(remaining, int):
        registered = max(capacity - remaining, 0)
    return remaining, registered


def _summarize(course: Dict[str, Any]) -> Dict[str, Any]:
    remaining, registered = _seat_fields(course)
    return {
        "code": course.get("code"),
        "name": course.get("name"),
        "professor": course.get("professor"),
        "department": course.get("department"),
        "credits": course.get("credits"),
        "capacity": course.get("capacity"),
        "remaining_seats": remaining,
        "registered_count": registered,
        "interest_count": course.get("interestCount"),
    }


def _weekday_label(weekday: Any) -> Any:
    if isinstance(weekday, int) and 0 <= weekday < len(_WEEKDAY_LABELS):
        return _WEEKDAY_LABELS[weekday]
    return weekday


# 검색어에 자주 섞여 오는 군더더기 — "창병모 교수님", "데이터베이스 관련 수업"처럼
# 넘어오면 whole-string 매칭이 실패하므로 토큰 분리 시 걸러낸다.
_SEARCH_NOISE = {"교수님", "교수", "님", "수업", "과목", "강의", "관련", "쪽", "들", "좀"}


def _haystack(course: Dict[str, Any]) -> str:
    return " ".join(
        str(course.get(f) or "") for f in ("name", "professor", "department")
    )


def _filter_courses(courses: List[Dict[str, Any]], keyword: str) -> List[Dict[str, Any]]:
    """1) 전체 keyword를 부분문자열로 먼저 시도(정확·특정 검색 유지). 2) 결과가 없으면
    군더더기 단어를 뺀 토큰들의 OR 매칭으로 폴백(느슨한 자연어 질의 대응)."""
    kw = keyword.strip()
    if not kw:
        return courses
    exact = [c for c in courses if kw in _haystack(c)]
    if exact:
        return exact
    tokens = [t for t in kw.split() if len(t) >= 2 and t not in _SEARCH_NOISE]
    if not tokens:
        return []
    # 모든 토큰을 다 포함하는 과목 우선("자바 프로그래밍" → 자바프로그래밍만),
    # 그런 게 없으면 아무 토큰이나 포함하는 것으로 완화.
    strict = [c for c in courses if all(t in _haystack(c) for t in tokens)]
    return strict or [c for c in courses if any(t in _haystack(c) for t in tokens)]


@tool
def search_courses(keyword: str = "") -> List[Dict[str, Any]]:
    """과목명·학과명·담당 교수명으로 과목들을 조회한다. keyword에는 핵심어만 넣는다 —
    "교수님"·"관련"·"수업" 같은 군더더기나 조사는 빼고 교수명이나 과목명 조각만
    (예: "창병모", "데이터베이스"). 반환값에는 각 과목의 담당 교수·학점·정원과 함께
    remaining_seats(실시간 수강신청 잔여석), registered_count(실시간 신청자 수),
    interest_count(관심 등록·하트 수)가 들어 있다 — 이 셋은 서로 다른 값이니 질문에 맞는
    것을 골라 답한다. remaining_seats가 null이면 실시간 좌석 정보를 확인할 수 없다는 뜻이다.
    요일/시간(시간표)이 필요할 때만 get_course_by_code를 추가로 호출한다. keyword를 비우면
    개설된 전체 과목을 반환한다. 과목 코드(예: 21003183-1)를 정확히 알 때는
    get_course_by_code를 쓴다."""
    response = requests.get(f"{BACKEND_BASE_URL}/api/courses", timeout=10)
    response.raise_for_status()
    courses = _filter_courses(response.json(), keyword)
    return [_summarize(c) for c in courses]


@tool
def get_course_by_code(code: str) -> Dict[str, Any]:
    """과목 코드(예: 21003183-1)로 특정 과목 하나를 조회한다. 담당 교수, 학점,
    요일/시간(시간표), remaining_seats(실시간 잔여석), registered_count(실시간 신청자 수),
    interest_count(관심 등록·하트 수) 등 상세 정보를 반환한다. 과목명이나 교수명만 알 때는
    search_courses를 쓴다."""
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
