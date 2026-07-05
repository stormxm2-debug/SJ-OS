-- SJ OS — announcements schema DRAFT. REVIEW before production.
-- Owner/admin author; staff read published+targeted rows (enforced by RLS).
-- Run AFTER the base schema (profiles/teams) + admin phone login schema.

create extension if not exists "pgcrypto";

create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  priority text not null default 'normal' check (priority in ('normal','important','urgent')),
  target_type text not null default 'all' check (target_type in ('all','role','team')),
  target_role text check (target_role in ('owner','admin','team-leader','fc')),
  target_team_id uuid references public.teams(id) on delete set null,
  status text not null default 'draft' check (status in ('draft','published','hidden','archived')),
  pinned boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.announcement_reads (
  id uuid primary key default gen_random_uuid(),
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  read_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (announcement_id, profile_id)
);

create index if not exists announcements_status_idx on public.announcements(status);
create index if not exists announcements_target_type_idx on public.announcements(target_type);
create index if not exists announcements_target_role_idx on public.announcements(target_role);
create index if not exists announcements_target_team_id_idx on public.announcements(target_team_id);
create index if not exists announcements_pinned_idx on public.announcements(pinned);
create index if not exists announcements_published_at_idx on public.announcements(published_at desc);
create index if not exists announcement_reads_announcement_id_idx on public.announcement_reads(announcement_id);
create index if not exists announcement_reads_profile_id_idx on public.announcement_reads(profile_id);
