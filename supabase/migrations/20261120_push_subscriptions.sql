-- 웹 푸시 구독 (기기별). 브라우저/폰을 닫아도 OS 알림을 받기 위해 쓴다.
-- 한 사람이 여러 기기(PC·폰)를 쓸 수 있으므로 endpoint 단위로 저장한다.
-- RLS: 본인 구독만 보고 바꾼다. 발송은 edge function(push-send)이 service role 로 읽는다.

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

drop policy if exists push_sub_own_select on public.push_subscriptions;
create policy push_sub_own_select on public.push_subscriptions
  for select to authenticated using (user_id = auth.uid());

drop policy if exists push_sub_own_insert on public.push_subscriptions;
create policy push_sub_own_insert on public.push_subscriptions
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists push_sub_own_update on public.push_subscriptions;
create policy push_sub_own_update on public.push_subscriptions
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists push_sub_own_delete on public.push_subscriptions;
create policy push_sub_own_delete on public.push_subscriptions
  for delete to authenticated using (user_id = auth.uid());
