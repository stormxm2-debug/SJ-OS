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
6. **권한/동의 — 서버가 실제 경계.** `access.ts`(순수 함수)는 **사전검증일 뿐 경계가 아니다**.
   실제 경계는 RLS 정책 + 쓰기시점 검증 함수(`claim_finder_run_link_ok`)다: 클라이언트가 staff_id 를
   자기 것으로 넣어도, 본인 소유·유효 동의된 건강기록 요청과 **고객이 일치하지 않으면 DB가 insert 를 거부**한다.
   reviews 는 `run_id` 소유를 확인(교차 run 리뷰 차단). → `test/claim_finder_rls.sh` 가 일회용 Postgres 에
   RLS 를 적용해 교차 고객/직원 차단을 **실제로** 검증(프런트 가드 테스트와 구별). 단 합성 스키마라 운영 호환성 미보장.
7. **원본 수집(ingest)은 추측 금지·안전 비활성.** `ingest.ts` 는 형식/크기 검증 + 원본 해시(provenance) +
   JSON 구조적 파싱(어댑터 재사용). PDF 는 **자동 담보/금액 추출을 하지 않고** 페이지 원문만 제공(사람 확인·입력).
   PDF 추출기(pdfjs)는 DI 로 주입하며, 미주입 시 "비활성" 으로 명확히 보고(조용히 성공 금지). 실포맷 정확도 미검증.
8. **UI 상태 위생은 순수 reducer(`uiState.ts`) + 세대 가드(`asyncGuard.ts`).** 고객 변경(외부 hub 포함)/동의 철회/DEMO 전환 시
   결과·검토메모·업로드·저장상태 초기화. 저장/검토는 **결과 scope 세대**를 캡처해 늦은 완료를 폐기하고,
   저장은 **분석 당시 입력 스냅샷**으로 수행(라이브 값 금지) — 입력이 바뀌면 결과 무효화. 브라우저 E2E 로 경쟁 상태 검증.

## 재사용한 기존 자산
- 고객: `services/commercial/customerService`(+`@shared/commercial/models` CustomerRecord), 교차기능 선택 `services/insurance-hub/insuranceHubStore`.
- 건강기록: `services/commercial/healthRecordService`(listHealthRecords/result), 테이블 `health_record_requests`(RLS 패턴 템플릿).
- 보장분석/약관: `services/commercial/coverageAnalysis`(CoverageAnalysis), `services/insurance-claim/policyTermsService`(PolicyTerm).
- 네비게이션 패턴(6곳)·Tailwind 반전 팔레트·테스트 하네스(esbuild+node:test).

## 데이터 모델(파일만, 미적용)
`supabase/migrations/20261102_claim_finder.sql`: `claim_finder_runs`(실행/결과 jsonb), `claim_finder_reviews`(사람 검토).
RLS select/update/delete = `is_owner_or_admin() or staff_id = auth.uid()`. insert 는 강화:
- 공통 `claim_finder_run_valid`(DEMO 규칙 포함)를 runs SELECT/INSERT/UPDATE(using+with check)에 동일 적용 → 동의 철회 후 읽기·수정·리뷰 차단.
- 불변 필드(staff_id/customer_id/health_record_request_id/is_demo)는 BEFORE UPDATE 트리거로 변경 금지.
- reviews: `staff_id=auth.uid()` + `claim_finder_run_accessible(run_id)`(부모 run 접근+유효).
- `health_record_request_id` FK **on delete cascade**(원본 건강기록 삭제 시 파생 run·검토 삭제 = 프라이버시). set null 은 FK UPDATE 가 불변 트리거와 충돌해 삭제가 막히므로 쓰지 않음(격리 DB 로 확인).
⚠️ 운영 스키마(status enum·consent_at·customers) 미확인 → 적용 전 재확인(미확인 시 fail-closed).

## 흐름
고객 선택 + 동의 → 진료기록(완료된 건강기록 결과) 연결 / 보장분석 선택 / 약관 자동연결 →
`adapters` 변환 → `analyzeClaims` → 상태별 후보 + 근거·필요서류·원본대조 → 사람 검토.

## 한계 / 확장점
- 원본 업로드→자동추출(PDF/JSON)은 미구현(어댑터 추가로 확장; 실제 샘플 필요).
- 약관 지급규칙이 구조화돼 있지 않아 금액은 대부분 null(실제 약관 데이터 필요).
- 결과 영구저장/검토이력 서버 반영은 DB 적용 + 엣지함수(소유권·동의 재검증) 후 연결.
자세한 필요자료·검증결과는 `PROGRESS.md`.
