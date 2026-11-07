# 건강기록 UI 데스크톱 반영 — v1.0.56

기준: `origin/main` d343b7b (v1.0.55, PR #92 병합 이후). 공개 최신 릴리스 v1.0.55 확인 → 1.0.56 patch. 의존성 변경 없음.

## 변경

- 가입 검토 탭 3단계 정리(UI 계획 3단계): 1. 보험사 선택(요약 + 펼침 목록) → 2. 등록 기준 확인(상태 한 줄 + 보험사별 카드, 세부 조건 펼침) → 3. AI 참고 요약(큰 버튼, 질문은 접힌 선택 사항).
- 기준 조회 상태를 두 소스 응답 ok 값으로 구분(미조회/조회 중/완료(0건 포함)/일부 실패/전체 실패) — `src/renderer/src/services/health-record/guideLoadState.ts` + `test/hrGuideLoadState.test.mjs`.
- 조회 서비스·매칭 규칙·AI 프롬프트/API·청구 저장·인쇄·집계·인증·DB·전역 테마 변경 없음.

## 검증

- `npm run typecheck`, `npm run build` 통과 (로컬 Windows). `node --test test/hrGuideLoadState.test.mjs` 5/5 통과.
- 임시 esbuild + Edge headless/CDP 하네스(저장소 미추가): 실제 `ResultReport`(내부 `HealthRecordWorkspace` 포함)를 합성 결과로 렌더,
  `listUnderwriting`/`listExceptions`/`askHealthRecordAi`/`healthClaimStore` 모듈 mock, `--host-resolver-rules`로 외부 네트워크 차단. 32/32 통과:
  탭 진입·보험사 체크·기간/고객 변경 시 기준·AI 자동호출 0(버튼에서만 호출), 미조회/선택 0/두 소스 성공·0건/부분 실패/전체 실패/catch 표시,
  재조회 중 이전 완료 미표시, 세부 조건 펼침(상품명·기준일 미제공·자료 수정일·검수 여부), 키보드 Enter 펼침·aria-expanded, DOM id 한글 없음,
  AI 분석 중/완료/실패·다시 시도, 보험사 변경 시 답변 초기화, 기간·고객 변경 전 지연 응답 무시, 탭 왕복 시 AI 답변·질문·기준·청구 선택 보존,
  375px·1280px 가로 넘침 없음, 가입 검토 영역 텍스트 대비 최저 4.76:1, 터치 대상 44px 이상.
  합성 화면: `docs/ui/health-review-mobile-375-synthetic.png`, `health-review-pc-1280-synthetic.png`, `health-review-partial-failure-pc-1280-synthetic.png`.
- 미검증: 실제 Electron 앱·실제 Supabase 기준 조회·실제 AI 호출·실기기 모바일·스크린리더, 실손 입력 유지(이번 하네스에서 미확인, 마운트 구조 변경 없음).

# 건강기록 UI 데스크톱 반영 — v1.0.55

기준: `origin/main` 8a05811 (v1.0.54, PR #90 병합 이후). 공개 최신 릴리스 v1.0.54 확인 → 1.0.55 patch.

## 변경

- 청구 관리 화면 단순화(UI 계획 2단계): PC 간결 목록 / 모바일 카드, 행별 상세 보기, 선택 시에만 작업 툴바,
  인쇄 범위 안내, 불러오기 실패 재시도. 저장·인쇄·키 생성·인증·DB·AI 코드와 의존성은 변경 없음.

## 검증

- `npm run typecheck`, `npm run build` 통과 (로컬 Windows).
- 합성 자료 + 가짜 requestId로 실제 `HealthRecordWorkspace`를 렌더(`healthClaimStore`·`printCareRecords`·기준 조회 모듈 mock,
  외부 네트워크 차단)한 임시 Vite + Edge headless/CDP 하네스에서 25개 시나리오 통과
  (375px 가로 넘침, 키보드 선택/펼침, 탭 왕복 유지, 필터 변경 선택 초기화, 전체 선택/해제·indeterminate,
  load 실패 재시도, save 실패/지연/성공, 인쇄 visible 범위, requestId 변경 누수). 합성 화면: `docs/ui/health-claims-*-synthetic.png`.
- 미검증: 실제 Electron 앱·실제 Supabase 저장·실제 인쇄 창·실기기 모바일·스크린리더. 하네스는 저장소에 추가하지 않음.
- 위 25/25 시나리오는 PR #91(head 813aadb) 보고 결과이며 이번 보완 후 재실행하지 않음.

### 접근성 보완 (PR #91 검토 반영)

- 문제: `ClaimRow` 상세 id가 `r.key`의 비ASCII 문자를 `_`로 치환해 만들어져, 병원명만 다른 행
  (`["20261101","가나병원",…]` vs `["20261101","다라병원",…]`)이 같은 DOM id/aria-controls를 가짐. 저장/인쇄 데이터 키 충돌은 아님.
- 수정: React `useId()` 기반 고유 id로 교체. `r.key`·선택·저장 hash·API 변경 없음.
- 검증(로컬 Windows): `test/hrClaimRowA11y.test.mjs` — 실제 `ClaimRow` 두 개를 둘 다 펼친 상태로 esbuild 번들 +
  `renderToStaticMarkup` 렌더 → 중복 id 없음, 각 버튼 aria-controls가 같은 행 상세 영역을 가리킴 통과.
  이전 id 방식으로 되돌리면 같은 테스트가 "중복 DOM id 없음"에서 실패함을 확인.
  `hrCareWorkspace`·`hrEntryPhase`와 함께 node 단위 테스트 25건 모두 통과(위 하네스 25개와 별개). `npm run typecheck`·`npm run build` 통과.
  (`npm test` 전체 중 claim*/coverage* 등 16개 파일은 이번 변경과 무관한 기존 Windows 경로 로더 오류 `ERR_UNSUPPORTED_ESM_URL_SCHEME`로 실패.)

---

## (이전) 건강기록 UI 데스크톱 반영 — v1.0.52

기준: `main` 1da8c69 (UI 누적 PR #85, 실행기 복구 PR #82 병합 이후).
이 문서는 이미 `main`에 병합된 변경을 데스크톱 배포 버전(1.0.51 → 1.0.52)으로
묶기 위한 기록입니다. 이번 버전 작업 자체는 버전 메타데이터와 이 문서만 변경하며,
UI·고객 자료·인증·DB·AI·실행기 코드는 변경하지 않았습니다.

## 포함된 변경 (기존 병합분)

- 고객 선택 / 인증 단계 안내 표시
- 조회 설정을 기본 접힌 상태로 정리
- 결과 화면 탭: 요약 / 청구 관리 / 가입 검토
- 실손·원본 항목에서 상세 화면으로 이동
- 링크 재발급 상태 표시 보완
- 원격 실행기: 미완성 작업 보존 및 시간초과 안전 처리

위 항목은 화면·실행기 수준 변경이며, 서비스/DB 기능을 이번에 새로 완료한 것이
아닙니다.

## 검증 상태

- `npm run typecheck`, `npm run build` 통과 (로컬 Windows).
- **실제 브라우저/모바일 화면 검증은 완료되지 않았습니다.**

## 배포

`package.json` 버전 변경이 `main`에 병합되면 기존 데스크톱 배포 워크플로가
설치본과 `latest.yml`을 준비한 뒤 릴리스를 공개합니다. 워크플로·서명·배포 설정은
변경하지 않았습니다.

---

# 건강기록 조회 결과 개선 반영 — v1.0.53

기준: `main` aeceece (조회 결과 개선 PR #87 병합 이후). 버전 1.0.52 → 1.0.53.
이번 작업은 버전 메타데이터와 이 문서만 변경합니다(앱 코드·의존성·워크플로 변경 없음).

## 포함된 변경 (PR #87)

- 최근 3개월 진료 내역을 고정 표로 표시
- 날짜 미확인 항목을 별도 구역으로 분리
- 상세 내역은 기본 접힌 상태로 표시
- 결과 화면 가독성 개선

## 검증 상태

- 관련 단위 테스트 24개 통과.
- 실제 컴포넌트 합성 PC·모바일 headless 화면 검증: PR #87에서 보고됨
  (이번 버전 작업에서 별도 화면 검증 서버·브라우저는 실행하지 않음).
- `hrSummarize` 테스트: 기존 Windows 경로 문제로 미실행.
- `npm run typecheck`, `npm run build` 통과 (로컬 Windows).

---

# 건강기록 결과 첫 화면 정리 반영 — v1.0.54

기준: `main` d5e691b (v1.0.53) + 미병합 PR #89(head 6e47408) 누적. 버전 1.0.53 → 1.0.54.

## 포함된 변경

- 결과 첫 화면: 큰 숫자 KPI 요약을 먼저 표시 → 최근 3개월 → 접힌 상세 기록
- 선택 기간(요약·상세·청구·가입 검토 적용)과 **최근 3개월 고정** 표를 배지·날짜로 구분
- 상세 기록 입구를 하나로 통합(상병별 묶음/상병 집계/진료순/원자료)
- 넉넉한 3탭(요약 / 청구 관리 / 가입 검토, 높이 56px, ←/→ 전환)
- 이번 추가: 적용 기간 선택 버튼(활성)과 '선택 기간' 배지를 금색 배경+흰 글씨(대비 2.65:1)에서
  연한 금색 `#fdf7ea` 배경 + 남색 `#0e1e3a` 글씨 + 금색 테두리(대비 15.54:1)로 변경.
  `aria-pressed`·활성 표시·기능은 동일, 전역 테마 변경 없음.

## 검증 상태

- `npm run typecheck`, `npm run build` 통과 (로컬 Windows).
- 색 대비: WCAG 상대휘도 계산으로 확인(작은 글씨 목표 4.5:1 이상 충족).
- 합성 화면 21/21 확인은 **PR #89에서 보고된 결과**이며, 이번 대비 수정 후 화면 재검증은 하지 않았습니다
  (375px·선택 상태 화면 미확인).
- 실제 청구 선택 체크박스·청구 상태 저장은 하네스에서 검증되지 않았습니다(저장된 요청 필요).
