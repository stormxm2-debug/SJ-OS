-- 같은 기기(브라우저)에서 다른 계정으로 로그인해 알림을 켜면, 그 기기의 푸시 구독을
-- 지금 로그인한 사용자에게 넘긴다. 구독 endpoint 가 unique 인데 RLS 로 남의 행을
-- 수정할 수 없어 "서버에 알림 구독을 저장하지 못했습니다"가 나던 문제 해결.
-- 본인 인증(auth.uid())된 사용자만 호출 가능, 자기 이름으로만 저장한다.
create or replace function public.claim_push_subscription(
  p_endpoint text,
  p_p256dh text,
  p_auth text,
  p_user_agent text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  if coalesce(p_endpoint, '') = '' or coalesce(p_p256dh, '') = '' or coalesce(p_auth, '') = '' then
    raise exception 'invalid subscription';
  end if;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent, last_seen_at)
  values (v_uid, p_endpoint, p_p256dh, p_auth, left(p_user_agent, 200), now())
  on conflict (endpoint) do update
    set user_id = excluded.user_id,
        p256dh = excluded.p256dh,
        auth = excluded.auth,
        user_agent = excluded.user_agent,
        last_seen_at = now();
end;
$$;

revoke all on function public.claim_push_subscription(text, text, text, text) from public, anon;
grant execute on function public.claim_push_subscription(text, text, text, text) to authenticated;
