-- Summy Garden Studio — failed sign-in tracking and account lockout
-- Run ONCE in the Supabase SQL Editor. Safe to re-run.
--
-- HONEST SCOPE. Sign-in happens in the browser, directly against Supabase, so
-- this lockout is enforced by the sign-in form rather than by the auth server.
-- It stops a person guessing at a keyboard — a shared laptop, a colleague, a
-- stolen phone — and it gives you a record of every attempt. It does NOT stop
-- somebody scripting straight at Supabase's API, which bypasses the form.
--
-- Enforcing it properly would need Supabase's password_verification_attempt
-- hook, which is Teams plan and up. Supabase's own per-IP rate limiting still
-- applies underneath this regardless.
--
-- Emails are stored lowercased. Rows are keyed on email rather than user_id
-- because a failed attempt often means the address does not exist at all.

create table if not exists public.login_attempts (
  email        text primary key,
  fails        int not null default 0,
  locked_until timestamptz,
  last_fail_at timestamptz,
  last_ip      text default '',
  updated_at   timestamptz not null default now()
);

create index if not exists login_attempts_locked_idx
  on public.login_attempts (locked_until) where locked_until is not null;

alter table public.login_attempts enable row level security;

-- No member-facing policies. Everything goes through /api/login-guard with the
-- service key: if the browser could write here it could clear its own lockout,
-- and if it could read here it could enumerate which emails have accounts.
drop policy if exists "admin reads login attempts" on public.login_attempts;
create policy "admin reads login attempts"
  on public.login_attempts for select to authenticated
  using ((auth.jwt()->>'email') = 'tiffany123@hotmail.com.hk');

-- ---------------------------------------------------------------------------
-- Atomic helpers. Read-modify-write from a Worker would lose increments when
-- two attempts land together, which is exactly what a brute-force run does.
-- ---------------------------------------------------------------------------

-- Record one failure and lock the account once it reaches p_max.
create or replace function public.sgs_login_fail(p_email text, p_ip text default '',
                                                 p_max int default 6, p_hours int default 24)
returns table (out_fails int, out_locked_until timestamptz)
language plpgsql security definer set search_path = public as $fn$
declare v_fails int;
begin
  insert into public.login_attempts (email, fails, last_fail_at, last_ip, updated_at)
  values (lower(p_email), 1, now(), p_ip, now())
  on conflict (email) do update
    set fails = case
                  -- A lapsed lock starts the count over rather than leaving the
                  -- next single mistake to re-lock the account immediately.
                  when public.login_attempts.locked_until is not null
                   and public.login_attempts.locked_until < now() then 1
                  else public.login_attempts.fails + 1
                end,
        last_fail_at = now(), last_ip = p_ip, updated_at = now(),
        locked_until = case
                  when public.login_attempts.locked_until is not null
                   and public.login_attempts.locked_until < now() then null
                  else public.login_attempts.locked_until
                end
  returning fails into v_fails;

  if v_fails >= p_max then
    update public.login_attempts
       set locked_until = now() + (p_hours || ' hours')::interval, updated_at = now()
     where email = lower(p_email) and (locked_until is null or locked_until < now());
  end if;

  return query
    select fails, locked_until from public.login_attempts where email = lower(p_email);
end $fn$;

-- Clear the record: a correct password, a completed reset, or an admin unlock.
create or replace function public.sgs_login_clear(p_email text)
returns void language sql security definer set search_path = public as $fn$
  delete from public.login_attempts where email = lower(p_email);
$fn$;

revoke execute on function public.sgs_login_fail(text, text, int, int) from anon, authenticated;
revoke execute on function public.sgs_login_clear(text) from anon, authenticated;
