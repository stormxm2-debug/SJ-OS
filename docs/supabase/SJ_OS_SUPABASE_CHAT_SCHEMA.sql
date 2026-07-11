-- SJ OS — 사내 직원 메신저 (카톡형 채팅). ⚠ NOT YET APPLIED.
-- 1:1 및 그룹(팀 단톡) 대화. 핵심 보안 = 참여자 기반 RLS: 자기가 참여한 대화만
-- 조회/발신할 수 있다(대화·참여자·메시지 전부). Requires public.profiles.

create extension if not exists "pgcrypto";

-- ── 대화방 ────────────────────────────────────────────────────────────────────
create table if not exists public.chat_conversations (
  id uuid primary key default gen_random_uuid(),
  title text,                       -- 그룹명(1:1은 null → 상대 이름으로 표시)
  is_group boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  last_message_preview text
);
create index if not exists chat_conversations_recent_idx on public.chat_conversations (last_message_at desc);

-- ── 참여자 ────────────────────────────────────────────────────────────────────
create table if not exists public.chat_participants (
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  last_read_at timestamptz,         -- 안읽음 계산용
  joined_at timestamptz not null default now(),
  primary key (conversation_id, profile_id)
);
create index if not exists chat_participants_profile_idx on public.chat_participants (profile_id);

-- ── 메시지 ────────────────────────────────────────────────────────────────────
create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  sender_id uuid references public.profiles(id) on delete set null,
  body text not null,
  created_at timestamptz not null default now()
);
create index if not exists chat_messages_conv_idx on public.chat_messages (conversation_id, created_at);

-- ── 멤버십 헬퍼 (SECURITY DEFINER — RLS 재귀 방지) ─────────────────────────────
create or replace function public.is_chat_member(conv uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.chat_participants p
    where p.conversation_id = conv and p.profile_id = auth.uid()
  )
$$;

-- ── RLS ───────────────────────────────────────────────────────────────────────
alter table public.chat_conversations enable row level security;
alter table public.chat_participants  enable row level security;
alter table public.chat_messages      enable row level security;

-- 대화방: 참여자만 조회. 생성=본인이 만든 것만. 수정(last_message 등)=참여자.
create policy chat_conv_select on public.chat_conversations for select to authenticated
  using ( public.is_chat_member(id) );
create policy chat_conv_insert on public.chat_conversations for insert to authenticated
  with check ( created_by = auth.uid() );
create policy chat_conv_update on public.chat_conversations for update to authenticated
  using ( public.is_chat_member(id) ) with check ( public.is_chat_member(id) );

-- 참여자: 같은 대화 참여자만 목록 조회. 추가=방 생성자이거나 본인 자신(합류).
-- 본인 행 수정(읽음시각)/삭제(나가기)만 가능.
create policy chat_part_select on public.chat_participants for select to authenticated
  using ( public.is_chat_member(conversation_id) );
create policy chat_part_insert on public.chat_participants for insert to authenticated
  with check (
    profile_id = auth.uid()
    or exists (select 1 from public.chat_conversations c where c.id = conversation_id and c.created_by = auth.uid())
  );
create policy chat_part_update_self on public.chat_participants for update to authenticated
  using ( profile_id = auth.uid() ) with check ( profile_id = auth.uid() );
create policy chat_part_delete_self on public.chat_participants for delete to authenticated
  using ( profile_id = auth.uid() );

-- 메시지: 참여자만 조회/발신. 발신자는 본인(sender_id=auth.uid()) 강제. 수정 없음.
create policy chat_msg_select on public.chat_messages for select to authenticated
  using ( public.is_chat_member(conversation_id) );
create policy chat_msg_insert on public.chat_messages for insert to authenticated
  with check ( public.is_chat_member(conversation_id) and sender_id = auth.uid() );

-- 실시간 (새 메시지 즉시 수신 + 방 목록 갱신)
alter publication supabase_realtime add table public.chat_messages;
alter publication supabase_realtime add table public.chat_conversations;

-- Do NOT add a public/anon select policy — 사내 대화는 로그인 참여자 전용.
