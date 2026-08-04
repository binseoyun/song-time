# 트러블슈팅 01: docker-compose 환경변수 치환 버그로 인한 DB 초기화 실패 (팀플 시절부터 이어진 고질병)

- 날짜: 2026-07-22
- Phase: Phase 2 착수 전, 로컬 실행 환경 점검 과정에서 발견
- 관련: `docker-compose.yml`, `frontend/.../Dockerfile`, `backend/src/app.js`

## 1. 팀플 당시 문제 상황

### 문제 상황 파악 과정

 "일단 이 앱이 로컬에서 잘 뜨는지" 확인하려고 `docker compose up --build`를 실행했다. `db` 컨테이너가 아래 에러를 내며 재시작을 반복했다.

```
[ERROR] [Entrypoint]: Database is uninitialized and password option is not specified
    You need to specify one of the following as an environment variable:
    - MYSQL_ROOT_PASSWORD
    - MYSQL_ALLOW_EMPTY_PASSWORD
    - MYSQL_RANDOM_ROOT_PASSWORD
```

`.env.docker`에는 `MYSQL_ROOT_PASSWORD` 값이 분명히 채워져 있었다. 팀플 당시 기억을 되짚어보니, 이 문제는 이번이 처음이 아니라 **팀 프로젝트 기간 내내 간헐적으로 반복됐던 문제**였었다.  `db`가 뜨는 데 실패해서 프로젝트 전체가 안 뜨는 상황이 잦았고, 그런데 어떨 때는 됐다는 기억이 있었지만, 당시에는 프로젝트 제출 마감 기간이 촉박해 이 문제를 제대로 딥다이브 하지 못하고 넘어갔었다.  
이 프로젝트를 리팩토링 하기 위해 이 문제 해결이 급 우선임을 인지했고, 문제 상황 파악을 진행하였다. 

### 문제 상황 파악을 위해 한 일

1. `.env.docker`에 실제로 올바른 값이 들어있는지 파일을 직접 읽어 확인.
2. Docker Desktop이 꺼져 있던 게 원인인지 배제하기 위해 데몬 상태 확인 후 재시도.
3. `docker compose down -v`로 이전 실패 시도의 잔존 볼륨을 정리하고 재시도 — 그래도 동일 에러 재현.
4. `docker compose down -v` 실행 로그에 남은 경고 메시지를 근거로 원인 후보를 좁힘:
  ```
   level=warning msg="The \"MYSQL_ROOT_PASSWORD\" variable is not set. Defaulting to a blank string."
   level=warning msg="The \"GEMINI_API_KEY\" variable is not set. Defaulting to a blank string."
  ```
   `.env.docker`에는 값이 있는데 compose가 "설정 안 됨"이라고 경고한다는 것은, **compose가 값을 읽는 경로가 `.env.docker`가 아니라는 뜻**이라는 가설을 세우게 됨.

## 2. 문제 상황을 해결하기 위해 한 일

### 가설 수립과 문제 해결 방법 고안

`docker-compose.yml`을 다시 읽어보니 `db` 서비스에 다음과 같은 구조가 있었다.

```yaml
db:
  env_file:
    - .env.docker                                # (A) 컨테이너 런타임에 값 주입
  environment:
    MYSQL_ROOT_PASSWORD: ${MYSQL_ROOT_PASSWORD}   # (B) compose 파싱 시점에 값 치환
    ...
  healthcheck:
    test: ["CMD", "mysqladmin", "ping", ..., "-p${MYSQL_ROOT_PASSWORD}"]  # (C) 여기도 마찬가지
```

