"""ADR-010 §12(2026-08-23 재검토) — LangChain 1.x의 에이전트 API.

원래(0.x대) `langchain.agents.AgentExecutor` + `create_tool_calling_agent` 조합으로
쓸 계획이었으나, LangChain 1.0에서 이 클래스/함수가 완전히 제거되고 `create_agent`
하나로 통합됐다(실제로 requirements.txt에 버전을 안 박고 설치했더니 최신 1.3.16이
깔리면서 ImportError로 확인됨). `create_agent`는 내부적으로 LangGraph의
StateGraph를 컴파일해 반환한다 — 애플리케이션 코드가 그래프를 직접 그리진 않지만,
실행 엔진 자체는 이제 LangGraph다. §12가 "LangGraph는 과하다"고 판단했던 전제
자체가 라이브러리 쪽에서 무너진 것이라, 이 결정을 뒤집는 게 아니라 현실을
반영하는 재검토다."""
import os

from langchain.agents import create_agent
from langchain_google_genai import ChatGoogleGenerativeAI

from .tools import TOOLS

SYSTEM_PROMPT = (
    "너는 대학교 수강신청 연습 플랫폼의 상담 챗봇이다. 잔여석·과목 정보는 반드시 "
    "Tool을 호출해 얻은 값으로만 답하고, 절대 추측하지 않는다. Tool로도 알 수 없는 "
    "질문에는 모른다고 답한다. 실제 실시간 수강신청/취소는 네가 대신 해줄 수 없다 — 사용자가 "
    "화면에서 직접 신청하도록 안내한다."
)

_CHAT_MODEL = os.getenv("CHAT_MODEL", "gemini-3.6-flash")
_GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
# create_agent엔 max_iterations 파라미터가 없다 — LangGraph 실행 엔진의
# recursion_limit(agent.invoke의 config)으로 턴당 호출 상한을 건다(router.py).
RECURSION_LIMIT = int(os.getenv("CHAT_MAX_ITERATIONS", "6")) * 2 + 1

_agent = None


def get_agent():
    """요청마다 새로 만들면 비용이 커서 프로세스 내 싱글턴으로 재사용한다."""
    global _agent
    if _agent is None:
        llm = ChatGoogleGenerativeAI(model=_CHAT_MODEL, google_api_key=_GEMINI_API_KEY, temperature=0)
        _agent = create_agent(llm, TOOLS, system_prompt=SYSTEM_PROMPT)
    return _agent
