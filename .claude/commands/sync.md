---
description: 변경분 커밋하고 노트북용 OneDrive 폴더까지 최신화
allowed-tools: Bash, PowerShell
---

지금까지 바뀐 내용을 정리해줘.

1. `git status` 로 변경 파일 확인 (민감한 파일이 섞여 있으면 멈추고 알려줄 것)
2. 무엇이 바뀌었는지 한국어로 요약한 커밋 메시지로 커밋
   - git 사용자 정보가 없으므로 `-c user.name="storm" -c user.email="stormxm2@gmail.com"` 사용
3. `robocopy` 로 `C:\Users\storm\OneDrive\SJ-OS\sj-os-coverage-tool` 에 복사
   (node_modules, .git, *.tmp.mjs, *.log 제외)
4. 원격 저장소가 등록되어 있으면 푸시하고, 없으면 "원격 없음"이라고만 알려줄 것

$ARGUMENTS
