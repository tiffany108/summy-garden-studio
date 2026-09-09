-- Summy Garden Studio — 2026-09-09
-- 1. Department on the staff roster, so HR can group and chase by team.
-- 2. A hard ceiling on how long enterprise photos may be kept.
-- Safe to run more than once.

-- ---------------------------------------------------------------- department
alter table public.org_members
  add column if not exists department text;

create index if not exists org_members_org_dept_idx
  on public.org_members (org_id, department);

-- ------------------------------------------------------------ retention cap
-- The short window is the enterprise promise, not a preference: HR must not be
-- able to quietly turn a fortnight into a year. Bring any existing row inside
-- the range first, then make it a rule the database itself enforces, so it
-- holds even if a future code path forgets to check.
update public.organisations set purge_days = 14 where purge_days is null or purge_days > 14;
update public.organisations set purge_days = 1  where purge_days < 1;

alter table public.organisations drop constraint if exists organisations_purge_days_ck;
alter table public.organisations add constraint organisations_purge_days_ck
  check (purge_days between 1 and 14);