**가설**: `${VAR}` 형태의 치환(B, C)은 컨테이너 안의 환경변수가 아니라, **프로젝트 루트에 있는 정확히 `.env`라는 이름의 파일**(compose 전용 변수 치환 파일)을 compose CLI가 직접 읽어서 처리한다. 이 프로젝트는 처음부터 `.env.docker`만 쓰고 `.env`는 만든 적이 없으므로, `${MYSQL_ROOT_PASSWORD}`는 항상 빈 문자열로 치환된다. 그리고 **명시적으로 선언된 `environment:` 블록은 `env_file:`이 넣어준 값을 덮어쓴다** — 그래서 (A)가 올바른 값을 넣어도 (B)가 그 위에 빈 값을 얹어버린다.

`ls -la .env`로 루트에 `.env` 파일이 실제로 없다는 것을 확인해 가설을 검증했다.

### Q&A로 다진 이해 (3개월 뒤의 나를 위한 기록)

가설을 세우고 버그를 고친 뒤에도 "그래서 정확히 뭐가 문제였던 거지"를 스스로 설명하지 못하면 아는 게 아니다. 아래는 이해를 검증하며 실제로 헷갈렸던 지점과 그걸 바로잡은 순서 그대로의 기록이다. 나중에 다시 읽을 나를 위해, 결론만이 아니라 **어디서 무엇을 잘못 짚었는지**까지 남긴다.

**Q1. compose가 `${MYSQL_ROOT_PASSWORD}`를 못 읽은 게, 루트 `.env` 파일에 `MYSQL_ROOT_PASSWORD=`가 빈 값으로 "명시"돼 있어서 그런 거야?**

아니다 — 처음엔 이렇게 오해했는데, 정확히는 **루트에 `.env` 파일 자체가 존재하지 않았다.** compose는 `${VAR}` 치환 시 `.env` 파일을 찾다가 파일이 없으면 그 변수를 자동으로 빈 문자열 취급하고 경고를 띄운다:
```
level=warning msg="The \"MYSQL_ROOT_PASSWORD\" variable is not set. Defaulting to a blank string."
```
"빈 값으로 명시됨"과 "정의 자체가 없어서 기본값으로 대체됨"은 결과(빈 문자열)는 같지만 원인은 다르다. 후자였다.

이 흐름을 정리하면: ① 루트에 `.env` 없음 → ② compose가 YAML을 읽다 `${MYSQL_ROOT_PASSWORD}`를 빈 문자열로 치환 → ③ 그 빈 값이 `environment:` 블록에 확정돼 `env_file`의 값을 덮어씀 → ④ MySQL이 빈 비밀번호를 받고 초기화 거부 → ⑤ `restart: unless-stopped`라 무한 재시작 → ⑥ `backend`는 `depends_on: condition: service_healthy`라 db가 안 뜨는 한 절대 안 뜸 → **앱 전체 실행 불가.**

**Q2. `backend/.env`라는 파일은 있잖아. 그게 compose가 찾던 `.env` 아니야?**

이름만 같을 뿐 위치가 다르다. docker compose는 **`docker compose` 명령을 실행하는 디렉터리(=`docker-compose.yml`이 있는 프로젝트 루트)에 있는 `.env`만** 본다. 프로젝트 전체를 뒤져서 아무 `.env`나 찾는 게 아니다. `backend/.env`는 루트가 아니라 `backend/` 폴더 안에 있으므로 compose의 변수 치환 대상이 아니다.

게다가 이 파일은 애초에 목적 자체가 다르다. `backend/src/config/env.js`에서 Node.js `dotenv` 라이브러리가 읽는, **Docker 없이 로컬에서 `node src/server.js`를 직접 돌릴 때** 쓰는 개발용 설정이다 (`DB_HOST=localhost`인 게 증거 — 컨테이너 안에서는 서비스 이름 `db`를 써야 하는데 `localhost`로 돼 있다).

**Q3. 근데 `backend/.env`에도 DB 관련 환경변수(`DB_PASSWORD=songtimedb` 등)가 있잖아. 그거라도 쓰이면 안 됐어?**

이름과 역할이 다른 변수라 애초에 대상이 아니었다.

