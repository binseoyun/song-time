"""
DB에서 제공하는 실데이터를 AI 서버에서 재활용하기 위한 헬퍼 모듈.
기존 mock 데이터를 모두 제거하고, 백엔드 REST API를 호출해 과목 정보를 불러온다.
"""

import os
from typing import Any, Dict, List, Optional, Union

import requests

COURSE_API_URL = os.getenv("COURSE_API_URL", "http://127.0.0.1:8000/api/courses")
WEEKDAY_LABELS = ['일', '월', '화', '수', '목', '금', '토']


def _trim_time(value: Any) -> Optional[str]:
    """HH:MM(:SS) 형태의 문자열을 HH:MM으로 정규화"""
    if not value:
        return None
    text = str(value)
    if len(text) >= 5:
        return text[:5]
    return text


def _time_to_float(time_str: Optional[str]) -> Optional[float]:
    """'09:30' -> 9.5"""
    if not time_str:
        return None
    hour_minute = time_str.split(':')[:2]
    if len(hour_minute) != 2:
        return None
    hour, minute = hour_minute
    try:
        return int(hour) + (int(minute) / 60.0)
    except ValueError:
        return None


def _normalize_schedules(raw_schedules: List[Dict[str, Any]], fallback_id: str) -> List[Dict[str, Any]]:
    normalized = []
    for schedule in raw_schedules:
        weekday = schedule.get("weekday")
        if weekday is None:
            continue

        normalized.append({
            "class_id": str(schedule.get("class_id") or fallback_id),
            "weekday": int(weekday),
            "start_time": _trim_time(schedule.get("start_time")),
            "end_time": _trim_time(schedule.get("end_time")),
            "duration_minutes": schedule.get("duration_minutes"),
            "location": schedule.get("location")
        })
    return normalized


def _build_time_blocks(schedules: List[Dict[str, Any]], credits: Union[int, float]) -> List[Dict[str, float]]:
    blocks = []
    for schedule in schedules:
        start_float = _time_to_float(schedule["start_time"])
        if start_float is None:
            continue

        end_float = _time_to_float(schedule["end_time"])
        if end_float is None:
            duration_minutes = schedule.get("duration_minutes")
            if duration_minutes:
                end_float = start_float + (duration_minutes / 60.0)
            else:
                end_float = start_float + float(credits or 1)

        blocks.append({
            "day": schedule["weekday"],
            "start": start_float,
            "end": end_float
        })
    return blocks


def _collect_days(schedules: List[Dict[str, Any]]) -> List[str]:
    days: List[str] = []
    for schedule in schedules:
        weekday = schedule["weekday"]
        if 0 <= weekday < len(WEEKDAY_LABELS):
            label = WEEKDAY_LABELS[weekday]
            if label not in days:
                days.append(label)
    return days


def _format_time_text(schedules: List[Dict[str, Any]]) -> str:
    slots = []
    for schedule in schedules:
        start = schedule["start_time"]
        end = schedule["end_time"]

        if start and end:
            slots.append(f"{start}~{end}")
        elif start:
            slots.append(start)

    return ", ".join(slots) if slots else "시간 정보 없음"


def _normalize_course(raw: Dict[str, Any]) -> Dict[str, Any]:
    course_id = str(raw.get("id") or raw.get("code") or raw.get("class_id") or "")
    if not course_id:
        raise ValueError("과목 ID를 찾을 수 없습니다.")

    schedules = _normalize_schedules(raw.get("schedules") or [], course_id)
    credits = int(raw.get("credits") or 0)

    return {
        "id": course_id,
        "code": raw.get("code") or course_id,
        "name": raw.get("name"),
        "professor": raw.get("professor"),
        "credits": credits,
        "capacity": raw.get("capacity"),
        "enrolled": raw.get("enrolled"),
        "department": raw.get("department"),
        "courseType": raw.get("courseType"),
        "day": _collect_days(schedules),
        "time": _format_time_text(schedules),
        "times": _build_time_blocks(schedules, credits),
        "schedules": schedules
    }


def _fetch_courses() -> List[Dict[str, Any]]:
    try:
        response = requests.get(COURSE_API_URL, timeout=10)
        response.raise_for_status()
    except requests.RequestException as exc:
        raise RuntimeError(f"수업 데이터를 불러오지 못했습니다: {exc}") from exc

    data = response.json()
    if not isinstance(data, list):
        raise RuntimeError("강의 API 응답 형식이 잘못되었습니다.")
    return data


def get_all_courses() -> List[Dict[str, Any]]:
    """백엔드 API에서 실데이터를 가져와 스케줄러가 사용할 수 있는 형태로 정규화"""
    raw_courses = _fetch_courses()
    return [_normalize_course(course) for course in raw_courses]