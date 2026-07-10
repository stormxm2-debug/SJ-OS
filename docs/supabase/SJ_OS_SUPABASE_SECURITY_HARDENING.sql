-- SJ OS — 보안 하드닝 (2026-07-10 보안 감사 후). ⚠ 라이브 DB에 즉시 적용 권장.
-- 감사에서 라이브로 검증된 CRITICAL 2건을 막는다. 관리자 정상 경로는 보존한다.
--   C1) 일반 직원이 스스로 role='owner'로 바꿔 전사 권한 탈취 (권한 상승)
--   C2) 로그인한 아무 직원이나 모든 고객의 첨부서류(주민증·의무기록·증권) 열람/삭제
-- Requires helper public.is_owner_or_admin() (SJ_OS_SUPABASE_RLS_POLICIES.sql).

-- ─────────────────────────────────────────────────────────────────────────────
-- C1. 권한 상승 차단 — profiles.role / team_id / status 는 owner/admin만 변경 가능.
--   기존 profiles_update_self 는 WITH CHECK 가 없어 role 컬럼을 막지 못했다.
--   트리거로 '민감 컬럼 변경 = 관리자만' 을 강제한다(정책이 바뀌어도 유효).
--   ※ 컬럼 REVOKE 는 쓰지 않는다 — 관리자도 authenticated 롤로 접속하므로
--     REVOKE 하면 관리자 UI의 정상 역할변경까지 막힌다. 트리거로 사용자 단위 판별.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.profiles_guard_privileged()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- coalesce(...,false): 프로필 없는 caller 등에서 is_owner_or_admin()=NULL 이면 '관리자 아님'으로.
  if not coalesce(public.is_owner_or_admin(), false) then
    if new.role   is distinct from old.role
    or new.team_id is distinct from old.team_id
    or new.status is distinct from old.status then
      raise exception '권한이 없습니다: role/team/status 는 관리자만 변경할 수 있습니다.'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard_privileged on public.profiles;
create trigger profiles_guard_privileged
before update on public.profiles
for each row execute function public.profiles_guard_privileged();

-- 자기 프로필 수정 정책에 명시적 WITH CHECK 추가 (행 id 고정). 민감 컬럼은 위 트리거가 담당.
drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- ─────────────────────────────────────────────────────────────────────────────
-- C2. customer-files 버킷 — 경로(<ownerStaffId>/…) 기준으로 본인+관리자만 접근.
--   기존 정책 customer_files_rw = (auth.uid() is not null) FOR ALL → 전 직원이
--   남의 고객 서류 열람/삭제 가능(대량 PII 유출·파괴). attendance-photos/claim-fax
--   버킷과 동일하게 폴더 첫 세그먼트 = 업로더 uid 로 스코프한다.
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists customer_files_rw on storage.objects;

create policy customer_files_read on storage.objects for select to authenticated
  using (
    bucket_id = 'customer-files'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_owner_or_admin())
  );
create policy customer_files_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'customer-files'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
create policy customer_files_update on storage.objects for update to authenticated
  using (
    bucket_id = 'customer-files'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_owner_or_admin())
  )
  with check (
    bucket_id = 'customer-files'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_owner_or_admin())
  );
create policy customer_files_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'customer-files'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_owner_or_admin())
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- (참고) 아래는 이 파일에서 자동 적용하지 않는다 — 별도 검토/승인 후 처리:
--  · H1: AI 엣지 함수(claim-expert/insurance-analysis/underwriting-expert/claim-vision/
--        jarvis-brain/meeting-brief/parse-schedule) 는 호출자 인증이 없다 → 누구나
--        anon 키로 유료 LLM을 무제한 호출(청구 폭탄·DoS). send-claim-fax/send-alimtalk
--        처럼 getUser() 검증 추가 + config.toml verify_jwt=true. (엣지 재배포 필요)
--  · L3: 이메일 자가가입이 열려 있으면 외부인도 fc로 가입 가능 → C1 트리거로
--        권한상승은 막히지만, 가입 자체를 관리자 폰 등록 흐름으로 제한 권장.
--  · M1: profiles_select 가 전 직원 열람(전화·이메일·role). 직원 매칭 기능이 의존할
--        수 있어 성급히 축소하면 UI가 깨질 수 있음 — 별도 검토.
