# 건강기록 UI 데스크톱 반영 — v1.0.61

기준: `main` 9630fff (v1.0.60). 1.0.61 patch(작은 후속 UI 변경). 의존성 변경 없음.

## 변경

- `HealthRecordPage.tsx` `ResultReport`: `청구 관리`·`가입 검토` 탭 제목 옆 작은 `베타` 배지(선택 탭: 금색 바탕+남색 글씨, 비선택: 연한 금색+금색 테두리). 좁은 폭에서는 배지가 줄바꿈. tab id·←/→ 이동·`aria-selected`·기능·권한 변경 없음. `한눈에 요약`에는 없음.
- `RecentCareTable.tsx`: `SurgeryTag` 추가(기존 `r.surgery === true`일 때만 `수술 추정`). 최근 진료 기본 행 병명(+좌우) 옆에 표시. `ClaimRecordList.tsx` 기본 행에서도 재사용. 새 수술 판정·추가 열 없음. 자세히 보기의 수술/참고 표시·치료 내용·처방약(이름·성분·투약일수)은 그대로 상세에만.
- KPI·기간·청구 상태 저장/되돌리기/출력·가입 검토/AI·인증·API/DB/RLS·러너 변경 없음.

## 검증 (실제 실행)

- `npm run typecheck`, `npm run build` 통과 (로컬 Windows).
- 관련 기존 테스트 6개 파일 55 pass / 0 fail.
- 실제 `ResultReport` + `ClaimRow` 컴포넌트, 합성 데이터(가상 병원·병명, 긴 병원명/병명 포함), 앱 Tailwind CSS, 헤드리스 Chrome(네트워크 차단, `requestId` 없음) 375px/1280px 43/43 확인: 두 탭만 베타(선택 전·←/→ 및 클릭 선택 후), 제목·배지·힌트 겹침/잘림 없음, 탭 비활성 아님, 수술 true 행만 접힌 상태 배지(false 행 없음), 좌우 표시 유지, 약 이름 기본 숨김/상세 표시, 상세 수술·치료 내용 유지, 청구 선택·상태·자세히 보기 유지, PC 열 수 유지(최근 진료 4열·청구 6열), 가로 넘침 없음. 스크린샷·하네스는 로컬 임시 폴더에만 둠(업로드·커밋 안 함).

## 미검증

- 실제 Electron 앱 전체 화면·실고객 데이터·청구 상태 저장(저장된 요청 필요)은 확인하지 않음.

# 건강기록 UI 데스크톱 반영 — v1.0.60

기준: `main` d79cc96 (v1.0.59). 1.0.60 patch. 의존성 변경 없음. 계획: HEALTH_RECORD_UI_PLAN.md 6단계.

## 변경

- 청구 관리의 의미를 화면 첫 줄에 표시: "조회된 진료마다 보험 청구 여부를 직접 표시합니다. (보험사 청구 내역 자동 조회 아님)". 나머지 설명은 접힌 `이용 안내`.
- `HealthRecordWorkspace.tsx` claims 분기: 상태 select → 건수 버튼 4개(`aria-pressed`), 같은 기반 목록(기간·검색·유형, 상태 필터 제외) 집계. 준비 전/조회 중/실패 시 상태 건수 `-`·버튼 비활성·필터는 `전체`로 취급. `청구 완료로 표시` 주요 버튼 + 접힌 `다른 상태로 표시`. `되돌리기`. `미청구 N건 출력`(범위의 미청구만) + 기존 `현재 목록 N건 출력`.
- `ClaimRecordList.tsx`: 기본 행 6열(선택·날짜·병원·병명(+좌우)·청구 상태·자세히 보기), 375px 카드. 날짜는 `validCareDate`. 나머지 정보(코드·구분·입원일수·참고 표시·처방약 전체·치료 내용·표시한 날)는 자세히 보기. 표시 라벨 `CLAIM_VIEW_LABELS`. 병명 쉬운 표기는 `RecentCareTable`의 `diseaseLabel` 재사용(export만 추가).
- 신규 `services/health-record/claimUndo.ts`(순수 도우미): `claimCounts`, `createUndoToken`, `undoGroups`, `undoConflicts`, `runClaimUndo`.
- 서비스 API(`claimStateStore`)·RPC·DB·RLS·권한·인쇄 서비스·실제 접수/자동 청구 이력·기관 인증·AI·원격 러너 변경 없음. 한눈에 요약·기간·KPI·가입 검토·고객 전환 가드 변경 없음.

