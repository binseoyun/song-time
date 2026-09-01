# ADR-003: Frontend API 주소 구성 방식 변경 — 빌드타임 절대주소 baking → 상대경로 + Ingress 리버스 프록시

- 날짜: 2026-08-04
- 상태: 승인됨 — 구현 진행
- 관련: Phase 3 (K8s 운영화, 서사 B), [트러블슈팅 02](../troubleshooting/02-kind-배포-명령어-레퍼런스.md), `K8s/40-frontend.yaml`, `docker-compose.yml`

## 문제 상황

> **한 줄 요약**: DB 스키마와 로그인 흐름을 고친 뒤 K8s(kind)에 재배포해서 브라우저로 확인하려 하는데, 지금 frontend가 만들어지는 방식 때문에 **K8s에서는 애초에 브라우저로 확인하는 것 자체가 불가능**하다.

아래에서 이 한 줄을 다섯 갈래로 쪼개서 설명한다: (1) 정확히 뭐가 안 되는지, (2) 왜 하필 frontend만 그런지, (3) 왜 MSA 전체가 아니라 frontend↔backend 경계 한 지점만 문제인지, (4) docker-compose는 괜찮은지, (5) 부가로 걸리는 것.

### 1. 정확히 뭐가 안 되는가

frontend는 4곳에서 `import.meta.env.VITE_*_BASE_URL`로 API 주소를 읽는다 — `App.tsx:55`, `LoginPage.tsx:11`, `AIRecommendation.tsx:42`, `TimetableGenerator.tsx:175`. Vite는 이 값을 **빌드 시점**에 정적 문자열로 JS 번들에 그대로 굽는다(`Dockerfile`이 `ARG`로 받아 `ENV`로 넘기고 그 상태에서 `npm run build` 실행). 그 결과:

- docker-compose용으로 빌드하면 `http://127.0.0.1:8080` 같은 호스트 주소가 박히고
- K8s용으로 빌드하면 `http://backend-service:8000` 같은 **클러스터 내부 DNS 이름**이 박힌다

`backend-service`는 클러스터 밖 브라우저에서 이름 해석이 안 되는 주소다. 그래서 frontend 페이지 자체는 뜨더라도(`/` 200) 로그인·과목조회 같은 API 호출은 브라우저에서 전부 실패한다.

참고로 `K8s/40-frontend.yaml`은 `VITE_API_BASE_URL` 등을 ConfigMap(`app-config`)에서 컨테이너 **런타임** 환경변수로 주입하고 있는데, 이 이미지는 `serve -s build`로 이미 완성된 정적 파일을 서빙만 하는 구조라 런타임 주입은 아무 효과가 없다 — `troubleshooting/02`에서 이미 확인된 문제이며, 지금도 그 무의미한 `env:` 블록이 그대로 남아있다.

### 2. 왜 하필 frontend만 이 문제를 겪는가

backend/ai-server는 요청이 올 때마다 `process.env`를 그때그때 읽는 **살아있는 프로세스**다. 같은 이미지에 다른 환경변수만 넣어 실행하면 환경마다 다르게 동작한다 — 재빌드가 필요 없다.

반면 frontend(Vite)는 `npm run build` 시점에 `import.meta.env.VITE_*` 텍스트를 실제 값으로 바꿔치기해서 **정적 파일로 굳혀버린다**. 빌드가 끝나면 그 안의 주소는 컨테이너에 어떤 환경변수를 넣어도 바뀌지 않는다 — 환경이 바뀌면 재빌드해야 한다. 이게 바로 지금 frontend만 `binseoyun/frontend:v1`(docker-compose용), `v2`(K8s용)로 이미지가 갈라진 이유다.

### 3. 왜 전체가 아니라 frontend↔backend 경계 한 지점만 문제인가

