"""LangChain 메시지 → 직렬화 헬퍼.

`router.py`(실서비스 응답 가공)와 `eval/`(Tool 라우팅 정확도 측정 하네스, 이슈 #74)가
같은 방식으로 최종 답변 텍스트와 tool_call 관측값을 뽑아내야 해서 공용 모듈로 분리했다.
"""
from typing import Any, Dict, List

from langchain_core.messages import AIMessage, ToolMessage


def extract_text(content: Any) -> str:
    """최신 langchain-google-genai는 AIMessage.content를 항상 문자열로 주지 않고
    [{"type": "text", "text": "..."}, ...] 같은 콘텐츠 블록 리스트로 줄 때가 있다
    (Gemini 3.x 응답 형식). MySQL TEXT 컬럼에 쓰거나 채점하려면 순수 문자열로 평탄화해야 한다."""
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


def extract_tool_calls(new_messages) -> List[Dict[str, Any]]:
    """create_agent(langchain 1.x) invoke 결과 중 이번 호출에서 새로 생긴 메시지만 받아,
    AIMessage.tool_calls와 매칭되는 ToolMessage.content(관측값)를 묶어 직렬화한다
    (ADR-010 §14 eval 데이터 원본)."""
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
