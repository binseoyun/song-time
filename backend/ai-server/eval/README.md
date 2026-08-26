# AI 챗봇 Tool 라우팅 정확도 측정 하네스

이슈 #74 · ADR-010 §8/§14 · `doc/AI-에이전트-구현계획.md` Stage 0-6

RAG(Stage 1)를 붙이기 전에, 순수 function-calling 라우팅이 **맞는 Tool을 고르는지**
baseline 수치를 만든다. 이후 Stage 1(RAG 결합)·Stage 3(가드레일)의 Before/After 기준점.

측정 대상은 "LLM이 맞는 Tool을 고르는가" 하나다 — Node 프록시/인증/SSE/`db-chat`/
`redis-chat`은 전부 우회하고 `chat.agent.get_agent()`를 직접 호출한다. E2E latency(Node 포함)는
Stage 3 지표라 여기서 재지 않는다. 측정하는 latency는 에이전트 invoke 구간만이다.

## 파일

| 파일 | 역할 |
|---|---|
| `questions.yaml` | 질문 세트 + 기대 라벨. 사람이 손으로 채운다(ADR-010 §14). 스키마는 파일 상단 주석 |
| `scoring.py` | turn 채점 + 집계. 순수 함수 |
| `run_tool_eval.py` | 러너 — 질문 로드 → 에이전트 호출(멀티턴) → tool_calls 캡처 → 채점 → raw+요약 저장 |
| `test_scoring.py` | `scoring.py` 단위 테스트 (`python -m unittest eval.test_scoring`) |

## 지표 (정의 원문: `doc/experiment/03-ai-tool-라우팅-정확도-측정계획.md`)

- **Tool 선택 정확도** — 기대 Tool 동작(`search_courses`/`get_course_by_code`/`none`/`any`)과 일치한 turn 비율. `none`은 "Tool 안 부름"이 정답
- **파라미터 정확도** — 맞는 Tool을 부른 전제로, 인자에 기대 문자열이 들어갔는지
- **과잉 호출** — `none` 기대인데 Tool을 부른 비율
- **과소 호출** — 호출 기대인데 0개 부른 비율
- **답변 포함/제외 검사** — 최종 답변에 기대 값이 있는지 / 지어낸 값이 없는지(할루시네이션 근사)
- **안정성** — 질문당 5회 반복, rep별 정확도의 표준편차 + 전 rep 통과 시나리오 수
- **latency**(invoke 구간), **Gemini 토큰**

## 실행

### 1. 스택 띄우기 (backend가 과목 API를 서빙해야 함)

```bash
docker compose up -d db backend_1 redis rabbitmq
# backend_1이 seedData.js로 과목 마스터를 시딩한다. 로그로 "클래스 테이블: N개" 확인
```

### 2. 하네스 이미지 갱신 (`eval/` + `pyyaml` 반영)

```bash
docker compose build ai-server
```

### 3. 측정 실행 (ai-server 컨테이너 = compose 내부망 + Gemini 키)

```bash
docker compose run --rm --no-deps \
  -v "$PWD/doc/experiment/raw:/out" \
  ai-server python -m eval.run_tool_eval --out-dir /out
```

`ai-server` 서비스의 `env_file`(`.env.docker`)에 `GEMINI_API_KEY`,
`BACKEND_BASE_URL=http://backend_1:8000`, `CHAT_MODEL`이 이미 들어 있다.

산출물: `doc/experiment/raw/03-tool-eval-<model>-<timestamp>.jsonl` (turn별 원본) +
`...-summary.json` (집계). 콘솔에도 요약표가 출력된다.

### 주요 옵션

| 옵션 | 기본 | 설명 |
|---|---|---|
| `--reps N` | 5 | 질문당 반복 횟수 |
| `--model NAME` | env `CHAT_MODEL` | 모델 오버라이드. 멀티 프로바이더 비교(별도 이슈)에서 이 값만 바꿔 재실행 |
| `--limit N` | 없음 | 앞 N개 시나리오만 (스모크) |
| `--sleep S` | 1.0 | invoke 사이 대기 초 (rate limit 완화) |
| `--retries N` | 3 | 429/quota 재시도 횟수 |
| `--label TAG` | 없음 | 산출물 파일명에 태그 추가 |

빠른 연결 확인:
```bash
docker compose run --rm --no-deps -v "$PWD/doc/experiment/raw:/out" \
  ai-server python -m eval.run_tool_eval --out-dir /out --limit 2 --reps 1
```

## 범위 밖 (별도 이슈/Stage)

- 멀티 프로바이더 팩토리(GPT/Claude/Grok LangChain 분기) — 다음 이슈. 지금은 `CHAT_MODEL`이
  `ChatGoogleGenerativeAI`에만 전달된다
- RAG 검색 hit rate — Stage 1-4
- 결과 기반 프롬프트/Tool description 튜닝 — baseline 다음 "개선" 단계
