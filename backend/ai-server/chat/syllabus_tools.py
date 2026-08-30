"""강의계획서 RAG Tool 2개 (ADR-010 §8/§13, Stage 1-3).

Node API를 호출하는 tools.py 와 달리 이 둘은 Qdrant `syllabi` 컬렉션을 읽는다.
적재 파이프라인(rag/)의 embed·store 를 그대로 재사용한다 — chat → rag 단방향 의존.

- search_syllabus : 강의 내용·주제로 관련 과목 발견 (유사도, top-3, threshold 없음)
- get_syllabus    : 과목 코드로 강의계획서 상세 정확 조회 (없으면 None)
"""
from __future__ import annotations

import re
from typing import Any

from langchain_core.tools import tool

from rag import embed, store

from .errors import TOOL_ERROR_SYLLABUS

_SEARCH_TOP_K = 3
# 1-3 에서는 컷오프를 두지 않는다. rag_questions.yaml 35개 점수 분포를 본 뒤
# 1-4 에서 정답/무관 갭이 보이면 그때 박는다(측정 후 결정).

_PAYLOAD_DETAIL = (
    "course_name", "professor", "professor_email", "department", "credits",
    "method", "teaching_methods", "textbook", "reference", "prerequisites",
    "grading", "weekly_plan", "exam_schedule", "overview", "objectives",
)


def _class_codes(payload: dict) -> list[str]:
    return [f"{payload['course_code']}-{n}" for n in payload["class_no"]]


def _norm_class_no(value: Any) -> str:
    """LLM이 1(int)·"1"·"001" 을 섞어 넘긴다 — str 강제 + leading-zero strip."""
    return str(value).strip().lstrip("0") or "0"


@tool
def search_syllabus(query: str) -> list[dict[str, Any]]:
    """과목명이나 교수명이 아니라 강의에서 다루는 내용·주제로 관련 과목을 찾는다.
    예: "동적 계획법이랑 그리디 배우는 수업", "트랜스포머랑 멀티모달 이론 다루는 과목",
    "쉘 스크립트랑 프로세스 관리 실습". query에는 배우고 싶은 개념·키워드를 자연어로 넣는다.
    과목명이나 교수명으로 찾을 때(예: "창병모 교수님 수업", "자바프로그래밍")는 search_courses를
    쓴다. 각 결과에는 course_code, 과목명, 교수, 분반코드 목록, 개요 한두 줄, relevance(0~1
    유사도)가 들어 있다 — 결과로 나온 과목은 강의계획서가 등록되어 있는 것이고, relevance가
    낮으면(예: 0.6 미만) 관련 과목이 없을 수 있다. 평가 비중·주차별 계획·주교재 같은 상세가
    필요하면 결과의 course_code로 get_syllabus를 부른다. 잔여석·시간표·정원은 이 Tool로 알 수
    없다."""
    if not query or not query.strip():
        return []
    try:
        vector = embed.embed_query(query.strip())
        hits = store.search(store.client(), vector, limit=_SEARCH_TOP_K)
    except Exception:  # noqa: BLE001 — 임베딩 API / Qdrant 장애 → 에이전트가 안내 (Stage 3-2)
        return {"error": TOOL_ERROR_SYLLABUS}
    results = []
    for h in hits:
        p = h.payload
        results.append(
            {
                "course_code": p["course_code"],
                "course_name": p["course_name"],
                "professor": p["professor"],
                "class_codes": _class_codes(p),
                "overview": p["overview"],
                "relevance": round(h.score, 3),
            }
        )
    return results


@tool
def get_syllabus(course_code: str, class_no: str | None = None) -> dict[str, Any] | None:
    """과목 코드로 그 과목의 강의계획서 상세를 조회한다. 개요, 교육목표, 평가 비중,
    주교재·참고문헌, 선수과목, 담당교수 이메일, 강의형태, 주차별 계획을 반환한다.
    course_code는 분반번호를 뺀 8자리(예: "21000549")를 넣는다. class_no는 분반 번호
    (예: "1")이며 생략하면 등록된 전체 분반을 반환한다 — 여러 개면 교수와 분반으로 구분해
    어느 분반인지 되물어라. 강의계획서가 등록되어 있지 않으면 null을 반환한다 — 이때 개요·
    평가·주차별을 지어내지 말고 "강의계획서가 등록되어 있지 않다"고 답한다. 일부 분반만
    강의계획서가 있는 경우 covers 필드로 표시된다. 잔여석·시간표·정원은 이 Tool로 알 수
    없다."""
    raw = str(course_code).strip()
    # LLM이 "21000549-1" 처럼 full code 를 넘기면 분반을 떼어 class_no 로 승격
    m = re.match(r"^(\d{8})(?:-(\d+))?$", raw)
    code = m.group(1) if m else re.sub(r"\D", "", raw)[:8]
    if m and m.group(2) and class_no is None:
        class_no = m.group(2)

    try:
        records = store.by_course_code(store.client(), code)
    except Exception:  # noqa: BLE001 — Qdrant 장애 → 에이전트가 안내 (Stage 3-2)
        return {"error": TOOL_ERROR_SYLLABUS}
    if not records:
        return None

    if class_no is not None:
        target = _norm_class_no(class_no)
        records = [r for r in records if target in [_norm_class_no(n) for n in r.payload["class_no"]]]
        if not records:
            return None

    if len(records) > 1:
        # 같은 course_code 인데 내용·교수가 달라 분리된 청크 (예: 경영정보시스템 서보밀/한은정)
        return {
            "needs_class_no": True,
            "course_name": records[0].payload["course_name"],
            "options": [
                {
                    "class_no": "/".join(p["class_no"]),
                    "professor": p["professor"],
                    "course_code": p["course_code"],
                }
                for p in (r.payload for r in records)
            ],
        }

    p = records[0].payload
    detail = {k: p[k] for k in _PAYLOAD_DETAIL}
    detail["course_code"] = p["course_code"]
    detail["class_codes"] = _class_codes(p)
    detail["covers"] = p["class_no"]  # 이 강의계획서가 담는 분반. 다른 분반은 내용이 다를 수 있음
    return detail
