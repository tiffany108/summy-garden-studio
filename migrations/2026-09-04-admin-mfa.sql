-- Summy Garden Studio — two-factor authentication for the admin page
-- Run ONCE in the Supabase SQL Editor. Safe to re-run.
--
-- After the password step, the admin page emails a 6-digit code and will not
-- show any data until it is entered. Crucially the check is enforced by the
-- ADMIN APIs, not just the browser — a gate that only hides the dashboard would
-- be theatre, because /api/admin-stats would still answer a direct request made
-- with nothing but the password session.
--
-- The code is stored only as a SHA-256 hash, so a leak of this table does not
-- hand anybody a working code.

create table if not exists public.admin_mfa (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  code_hash   text not null,                     -- SHA-256 of the 6 digits + pepper
  session_token text,                            -- issued once the code is accepted
  expires_at  timestamptz not null,              -- the CODE expires (minutes)
  session_expires_at timestamptz,                -- the SESSION expires (hours)
  attempts    int not null default 0,
  consumed    bool not null default false,
  ip          text default '',
  created_at  timestamptz not null default now()
);

create index if not exists admin_mfa_user_idx on public.admin_mfa (user_id, created_at desc);
-- Session lookups happen on every admin API call, so they need to be fast.
create index if not exists admin_mfa_session_idx on public.admin_mfa (session_token) where session_token is not null;

alter table public.admin_mfa enable row level security;

-- No policies at all, on purpose. Every read and write goes through the
-- Cloudflare Functions with the service key. Nothing in a browser — not even the
-- admin's own browser — should be able to read code hashes or session tokens.

-- Housekeeping: drop rows once they can no longer be used for anything. Called
-- opportunistically by /api/admin-mfa so the table cannot grow without bound.
create or replace function public.sgs_admin_mfa_gc()
returns void language sql security definer set search_path = public as $$
  delete from public.admin_mfa
   where (session_expires_at is null and expires_at < now() - interval '1 day')
      or (session_expires_at is not null and session_expires_at < now() - interval '1 day');
$$;

revoke execute on function public.sgs_admin_mfa_gc() from anon, authenticated;
