# SJ CLAIM FINDER — 설계 (DESIGN)

## 목표
고객의 **심평원 진료기록(JSON)** × **보장분석(KB 등 보유 담보)** × **약관**을 대조해
미청구 가능성이 있는 **검토 후보**와 **부족 서류**를 한국어로 보여주는 상담 지원 기능.
결과는 "검토 전 후보"이며 보험사 지급확정이 아니다.

## 핵심 설계 결정
1. **판단은 결정론, AI는 보조.** 지급조건·금액은 `claimRules.ts`(순수 함수) + 검증된 약관으로만.
   AI(기존 `claimExpertService`)는 추출/후보검색 보조로만 쓰며 이번 초기버전의 결정론 경로에는 포함하지 않는다.
   → 전 과정이 테스트 가능하고 재현 가능(규칙 버전 `CLAIM_RULES_VERSION`).
2. **보수성 우선.** 약관/증빙/지급규칙이 없으면 금액은 null(미산정), 상태는 NEED_DOCUMENTS/POTENTIAL.
   근거 없는 CONFIRMED·0원 표시·미청구 단정을 하지 않는다. KB 가입금액 ≠ 지급액.
3. **엔진은 저장소/파서와 분리.** 엔진은 "정규화 입력(TreatmentEvent/Contract/Coverage/ClaimHistory)"만 받는다.
   기존 데이터(건강기록 결과·보장분석·약관) → 입력 변환은 `adapters.ts`가 담당(구조적 입력, 무거운 의존 없음 → 단독 테스트).
   실제 HIRA/KB 필드는 추측하지 않고, 코드에서 관측된 필드만 매핑하며 미확인은 null로 둔다.
4. **원본 추적(provenance).** 모든 후보에 `sources`(json 경로/파일 해시/페이지/약관 조항·버전), 규칙 버전,
   부족 서류, 판정 근거를 포함 → 원본 대조·감사 가능.
5. **중복 방지/무병합.** CI 주계약·선지급 등은 `dedupeGroup`으로 합산 1건만(`sumConfirmedAmounts`).
   같은 날짜·기관이라도 서로 다른 진료 이벤트는 병합하지 않는다.
6. **권한/동의.** 서버(RLS/엣지함수)가 실제 경계. `access.ts`는 그 규칙을 결정론 함수로 재현해
   클라이언트 사전검증·테스트에 쓴다(우회 아님). 타 조직/타 고객 차단, 동의 유효성/철회 반영.

## 재사용한 기존 자산
- 고객: `services/commercial/customerService`(+`@shared/commercial/models` CustomerRecord), 교차기능 선택 `services/insurance-hub/insuranceHubStore`.
- 건강기록: `services/commercial/healthRecordService`(listHealthRecords/result), 테이블 `health_record_requests`(RLS 패턴 템플릿).
- 보장분석/약관: `services/commercial/coverageAnalysis`(CoverageAnalysis), `services/insurance-claim/policyTermsService`(PolicyTerm).
- 네비게이션 패턴(6곳)·Tailwind 반전 팔레트·테스트 하네스(esbuild+node:test).

## 데이터 모델(파일만, 미적용)
`supabase/migrations/20261102_claim_finder.sql`: `claim_finder_runs`(실행/결과 jsonb), `claim_finder_reviews`(사람 검토).
RLS = `is_owner_or_admin() or staff_id = auth.uid()`(기존과 동일).

## 흐름
고객 선택 + 동의 → 진료기록(완료된 건강기록 결과) 연결 / 보장분석 선택 / 약관 자동연결 →
`adapters` 변환 → `analyzeClaims` → 상태별 후보 + 근거·필요서류·원본대조 → 사람 검토.

## 한계 / 확장점
- 원본 업로드→자동추출(PDF/JSON)은 미구현(어댑터 추가로 확장; 실제 샘플 필요).
- 약관 지급규칙이 구조화돼 있지 않아 금액은 대부분 null(실제 약관 데이터 필요).
- 결과 영구저장/검토이력 서버 반영은 DB 적용 + 엣지함수(소유권·동의 재검증) 후 연결.
자세한 필요자료·검증결과는 `PROGRESS.md`.
