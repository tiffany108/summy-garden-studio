-- Summy Garden Studio — tester accounts generate without spending credits.
-- (Already applied to production on 20 Jul 2026; kept here as the record.)

alter table public.profiles add column if not exists is_tester boolean not null default false;

create or replace function public.consume_credit(uid uuid)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare remaining int;
begin
  -- tester accounts generate for free: return current credits untouched
  select credits into remaining from public.profiles where id = uid and is_tester;
  if remaining is not null then return remaining; end if;
  update public.profiles set credits = credits - 1 where id = uid and credits > 0 returning credits into remaining;
  if remaining is null then return -1; end if;
  return remaining;
end; $function$;

-- flag the admin account as tester (repeat for any future tester by email)
update public.profiles set is_tester = true, credits = 5
where id = (select id from auth.users where email = 'tiffany123@hotmail.com.hk');
