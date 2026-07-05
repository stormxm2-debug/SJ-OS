-- SJ OS — admin-managed phone login schema DRAFT. REVIEW before production.
-- The registered-phone list is an ENTRY GATE only; profiles.role + RLS still control
-- business data. No secrets here. Admin writes happen via owner/admin (RLS) or a
-- server Edge Function (service_role stays server-side, never in the browser).

create extension if not exists "pgcrypto";

-- Allowed staff phone numbers (the entry gate).
create table if not exists public.staff_login_accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text not null,
  normalized_phone text not null unique,   -- E.164, e.g. +8210XXXXXXXX
  role text not null check (role in ('owner','admin','team-leader','fc')),
  team_id uuid,
  status text not null default 'invited' check (status in ('invited','active','inactive','blocked')),
  password_status text not null default 'not-set'
    check (password_status in ('not-set','set','reset-requested','reset-approved')),
  profile_id uuid references public.profiles(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Password reset requests (staff-initiated; owner/admin approves).
create table if not exists public.password_reset_requests (
  id uuid primary key default gen_random_uuid(),
  normalized_phone text not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  requested_at timestamptz not null default now(),
  approved_at timestamptz,
  approved_by uuid references public.profiles(id) on delete set null,
  note text
);

create index if not exists staff_login_accounts_status_idx on public.staff_login_accounts(status);
create index if not exists password_reset_requests_status_idx on public.password_reset_requests(status);
-- normalized_phone is already UNIQUE (indexed) on staff_login_accounts.
create index if not exists password_reset_requests_phone_idx on public.password_reset_requests(normalized_phone);