## 되돌리기 동작과 제약 (정확한 범위)

- 저장 성공 응답(서버가 모든 대상 키의 새 상태를 돌려줌)을 확인한 뒤에만 되돌리기를 만든다. 메모리에만 보관: requestId, 화면 범위(scope), 저장 상태, 실제로 상태가 바뀐 해시 키별 이전 상태, 저장 응답의 해당 키 `status·checked_at·checked_by` 스냅샷. 원래 같은 상태였던 행은 대상에서 뺀다(그 행의 확인 시각은 저장으로 갱신되며 되돌리지 않음).
- 이전 상태가 없던(미등록) 키는 `unknown`(확인 필요)으로 써서 복원한다. 옛 확인자·확인 시각은 복원하지 않으며 복원 쓰기 시각/사용자로 새로 기록된다.
- 기존 API 계약(한 번에 한 상태·최대 200키)으로 이전 상태별 최대 3묶음을 순차 저장한다. 저장 핸들러도 200건 초과를 거부한다.
- 복원 직전 `load`로 대상 키 스냅샷을 비교한다. 하나라도 다르면(상태·확인 시각·확인자) 쓰기 없이 중단하고 최신 상태를 화면에 반영한다. 이 조회가 실패하면(`load-failed`) 쓰기 없이 중단하고, 실제 서버 상태를 모르므로 기존 값을 확정 표시하지 않도록 `ready=false`·상태(`states`) 비움·선택 해제로 잠근다. 그 결과 상태 건수 `-`·상태 버튼 비활성·`상태 미조회`·선택/저장 불가·`미청구 출력` 불가가 되고, 안내 "현재 상태를 확인하지 못해 되돌리지 않았습니다. 상태 표시를 잠갔습니다. ‘다시 불러오기’를 누르세요."와 `다시 불러오기` 버튼을 보인다(누르면 정상 조회로 복구). 토큰은 1회용이라 이 경우에도 폐기된다.
- **동시성 한계**: 현재 RPC에는 비교 후 쓰기(CAS)가 없어, 직전 조회와 복원 쓰기 사이(또는 묶음 사이)에 다른 직원이 같은 키를 바꾸면 그 변경을 덮어쓸 수 있다. 이 화면은 "저장 후 조회 시점까지 다른 변경이 없었음"만 확인하며 완전한 동시성 보장을 하지 않는다. 막으려면 서버에 기대 상태 비교 RPC가 필요하다(이번 범위 밖, DB/API 미변경).
- 부분 실패: 실패한 묶음에서 멈추고 이미 성공한 묶음은 유지(다시 되돌리거나 자동 재시도하지 않음). 실패한 묶음은 응답을 확인하지 못했을 뿐 서버에서는 반영됐을 수 있으므로(응답 유실 등) 실패로 단정하지 않고 `N건은 복원 응답을 확인했고, 나머지 M건은 결과 확인이 필요합니다.` 안내 후 실제 상태 재조회(성공 시 "실제 상태를 다시 불러왔습니다. 확인 후 필요한 기록만 다시 표시하세요."). 재조회도 실패하면 `ready=false`로 잠가 상태를 확정 표시하지 않고 `다시 불러오기`를 보인다.
- 토큰 폐기: 새 저장 시작, 요청·고객·기간 전환, 상태 새로고침, 되돌리기 실행(1회용, 결과 무관). 결과 탭 전환은 유지.
- 재진입: 저장·복원은 ref 잠금(더블클릭 보호). 범위가 바뀌면 각 후속 RPC 전에 확인해 남은 묶음을 보내지 않으며, 늦은 응답·이전 finally는 새 화면의 상태·잠금을 덮지 않는다(잠금은 자기 토큰일 때만 해제). 이미 전송된 RPC는 취소된다고 가정하지 않는다.

## 검증 (실제 실행)