| | `DB_PASSWORD` (`backend/.env`) | `MYSQL_ROOT_PASSWORD` (compose가 찾던 것) |
|---|---|---|
| 역할 | 앱이 **client**로서 MySQL에 로그인할 때 대는 비밀번호 | MySQL 서버가 **최초 초기화 시** root 계정을 세팅하는 값 |
| 비유 | 손님이 문 두드릴 때 대는 비밀번호 | 집주인이 처음 집 지을 때 자물쇠를 뭘로 걸지 정하는 값 |
| 사용 주체 | Sequelize(백엔드 앱) | MySQL 공식 이미지의 entrypoint 스크립트 |

`backend/.env`에는 `MYSQL_ROOT_PASSWORD`라는 **키 자체가 존재하지 않는다.** 설사 compose가 이 파일을 봤다 하더라도(안 보지만), 찾는 이름이 다르므로 여전히 못 찾았을 것이다. 위치 문제와 이름/역할 문제, 두 가지가 겹쳐서 이 파일은 처음부터 이 버그와 무관했다.

**Q4. 그럼 애초에 `MYSQL_ROOT_PASSWORD`가 왜 필요한 거야? 앱은 `appuser`로 접속하는데?**

맞다, 앱 로직 어디에도 `root` 계정은 등장하지 않는다(`.env.docker`의 `DB_USER=appuser`로 접속). 그런데도 필요한 이유는 **MySQL 공식 이미지 자체의 강제 안전장치**다: 이 이미지의 entrypoint 스크립트는 데이터 디렉터리가 비어있는 최초 초기화 시점에 다음 셋 중 하나를 반드시 요구한다.

- `MYSQL_ROOT_PASSWORD` — root 비밀번호를 이 값으로 설정
- `MYSQL_ALLOW_EMPTY_PASSWORD=yes` — root 비밀번호 없이 허용
- `MYSQL_RANDOM_ROOT_PASSWORD=yes` — 랜덤 비밀번호 생성 후 로그에 1회 출력

셋 다 없으면 "root 계정을 보호 없이 열어두는 서버가 실수로 만들어지는" 상황을 막기 위해 아예 초기화를 거부한다 — 애플리케이션이 요구하는 게 아니라 **이미지가 사용자에게 보안 정책을 명시적으로 선택하도록 강제**하는 것이다.

이 프로젝트에서 root 계정의 실질적 쓰임새는 `healthcheck`(`mysqladmin ping -uroot ...`)뿐이다. `MYSQL_ALLOW_EMPTY_PASSWORD`로 우회할 수도 있었지만 택하지 않았다 — 로컬 습관이 그대로 굳어지면 나중에 포트가 실수로 외부에 노출됐을 때 root가 비밀번호 없이 열려있는 위험한 기본값이 되기 때문에, 명시적인 값을 주는 지금 방식이 더 안전한 선택이다.

### 딥다이브: "왜 예전엔 됐었나"까지 추적

버그 자체를 찾은 뒤, 예전에는 시연 혹은 테스트 때 어쩔땐 된 기록이 있어 이를 그냥 넘기지 않고 딥다이브했다. 단순 재현 실패로 끝내지 않고, **왜 같은 코드가 어떤 상황에서는 동작했는지**까지 설명할 수 있어야 진짜 원인을 찾았다고 판단했기 때문이다.

