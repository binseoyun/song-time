# 트러블슈팅 02: kind 클러스터 배포 — 명령어 레퍼런스와 겪은 문제들

- 날짜: 2026-07-22
- Phase: Docker Hub 이관 후 첫 K8s 배포 검증 (Phase 3 착수 전 사전 점검)
- 관련: `K8s/*.yaml`, `frontend/.../Dockerfile`

## 1. 왜 이 작업을 했나

Docker Hub 이미지를 팀 계정(`krpark1108`)에서 개인 계정(`binseoyun`)으로 옮긴 뒤, `K8s/*.yaml`의 `image:` 필드를 새 계정으로 바꾸는 것만으로 끝나지 않았다. 실제로 로컬 kind 클러스터에 배포해서 "정말 동작하는지"까지 검증하는 과정에서 두 가지 문제를 새로 발견했다. 이 문서는 (1) 그 과정에서 쓴 명령어를 나중에 그대로 재현할 수 있게 정리하고, (2) 발견한 문제와 해결을 기록한다.

## 2. 명령어 레퍼런스

### 2-1. kind 클러스터 생성/관리

```bash
kind version                                            # kind CLI 버전 확인
kind get clusters                                        # 현재 존재하는 클러스터 목록
kind create cluster --config kind-config.yaml --name sugang
                                                           # kind-config.yaml에 정의된 노드 구성(control-plane 1 + worker 2)으로
                                                           # 클러스터 생성. 각 노드는 실제로는 Docker 컨테이너 1개씩이다.
kubectl cluster-info --context kind-sugang                # 클러스터 접속 정보 (kind가 kubeconfig에 자동 등록해줌)
kind delete cluster --name sugang                         # 클러스터 통째로 삭제
```

### 2-2. 매니페스트 적용 — `kubectl apply -f`가 실제로 하는 일

```bash
kubectl apply -f K8s/00-namespace.yaml -f K8s/01-configmap.yaml -f K8s/02-secret.yaml
kubectl apply -f K8s/10-db.yaml -f K8s/20-ai-server.yaml -f K8s/30-backend.yaml -f K8s/40-frontend.yaml
```

`apply`는 컨테이너를 직접 실행하는 명령이 아니라, **"이 YAML대로의 상태가 최종적으로 존재해야 한다"는 선언을 API 서버에 등록**하는 것이다. 이후 흐름:

1. API 서버가 그 선언을 etcd(K8s 내부 저장소)에 기록
2. Deployment/StatefulSet 컨트롤러가 "지금 실제 상태 vs 선언된 원하는 상태"를 계속 비교(reconciliation loop)하다가 차이가 있으면 Pod 개수를 맞춤
3. 스케줄러가 새로 필요한 Pod을 어느 노드에 둘지 결정
4. 그 노드의 kubelet이 containerd에게 "이 이미지로 컨테이너를 띄워라" 지시

파일명 앞의 숫자(`00`, `01`, `10`, `20`...)는 K8s가 강제하는 규칙이 아니라 **사람이 정한 적용 순서 관례**다 — namespace 없이 그 안의 리소스부터 만들 수는 없으니 00번이 먼저 와야 하는 식. 여러 파일을 `apply -f a -f b -f c`로 한 번에 줘도 결과는 동일하다(등록은 다 되고, 실제 수렴은 컨트롤러가 알아서 처리).

### 2-3. 배포 상태 확인

```bash
kubectl get pods -n sugang-system -o wide                # 파드 상태/노드 배치 한눈에
kubectl get pods -n sugang-system -w                      # 실시간 watch
kubectl describe pod <파드이름> -n sugang-system           # 왜 안 뜨는지 원인(이벤트) 확인
kubectl logs <파드이름> -n sugang-system                   # 컨테이너 로그
kubectl logs <파드이름> -n sugang-system --previous        # 재시작 직전, 죽은 컨테이너의 로그 (crash-loop 디버깅 필수)
kubectl get deployments,statefulsets,services -n sugang-system
```

### 2-4. 로컬에서 서비스 접근 — `port-forward`

```bash
kubectl port-forward -n sugang-system svc/backend-service 18000:8000
```

kind는 `LoadBalancer` 타입 서비스를 지원하지 않아(클라우드 로드밸런서가 없음) `EXTERNAL-IP`가 계속 `<pending>`으로 남는다. 로컬 kind 환경에서 바로 접근하는 사실상 유일한 방법이 `port-forward`다. `kind-config.yaml`의 `extraPortMappings`로 NodePort를 호스트에 매핑하는 방법도 있지만, 현재 이 값(30000→3100, 30080→8100)이 실제 서비스의 NodePort와 맞지 않아 그대로는 안 된다 — Ingress 도입과 함께 Phase 3에서 정리할 항목.

**주의**: `port-forward`를 `svc/이름`(서비스) 대상으로 걸면 특정 시점의 파드 하나에 연결이 고정된다. 그 뒤 `kubectl apply`로 파드가 재생성(rollout)되면 연결이 끊기므로, 재배포 후에는 `port-forward`를 다시 실행해야 한다.

### 2-5. 이미지/설정을 바꾼 뒤 다시 반영하기

```bash
kubectl apply -f K8s/30-backend.yaml                       # yaml을 고쳤을 때 — 바뀐 부분만 반영(선언적)
kubectl rollout restart deployment/backend -n sugang-system
                                                             # 이미지 태그(v1)는 그대로인데 Docker Hub에 새 이미지를 푸시했을 때,
                                                             # 강제로 파드를 새로 만들어 이미지를 다시 pull하게 함
kubectl rollout status deployment/backend -n sugang-system    # 롤아웃 완료 여부 확인
kubectl rollout undo deployment/backend -n sugang-system      # 방금 배포가 잘못됐으면 직전 버전으로 롤백
```

