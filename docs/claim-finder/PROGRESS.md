# SJ CLAIM FINDER — 진행 상황 (PROGRESS)

작업 세션: `claude/manager-contacts-excel-upload-8jd6u0` (기준 main `5beca0f`, #47). PR #48.
범위: 기존 SJ-OS에 "보험금 발굴(검토 지원)" **초기 통합 버전** + 리뷰 후속 하드닝(v0.2).
**하지 않은 것(지침 준수): 운영 DB 변경/조회, main 병합/운영 배포, 유료가입, 새 외부서비스 연결, 인증/권한 우회.**

## 0) PR #48 리뷰 후속(v0.2) — 요점별 처리
리뷰 6개 항목을 모두 반영하고 각 항목에 회귀 테스트를 추가했다. 전부 실제 실행으로 검증.

1. **CONFIRMED 과확정 수정(입원/진단/수술)** — `claimRules.ts`
   - 외래(통원일수>1)를 입원으로 보던 로직 제거. 입원일당은 `treatType==='입원'` 또는 `inpatientVerified===true` + `admissionDays`가 있을 때만 관련 판정, 확정은 **입원 증빙(inpatientVerified)** 필요.
   - 진단비는 진단명만으로 CONFIRMED 안 됨 → `conditionVerified`(사람/증빙 검증) 필요.
   - 약관 ID(clauseId) 하나만으로 "조건 검증 완료" 아님 → `fullyVerified = 약관연결 && 근거 && conditionVerified && eligibilityVerified` 일 때만 CONFIRMED(금액 있으면), 금액 null이면 POTENTIAL, 그 외 NEED_DOCUMENTS.
2. **날짜/숫자 검증 누락 수정**
   - `isValidYmd`: YYYYMMDD 정규식 + **달력상 불가능한 날짜(Date 왕복)** 거부.
   - `eligibility`: 보장 **개시/종료/면책/대기(waitingDays)** 중 하나라도 미확인·무효면 정상조건으로 보지 않음(→ NEED_DOCUMENTS). 종료일 경과/개시 전/면책기간 내는 EXCLUDED.
   - `nn`/`ratio01`: NaN·Infinity·음수·범위 밖 비율은 null 처리, 잘못된 감액 규칙은 건너뜀.
3. **ALREADY_PAID 엄격화** — 검증된 이력 + `outcome==='paid'` + **동일 treatmentEventId** 일치일 때만. 같은 날짜라도 사건 식별 불일치/거절·부지급은 지급완료로 보지 않음.
4. **서버 경계(SQL/RLS) 강화** — `supabase/migrations/20261102_claim_finder.sql`(미적용)
   - `claim_finder_reviews.insert`: `run_id` 가 **호출자가 접근 가능한 run** 인지 검증(교차 run 리뷰 차단).
   - `claim_finder_runs.insert`: 쓰기시점 검증 함수 `claim_finder_run_link_ok(hr_request_id, customer_id)` — 연결한 건강기록 요청이 **본인 소유/관리자** + **유효 동의(consent_at·status)** + **고객 일치**일 때만 허용(클라이언트 위조 불가). DEMO run 은 실고객/요청 연결 금지. `health_record_request_id` FK 추가.
   - ⚠️ **운영 스키마 미확인**: 본 세션은 운영 DB 를 조회하지 않았다. `health_record_requests` 의 status enum·consent_at·`customers` 소유권 구조가 가정과 일치하는지 **적용 전 재확인 필요**(미확인 시 fail-closed = 연결 거부).
   - **실제 서버 경계 테스트**(프런트 가드 아님): `test/claim_finder_rls.sh` + `test/sql/*` — 운영과 **완전히 분리된 일회용 Postgres** 에 마이그레이션 RLS 를 적용해 교차 고객/직원 접근 12 시나리오를 실제 차단/허용 검증. 합성 격리 스키마이므로 **운영 호환성은 보장하지 않음**.
5. **원본 수집(업로드/파싱/저장) 기반** — `ingest.ts` + `pdfExtractor.ts`
   - 형식(JSON/PDF, 내용 스니핑 우선)·크기 검증, 원본 **SHA-256 해시(provenance)**, JSON 은 어댑터 재사용(관측 필드만, 추측 금지), PDF 는 **자동 담보 추출 안 함** — 페이지 원문만 제공(사람 확인/입력). 지원 안 되는 구조는 명시적 오류.
   - **미설정 시 안전 비활성**: PDF 추출기(pdfjs) 미주입이면 "비활성" 으로 명확히 보고(조용히 성공 금지) — DI 구조로 코어는 pdfjs 없이 단독 테스트.
   - **실제 HIRA/KB 포맷 정확도는 미검증**(실 샘플 확보 전). 합성 입력으로 end-to-end 검증(`test/claimIngest.test.mjs`).
6. **UI 상태 위생 + 전체 점검** — `uiState.ts`(순수 reducer) + `ClaimFinderPage.tsx`
   - **고객 변경(외부 hub 변경 포함)/동의 철회/DEMO 전환** 시 이전 고객의 결과·검토메모·DEMO·동의가 남지 않도록 reducer 가 초기화. 회귀 테스트 `test/claimUiState.test.mjs`.
   - 전체 점검: `typecheck:web`·`typecheck:node`·`build:web`·`npm test` 모두 실행(아래 2).

## 1) 구현한 것(파일)
- 엔진: `services/claim-finder/claimRules.ts`(v0.2.0-demo, 상태·보수성·중복방지·검증 게이트), `access.ts`(순수 소유/동의 가드 — 사전검증, 경계 아님), `adapters.ts`(기존 데이터→입력, 입원일수/통원일수 분리·입원 미확정 기본), `fixtures.ts`(DEMO), `uiState.ts`(결과 수명주기 reducer), `ingest.ts`(원본 수집 코어), `pdfExtractor.ts`(pdfjs 래퍼).
- 화면: `pages/ClaimFinderPage.tsx` — 고객+동의 → 자료연결 → (원본 파일 점검·선택) → 분석 → 상태별 검토결과(필터·근거·필요서류·원본대조·중복방지·사람검토·DEMO·합계경고).
- 네비 연결(6곳): `navigation/types.ts`, `navigation/roleAccess.ts`, `components/Router.tsx`, `components/layout/Sidebar.tsx`, `components/mobile/mobileMenu.ts`, `components/layout/MobileShell.tsx`. 라우트 `claim-finder`, 라벨 "보험금 발굴".
- DB(파일만, 미적용): `supabase/migrations/20261102_claim_finder.sql`.

## 2) 검증 결과 (실제 실행)
- `npm run typecheck:web` → **통과(0)**. `npm run typecheck:node` → **통과(0)**.
- `npm run build:web` → **성공**(~24s).
- `npm test`(전체 `node --test test/*.test.*`) → **123/123 통과**, 무회귀.
  - 신규/갱신: `claimRules.test.mjs`(39, v0.2 규칙), `claimAccess.test.mjs`(9), `claimAdapters.test.mjs`(입원/통원 분리 반영), `claimIngest.test.mjs`(11), `claimUiState.test.mjs`(7), `claimFinderRls.test.mjs`(1 — 실 Postgres RLS 래퍼; initdb 없으면 스킵).
- 서버 경계 RLS 실검증: `bash test/claim_finder_rls.sh` → **12/12 시나리오 통과**(합성 격리 Postgres, 운영 미접속).

## 3) 미완/보류 + 사유
- **운영 DB 미적용·미조회**: 지침. 저장/검토이력 영구화는 마이그레이션+(저장 시) supabase JWT 경로(RLS 강제)로 연결. 현재는 화면 세션 로컬 보관.
- **운영 스키마 미확인 항목**(적용 전 확인 필요): `health_record_requests.status` enum 값, `consent_at`, `customers` 소유 컬럼, `is_owner_or_admin()` 정의. 미확인 → fail-closed.
- **원본 자동추출 정확도 미검증**: 실 심평원 JSON/KB PDF 샘플 확보 시 어댑터로 교체. 현재 foundation 은 합성 검증만.
- **지급액 산정 대부분 null(의도된 보수성)**: 구조화된 약관 지급규칙 데이터 필요(`payRule` 자유텍스트는 금액 신뢰 파싱 안 함).
- **청구/지급 이력 소스 없음** → 미확인 처리(미청구 단정 금지).
- **브라우저 e2e(인증 포함) 미수행**: 운영 접속/계정 없음. 상태 위생은 순수 reducer 회귀 테스트로 결정론 검증(브라우저 전체 플로우 자동화는 미수행으로 명시).

## 4) 배포/PR 상태 (정확히)
- **운영 배포 없음**: 운영 배포는 `main` push 시 `deploy-web.yml`(Cloudflare Pages) 로만 일어난다. main 병합/배포는 하지 않았다.
- **preview 배포는 발생함**: PR #48(피처 브랜치)에 대해 GitHub PR 봇의 **Netlify/Cloudflare preview 자동배포가 생성**된다. 즉 "main 미병합 = 운영 배포 없음" 은 맞지만 **"배포가 전혀 없다"는 아니다** — 리뷰용 preview URL 은 존재할 수 있다(민감 데이터 입력 금지, 합성/DEMO 만 확인용).

## 5) 완성에 필요한 실제 자료/권한 (리뷰어 결정)
1. 익명화된 심평원/CODEF 진료·투약 JSON 샘플 → JSON 어댑터 실포맷 검증.
2. 익명화된 KB(및 타사) 보장분석/제안서 PDF 샘플 → PDF 담보 매핑(사람 확인 UI 확장).
3. 구조화된 약관 지급규칙(담보별 금액/한도/면책/감액) → 금액 산정.
4. 청구/지급 이력 소스 → ALREADY_PAID/미청구 정확도.
5. DB 적용 권한 + 운영 스키마 확인(위 미확인 항목) → 마이그레이션 적용 전 검증.
6. (저장 연결 시) 서버 재검증은 RLS 가 1차 경계. 필요 시 엣지함수로 defense-in-depth 추가.

## 6) 백업
작업 전 코드 백업 완료(별첨): 번들 `sj-os-backup-20261102T172059Z.bundle`(검증됨), 기준 main `5beca0f`, 영구 복구 브랜치 `backup/pre-claim-finder-20261102`. **운영 DB 백업은 미수행(코드 한정).** 상세: `docs/claim-finder/BACKUP_REPORT.md`.