- `npm run typecheck` 통과, `npm run build` 통과.
- `node --test test/hrClaimUndo.test.mjs test/hrClaimRowA11y.test.mjs test/hrCareWorkspace.test.mjs test/hrForegroundGuard.test.mjs test/hrStatusView.test.mjs test/hrEntryPhase.test.mjs` 55 pass / 0 fail. 신규 `hrClaimUndo.test.mjs` 9건(합성 서버 mock): 건수 합계·준비 전 미집계, 혼합 이전 상태(미등록·미청구·이미 완료·확인 필요) 상태별 복원과 동일 상태 행 제외, 변경 없음→토큰 없음, 경합(상태·시각·확인자) 시 쓰기 0, 조회 실패 시 쓰기 0, 부분 실패 시 남은 묶음·재시도 없음, 범위 전환 시 후속 쓰기 중단(조회 중/묶음 사이), 200건 → 3묶음 이하·각 200 이하.
- 전체 `npm test` 84 중 66 pass / 16 fail: 실패 16건은 수정하지 않은 테스트의 Windows `ERR_UNSUPPORTED_ESM_URL_SCHEME`(기존 로더 문제, v1.0.58과 동일 목록).
- 실제 `HealthRecordWorkspace`(claims) + `ClaimRecordList` 컴포넌트, 합성 진료 데이터, `claimStateStore`만 합성 mock으로 치환, 빌드된 앱 CSS, 헤드리스 Chrome(CDP, 375px mobile / 1280px) 33개 확인 전부 통과: 준비 전 건수 `-`·버튼 비활성·`상태 미조회`, 준비 후 합계 일치·검색 반영, `20260230` → `날짜 미확인`, 기본 화면 약 이름 미노출, 선택 → 표시 → 되돌리기(혼합 이전 상태 복원, 호출 순서 load→묶음 저장), 더블클릭 저장 1회, 경합 감지 쓰기 0, 부분 실패 안내·재조회, 재조회 실패 시 잠금·다시 불러오기, 되돌리기 중 요청 전환 시 쓰기 0·토큰 폐기, 탭 전환 유지·새로고침 폐기, `aria-pressed`, 미청구 출력은 상태 필터·체크와 무관하게 범위의 미청구만, 현재 목록 출력 = 보이는 목록, 자세히 보기 정보(코드·구분·입원일수·약 이름/성분/일수·독감약·수술·치료·표시한 날), PC 헤더·행 6열 위치 일치, 가로 넘침 없음. 스크린샷·하네스는 로컬 임시 폴더에만 두고 업로드·커밋하지 않음.
- 리뷰 보완(preflight 조회 실패 잠금·부분 실패 문구) 재검증: 실제 `HealthRecordWorkspace`(claims) 컴포넌트 + 합성 진료 3건 + 메모리 합성 서버 mock(`claimStateStore`만 치환), 헤드리스 Chrome 20개 확인 전부 통과. ① 성공 저장 → 되돌리기 직전 조회 실패: 복원 쓰기 0, 상태 버튼 4개 전부 비활성, 건수 전부 `-`, 행 배지 `상태 미조회`, 체크박스 전부 비활성·선택 해제(표시 버튼 없음), `미청구 -건 출력` 비활성, 되돌리기 버튼 사라짐, 잠금 안내와 `다시 불러오기` 노출 → 누르면 서버 실제값으로 정상 복구. ② 혼합 이전 상태(확인 필요 2·미청구 1) 되돌리기 중 두 번째 묶음을 서버가 반영한 뒤 오류 응답(응답 유실 흉내): `2건은 복원 응답을 확인했고, 나머지 1건은 결과 확인이 필요합니다.` 표시(‘되돌리지 못했’ 문구 없음), 재조회 결과(실제 복원됨)가 화면에 반영, 복원 쓰기 2회로 자동 재시도 없음, 되돌리기 재노출 없음. 같은 6개 관련 테스트 55 pass / 0 fail, `typecheck`·`build` 통과.

## 미검증

- 실제 Electron 앱 전체 화면·실고객/운영 청구 저장 데이터·실제 Supabase RPC는 사용하지 않음(컴포넌트 단독 + 합성 mock).
- 실제 인쇄 대화상자·PDF 저장은 열지 않음(`window.open`을 가로채 출력 HTML의 행만 확인).
- 다중 직원 실제 동시 쓰기(위 동시성 한계)는 재현하지 않음.

# 건강기록 UI 데스크톱 반영 — v1.0.59

기준: `main` 14acd7c (v1.0.58). 1.0.59 patch(작은 후속 UI 변경). 의존성 변경 없음.

## 변경

