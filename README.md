
  # Course Registration Platform

  This is a code bundle for Course Registration Platform. The original project is available at https://www.figma.com/design/ZrRT5XE98y9bUSJt0iFIdf/Course-Registration-Platform.

  ## Running the code

  Run `npm i` to install the dependencies.

  Run `npm run dev` to start the development server.

## Docker로 실행하기

1. `env.docker.example`을 복사해 `.env.docker`를 만들고 값(특히 `GEMINI_API_KEY`)을 채웁니다.
2. 아래 명령으로 모든 서비스를 빌드/실행합니다.
   ```bash
   docker compose --env-file .env.docker up --build
   ```
3. 노출 포트
   - Frontend: http://localhost:3000
   - Backend API: http://localhost:8000
   - AI Server: http://localhost:5000
   - MySQL: localhost:3306

`docker compose down`으로 종료할 수 있으며, DB 데이터는 `db_data` 볼륨에 유지됩니다.

## 백엔드 테스트 실행

테스트는 개발 DB와 분리된 전용 MySQL 컨테이너(포트 3311, 일회용)를 사용합니다.

```bash
cd backend
npm i
npm run test:db:up   # 테스트용 MySQL 기동
npm test             # 통합 테스트 실행
npm run test:db:down # 테스트용 MySQL 종료
```

## 문서

- 고도화 로드맵과 진행 상황: [doc/portfolio-roadmap.md](doc/portfolio-roadmap.md)
- 의사결정 기록(ADR): [doc/ADR/](doc/ADR/)
- 리팩토링/트러블슈팅 기록: [doc/refactoring/](doc/refactoring/), doc/troubleshooting/
