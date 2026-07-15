# 1. 공식 MySQL 8.0 이미지 기반
FROM mysql:8.0

# 2. 한글 설정 파일 복사 (Docker Compose의 volumes 설정을 여기서 처리)
COPY ./conf.d/my.cnf /etc/mysql/conf.d/my.cnf

# 3. (선택사항) 초기화 SQL 복사
# seedData.js Job을 쓸 거라면 이건 주석 처리해도 됩니다.
# COPY ./init.sql /docker-entrypoint-initdb.d/