### 2-6. 정리

```bash
kubectl delete -f K8s/40-frontend.yaml                      # 특정 리소스만 삭제
kind delete cluster --name sugang                            # 클러스터 통째로 삭제 (실습 종료 시)
```

## 3. 실제로 배포하며 발견한 문제 2가지

### 3-1. `app-secrets`에 `cron-secret` 키가 없어 backend가 아예 못 뜸

`K8s/30-backend.yaml`이 `secretKeyRef`로 `app-secrets`의 `cron-secret` 키를 참조하는데, `K8s/02-secret.yaml`에는 `db-user`/`db-password`/`gemini-api-key`만 있고 `cron-secret`이 없었다. K8s는 `secretKeyRef`가 가리키는 키가 Secret 오브젝트에 아예 없으면 그 컨테이너를 **띄우는 것 자체를 거부**한다(`CreateContainerConfigError`) — 앱 코드가 그 값을 필수로 쓰는지와 무관하게, Pod 레벨에서 막힌다. `02-secret.yaml`에 `cron-secret` 값을 추가해서 해결했다 (이 파일은 `.gitignore`에 등록돼 있어 커밋되지 않는 로컬 전용 파일).

### 3-2. frontend 이미지가 docker-compose용 주소를 그대로 배포에 올림

Docker Hub 이관 작업(`binseoyun/frontend:v1`) 때 쓴 이미지는 **로컬 docker-compose 검증용으로 빌드된 것**이라, Vite 빌드 시점에 `VITE_API_BASE_URL=http://127.0.0.1:8080` 등이 번들에 박혀 있었다. 이 이미지를 그대로 K8s에 올렸더니, 파드는 정상적으로 `Running`이 되고 정적 페이지(`/`)는 200을 반환했지만 — 실제 JS 번들 안에는 브라우저가 존재하지도 않는 `127.0.0.1:8080`을 호출하도록 박혀 있어 로그인·과목조회 같은 실제 기능은 전부 실패했을 상태였다.

**발견 과정**: `curl`로 받은 HTML에서 번들 파일명을 추출한 뒤, 그 JS 파일 안에서 `127.0.0.1` 문자열을 직접 grep해서 확인했다.
```bash
curl -s http://127.0.0.1:13000/ | grep -o 'assets/index-[^"]*\.js'
curl -s http://127.0.0.1:13000/assets/index-B1o_B7Wb.js | grep -o '127\.0\.0\.1:[0-9]*'
```

**원인**: Vite는 `import.meta.env.VITE_*`를 **빌드 시점에 정적 문자열로 번들에 굽는다.** K8s 매니페스트(`40-frontend.yaml`)는 이걸 모르고 컨테이너 **런타임 환경변수**로 `VITE_API_BASE_URL` 등을 ConfigMap에서 주입하고 있었는데, 이 이미지는 `serve -s build`로 이미 완성된 정적 파일을 서빙만 하는 구조라 런타임 환경변수는 아무 효과가 없다. 즉 "이 이미지가 어떤 목적(로컬 compose용 vs K8s용)으로 빌드됐는지"에 따라 완전히 다른 주소가 박혀야 하는데, 하나의 이미지를 두 용도에 재사용하려 한 게 문제였다.

**해결**: K8s용 값(`http://backend-service:8000`, `http://ai-server-service:5000/...` — 이미 `01-configmap.yaml`에 정의돼 있던 값)으로 별도 빌드해서 `binseoyun/frontend:v2`로 새로 푸시하고, `40-frontend.yaml`의 이미지 태그를 `v2`로 갱신했다.
```bash
docker build \
  --build-arg VITE_API_BASE_URL=http://backend-service:8000 \
  --build-arg VITE_AUTH_BASE_URL=http://backend-service:8000/api/auth \
  --build-arg VITE_AI_BASE_URL=http://backend-service:8000/api/ai/recommend \
  --build-arg VITE_SCHEDULER_BASE_URL=http://ai-server-service:5000/api/schedule \
  -t binseoyun/frontend:v2 .
docker push binseoyun/frontend:v2
```

이후 번들을 다시 확인해 `backend-service:8000`, `ai-server-service:5000`이 정상적으로 박혀 있음을 재검증했다.

## 4. 결과

`curl`/`port-forward`로 4개 서비스 모두 스모크 테스트 통과: backend `/`·`/health`·`/api/courses` 200, ai-server `/docs` 200, frontend `/` 200 + 번들 내 API 주소가 K8s 서비스 DNS(`backend-service`, `ai-server-service`)를 정확히 가리킴을 확인.

## 5. 배운 점

- **같은 소스 코드라도 "어떤 환경을 향해 빌드됐는지"는 이미지 태그만으로는 알 수 없다.** frontend처럼 빌드 시점에 설정을 굽는(bake) 구조에서는, "로컬 확인용으로 빌드한 이미지"를 그대로 다른 환경(K8s)에 재사용하면 겉보기엔 멀쩡히 떠도 실제 기능은 조용히 깨진다. 이건 컨테이너가 `Running`인지만 봐서는 절대 안 보이고, 번들 내용까지 직접 까봐야 드러난다.
- **K8s 매니페스트에 `env:`로 런타임 값을 주입하는 방식이 항상 통하는 건 아니다.** 서버가 요청마다 그 값을 참조하는 구조(백엔드처럼)라면 되지만, 정적 파일을 미리 굽고 그냥 서빙만 하는 구조(Vite 빌드 결과물)라면 런타임 주입은 무의미하다 — 애플리케이션의 "설정을 언제 읽는가"(빌드 시점 vs 런타임)를 알아야 올바른 주입 지점을 고를 수 있다.