- 요청: "처방약은 자세히 보기 누르면 떴으면 좋겠어".
- `RecentCareTable.tsx`만 변경: 최근 진료 기본 행에서 처방약 이름·요약·`외 N건`·빈칸 `-`와 PC `처방약` 열 제목 제거. 모바일·PC 기본 행은 날짜·병원·병명(+좌우)·자세히 보기만. PC 헤더/행 grid를 같은 4열(`6.5rem / 1fr / 1.4fr / 7.5rem`)로 맞춤. 미사용 `medSummary`/`meds` 삭제.
- 처방약 전체 이름·성분·투약일수는 행별 `자세히 보기`에서만 표시(기존 Detail 그대로), 접으면 사라짐. 약만 있는 기록도 버튼이 있도록 `hasCareDetail`의 medications 조건 유지. 일반 기록 종류 라벨 `처방약 기록`은 유지.
- 청구 관리·가입 검토·AI·전체 상세보기·수집/API/DB/인증·집계·기간·기록 키·날짜 검증·고객 전환 가드 변경 없음.

## 검증 (실제 실행)

- `npm run typecheck` 통과, `npm run build` 통과.
- `node --test test/hrForegroundGuard.test.mjs test/hrStatusView.test.mjs test/hrCareWorkspace.test.mjs test/hrEntryPhase.test.mjs` 45 pass / 0 fail.
- 실제 `RecentCareTable` 컴포넌트 + 합성 데이터, 빌드된 앱 CSS, 헤드리스 Chrome(CDP 375px mobile·scale 1 / 1280px): 닫힌 행에 약 이름·성분 미노출 → 자세히 보기 시 이름·성분·`N일분`/`일수 미확인` 노출 → 접기 시 다시 미노출. 약만 있는 기록(`처방약 기록`)도 버튼 있음, 펼치면 약 표시. PC 헤더·행 열 위치 일치(4열), 375/1280 가로 넘침 없음. 스크린샷은 로컬 임시 폴더에만 두고 업로드하지 않음.

## 미검증

- 실제 Electron 앱 화면·실고객 데이터는 실행하지 않음(ResultReport 전체 화면이 아니라 컴포넌트 단독 렌더링).

# 건강기록 UI 데스크톱 반영 — v1.0.58

