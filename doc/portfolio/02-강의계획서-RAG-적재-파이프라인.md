# 강의계획서 RAG 적재 파이프라인 (Stage 1-2)

- 작성일: 2026-08-30
- 관련: 이슈 #100, ADR-010 §4/§5/§6/§13, `doc/AI-에이전트-구현계획.md` Stage 1
- 코드: `backend/ai-server/rag/`

## 문제 정의

AI 상담 챗봇은 잔여석·시간표·교수 같은 **정해진 값**은 Node API Tool로 답하지만
(Stage 0), "동적 계획법 배우는 수업 있어?" 처럼 **강의계획서 본문을 의미적으로
매칭**해야 하는 질문은 답할 수 없었다. 이를 위해 강의계획서를 임베딩해 벡터
DB에 넣고 유사도 검색하는 RAG 파이프라인이 필요하다.

제약:
- 코퍼스가 강의계획서 18청크로 아주 작다 (학기당 1회 갱신, 확장돼도 수백 청크).
- 이 프로젝트는 "로컬 `docker-compose`로 완결" 원칙을 지켜왔고, K8s·AWS/GCP
  실배포가 로드맵 후반에 확정돼 있다.
- 정답이 하나인 질문(평가 비중 등)에서 청킹 경계로 인한 할루시네이션을 막아야
  한다.

## 설계 결정 (ADR-010에서 확정, 여기서는 실행)

| 항목 | 결정 | 근거 |
|---|---|---|
| 벡터 DB | **Qdrant** (컨테이너 1개, 호스트 포트 미노출) | 로컬→K8s(공식 Helm)→클라우드가 같은 클라이언트 API로 연속. Chroma는 K8s 운영 도구 미성숙 (§4 재검토, #91) |
| 임베딩 | `gemini-embedding-001`, 3072차원 | 이미 Gemini 사용 → 키/SDK 재사용. `task_type`으로 문서/쿼리 **비대칭** 임베딩 가능 (§5) |
| 파싱 | **A3 — 수기 `syllabi.yaml`** | 18청크 규모라 PDF 파서는 Stage 1-1 정독 작업의 재구현. 파서가 가장 약한 필드(평가표·자유텍스트 선수과목)가 곧 사람이 확인해야 하는 필드 (§6 재검토, #95) |
| 청킹 | 과목당 1청크, 분반 병합은 사람이 YAML 작성 시 | 본문이 얇음(~300토큰). RAG 역할은 "관련 과목 발견" (§13) |
| 재적재 | 전체 wipe-and-reload, `recreate_collection` | 학기당 1회·수동. 무중단 alias 스왑은 이 빈도에 과함 (§4 재검토) |
| 구조화 필드 | Qdrant 페이로드(네이티브 JSON), 별도 SQL 테이블 없음 | 페이로드 필터로 충분. 파이프라인이 한 곳에만 쓰면 됨 (§13) |

## 파이프라인 구조

```
syllabi.yaml (수기, 커밋되는 유일한 소스)
   │  PDF 19개 전수 정독 → 8개 섹션 전부 전사. PDF 원본은 로컬만(저작권)
   ▼
validate_syllabi.py  ── 필수필드 / course_code ^\d{8}$ / grading 합 100
   │                     / weekly_plan 8~15주 / class_no 패딩 없음
   │                     / 엔트리 간 병합 누락·중복 경고
   ▼
ingest.py
   │  1. load + validate  (실패 시 적재 안 함)
   │  2. embedding_text 빌드: 메타헤더 + 개요 + 목표 + 선수과목 + 강의방법 + 주차별 15주
   │  3. gemini-embedding-001, task_type=RETRIEVAL_DOCUMENT, 3072d (건별 호출 + 429 backoff)
   │  4. recreate_collection(syllabi, COSINE) + course_code 페이로드 인덱스
   │  5. upsert — point ID = uuid5(고정 NS, "{course_code}__{min class_no}")
   │  6. 적재 요약: 포인트 수 / course_code 수 / 병합 청크
   ▼
Qdrant `syllabi` 컬렉션  (18 points)

inspect_qdrant.py
   list                → 전 청크 chunk_key·과목명·교수·분반코드·source_pdf
   show <course_code>   → 페이로드 전체 (미등록이면 "강의계획서 미등록")
   query "<text>"       → RETRIEVAL_QUERY 임베딩 → top-k 유사도
```

`--dry-run`은 검증 + 각 청크의 `embedding_text`를 출력하고 임베딩·쓰기는 하지 않는다.

## 결과 (정량)

| 지표 | 값 |
|---|---|
| 청크 수 | 18 (19파일 − 알고리즘 001/002 병합 1건) |
| course_code 수 | 17 (`rag_questions.yaml` 라벨과 정확히 일치) |
| 벡터 차원 | 3072 |
| 스팟체크 rank-1 정답률 | 5/5 (`rag_questions.yaml` 발췌, score 마진 0.07~0.10) |

예:

```
query: "안드로이드 코틀린 Jetpack Compose로 앱 만드는 수업"  (top-3)
  1. 0.7481  21003757__1  모바일소프트웨어 — 박숙영     ← 정답
  2. 0.6505  21000557__1  자바프로그래밍 — 박숙영
  3. 0.6396  21105589__1  인공지능산업체특강 — 신승준
```

## 배운 것 / 정정

- **"17청크"는 산술 오류였다.** Stage 1-1 문서가 "19파일 → 17청크"라고 적었으나
  병합 케이스는 1건뿐이라 18이 맞다. 17은 *과목코드* 수. 실제로 전사해 보니 드러남
  → A3(사람이 직접 데이터를 만든다)의 부수 효과: 숫자가 실물과 대조되며 검증됨.
- **집중학기 과목**(영상정보처리)은 15주가 아니라 8주다. "정확히 15주" 검증을
  "8~15주"로 완화. 스키마 검증 규칙도 실데이터를 만나야 확정된다.
- **일부 분반만 강의계획서가 있는 경우**(데베설·리눅스 등 001만, 디지털논리회로는
  002만)를 `class_no` 배열로 정직하게 표현. `get_syllabus`가 "이 강의계획서는
  N분반 기준"을 신호.
- **컨테이너 이미지에 코드가 구워진다.** 로컬에서 `syllabi.yaml`을 고쳐도
  `docker compose exec`는 이미지 안 파일을 본다. 반복 작업엔
  `docker compose cp backend/ai-server/rag/. ai-server:/app/rag/` 후 실행,
  최종 검증만 재빌드.

## 다음 (Stage 1-3 / 1-4)

- 1-3: `search_syllabus`(유사도) · `get_syllabus`(course_code 정확 조회)를
  `chat/tools.py` `TOOLS`에 추가 + `agent.py` 프롬프트에 "정확한 값 질문에는
  강의계획서 검색 안 씀" · "미등록 과목 지어내지 않음" 명시.
- 1-4: RAG hit rate(정답 course_code가 top-k에 드는 비율) + naive 베이스라인
  (전체 강의계획서 프롬프트 주입) Before/After. `rag_questions.yaml` 47문항.
