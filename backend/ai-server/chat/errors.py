"""챗봇 장애 분류 + 사용자 메시지 (ADR-010 §17, Stage 3-2).

Gemini API 예외를 3종으로 나눠 프론트에 보낼 한글 안내를 고른다. raw 예외 문자열은
절대 클라이언트로 내보내지 않는다(API 키 관련 메시지·내부 경로 노출 방지) — 서버
로그에만 남기고, 여기서 고른 일반 메시지만 SSE `error` 이벤트로 흘린다.
"""
from __future__ import annotations

# quota(일일 한도 소진)와 transient(순간 rate limit)는 둘 다 HTTP 429 / ResourceExhausted라
# 예외 텍스트로만 구분된다. Gemini의 순간 rate limit 메시지도 "(e.g. check quota)"를 포함하므로
# 바 "quota"는 마커로 못 쓴다 — 한도 소진에만 나오는 구체 문구로 좁힌다. 애매하면 transient
# (재시도 여지가 있는 쪽)로 본다.
_QUOTA_MARKERS = (
    "exceeded your current quota", "quota exceeded for", "per day", "daily limit",
    "plan and billing", "billing details", "free_tier", "free tier", "insufficient_quota",
)
_TRANSIENT_MARKERS = (
    "429", "resourceexhausted", "resource_exhausted", "rate limit", "rate_limit",
    "ratelimit", "too many requests", "per minute", "try again",
    "503", "service unavailable", "unavailable", "overloaded",
    "deadline", "timeout", "timed out", "504", "500", "internalservererror",
)

_MESSAGES = {
    "transient": "지금 AI 응답 요청이 몰려 있어요. 잠시 후 다시 시도해 주세요.",
    "quota": "오늘 AI 사용량 한도에 도달했어요. 잠시 후 다시 이용해 주세요.",
    "unknown": "AI 응답 생성에 문제가 발생했어요. 잠시 후 다시 시도해 주세요.",
}


def classify_llm_error(exc: BaseException) -> tuple[str, str]:
    """(kind, user_message) 반환. kind ∈ {transient, quota, unknown}."""
    text = f"{type(exc).__name__}: {exc}".lower()
    if any(m in text for m in _QUOTA_MARKERS):
        return "quota", _MESSAGES["quota"]
    if any(m in text for m in _TRANSIENT_MARKERS):
        return "transient", _MESSAGES["transient"]
    return "unknown", _MESSAGES["unknown"]


# Tool 인프라 장애 시 Tool이 반환하는 값 — 에이전트가 사용자에게 그대로 전달한다.
TOOL_ERROR_COURSES = "지금 과목 정보를 조회할 수 없어요. 잠시 후 다시 시도해 주세요."
TOOL_ERROR_SYLLABUS = "지금 강의계획서 검색을 사용할 수 없어요. 잠시 후 다시 시도해 주세요."

STREAM_CUT_SUFFIX = "\n\n[응답이 중간에 끊겼습니다]"
