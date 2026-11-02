# SJ CLAIM FINDER — 진행 상황 (PROGRESS)

작업 세션: `claude/manager-contacts-excel-upload-8jd6u0` (기준 main `5beca0f`, #47).
범위: 기존 SJ-OS에 "보험금 발굴(검토 지원)" **초기 통합 버전** 구현 + 검증 + 리뷰용 변경 준비.
**하지 않은 것(지침 준수): 운영 DB 변경, main 병합/배포, 유료가입, 새 외부서비스 연결, 인증/권한 우회.**

## 1) 구현한 것
### 결정론 규칙 엔진 (핵심, 돈·지급조건 판단)
- `src/renderer/src/services/claim-finder/claimRules.ts`
  - 상태: `CONFIRMED_CONDITIONS(조건 확인·지급확정 아님) / POTENTIAL / NEED_DOCUMENTS / EXCLUDED / ALREADY_PAID`.
  - 원칙: 약관/증빙 없으면 금액 **null(미산정, 0 아님)**, KB 가입금액은 지급액으로 쓰지 않음, 청구이력 미확인은 미청구로 단정 안 함, 보장 개시/면책/감액/한도(금액·일수) 반영, **CI 주계약/선지급 중복 합산 방지(`dedupeGroup`+`sumConfirmedAmounts`)**, **수술은 이름만으로 인정 금지(검증 필요)**, **같은 날짜·기관이라도 병합 안 함**, 각 후보에 원본 대조(`sources`: json 경로/파일해시/페이지/약관 조항·버전)·`rulesVersion`·부족서류·근거 포함.
- `src/renderer/src/services/claim-finder/access.ts` — 조직/고객 소유권·동의 유효성/철회 가드(순수 로직; 서버 RLS 보조, 우회 아님).
- `src/renderer/src/services/claim-finder/adapters.ts` — 기존 데이터 → 엔진 입력 변환(무거운 의존 없이 구조적 입력):
  - 건강기록(CODEF 진료/투약 JSON) → 진료 이벤트(실제 코드에서 쓰이는 필드만 매핑, 없으면 null, 잘못된 JSON은 제외+warning).
  - 보장분석(기존 `CoverageAnalysis`) → 계약/담보(약관 미연결 → NEED_DOCUMENTS가 정상).
  - 약관(`PolicyTerm`) 연결(담보명 매칭 시 조항/버전 부여; `payRule` 자유텍스트는 지급액으로 신뢰 파싱 안 함).
- `src/renderer/src/services/claim-finder/fixtures.ts` — 합성(DEMO) 입력. **실제 HIRA/KB 포맷 미검증(내부 포맷)** 명시, 결과 isDemo=true.

### 화면
- `src/renderer/src/pages/ClaimFinderPage.tsx` — 고객+동의 → 자료연결(진료기록/보장분석/약관) → 분석 → 상태별 검토결과(필터, 근거, 필요서류, 원본 대조, 중복방지 표기, 사람 검토 상태수정·메모, DEMO 표시). "검토 전 후보 합계"는 받을 수 있는 보험금이 아님을 경고로 명시.
- 네비게이션 연결(6곳): `navigation/types.ts`, `navigation/roleAccess.ts`(STAFF_ROUTES), `components/Router.tsx`, `components/layout/Sidebar.tsx`(3 배열), `components/mobile/mobileMenu.ts`, `components/layout/MobileShell.tsx`. 라우트명 `claim-finder`, 라벨 "보험금 발굴".

### DB (파일만, 미적용)
- `supabase/migrations/20261102_claim_finder.sql` — `claim_finder_runs` + `claim_finder_reviews`, 기존 `health_record_requests` RLS 패턴(`is_owner_or_admin() or staff_id = auth.uid()`) 동일. **운영 DB 미적용.**

## 2) 검증 결과 (실제 실행)
- `npm run typecheck:web` → **통과(에러 0)**.
- `npm test`(전체) → **96/96 통과** (기존 65 + 신규 31). 무회귀.
- 신규 테스트:
  - `test/claimRules.test.mjs` (15) — 약관누락→null, 계약전→EXCLUDED, 면책→EXCLUDED, 지급이력→ALREADY_PAID, 청구이력 미확인→미청구 단정 금지, 수술 이름만→NEED_DOCUMENTS, 수술 검증→CONFIRMED+금액, 입원일당 일수한도, 감액, 약관 있으나 지급규칙 없음→null(가입금액 대체 금지), 같은날짜·기관 무병합, CI 중복합산 방지, 잘못된 입력 제외, "지급확정 아님" 근거.
  - `test/claimAccess.test.mjs` (9) — 타조직/타고객 차단, 동의 유효/철회/미동의, 종합 인가.
  - `test/claimAdapters.test.mjs` (7) — 필드 매핑·provenance, 잘못된 JSON 내성, 카테고리 분류, 보장분석→계약(약관 null), 약관 연결.
- `npm run build:web` → **성공**(23s).

## 3) 하지 않음/미완 + 사유
- **운영 DB 미적용**: 지침(운영 DB 변경 금지). 분석 결과 영구 저장/검토이력은 마이그레이션만 준비. 현재 화면 세션 로컬 보관.
- **main 병합·배포 안 함**: 리뷰용 PR(미병합)로만 제출. (배포는 main push 트리거라 자동 유발 안 됨.)
- **원본 업로드 → 자동추출(PDF/JSON) 파이프라인 미구현**: 기존 `claimExpertService`(AI 추출)·`proposalParser`(PDF)가 있으나, "AI는 추출 보조만" 원칙상 이번 초기버전은 **이미 저장된 건강기록 결과 + 보장분석**을 연결하는 결정론 경로만 구현. 업로드 추출은 어댑터 추가로 확장 가능(아래 필요자료 참고).
- **지급액 산정은 대부분 null(의도된 보수성)**: 실제 약관의 구조화된 지급규칙이 없으면 금액을 내지 않음. DEMO는 검증 경로를 보이기 위한 합성값.
- **청구/지급 이력 소스 없음**: 전용 테이블 부재 → 미확인으로 처리(미청구 단정 금지).

## 4) 완성에 필요한 "실제" 자료/약관/권한 (리뷰어 결정 필요)
1. **실제 심평원/CODEF 진료·투약 JSON 샘플**(익명화) — 어댑터 필드 매핑을 실제 포맷으로 검증. 현재는 코드에서 관측된 필드명 기준(추측 금지 원칙상 미검증 표기).
2. **실제 KB(및 타사) 보장분석/가입제안서 PDF 샘플**(익명화) — 계약별 담보·가입금액·계약일 추출 어댑터(`proposalParser` 연계).
3. **구조화된 약관 지급규칙** — 담보별 지급액/한도/면책/감액을 숫자로 검증 가능한 형태. 현재 `policy_terms.summary.clauses.payRule`은 자유텍스트라 금액 신뢰 파싱 불가(그래서 금액 null).
4. **청구/지급 이력 소스**(보험사 확인 또는 테이블) — ALREADY_PAID/미청구 판정 정확도.
5. **DB 적용 권한/승인** — `20261102_claim_finder.sql` 운영 적용 및 `is_owner_or_admin()` 존재 확인.
6. (운영 반영 시) 결과 저장 엣지함수 — 기존 패턴(`health-record-fetch` 등)과 동일하게 서버에서 소유권·동의 재검증.

## 5) 백업
작업 전 코드 백업 완료(별첨): 번들 `sj-os-backup-20261102T172059Z.bundle`(검증됨), 기준 main `5beca0f`, 영구 복구 브랜치 `backup/pre-claim-finder-20261102`. **운영 DB 백업은 미수행(코드 한정).** 상세: `docs/claim-finder/BACKUP_REPORT.md`.
