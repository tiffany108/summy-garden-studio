-- Summy Garden Studio — enterprise tenancy (phase 1 of the enterprise portal)
--
-- A company buys seats. Its staff each upload their own photo and shoot against
-- the backgrounds that company approved. Nothing here charges a credit: the
-- company pays by subscription, so org shoots skip consume_credit entirely.
--
-- RETENTION DIFFERS FROM THE CONSUMER SIDE. Consumer photos live 180 days
-- (2026-09-07-storage-usage.sql). Enterprise photos are deleted a short window
-- after delivery — purge_days below, default 14 — and the unpicked renders go
-- as soon as the member chooses. The purge job itself lands in phase 4; these
-- columns exist now so the data is shaped for it from the first row written.

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------
create table if not exists public.organisations (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  slug           text not null unique,            -- portal path: /team/acme-coffee
  seats          int  not null default 0,
  status         text not null default 'trial',   -- trial | active | paused | ended
  purge_days     int  not null default 14,        -- days from delivery to deletion
  bg_policy      text not null default 'choice',  -- choice | primary_locked
  daily_shoot_cap int not null default 3,         -- per member, per day; stops one
                                                  -- employee burning the API budget
  logo_path      text not null default '',
  stripe_sub     text,
  created_at     timestamptz not null default now()
);

create table if not exists public.org_backgrounds (
  org_id     uuid not null references public.organisations(id) on delete cascade,
  scene_id   text not null,                       -- same scene library the consumer studio uses
  is_primary bool not null default false,
  sort       int  not null default 0,
  primary key (org_id, scene_id)
);

create table if not exists public.org_members (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organisations(id) on delete cascade,
  email        text not null,
  name         text not null default '',
  staff_ref    text not null default '',          -- their employee id — the export filename
  user_id      uuid references auth.users(id) on delete set null,
  status       text not null default 'invited',
  -- The legal basis for the whole product. Set by the member's own action, never
  -- by an admin, never defaulted. generate.js refuses to shoot while it is null.
  consent_at   timestamptz,
  invited_at   timestamptz not null default now(),
  reminded_at  timestamptz,
  delivered_at timestamptz,                       -- starts the purge clock
  purged_at    timestamptz,                       -- kept after deletion, as proof
  unique (org_id, email)
);
create index if not exists org_members_user_idx on public.org_members (user_id);

create table if not exists public.org_admins (
  org_id     uuid not null references public.organisations(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

-- What was deleted, when. No image data — just enough to answer "prove you
-- deleted it", which is the question that follows every contract ending.
create table if not exists public.org_deletions (
  id        uuid primary key default gen_random_uuid(),
  org_id    uuid not null references public.organisations(id) on delete cascade,
  member_id uuid,                                 -- null for whole-org purges
  reason    text not null,                        -- window_expired | leaver | contract_end | unpicked
  photos    int  not null default 0,
  at        timestamptz not null default now()
);

-- Tie a stored photo to the company that paid for it. Null = a consumer shoot,
-- which keeps every existing row correct without a backfill.
alter table public.headshots
  add column if not exists org_id uuid references public.organisations(id) on delete set null;
create index if not exists headshots_org_idx on public.headshots (org_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 2. Membership helpers
-- ---------------------------------------------------------------------------
-- security definer on purpose: a policy on org_members that itself queries
-- org_members recurses forever. These bypass RLS to break that loop. They only
-- ever answer a yes/no about the CALLER, so exposing them is safe.
create or replace function public.sgs_org_admin_of(p_org uuid)
returns boolean language sql security definer stable set search_path to 'public' as $function$
  select exists (select 1 from public.org_admins a
                  where a.org_id = p_org and a.user_id = auth.uid());
$function$;

create or replace function public.sgs_org_member_of(p_org uuid)
returns boolean language sql security definer stable set search_path to 'public' as $function$
  select exists (select 1 from public.org_members m
                  where m.org_id = p_org and m.user_id = auth.uid());
$function$;

-- ---------------------------------------------------------------------------
-- 3. Row-level security
-- ---------------------------------------------------------------------------
-- Reads only. Every write goes through the Worker's service key, so there are
-- deliberately no insert/update/delete policies: authenticated callers cannot
-- create an organisation, add themselves as an admin, or set their own consent.
alter table public.organisations  enable row level security;
alter table public.org_backgrounds enable row level security;
alter table public.org_members    enable row level security;
alter table public.org_admins     enable row level security;
alter table public.org_deletions  enable row level security;

drop policy if exists "org readable by its people" on public.organisations;
create policy "org readable by its people"
  on public.organisations for select to authenticated
  using (sgs_org_member_of(id) or sgs_org_admin_of(id));

drop policy if exists "backgrounds readable by its people" on public.org_backgrounds;
create policy "backgrounds readable by its people"
  on public.org_backgrounds for select to authenticated
  using (sgs_org_member_of(org_id) or sgs_org_admin_of(org_id));

-- A member sees their own seat. An admin sees the whole roster — that roster IS
-- the HR console. Neither can read another member's stored photos: headshots
-- keeps its existing "members read own headshots" policy, and the export runs
-- through the service key instead.
drop policy if exists "member reads own seat, admin reads roster" on public.org_members;
create policy "member reads own seat, admin reads roster"
  on public.org_members for select to authenticated
  using (user_id = auth.uid() or sgs_org_admin_of(org_id));

drop policy if exists "admins readable by admins" on public.org_admins;
create policy "admins readable by admins"
  on public.org_admins for select to authenticated
  using (sgs_org_admin_of(org_id));

drop policy if exists "deletions readable by admins" on public.org_deletions;
create policy "deletions readable by admins"
  on public.org_deletions for select to authenticated
  using (sgs_org_admin_of(org_id));