1. `git log`로 현재 `main`(개인 레포로 orphan 이관된 브랜치)의 `docker-compose.yml` 히스토리를 봤으나, 이관 시 히스토리가 압축되어 있어 부족했다.
2. 옛 팀 레포 히스토리가 로컬 백업 브랜치 `old-team-main`에 남아있다는 걸(이전 세션의 메모리) 활용해, `git log old-team-main --follow -- docker-compose.yml`로 전체 이력을 추적.
3. `docker-compose.yml`을 최초로 추가한 커밋(`1afa30f`, **2025-12-04**)의 내용을 `git show`로 직접 열어보니, **처음 작성된 순간부터 이미 이 버그가 있었다**는 것을 확인. 즉 이 프로젝트는 `docker compose up`으로 `db`가 진짜 깨끗하게 초기화된 적이 코드상으로는 한 번도 없었다.
4. 이 상태에서 사용자가 두 가지 기억을 추가로 제공: "`docker run`을 개별로 띄웠을 땐 됐다", "DB를 채우는 역할이었던 팀원 컴퓨터에서만 됐었다". 이 두 증언이 가설과 모순되지 않는지 검증:
  - `docker run -e MYSQL_ROOT_PASSWORD=... mysql:8.0`처럼 compose를 거치지 않고 직접 실행하면 `${VAR}` 치환 버그 자체가 발동할 여지가 없다 → 정상 초기화됨. **모순 없음.**
  - MySQL 공식 이미지의 entrypoint 스크립트는 `/var/lib/mysql` 데이터 디렉토리가 **비어있을 때만** 루트 비밀번호를 요구하고, 이미 초기화된 데이터가 있으면 그 단계 자체를 건너뛴다. `db_data`는 이름 붙은 Docker 볼륨이라 `docker compose down`(볼륨 옵션 없이)으로는 지워지지 않고 로컬 머신에 계속 남는다. → 그 팀원이 한 번 `docker run`으로 수동 초기화에 성공한 뒤로는, 그 사람 로컬 볼륨에는 이미 정상 초기화된 데이터가 남아있어서 이후 `docker compose up`을 돌려도 버그가 있는 환경변수 치환 구간을 아예 타지 않았던 것. 다른 팀원들은 그런 이력이 없는 깨끗한 볼륨이라 매번 버그를 그대로 맞았다. **모순 없음 — 오히려 정확히 들어맞음.**

이 과정에서 팀원별로 "내 컴퓨터에선 되는데?"라는 흔한 상황이 실은 각자의 로컬 Docker 볼륨 상태 차이였을 뿐, 코드 자체는 한 번도 고쳐진 적이 없었다는 결론에 도달했다.

### Before / After 코드 비교

**Before** (`docker-compose.yml`, 2025-12-04부터 변경 없이 유지):

```yaml
db:
  env_file:
    - .env.docker
  environment:
    MYSQL_ROOT_PASSWORD: ${MYSQL_ROOT_PASSWORD}
    MYSQL_DATABASE: ${MYSQL_DATABASE}
    MYSQL_USER: ${MYSQL_USER}
    MYSQL_PASSWORD: ${MYSQL_PASSWORD}
  healthcheck:
    test: ["CMD", "mysqladmin", "ping", "-h", "localhost", "-uroot", "-p${MYSQL_ROOT_PASSWORD}"]

ai-server:
  env_file:
    - .env.docker
  environment:
    COURSE_API_URL: ${COURSE_API_URL:-http://backend:8000/api/courses}
    GEMINI_API_KEY: ${GEMINI_API_KEY}
    GENAI_MODEL: ${GENAI_MODEL:-models/gemini-pro-latest}
```

**After**:

```yaml
db:
  env_file:
    - .env.docker          # env_file의 키 이름이 MySQL 이미지가 기대하는 이름과 동일하므로 이것만으로 충분
  healthcheck:
    test: ["CMD-SHELL", "mysqladmin ping -h localhost -uroot -p\"$$MYSQL_ROOT_PASSWORD\""]
    # $$ 로 이스케이프 → compose 파싱 시점이 아니라 컨테이너 내부 셸이 실행 시점에 자기 환경변수를 읽음

ai-server:
  env_file:
    - .env.docker           # 동일 사유로 environment 블록 전체 제거
```

### 새로운 전략과 수정 이유