> **용어 정정 (2026-09-01, #121)**: 이 절 제목과 본문에서 "MSA"라고 쓴 건 "여러 컨테이너로 나뉜 전체 시스템"을 가리키는 느슨한 표현이었다. 실제로 이 시스템은 MSA가 아니라 **모듈러 모놀리스(Node backend) + ai-server 추출**이다 — `doc/architecture/00-아키텍처-스타일-검토.md` 참고. 아래 논지(클러스터 내부 통신 vs 브라우저가 경계를 넘는 지점)는 그대로 유효하다.

backend→db, backend→ai-server처럼 **호출자와 호출 대상이 모두 클러스터 안**에 있는 통신은 클러스터 내부 DNS(`db-service`, `ai-server-service` 등)가 정상적으로 해석되므로 전혀 문제가 없다.

반면 frontend가 서빙한 JS 파일은 실제로는 **사용자의 브라우저(클러스터 밖)** 에서 실행되며, 그 브라우저가 `backend-service:8000`을 호출하려 한다 — 이 이름은 클러스터 내부 DNS에만 등록돼 있어 클러스터 밖에서는 절대 해석되지 않는다. 즉 문제는 "클러스터 밖(브라우저) → 클러스터 안"으로 경계를 넘는 이 지점 하나뿐이며, Ingress는 정확히 이 경계를 위해 존재하는 컴포넌트다.

### 4. docker-compose는 괜찮은가 — 아니다, 같은 병을 안고 있을 뿐 가려져 있다

docker-compose에서도 frontend(`127.0.0.1:3001`)와 backend(`127.0.0.1:8080`)는 서로 다른 origin이다. 지금은 frontend 빌드 시점에 `http://127.0.0.1:8080`을 절대주소로 박아 넣는 방식으로 우회하고 있을 뿐, K8s와 근본 원인이 동일하다.

그리고 이 절대주소를 박아 넣는 통로(`Dockerfile`의 `ARG VITE_*_BASE_URL`)는 **docker-compose와 K8s가 파일 하나를 공유**한다 — 두 환경의 이미지가 같은 `frontend/Course Registration Platform/Dockerfile`에서 만들어지기 때문에, 이 통로를 어떻게 바꾸느냐가 두 환경 모두에 영향을 준다. (→ 이 때문에 "docker-compose까지 같이 고칠 것인가"가 아래 별도 결정 사항이 된다.)

### 5. 부가 문제: kind는 LoadBalancer를 지원하지 않는다

kind는 `LoadBalancer` 타입에 실제 IP를 할당하지 못해(`backend-service`, `frontend-service` 모두 `EXTERNAL-IP: <pending>`) `port-forward`로만 접근 가능하고, `kind-config.yaml`의 `extraPortMappings`(30000→3100, 30080→8100)는 현재 서비스의 실제 NodePort(31619, 32565)와 맞지 않아 그대로 쓸 수 없는 상태다.

### 원래 목표와의 관계

원래 하려던 작업은 "DB 스키마 + 로그인 흐름 수정 → K8s에 재배포해서 브라우저로 확인"이다. 로그인 흐름 수정은 CORS·쿠키 등 **브라우저에서만 재현되는 동작**을 다루므로 `curl` 레벨 검증으로는 부족한데, 지금 구조로는 그 브라우저 검증 자체가 K8s에서 막혀 있다. 그래서 이 ADR의 변경을 먼저 끝내야 원래 목표를 검증할 수 있다.

## 검토한 대안과 트레이드오프

### 1안: 그대로 두고 hosts 파일 + port-forward로 매번 우회
- 장점: 코드/인프라 변경 없음
- 단점: `backend-service`/`ai-server-service`를 Windows hosts 파일(관리자 권한)에 매핑하고 서비스마다 port-forward를 열어야 브라우저 테스트가 가능하다. 로그인 로직을 고칠 때마다 frontend 이미지 재빌드 + 재푸시 + 재배포까지 반복해야 한다. 시스템 파일을 건드리는 임시방편이라 EKS로 옮겨도 재사용 불가.

### 2안: 런타임 설정 주입 (컨테이너 entrypoint가 `config.js`를 시작 시점에 채워 넣음)
- 장점: 이미지 1개로 여러 환경 재사용 가능 — 빌드타임 baking 문제는 해결.
- 단점: frontend가 여전히 backend를 **절대주소**로 호출하므로 환경마다 CORS 설정을 맞춰야 하고, `backend-service` 같은 클러스터 내부 DNS는 여전히 브라우저에서 해석 불가 — 지금 겪는 문제를 못 푼다. Ingress 없이는 `LoadBalancer` pending 문제도 별도로 남는다.

### 3안: 상대경로 + Ingress(NGINX) 리버스 프록시 (선택)
- 장점: frontend가 자신이 어느 환경에 있는지 몰라도 됨 → 환경별 이미지 재빌드/태그 분기(v1/v2) 자체가 불필요해짐. 같은 origin에서 호출하므로 CORS 설정이 사실상 필요 없어짐(로그인 흐름 수정 작업의 변수를 하나 제거). kind의 `LoadBalancer` pending 문제도 함께 해결(`extraPortMappings`로 80/443만 매핑하면 됨). EKS 이관 시에도 Ingress 리소스가 거의 그대로 재사용됨(컨트롤러만 NGINX → ALB Ingress Controller로 교체).
- 단점: 신규 컴포넌트(ingress-nginx) 설치/학습 필요. `kind-config.yaml`의 `extraPortMappings`를 다시 잡아야 함. frontend 4개 파일 + `Dockerfile` + `K8s/40-frontend.yaml` + `kind-config.yaml`까지 수정 범위가 걸쳐 있음.

## 부속 결정: docker-compose도 같이 고칠 것인가 (A안 vs B안)

3안(상대경로 + Ingress)까지는 정해졌지만, 그 상대경로를 **소스 코드에 어떻게 반영할지**를 정할 때 docker-compose를 어떻게 취급할지가 또 다른 갈림길이 됐다.

**먼저 개념 정리**: "frontend가 상대경로만 쓴다"는 건 사실 특이한 방식이 아니라 오히려 **더 표준적인 방식**이다. frontend와 backend가 같은 origin(같은 도메인/포트)에서 서빙되면, 브라우저는 `/api/courses`라고만 호출해도 알아서 "지금 이 페이지를 준 서버"로 요청을 보낸다 — API 주소를 설정할 필요 자체가 없다. 지금 이 프로젝트에 `VITE_API_BASE_URL` 같은 환경변수 설정이 있는 이유는 반대로, frontend와 backend가 **서로 다른 origin**에 떠 있기 때문이다(docker-compose는 포트가 다르고, K8s는 서비스 이름 자체가 다름). origin을 하나로 통일하면 그 설정 통로 자체가 필요 없어진다.

이 통로가 `Dockerfile`의 `ARG VITE_*_BASE_URL`이다. Docker의 `ARG`는 이미지를 빌드할 때(`docker build --build-arg 이름=값`) 외부에서 값을 받는 창구이고, `ENV`로 넘겨받아 `npm run build` 시점에 Vite가 그 값을 파일에 그대로 구워 넣는다. frontend가 상대경로만 쓰도록 바꾸면 이 창구로 넘겨줄 값이 없어지므로, 창구 자체(`ARG`/`ENV` 선언)를 지울 수 있다 — 다만 이 창구는 docker-compose와 K8s가 **공유**하고 있어서, 창구를 없애는 순간 두 환경 모두에 영향을 준다.

### A안: 창구는 남겨두고 K8s만 same-origin으로
- K8s에는 Ingress를 세워 same-origin을 만들고, frontend 이미지를 K8s용으로 빌드할 때만 `ARG` 창구에 상대경로 값(`""`, `/api/auth` 등)을 흘려보냄
- docker-compose는 지금처럼 frontend(3001)·backend(8080)가 서로 다른 origin인 채로 두고, 창구로 절대주소(`http://127.0.0.1:8080`)를 계속 흘려보내 우회
- 장점: 변경 범위가 K8s에 국한됨, docker-compose는 손댈 필요 없음
- 단점: "표준 방식(same-origin)"이 K8s에만 절반 적용된 상태로 남음. docker-compose와 K8s가 서로 다른 원리로 동작해서, 나중에 다시 헷갈리기 쉬움

### B안: 창구를 아예 없애고 두 환경 모두 same-origin으로 (선택)
- K8s는 Ingress, docker-compose는 nginx 컨테이너를 하나 추가해서 frontend·backend를 같은 origin으로 통일
- `Dockerfile`의 `ARG`/`ENV` 선언과 frontend 소스 4개 파일의 `import.meta.env.VITE_*` 읽기를 전부 제거하고, 상대경로(`/api/...`)를 코드에 직접 씀
- 장점: 어떤 환경에서도 주소 설정이 필요 없어짐 — "표준 방식"이 두 환경에 일관되게 적용됨. 이후 EKS를 포함해 새 환경이 추가돼도 frontend는 항상 그대로 재사용 가능
- 단점: docker-compose에 nginx 컨테이너 추가 작업이 필요(설정 파일 수십 줄 수준, 큰 작업은 아님)

### 결정: B안

nginx 컨테이너 하나 추가하는 비용이 크지 않은 데 비해, A안은 "K8s는 same-origin, docker-compose는 절대주소"라는 **두 가지 다른 규칙이 한 프로젝트 안에 공존**하게 되어 나중에 또 헷갈릴 소지가 된다(지금 겪고 있는 v1/v2 이미지 분기 문제도 애초에 이런 종류의 불일치에서 시작됐다). 지금 정리하는 김에 두 환경 모두 같은 원리로 통일한다.

## 결정과 이유

**3안(상대경로 + Ingress) + B안(docker-compose도 동일하게 same-origin으로 통일)으로 전환한다.**

`doc/portfolio-roadmap.md` 서사 B(Phase 3)에 이미 계획돼 있던 항목이고, 지금 당장 필요한 것(로그인 흐름을 K8s 환경에서 브라우저로 검증)과 기존에 발견된 문제(LoadBalancer pending, 이미지 환경별 재빌드, docker-compose·K8s 간 규칙 불일치)를 한 번에 해결하는 안이라 지금 시점에 당겨서 진행한다. 구체적 변경 범위:

- frontend 4개 파일의 `API_BASE_URL`을 `import.meta.env.VITE_*` 절대주소 대신 상대경로(`/api/...`)로 변경
- `K8s/`에 Ingress 리소스 신규 추가, path 라우팅: `/api` → `backend-service`, `/api/schedule` → `ai-server-service`, `/` → `frontend-service`
- `kind-config.yaml`의 `extraPortMappings`를 80/443 기준으로 재설정 (클러스터 재생성 필요)
- `docker-compose.yml`에 nginx 리버스 프록시 컨테이너 추가 — `/` → frontend:3000, `/api` → backend:8000, `/api/schedule`(스케줄러)만 ai-server:5000으로 우선 라우팅
- `Dockerfile`의 build-arg(`VITE_*_BASE_URL`) 전부 제거, `K8s/40-frontend.yaml`의 효과 없는 런타임 `env:` 주입 블록 제거 → frontend 이미지가 어떤 환경에서도 재사용 가능해짐(재빌드 필요 없음)

## 실행 순서

이 ADR의 변경은 DB/로그인 수정 작업의 **선행 조건**이지 별개 작업이 아니다. 순서를 뒤바꾸면(DB/로그인부터 고치고 나중에 Ingress) 매 수정마다 frontend 재빌드+hosts 파일 우회를 반복하게 되므로, 아래 순서를 지킨다.

1. **이 ADR 구현**: 상대경로 전환 + Ingress 도입 + docker-compose nginx 추가 (`kind-config.yaml`, `K8s/*.yaml`, frontend 4개 파일, `Dockerfile`, `docker-compose.yml`)
2. **베이스라인 확인**: DB/로그인 수정 전, 기존 기능(회원가입/로그인/과목조회)이 Ingress를 통해 브라우저로 정상 동작하는지 먼저 검증 — 이후 문제가 생겼을 때 "Ingress 전환 때문인지" "DB/로그인 수정 때문인지" 구분하기 위한 기준점
3. **DB 스키마 + 로그인 흐름 수정** 진행
4. **재배포 후 검증**: kind에 재배포 → 이미지 재빌드/hosts 파일 우회 없이 바로 브라우저로 확인
5. **(이후, 별도 ADR)** 안정화되면 EKS로 이관

## 구현 상세: 아키텍처·API 경로·코드 변경 (Before/After)

### 1. 아키텍처가 어떻게 바뀌었는가

**Before**

```
                    ┌─────────────────────────────┐
   브라우저 ────────▶│ frontend-service (LoadBalancer) │──▶ frontend pod
   (127.0.0.1:3000)  │   ⚠️ kind에서 EXTERNAL-IP <pending> │
                    └─────────────────────────────┘
                              │
                              │ (frontend JS 번들 안에 이미 박혀있는 주소로 직접 호출)
                              ▼
                    ┌─────────────────────────────┐
   브라우저 ─ ─ ─ ─ ▶│ backend-service (LoadBalancer)  │──▶ backend pod ×2
   (해석 불가!)       │   http://backend-service:8000    │
                    └─────────────────────────────┘
                              │
                    ┌─────────────────────────────┐
                    │ db-service (ClusterIP)          │──▶ db pod
                    └─────────────────────────────┘

진입점 3개(LoadBalancer×2 + 나머지), 클러스터 밖 브라우저가
"backend-service"라는 클러스터 내부 DNS 이름을 직접 호출 → 이름 해석 불가
```

**After**

```
                    ┌───────────────────────────────────────┐
   브라우저 ────────▶│  Ingress (nginx-ingress-controller)      │
   (127.0.0.1:18080) │  단일 진입점, path 기준 라우팅              │
                    └───────────────────────────────────────┘
                        │              │                │
                 path=/ │       path=/api │      path=/api/schedule │
                        ▼              ▼                ▼
              ┌─────────────┐ ┌──────────────┐ ┌──────────────────┐
              │frontend-svc │ │backend-svc    │ │ai-server-svc      │
              │(ClusterIP)  │ │(ClusterIP)    │ │(ClusterIP)         │
              └─────────────┘ └──────────────┘ └──────────────────┘
                    │                │                    │
              frontend pod      backend pod ×2        ai-server pod
                                     │
                              ┌─────────────┐
                              │ db-service   │──▶ db pod
                              │ (ClusterIP)  │
                              └─────────────┘

진입점 1개(Ingress)로 통합, 나머지 서비스는 전부 클러스터 내부용(ClusterIP)으로 전환.
브라우저는 "backend-service" 같은 이름을 몰라도 됨 — 항상 자기가 접속한 origin에만 요청.
```

**핵심 변화 3가지**
1. `LoadBalancer` 서비스 2개(frontend, backend) → `ClusterIP`로 전환, 대신 **Ingress 1개**가 유일한 외부 진입점
2. frontend가 더 이상 `backend-service:8000` 같은 절대주소를 모름 — **상대경로만 앎**
3. docker-compose에도 같은 원리(nginx 리버스 프록시)를 적용해서, K8s와 로컬 개발 환경이 **같은 규칙**으로 동작

### 2. API 호출 경로가 어떻게 바뀌었는가

**Before: 로그인 버튼을 누르면**

```
1. 브라우저가 frontend pod에서 받은 JS 실행
2. JS 안에 빌드 시점에 박힌 주소 사용: fetch("http://backend-service:8000/api/auth/login")
3. 브라우저가 "backend-service"를 DNS로 찾으려 시도
4. 실패 — 이 이름은 클러스터 내부 DNS(CoreDNS)에만 등록되어 있고,
   브라우저는 클러스터 밖에 있어서 그 DNS 서버에 물어볼 방법이 없음
5. 콘솔 에러: TypeError: Failed to fetch  ← 서버 응답이 아니라 "요청 자체가 안 나감"
```

**After: 로그인 버튼을 누르면**

```
1. 브라우저가 frontend pod에서 받은 JS 실행 (http://127.0.0.1:18080 에서 로드됨)
2. JS 안의 주소: fetch("/api/auth/login")  ← 상대경로, 서버 주소를 아예 모름
3. 브라우저가 이걸 자기가 지금 접속해 있는 origin 기준으로 해석:
   http://127.0.0.1:18080/api/auth/login
4. 이 요청은 Ingress로 감 (Ingress는 실제로 존재하는, 브라우저가 접속 중인 그 주소니까 문제없음)
5. Ingress가 경로(/api)를 보고 backend-service(클러스터 내부)로 라우팅
   ← 이 구간은 클러스터 안에서 일어나므로 내부 DNS로 충분히 해석됨
6. backend가 실제로 요청을 처리하고 응답 (예: 400 "존재하지 않는 학번입니다")
```

같은 원리가 스케줄러(AI 시간표 생성)에도 적용된다: `fetch("/api/schedule")` → Ingress가 `/api/schedule`만 따로 떼서 `ai-server-service`로(backend를 거치지 않고 직접) 라우팅.

### 3. 코드 변경 (Before/After)

**`src/App.tsx`**
```diff
- const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:8000';
+ // frontend는 항상 자신을 서빙한 origin의 상대경로(/api/...)로만 호출한다.
+ const API_BASE_URL = '';
```

**`src/components/LoginPage.tsx`**
```diff
- // 로컬 환경에 맞춰 주소를 수정해주세요 (예: http://localhost:3000/api/auth)
- const API_BASE_URL = import.meta.env.VITE_AUTH_BASE_URL ?? 'http://127.0.0.1:8000/api/auth'
+ const API_BASE_URL = '/api/auth';
```

**`src/components/AIRecommendation.tsx`**
```diff
- const API_BASE_URL = import.meta.env.VITE_AI_BASE_URL ?? 'http://127.0.0.1:8000/api/ai/recommend';
+ const API_BASE_URL = '/api/ai/recommend';
```

**`src/components/TimetableGenerator.tsx`**
```diff
- const SCHEDULER_BASE_URL = import.meta.env.VITE_SCHEDULER_BASE_URL ?? 'http://127.0.0.1:5000/api/schedule';
+ const SCHEDULER_BASE_URL = '/api/schedule';
```

**`Dockerfile`** — 절대주소를 받던 창구(ARG) 제거
```diff
  FROM node:18-alpine AS builder
  WORKDIR /app
  ENV NODE_ENV=development
- ARG VITE_API_BASE_URL
- ARG VITE_AUTH_BASE_URL
- ARG VITE_AI_BASE_URL
- ARG VITE_SCHEDULER_BASE_URL
- ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
- ENV VITE_AUTH_BASE_URL=$VITE_AUTH_BASE_URL
- ENV VITE_AI_BASE_URL=$VITE_AI_BASE_URL
- ENV VITE_SCHEDULER_BASE_URL=$VITE_SCHEDULER_BASE_URL
  COPY package*.json ./
```
이제 frontend 이미지는 `docker build .`만으로 빌드되고, 환경에 상관없이 재사용 가능하다(예전엔 docker-compose용 `v1`, K8s용 `v2`로 따로 빌드해야 했음).

**`K8s/40-frontend.yaml`** — LoadBalancer→ClusterIP, 죽은 env 주입 제거
```diff
  spec:
-   type: LoadBalancer # localhost:3000 접속용
+   type: ClusterIP   # 외부 접속은 Ingress로 통일
    ports:
    - port: 3000
      targetPort: 3000
-     nodePort: 32565
    selector:
```
```diff
      containers:
      - name: frontend
-       image: binseoyun/frontend:v2
+       image: binseoyun/frontend:v3
        imagePullPolicy: Always
        ports:
        - containerPort: 3000
-       env:
-           - name: VITE_API_BASE_URL
-             valueFrom:
-               configMapKeyRef: {name: app-config, key: FRONTEND_VITE_API_BASE_URL}
-           - name: VITE_AUTH_BASE_URL
-             valueFrom: {...}
-           - name: VITE_AI_BASE_URL
-             valueFrom: {...}
-           - name: VITE_SCHEDULER_BASE_URL
-             valueFrom: {...}
```
이 `env:` 블록은 애초에 효과가 없었다 — frontend 이미지가 `serve -s build`로 완성된 정적 파일만 서빙하는 구조라, 컨테이너 런타임 환경변수가 이미 구워진 JS 파일에 영향을 줄 수 없었기 때문(`troubleshooting/02`에서 이미 확인된 문제).

**`K8s/45-ingress.yaml`** — 신규 파일, 단일 진입점
```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: app-ingress
  namespace: sugang-system
spec:
  ingressClassName: nginx
  rules:
  - http:
      paths:
      - path: /api/schedule      # 더 구체적인 경로를 먼저 매칭
        pathType: Prefix
        backend:
          service: {name: ai-server-service, port: {number: 5000}}
      - path: /api
        pathType: Prefix
        backend:
          service: {name: backend-service, port: {number: 8000}}
      - path: /
        pathType: Prefix
        backend:
          service: {name: frontend-service, port: {number: 3000}}
```

**`kind-config.yaml`** — Ingress를 위한 포트 노출
```diff
  nodes:
    - role: control-plane
+     kubeadmConfigPatches:
+       - |
+         kind: InitConfiguration
+         nodeRegistration:
+           kubeletExtraArgs:
+             node-labels: "ingress-ready=true"
      extraPortMappings:
-       - containerPort: 30000
-         hostPort: 3100
-       - containerPort: 30080
-         hostPort: 8100
+       - containerPort: 80
+         hostPort: 18080
    - role: worker
    - role: worker
```

> 구현 중 발견한 트러블슈팅: ingress-nginx 컨트롤러가 기본 설치 시 `sugang-worker` 노드에 배치되어, control-plane 전용으로 뚫어둔 `18080↔80` 매핑이 무효화되는 문제가 있었다. `kubectl patch deployment ingress-nginx-controller -n ingress-nginx`로 `nodeSelector: {ingress-ready: "true"}`를 추가해 control-plane에 고정시켜 해결했다.

**`docker-compose.yml`** — nginx 리버스 프록시 추가
```diff
    frontend:
      build:
        context: ./frontend/Course Registration Platform
        dockerfile: Dockerfile
-       args:
-         VITE_API_BASE_URL: http://127.0.0.1:8080
-         VITE_AUTH_BASE_URL: http://127.0.0.1:8080/api/auth
-         VITE_AI_BASE_URL: http://127.0.0.1:8080/api/ai/recommend
-         VITE_SCHEDULER_BASE_URL: http://127.0.0.1:5000/api/schedule
      depends_on:
        - backend
      ports:
        - "3001:3000"
+
+   nginx:
+     image: nginx:alpine
+     volumes:
+       - ./nginx/default.conf:/etc/nginx/conf.d/default.conf:ro
+     depends_on: [frontend, backend, ai-server]
+     ports:
+       - "8090:80"
```

**`nginx/default.conf`** — 신규 파일, K8s Ingress와 동일한 규칙
```nginx
server {
    listen 80;

    location /api/schedule {
        proxy_pass http://ai-server:5000/api/schedule;
    }
    location /api/ {
        proxy_pass http://backend:8000/api/;
    }
    location / {
        proxy_pass http://frontend:3000/;
    }
}
```

**`K8s/30-backend.yaml`** — (구현 중 부가로 발견한 보안 문제 수정)

작업 중 이 파일에 `JWT_SECRET`이 평문으로 커밋되어 있는 걸 발견해서 같이 고쳤다:
```diff
-       # ★★★ [여기 추가] 이게 있어야 로그인이 됩니다! ★★★
-       - name: JWT_SECRET
-         value: "mySuperSecretKey1234!"
+       - name: JWT_SECRET
+         valueFrom:
+           secretKeyRef: {name: app-secrets, key: jwt-secret}
```
`app-secrets`는 `.gitignore` 대상이라 git에 노출되지 않는다. 기존 값은 이미 커밋 이력에 남아있어 새 값으로 로테이션했다.

### 4. 검증 결과 요약

| | Before | After |
|---|---|---|
| K8s 브라우저 로그인 시도 | 콘솔: `TypeError: Failed to fetch` (요청이 나가지도 못함) | `POST /api/auth/login` → `400`(정상 서버 응답) |
| K8s 외부 진입점 | `LoadBalancer ×2` (`EXTERNAL-IP: <pending>`) | Ingress 1개 (`ADDRESS` 정상 할당) |
| frontend 이미지 | 환경별로 `v1`(compose) / `v2`(K8s) 분리 빌드 | `v3` 하나로 통합, 이후 재빌드 불필요 |
| docker-compose | 정상 동작(구조적으로는 K8s와 같은 문제를 절대주소로 가려서 우회 중) | nginx 경유로 K8s와 동일한 구조 |

## 결과 (정량·정성)

### Before (구현 전, 문제 재현 확인)

kind에 떠 있던 기존 배포(`frontend:v2`)에 `kubectl port-forward`로 접속해 로그인을 시도한 결과, 콘솔에 `TypeError: Failed to fetch`가 기록됨 — 요청이 서버에 도달하지도 못하고 브라우저 단계에서 실패(클러스터 내부 DNS `backend-service`를 브라우저가 해석하지 못함). `curl` 레벨 검증으로는 이 문제가 드러나지 않았을 것.

### After (구현 후)

- **K8s(kind, `http://127.0.0.1:18080`)**: `POST /api/auth/login` → `400`(정상 서버 응답, "존재하지 않는 학번입니다") — 브라우저→Ingress→backend까지 요청이 실제로 도달함을 네트워크 탭으로 확인
- **docker-compose(`http://127.0.0.1:8090`, nginx 경유)**: 동일하게 `GET /` → `200`, `POST /api/auth/login` → `400`(정상 서버 응답)
- `kubectl get ingress`: `ADDRESS`에 값이 채워짐 (`LoadBalancer <pending>` 의존 제거)
- frontend 이미지: K8s는 `binseoyun/frontend:v3` 하나로 통합(더 이상 환경별 build-arg 불필요), docker-compose는 별도 로컬 빌드지만 같은 소스 코드(상대경로) 사용

### 구현 중 추가로 발견/수정한 것 (범위 밖이지만 함께 처리)

- `K8s/30-backend.yaml`에 `JWT_SECRET`이 평문으로 커밋되어 있던 것을 발견 — `app-secrets`(gitignore 대상)로 이동하고 값 로테이션
- kind 클러스터 재생성 시 ingress-nginx 컨트롤러가 `sugang-worker`에 배치되어 `extraPortMappings`(control-plane 전용)가 무효화되는 문제 발생 → 컨트롤러에 `nodeSelector: ingress-ready: "true"`를 패치해 control-plane에 고정
