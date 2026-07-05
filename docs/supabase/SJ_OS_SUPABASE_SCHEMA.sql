-- SJ OS — Supabase schema draft (commercial staff MVP)
-- Run in the Supabase SQL Editor. REVIEW before production use.
-- Enums are modeled as text + CHECK for simplicity; tighten as needed.
-- RLS is enabled separately in SJ_OS_SUPABASE_RLS_POLICIES.sql.

-- Requires pgcrypto for gen_random_uuid() (enabled by default on Supabase).
create extension if not exists "pgcrypto";

-- profiles: one row per auth user (staff account)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  role text not null check (role in ('owner','admin','team-leader','fc')),
  team_id uuid,
  phone text,
  email text,
  status text not null default 'active' check (status in ('active','inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- teams
create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  leader_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- attendance_records
create table if not exists public.attendance_records (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.profiles(id) on delete cascade,
  type text not null check (type in ('check-in','check-out')),
  status text not null default 'normal' check (status in ('normal','late','early-leave','missing')),
  timestamp timestamptz not null default now(),
  photo_path text,
  watermark_text text,
  memo text,
  created_at timestamptz not null default now()
);

-- customers
create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  owner_staff_id uuid not null references public.profiles(id) on delete cascade,
  team_id uuid,
  name text not null,
  phone text,
  birth_date date,
  address text,
  source text,
  status text not null default 'new'
    check (status in ('new','contacted','consulting','proposal','closing','contracted','lost')),
  tags text[] not null default '{}',
  memo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- consultations
create table if not exists public.consultations (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  staff_id uuid not null references public.profiles(id) on delete cascade,
  consultation_type text not null
    check (consultation_type in ('first','follow-up','proposal','closing','aftercare')),
  status text not null default 'planned' check (status in ('planned','completed','cancelled')),
  summary text,
  next_action text,
  scheduled_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- schedule_events
create table if not exists public.schedule_events (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.profiles(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  title text not null,
  type text not null check (type in ('consultation','contract','follow-up','internal','personal')),
  starts_at timestamptz not null,
  ends_at timestamptz,
  status text not null default 'planned' check (status in ('planned','done','cancelled')),
  memo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- performance_records
create table if not exists public.performance_records (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.profiles(id) on delete cascade,
  team_id uuid,
  month text not null, -- YYYY-MM
  life_premium numeric not null default 0,
  non_life_premium numeric not null default 0,
  short_term_premium numeric not null default 0,
  total_premium numeric not null default 0,
  contract_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- notices
create table if not exists public.notices (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  content text not null,
  target_roles text[] not null default '{}',
  created_by uuid references public.profiles(id) on delete set null,
  pinned boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Helpful indexes
create index if not exists idx_attendance_staff on public.attendance_records(staff_id);
-- Attendance management integration: time/type/status filters.
create index if not exists attendance_records_timestamp_idx on public.attendance_records("timestamp" desc);
create index if not exists attendance_records_type_idx on public.attendance_records(type);
create index if not exists attendance_records_status_idx on public.attendance_records(status);
create index if not exists idx_customers_owner on public.customers(owner_staff_id);
create index if not exists idx_customers_team on public.customers(team_id);
-- Customer management integration: status + recency filters/sorts.
create index if not exists customers_status_idx on public.customers(status);
create index if not exists customers_updated_at_idx on public.customers(updated_at desc);
create index if not exists idx_consultations_customer on public.consultations(customer_id);
create index if not exists idx_consultations_staff on public.consultations(staff_id);
-- Consultation records integration: status + schedule/recency filters/sorts.
create index if not exists consultations_status_idx on public.consultations(status);
create index if not exists consultations_scheduled_at_idx on public.consultations(scheduled_at desc);
create index if not exists consultations_updated_at_idx on public.consultations(updated_at desc);
create index if not exists idx_schedule_staff on public.schedule_events(staff_id);
-- Schedule management integration: customer link + time/status/type filters.
create index if not exists schedule_events_customer_id_idx on public.schedule_events(customer_id);
create index if not exists schedule_events_starts_at_idx on public.schedule_events(starts_at);
create index if not exists schedule_events_status_idx on public.schedule_events(status);
create index if not exists schedule_events_type_idx on public.schedule_events(type);
create index if not exists idx_performance_staff_month on public.performance_records(staff_id, month);