기준: `main` 9e584a4 (v1.0.57, PR #97). 1.0.58 patch. 의존성 변경 없음.

## 변경

- UI 계획 5단계: 한눈에 요약 단순화(상세는 HEALTH_RECORD_UI_PLAN.md 5단계 결과).
- `careWorkspace.ts`: `careListSummary(result, period)`·`careKpis(rows)` 추가, `recentCareSummary`는 3개월 래퍼로 유지, 기간 라벨 `전체`.
- `RecentCareTable.tsx`: 공통 기간 목록·행별 자세히 보기·모바일 카드·빈 결과/날짜 미확인 안내.
- 검토 보완(PR98): 목록 날짜는 기존 `validCareDate`로 검증된 값만 `YYYY.MM.DD`로 표시, `20260230` 같은 존재하지 않는 8자리 날짜·빈값은 `날짜 미확인`. 표시만 변경 — 원본값·기록 키·기간 필터·집계는 그대로.
- `HealthRecordWorkspace.tsx` summary 분기: 핵심 숫자 3개. `HealthRecordPage.tsx` ResultReport: 기본 3개월, 확인 권장 띠 제거, 자료 안내 통합.
- 청구/가입 검토/AI/원본 수집/고객 전환 가드, 인증·기관 API·DB·RLS 변경 없음.

## 검증 (실제 실행)

- `npm run typecheck` 통과, `npm run build` 통과.
- `node --test test/hrForegroundGuard.test.mjs test/hrStatusView.test.mjs test/hrCareWorkspace.test.mjs test/hrEntryPhase.test.mjs` 45 pass / 0 fail. 신규 2건: 기간별(3m/1y/3y/5y/전체) 목록 = 숫자 기록 일치·경계 포함·날짜 미확인은 전체에서만, 입원일수 미확인을 0일로 합산하지 않음·수술 방문별 1회·건수 의미 유지.
- 실제 컴포넌트(ResultReport) 헤드리스 Chrome, 합성 데이터, 375px(mobile 에뮬레이션)·1280px: 가로 넘침 없음, 기본 3개월 선택, 1년/전체 전환 시 숫자와 목록 건수 동시 변경(3→4→5), 날짜 미확인 안내·전체 기록 보기, 빈 결과/기간 밖 결과 문구, 행 자세히 보기 토글(질병코드·처방약 성분·일수 미확인), 좌우 표시, 내부 설명 문구 미노출, 원자료 기본 미노출, 기간 전환 중 네트워크 요청 0건, 청구 관리·가입 검토 탭 정상 표시. 스크린샷은 로컬 임시 폴더에만 두고 업로드하지 않음.
- 전체 `npm test` 75 중 57 pass / 16 fail: 실패 16건은 수정하지 않은 테스트 파일이 Windows에서 `ERR_UNSUPPORTED_ESM_URL_SCHEME`(기존 로더 문제)로 실패 — 이번 변경과 무관(v1.0.57과 동일).

## Codex 독립 검증

- PR #98 `ca8bf9f`: 핵심 브라우저 시나리오 19/19 통과. 실제 Linux `npm test`는 named test 248개 중 246개 통과·실패 0·건너뜀 2입니다. Windows의 기존 로더 실패와 별개로 확인했습니다.
- 최종 PR #99 `ea68e85814396961104ec96e8f2665a4f1e8a36d`: 잘못된 날짜/빈 날짜/유효 날짜 표시와 최종 모바일·PC 화면 7/7 통과. 두 PR 사이 앱·테스트·패키지는 날짜 표시 보완 외 동일합니다.
- requestId가 있는 합성 청구 상태도 탭·기간 변경에서 보존됨을 확인했습니다. 실제 청구 저장 서버 호출은 수행하지 않았습니다.
- 375px 실제 viewport(scale 1)와 1280px에서 시각 확인했습니다. 외부 요청 시도·페이지 런타임 오류는 없었습니다. 상세 범위는 HEALTH_RECORD_UI_QA.md 참고.

## 미검증·남은 한계

- 실제 Electron 앱 화면·실고객 데이터·청구 상태 저장 서버 경로(requestId 있는 경우)는 이번에 실행하지 않음.
- 청구 관리 탭 내부 용어(상병·약물)는 범위 밖이라 유지.

# 건강기록 UI 데스크톱 반영 — v1.0.57

기준: `origin/main` 63cf179 (v1.0.56, PR #94 병합 이후). 공개 최신 릴리스 v1.0.56 확인 → 1.0.57 patch. 의존성 변경 없음.

## 변경

- UI 계획 4단계: 조회 진행·오류 안내 통일(상세는 HEALTH_RECORD_UI_PLAN.md 4단계 결과).
- 신규 `src/renderer/src/services/health-record/healthStatusView.ts` + `test/hrStatusView.test.mjs`, `healthErrorHelp` 위임, `HealthRecordPage.tsx` 표시 변경.
- healthRecordService(150초 타임아웃·매개변수·암호화·1회용 인증·세션 종료 처리), 폴링 조건/간격, deriveEntryPhase, ResultReport, auth/DB/API/AI 변경 없음.

## 검증 (실제 실행)

- `npm run typecheck` 통과, `npm run build` 통과.
- `node --test test/hrStatusView.test.mjs test/hrCareWorkspace.test.mjs test/hrEntryPhase.test.mjs` 28 pass / 0 fail
  (timeout/network 분류·주행동, 분류 문구에 구현 설명/9시 없음, 행 행동·30일 경계(30일 열람 가능/31일 불가)·결과 없음 구분, 늦은 검색 A 응답 무시, 실패 시 목록·마지막 성공 시각 유지, 이전 실패가 최신 로딩을 뒤집지 않음).
- 검토 보완 후 `node --test test/hrStatusView.test.mjs` 10 pass / 0 fail(동일 query 10초 폴링+11초 응답 수용·로딩 해제, 61초 시뮬 응답 폐기 없음, 동일 query coalesce, A→B→A·이전 finally 가드, 실패/동기 예외 후 재시도, 연속 오류 code 초기화, 보관일수 NaN/30/31). typecheck·build 재통과.

## 독립 QA 재현 3건 보완 (진행 중 요청의 늦은 응답)

- 재현: A start 보류 → B 선택 → A completed = B 화면에 A 결과 / A invite 보류 → B 선택 → B 폼에 A 링크 / 상품 start 보류 → 상품 변경 → 새 상품 폼에 옛 결과.
- 보완(표시용만): `healthStatusView.ts`에 `createForegroundGuard`·`runForeground`·`PREV_REQUEST_NOTE` 추가. onStart/onConfirm/onInvite는 현재 작업일 때만 결과·requestId·twoWay·링크·안내·오류·configNote·busy 해제를 반영하고, 오래된 응답은 「최근 요청」 목록만 refresh. 고객·상품·입력방식 전환과 저장 결과 열기는 이전 작업을 무효화하고 busy/inviteBusy를 즉시 정리(새 고객은 바로 요청 가능). 진행 중이었으면 "이전 요청은 「최근 요청」에서 확인하세요." 한 줄 안내.
- 진행 중에는 요청 변수 입력(성함·연락처·식별번호·조회기간·인증수단·통신사·옵션)만 disabled. 고객·상품 선택과 입력방식 전환은 열어 둠. 새 클릭/확인 팝업 없음.
- 변경 없음: 서비스 호출 payload, 서버 start/confirm/invite 재호출·취소(자동 실행 없음), 매개변수·암호화·1회용 세션·150초 timeout·RLS·10초 history poll, deriveEntryPhase. PR96의 coalesce·오류/code 원자 상태·NaN 보관 가드 유지. invite 예외는 기존엔 처리되지 않았으나 이제 현재 작업이면 "링크 생성 중 오류가 발생했습니다." 표시.
- 실행한 검증: `npm run typecheck` 통과, `npm run build` 통과. `node --test test/hrForegroundGuard.test.mjs test/hrStatusView.test.mjs test/hrCareWorkspace.test.mjs test/hrEntryPhase.test.mjs` 43 pass / 0 fail. 신규 `hrForegroundGuard.test.mjs` 9건은 deferred mock으로 재현 3건 + 늦은 confirm vs 저장 결과/입력방식 전환 + 오래된 catch/finally가 새 busy·오류 미덮음 + 현재 응답 정상 반영 + 페이지 배선(전환 4곳 무효화·핸들러 3개 가드·입력 잠금)을 확인.
- 전체 `npm test`는 73 중 55 pass / 16 fail: 실패 16건은 이번에 수정하지 않은 테스트 파일(claim*·coverage*·hrSummarize·hrInsuranceEstimate 등)이 Windows에서 `import(원시 경로)`로 ERR_UNSUPPORTED_ESM_URL_SCHEME 발생 — 이 환경의 기존 로더 문제이며 이번 변경과 무관.
- 후속 Codex 독립 브라우저 QA에서 최종 앱 소스 `bcad9f70714e9bf3209428b18fc65cc2295368a0`로 20/20 통과. 아래 최종 검증 및 `HEALTH_RECORD_UI_QA.md` 참조.

## 최종 독립 브라우저 검증 (Codex, 2026-11-08 KST)

- 실제 HealthRecordPage/ResultReport·프로젝트 Tailwind, 합성 서비스 mock·외부 네트워크 차단으로 최종 소스 20/20 통과.
- 시간초과/네트워크 CTA 목록만 조회, 갱신 실패 시 기존 목록 유지, 검색 응답 경합, 새 링크/고객/상품 전환, AI 자동 호출 없음 확인.
- 진행 중 A 고객의 결과·인증 링크·옛 상품 결과가 새 화면에 붙지 않음. 오래된 finally가 새 busy를 지우지 않고 새 고객의 정상 응답은 적용됨. 저장 결과 열람·confirm/입력방식 전환 지연 응답도 확인.
- 10초 폴링 중 11초 동일 검색 응답은 단일 조회로 완료되며, 무효 날짜의 열람은 차단됨.
- **모바일 gap 해소**: 실제 innerWidth/clientWidth/visualViewport.width/scrollWidth = 375, scale = 1을 직접 측정. PC 1280px도 확인. PNG 파일 폭만으로 판단하지 않았음.
- 상세 기록은 [HEALTH_RECORD_UI_QA.md](HEALTH_RECORD_UI_QA.md) 참조. 합성 캡처 4장은 검증 환경에 보관하며 별도 공개 승인 전에는 게시하지 않음.
- 앱 구현·테스트는 Claude Code, 독립 QA와 검증 문서 정리는 Codex가 담당. 문서 정리에서 앱·테스트 코드는 변경하지 않음.

## 남은 검증 한계

- 실제 Electron 설치 실행·실고객 인증·실제 Supabase/AI 호출·실기기·스크린리더는 검증하지 않았음.
- 위 초기 '브라우저 미실행'은 최초 구현 단계의 기록이며, 핵심 실제 브라우저·모바일 검증은 후속 독립 QA에서 완료함.

---

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
  위 32/32는 PR #93 보완 전 하네스 보고입니다. 최종 모바일 화면 검증을 뜻하지 않으며, 보관하는 미리보기와 최종 검증 제한은 아래에 기록합니다.
- 미검증: 실제 Electron 앱·실제 Supabase 기준 조회·실제 AI 호출·실기기 모바일·스크린리더, 실손 입력 유지(이번 하네스에서 미확인, 마운트 구조 변경 없음).

## 보완 (PR93 리뷰 반영, 같은 v1.0.56)

- AI 패널 안내 건수를 실제 `askHealthRecordAi` 전송 기준(검수된 인수·예외만)과 일치: "AI 반영 기준 N건(검수됨 · 인수 a · 예외 b)", 검수 전은 "AI 반영에서 제외" 명시,
  매칭이 전부 검수 전이면 "AI 반영 기준 0건 · 건강기록만 요약", 부분 실패는 "성공한 자료 중 검수된 기준만 반영". 순수 helper `aiGuideNote`(guideLoadState.ts).
  보험사별 카드의 전체/검수됨/검수 전 건수 의미는 유지. AI 서비스 필터·payload·프롬프트·API·매칭 규칙 변경 없음.
- 보험사 선택 목록: `hidden` 속성만으로는 Tailwind `.flex`가 덮어 닫혀도 보이던 문제 → 열림 여부에 따라 `flex`/`hidden` 클래스로 실제 display 제어(세부 조건 목록도 동일). aria-expanded/aria-controls 유지.
- 세부 조건 펼침 state를 index → 보험사명(Set<string>)으로 귀속. 현재 선택 보험사를 옵션 목록에 포함해 예외 기준 조회 실패 시에도 확장 보험사 해제 가능.

### 보완 검증 (이전 32/32 하네스 보고와 별개)

- `npm run typecheck`, `npm run build` 통과. `node --test test/hrGuideLoadState.test.mjs` 9/9(기존 5 + aiGuideNote 4).
- Claude의 임시 esbuild + Edge headless/CDP 하네스 실행 보고(저장소 미추가, 실행 후 삭제): 실제 `ResultReport`를 합성 결과·빌드 CSS로 렌더, 기준 조회/AI/청구 저장 모듈 mock, 외부 네트워크 차단. 17/17 통과로 보고했으나, 독립 검토에서 아래 모바일 캡처 제한을 확인했습니다.
  picker 초기 computed display none·높이 0, 키보드 Enter 펼침(display flex·높이>0·aria-expanded)/재접힘, 검수 전 인수1+검수 예외1 → AI 반영 1건(인수 0·예외 1),
  카드 검수됨 1·검수 전 1 유지, 삼성화재 펼침 후 해제 시 현대해상 미펼침·재선택 후 현대해상 펼침 유지, 예외 조회 실패 후 선택된 확장 보험사 옵션 유지·해제 가능,
  부분 실패 안내(성공 소스 검수분만)·전부 검수 전 0건 안내·AI 호출 0 등을 보고했습니다. PC 1280px 미리보기는 확인했지만 최종 375px 가독성·가로 넘침은 재검증하지 못했습니다.
- 보완 후 합성 PC 1280px·인수 조회 부분 실패 PC 1280px 이미지 2장을 보관합니다: `docs/ui/health-review-pc-1280-synthetic.png`, `docs/ui/health-review-partial-failure-pc-1280-synthetic.png`.
- 독립 검토에서 새 375px PNG가 PC 레이아웃을 축소한 캡처임을 확인해 제외했습니다. 실제 앱 HTML의 viewport 설정은 정상이며 제품 회귀로 확인된 것은 아니지만, 이 캡처를 모바일 가독성 검증 증거로 사용하지 않습니다.
- 미검증: 보완 후 375px 모바일 화면, 실제 Electron 앱·실제 Supabase·실제 AI 호출·실기기·스크린리더.

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
