---
description: 담보정리 서버 재시작하고 정상 동작 확인
allowed-tools: PowerShell, Bash
---

담보정리 서버를 다시 띄우고 확인해줘.

1. 4173 포트를 쓰는 프로세스가 있으면 종료
2. `C:\Users\storm\Desktop\sj-os-coverage-tool` 에서 detached 로 실행
   (Start-Process 로 실행해서 이 대화가 끝나도 살아 있게 할 것)
3. 10초 기다린 뒤 http://localhost:4173/api/categories 응답 확인
4. 실패하면 stderr 로그를 읽어 원인을 알려줄 것

결과는 한 줄로: 정상이면 주소, 실패면 원인.
