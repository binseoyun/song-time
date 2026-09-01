# 옛 `/recommend` 제거 — 대화형 챗봇으로 완전 대체

- 작성일: 2026-09-01
- 관련: 이슈 #115, ADR-010 §1/§17, `doc/AI-에이전트-구현계획.md` Stage 3-4
- 대상: `frontend/.../components/`, `backend/src/{routes,controllers}/`, `backend/ai-server/main.py`, `K8s/01-configmap.yaml`

## 배경

옛 AI 추천은 "직무 버튼 클릭 → `{jobInterest, major}` 2개 값 전송 → Node가 전체 강의 목록을 조회해
`courses` 배열째로 ai-server에 전달 → ai-server가 전체 과목 텍스트를 프롬프트 하나에 욱여넣어
Gemini 단발 호출 → `{recommended_codes: [...]}` JSON 응답"이 전부였다. 화면엔 "AI 분석 중...(30초)"이
떴지만 대화가 아니라 백그라운드 배치 호출 한 번이었다.

ADR-010 §17(2026-08-23)에서 **완전 대체**로 결정했다:

- 새 챗봇이 기능적 상위집합 — 자유 텍스트로 "백엔드 직무에 맞는 과목 추천해줘"도 커버하고,
  강의계획서 근거까지 붙는다.
- 전체 과목 텍스트를 프롬프트에 다 넣는 방식은 과목 수가 늘수록 비용·정확도 모두 열등하다.
- **순서**: 새 챗봇(Stage 0~2)을 먼저 완성하고 Stage 3-3 최종 측정으로 안정성을 검증한 뒤
  걷어낸다 — 새 기능이 검증되기 전에 기존 기능부터 없애지 않는다. Stage 3-3(#113, PR #114)이
  Tool 선택 100%로 마무리돼 이 조건이 충족됐다.

## 제거 범위

| 계층 | 파일 | 변경 |
|---|---|---|
| Frontend | `components/AIRecommendation.tsx` | 파일 삭제 |
| Frontend | `App.tsx` | `AIRecommendation` import, nav 버튼("AI 수업 추천"), `currentPage === 'ai'` 라우트, `Page` 유니온의 `'ai'` 제거 |
| Frontend | `components/HomePage.tsx` | "AI 수업 추천" 기능 카드 → "AI 상담 챗봇"(`page: 'aichat'`) 카드로 교체, 팁 문구 1줄 교체 |
| Node | `routes/aiRoutes.js` | `POST /api/ai/recommend` 라우트 제거 |
| Node | `controllers/aiController.js` | `getRecommendation` 핸들러 제거. 이 핸들러만 쓰던 `require('../models/Class')`, `require('../models/ClassSchedule')` 제거 |
| ai-server | `main.py` | `POST /recommend` 엔드포인트 + `RecommendationRequest` 모델 제거. `/recommend` 전용이던 전역 Gemini 설정(`genai.configure`, `GENAI_MODEL`, `model = genai.GenerativeModel(...)`)과 죽은 import(`json`, `os`, `typing.Optional`, `google.generativeai`) 제거 |
| K8s | `01-configmap.yaml` | "AI 추천 설정"(`GENAI_MODEL`, `RECOMMEND_TOP_K`), "직무별 추천 기본 과목 리스트"(`JOB_BACKEND_COURSES`, `JOB_DATA_COURSES`, `JOB_PM_COURSES`) 제거 |

### `main.py`의 전역 Gemini 설정을 지워도 되는 이유

`/recommend`만 이 모듈 전역의 `genai.configure()` / `model`에 의존했다. 남는 소비자는 각자 자체 설정한다:

- **챗봇 에이전트** (`chat/agent.py`): `ChatGoogleGenerativeAI(model=..., google_api_key=os.getenv("GEMINI_API_KEY"))`
  로 키를 인스턴스에 직접 넘긴다. 전역 `genai.configure`와 무관.
- **RAG 임베딩** (`rag/embed.py`): `_ensure_configured()`가 `genai.configure(api_key=GEMINI_API_KEY)`를
  자체 호출(1회 게이트).

### configmap 항목이 죽어 있던 근거

`K8s/20-ai-server.yaml`은 `app-config`를 **볼륨으로 `/app/config`에 마운트만** 하고(환경변수 주입 아님),
ai-server 코드 어디에서도 그 경로의 파일을 읽지 않는다. `JOB_*_COURSES` 리스트는 옛 `/recommend`
코드에서도 실제로는 참조된 적이 없다(엔드포인트가 프롬프트를 자체 구성). `GENAI_MODEL`은 위에서
지운 `main.py` 전역 `model`만 쓰던 값. → 전부 순수 dead config.

## 검증

| 대상 | 방법 | 결과 |
|---|---|---|
| Frontend | `vite build` (프로덕션 번들) | ✅ 1606 modules, 빌드 성공 |
| Frontend 잔여 참조 | `grep -ri "recommend\|AIRecommendation\|'ai'"` (src) | ✅ 0건 |
| Node | `node -c` (aiController.js, aiRoutes.js) + `require('./src/routes/aiRoutes.js')` | ✅ 로드 성공 |
| ai-server | `python -m py_compile main.py` | ✅ 성공 |
| 전체 코드 잔여 참조 | `grep -ri recommend` (node_modules 제외) | ✅ 주석 1줄(제거 경위 설명)만 |

## 결과 (정성)

- **엔드포인트 감소**: ai-server `POST /recommend`, Node `POST /api/ai/recommend` 2개 제거. 남은 AI 표면은
  `POST /api/ai/chat`(SSE) + 세션 조회 2개로 단일화.
- **데이터 경계 정리**: "프론트/Node가 전체 과목 배열을 요청 바디로 실어 나르는" 마지막 경로가 사라졌다
  (P8 관련). 챗봇은 ai-server가 Tool로 필요한 만큼만 조회한다.
- **죽은 코드·설정 제거**: `main.py` 전역 Gemini 설정 블록, 미사용 모델 import 2개(Node), dead configmap 5키.

## 한계 / 후속

- `app-config` configmap에 `DB_HOST`/`DB_NAME`만 남았다. 이 두 값의 실제 소비 경로 정리는 Phase 3
  (K8s 운영화) DB 설정 정돈 때 함께 본다.
- ADR-010에 "결과" 섹션(Stage 0~3 종합)을 추가하는 작업이 Stage 3의 완료 조건으로 남아 있다.
