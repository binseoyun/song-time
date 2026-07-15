
  # Course Registration Platform

  This is a code bundle for Course Registration Platform. The original project is available at https://www.figma.com/design/ZrRT5XE98y9bUSJt0iFIdf/Course-Registration-Platform.

  ## Running the code

  Run `npm i` to install the dependencies.

  Run `npm run dev` to start the development server.
  

  # ai 스케줄러 관련

  ## 의존성 설치
     cd backend/ai-server
   py -3.10 -m pip install --upgrade pip
   py -3.10 -m pip install -r requirements.txt
   py -3.10 -m pip install python-dotenv google-generativeai

  ## Protobuf/OR-Tools 호환
   py -3.10 -m pip install "protobuf==5.29.5"
   py -3.10 -m pip install "ortools==9.12.4544"

  ## ai 서버 실행
     py -3.10 main.py