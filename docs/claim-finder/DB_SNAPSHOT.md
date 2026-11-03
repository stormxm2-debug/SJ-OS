# SJ CLAIM FINDER — DB 적용 전 스냅샷 / 백업 기록

프로젝트: Supabase `kmjnluubjgyxkppxxjel` (ap-northeast-2). 기록 시각: 2026-11-03.
목적: `20261102_claim_finder.sql`(additive) 적용 전, **영향 범위·현재 정의·롤백**을 분리 기록.

## 0) 데이터 백업 vs 스키마/정책 백업 — **분리**
- **DB 데이터 백업: 이 세션에서 수행하지 않음(수행 불가).** MCP 로는 데이터 덤프/백업 트리거를 할 수 없다.
  Supabase 의 자동 백업(일일/PITR)은 **플랜·설정에 따름** — 소유자가 대시보드(Database → Backups)에서
  보존 주기/PITR 활성 여부를 **직접 확인**해야 한다. "DB 백업 완료" 라고 주장하지 않는다.
- **스키마/정책 백업(아래): 이 문서가 그 역할.** 적용은 **additive 전용**이라 기존 객체를 바꾸지 않으므로,
  롤백은 "새로 만든 claim_finder_* 객체를 DROP" 하면 원상복구된다(§3).

## 1) 적용 전 상태(메타데이터로 확인 — 실고객 데이터 미조회)
- `public.claim_finder_runs`, `public.claim_finder_reviews` : **존재하지 않음**(additive CREATE 안전).
- `public.claim_finder_run_link_ok/ _valid/ _accessible/ _runs_guard` : 존재하지 않음(신규).
- 의존 객체(이미 존재, **변경하지 않음**):
  - `auth.users` ✔ / `public.health_record_requests` ✔ (RLS on) / `public.customers` ✔ (RLS on)
  - `public.is_owner_or_admin()` = `select public.current_user_role() in ('owner','admin')` (SQL, SECURITY DEFINER)
  - `public.current_user_role()` = `select role from public.profiles where id = auth.uid()` (SQL, SECURITY DEFINER)

### health_record_requests (마이그레이션 가정과 일치 확인)
- status CHECK = `('draft','awaiting_auth','consented','fetching','completed','failed','expired')`
- 컬럼: `id uuid`, `staff_id uuid default auth.uid()`, `customer_id uuid`, `consent_at timestamptz`, `status text`, `result jsonb` …
- 정책(authenticated): select/update/delete `is_owner_or_admin() OR staff_id = auth.uid()`, insert check `staff_id = auth.uid()`.
  → claim_finder 의 동의·소유 앵커 가정과 정확히 일치.

### customers (참고 — 변경하지 않음)
- 소유 컬럼 `owner_staff_id uuid NOT NULL`, `team_id uuid`. RLS: owner/admin/team-leader 패턴.
- claim_finder 는 customers 를 직접 수정/참조하지 않고, **health_record_requests 행(동의 앵커)**을 통해 고객 일치를 간접 검증한다.

## 2) 적용하는 변경(additive 전용)
`supabase/migrations/20261102_claim_finder.sql`:
- CREATE TABLE IF NOT EXISTS `claim_finder_runs`, `claim_finder_reviews` (+ 인덱스, RLS enable).
- CREATE OR REPLACE FUNCTION `claim_finder_run_link_ok/_valid/_accessible/_runs_guard`(신규 이름 — 기존 함수 덮어쓰지 않음).
- CREATE POLICY (claim_finder_* 테이블에만), CREATE TRIGGER (claim_finder_runs 에만).
- 기존 테이블/정책/함수/데이터 **변경·삭제 없음**. 권한 완화 없음. 새 비밀키 없음.

## 3) 롤백(원상복구) 스크립트
적용 후 되돌리려면(기존 객체는 건드리지 않았으므로 아래만 삭제하면 완전 원복):
```sql
drop table if exists public.claim_finder_reviews cascade;
drop table if exists public.claim_finder_runs cascade;  -- 트리거/정책 함께 삭제
drop function if exists public.claim_finder_run_accessible(uuid);
drop function if exists public.claim_finder_run_valid(boolean, uuid, uuid);
drop function if exists public.claim_finder_run_link_ok(uuid, uuid);
drop function if exists public.claim_finder_runs_guard();
```

## 4) 한계 / 미검증
- 실제 고객/의료 데이터로의 정확도는 **미검증**(합성 fixture 로만 검증).
- 데이터 백업은 미수행(§0). 운영 적용 결과는 적용 섹션(PROGRESS)의 "실제 적용 여부" 로 보고.
