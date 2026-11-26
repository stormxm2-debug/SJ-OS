# SJ 인증번호 (OTP 포워더)

보험사 전산 로그인 인증문자를 자동으로 잡아 SJ-OS 서버(`otp-ingest`)로 전달하는
**내부 전용** 안드로이드 앱. FC 폰에 설치하면, 이후 보험사 OTP 문자가 오는 즉시
총무 "인증번호 전달함" 보드에 자동으로 뜹니다. (FC는 손대지 않음)

## 동작
1. 수신 SMS에서 인증 관련 키워드(`인증`, `OTP`, `코드` 등) + 4~8자리 숫자를 추출
2. 보험사명을 본문에서 자동 태깅(가능할 때)
3. `otp-ingest`로 `{ token, code, insurer, sender, raw }` POST (기기 토큰으로 인증)

## 설치 (사이드로드)
1. GitHub Actions의 **Android OTP APK** 워크플로우 결과물(`sj-otp-apk`)에서 `app-debug.apk` 다운로드
   - 또는 Actions 탭 → "Android OTP APK" → 최근 실행 → Artifacts
2. FC 폰으로 APK 전송 → 설치(출처를 알 수 없는 앱 허용)
3. 앱 실행 → SMS 권한 허용
4. **수신 주소**는 기본값 그대로, **기기 토큰**은 SJ-OS 앱 → "인증번호 전달함 → 내 폰 연결"에서 복사해 붙여넣기 → **저장**
5. "테스트 전송"으로 총무 화면에 `000000`이 뜨는지 확인

## 안정성 팁
- 배터리 최적화에서 이 앱을 **예외(제한 없음)**로 두면 백그라운드에서도 잘 동작합니다.

## 로컬 빌드 (선택)
Android SDK가 있는 환경에서:
```
cd android-otp
./gradlew assembleDebug
# 결과: app/build/outputs/apk/debug/app-debug.apk
```

## 구성
- `minSdk 24` / `compileSdk 34` · Kotlin · AGP 8.5.2 / Gradle 8.9
- 권한: `RECEIVE_SMS`, `READ_SMS`, `INTERNET`
- 디버그 서명 APK(내부 배포용). 스토어 등록 불필요.
