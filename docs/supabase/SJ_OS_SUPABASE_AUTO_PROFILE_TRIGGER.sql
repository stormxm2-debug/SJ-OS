-- SJ OS — auto-create profile on auth signup + bootstrap first owner.
-- Applied to project kmjnluubjgyxkppxxjel (2026-07-07).
-- The FIRST auth user ever becomes 'owner'; everyone after defaults to 'fc'.
-- Run AFTER the base schema (profiles) + RLS helpers.

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_role text;
  v_name text;
begin
  if not exists (select 1 from public.profiles where role = 'owner') then
    v_role := 'owner';
  else
    v_role := 'fc';
  end if;
  v_name := coalesce(
    nullif(new.raw_user_meta_data->>'name', ''),
    nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
    '직원'
  );
  insert into public.profiles (id, name, role, email, status)
  values (new.id, v_name, v_role, new.email, 'active')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill any pre-existing auth users without a profile (first → owner).
insert into public.profiles (id, name, role, email, status)
select u.id,
       coalesce(nullif(split_part(coalesce(u.email,''),'@',1),''), '직원'),
       case when not exists (select 1 from public.profiles where role='owner')
                 and u.id = (select id from auth.users order by created_at asc limit 1)
            then 'owner' else 'fc' end,
       u.email,
       'active'
from auth.users u
where not exists (select 1 from public.profiles p where p.id = u.id)
on conflict (id) do nothing;