- `environment:` 블록을 지운 이유: `env_file`이 넣는 키 이름(`MYSQL_ROOT_PASSWORD`, `GEMINI_API_KEY` 등)이 컨테이너가 기대하는 이름과 완전히 같아서, 애초에 `environment:`로 다시 선언할 이유가 없었다. 중복 선언이 오히려 버그의 원인이었으므로 "안전한 값으로 고치는" 대신 "불필요한 이중 소스 자체를 제거"하는 방향을 택했다.
- healthcheck를 `CMD-SHELL` + `$$` 이스케이프로 바꾼 이유: 이 값만은 `environment:`로 옮겨도 해결이 안 된다 — healthcheck의 `test:` 문자열은 여전히 compose가 파일을 파싱하는 시점에 `${...}`를 치환하기 때문이다. 컨테이너가 뜬 **이후** 자기 자신의 실행 환경(`env_file`로 이미 주입된 값)을 읽게 하려면, compose가 아니라 컨테이너 내부 셸이 변수를 해석하도록 만들어야 한다. `$$`는 compose에게 "이 `$`는 치환하지 말고 그대로 컨테이너에 넘겨라"는 이스케이프 문법이다.
- 별도 `.env` 파일을 새로 만드는 방법도 있었지만 채택하지 않았다: `.env.docker`와 내용이 겹치는 파일을 하나 더 만들면 두 파일이 나중에 서로 어긋나는(drift) 새로운 사고 지점을 하나 더 만드는 셈이라, 소스를 하나로 유지하는 쪽을 택했다.

### 수정 후 결과

DB가 매번 정상적으로 healthy 상태까지 올라오는 것을 확인했다 (seed 데이터 85개 과목 / 158개 스케줄 정상 삽입).


| 항목                               | Before                                   | After                  |
| -------------------------------- | ---------------------------------------- | ---------------------- |
| `docker compose up`으로 db 초기화 성공률 | 사실상 0% (볼륨이 이미 초기화돼 있지 않은 한 항상 실패)       | 매번 성공                  |
| 실패 시 동작                          | `restart: unless-stopped`로 무한 crash-loop | 해당 없음                  |
| 문제 발생 조건                         | 로컬 Docker 볼륨의 우연한 과거 상태에 의존              | 볼륨 상태와 무관하게 항상 동일하게 동작 |


## 3. 부수 문제: Windows Docker Desktop(WSL2) 포트 잔류

위 버그를 고친 뒤에도 `backend`(8000), `frontend`(3000) 포트가 "already allocated" 에러로 뜨지 않는 문제가 남아있었다. `netstat -ano`로 확인해보니 `com.docker.backend.exe`, `wslrelay.exe`(둘 다 Docker Desktop 자체 프로세스)가 이미 그 포트를 물고 있었고, `docker compose down`으로 컨테이너를 다 지워도, Docker Desktop을 (완전 종료가 아니라) 재실행해도 동일 PID로 계속 남아있었다. 이건 애플리케이션 코드 버그가 아니라 **Windows/WSL2 환경에서 컨테이너가 짧은 시간에 반복적으로 죽고 재생성될 때 Docker Desktop의 포트 포워딩 레이어가 이전 바인딩을 온전히 해제하지 못하는, 잘 알려진 플랫폼 결함**으로 판단했다 (실제로 위 버그 때문에 이 프로젝트의 `db`가 수개월간 crash-loop를 반복해온 것이 이 결함을 유발하기 딱 좋은 조건이었다).

Docker Desktop 완전 재시작으로도 즉시 해결되지 않아, 근본 수정 대신 **호스트 포트를 우회하는 전략**을 택했다: 막혀있지 않은 `3001`(frontend), `8080`(backend)으로 옮기고, 컨테이너 내부 리스닝 포트는 그대로 뒀다.

이 우회가 단순 포트 번호 교체로 끝나지 않은 이유: 프론트엔드가 브라우저에서 백엔드를 호출할 때 쓰는 주소(`VITE_API_BASE_URL` 등)가 Vite 빌드 시점에 번들에 박히는데, 기존 `docker-compose.yml`은 이 값을 전혀 넘기지 않아 소스 코드의 `127.0.0.1:8000` 하드코딩 fallback을 그대로 쓰고 있었다. 포트를 바꾸면 이 fallback도 같이 바뀌어야 하므로:

- `frontend/.../Dockerfile`에 `ARG`/`ENV`로 `VITE_API_BASE_URL`, `VITE_AUTH_BASE_URL`, `VITE_AI_BASE_URL`, `VITE_SCHEDULER_BASE_URL`을 받도록 추가
- `docker-compose.yml`의 `frontend.build.args`에 새 포트(`8080`)를 반영한 값을 전달
- `backend/src/app.js`의 CORS `allowedOrigins`가 `http://127.0.0.1:3000`만 허용하고 있어, 새 프론트 origin(`3001`)을 추가하지 않으면 API 호출이 CORS로 전부 막히는 것도 함께 수정

수정 후 `curl`로 4개 서비스 모두 스모크 테스트: frontend `200`, backend `/`·`/health`·`/api/courses` `200`, ai-server `/docs` `200`.

## 4. 배운 점 및 느낀 점

- **증상과 원인은 다른 레이어에 있을 수 있다.** "포트가 이미 사용 중"이라는 표면적 에러 메시지에 낚여 포트만 바꿨다면, `docker-compose.yml`에 수개월간 방치된 진짜 버그(환경변수 이중 선언)는 발견하지 못했을 것이다. 반대로 환경변수 버그만 고치고 끝냈다면 Windows/WSL2 포트 잔류라는 완전히 다른 레이어의 문제로 여전히 앱이 안 떴을 것이다. 두 문제를 같은 문제로 뭉뚱그리지 않고 각각 독립적으로 원인을 좁힌 게 핵심이었다.
- **"어쩔 땐 됐다"는 증언을 노이즈로 버리지 않는 태도.** 재현 안 되는 과거의 성공 사례는 무시하기 쉽지만, 그걸 설명할 수 있는 가설(named volume의 영속성 + MySQL 공식 이미지의 초기화 조건부 로직)을 세우고 나서야 "왜 팀원마다 경험이 갈렸는지"까지 앞뒤가 맞는 그림이 완성됐다. 디버깅은 재현되는 실패만 보는 게 아니라, 재현 안 되는 과거의 성공까지 설명할 수 있어야 진짜로 끝난 것이라는 걸 다시 확인했다.
- `**git log`가 코드베이스의 나머지 절반이다.** 지금 파일만 봐서는 "이 설정이 언제부터 잘못됐는지"를 알 수 없다. orphan 이관으로 압축된 히스토리 대신 로컬 백업 브랜치(`old-team-main`)까지 뒤져서 최초 커밋을 찾아낸 덕분에, "이 버그가 애초에 이 프로젝트의 태생적 결함이었다"는 걸 추측이 아니라 근거로 말할 수 있게 됐다.
- **인프라 관점에서의 교훈**: `docker compose up` 한 번으로 아무 상태도 없는 새 머신에서 완전히 재현 가능해야 한다는 게 왜 중요한지 체감했다. 이 프로젝트는 로컬 볼륨의 우연한 과거 상태에 기대어 "되는 사람만 되는" 환경이었고, 이는 곧 온보딩 비용과 "내 컴퓨터에선 되는데요" 류의 협업 마찰로 직결된다. Phase 3(K8s 운영화)에서 시크릿/설정 관리를 다시 다룰 때 이 경험을 반영할 것.

## 한계

- Windows Docker Desktop의 포트 잔류 자체는 근본 원인(WSL2 네트워킹 레이어의 릴리스 타이밍 이슈로 추정)을 코드로 고칠 수 없어 우회했다. 실제 운영 환경(Linux 서버, K8s)에서는 이런 Windows/WSL2 특유의 문제가 애초에 발생하지 않으므로, 이 부분은 로컬 개발 환경 한정 이슈로 범위를 한정한다.

