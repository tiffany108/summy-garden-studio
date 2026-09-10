-- Outreach desk — 2026-09-10
-- Tables behind /outreach.html. Built to serve ANY campaign, not one product:
-- a campaign carries its own sender identity and its own message, so the same
-- tool works for the next venture without a schema change.
--
-- Safe to run more than once.

-- ---------------------------------------------------------------------------
create table if not exists public.campaigns (
  id            uuid primary key default gen_random_uuid(),
  name          text not null default 'Untitled',
  from_name     text not null default '',
  company_name  text not null default '',
  site          text not null default '',
  -- {{company}} {{domain}} {{note}} {{title}} {{sender}} are filled per prospect.
  -- A {{name}} that ends up empty becomes a <<gap>> and BLOCKS the send;
  -- {{name?}} is optional and simply disappears.
  subject_tpl   text not null default '',
  body_tpl      text not null default '',
  followup_tpl  text not null default '',
  proof         text not null default '',          -- the case study, once you have one
  daily_cap     int  not null default 40,
  followup_days int  not null default 7,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists public.prospects (
  id             uuid primary key default gen_random_uuid(),
  campaign_id    uuid not null references public.campaigns(id) on delete cascade,
  name           text not null default '',
  domain         text not null,
  stage          text not null default 'sourced',  -- sourced|enriched|drafted|sent|followed_up|replied|parked
  -- Provenance. Under UK GDPR Article 14 you may have to tell somebody where
  -- you got their details; that should be a lookup, not an excavation.
  source         text not null default '',
  source_url     text not null default '',
  email          text not null default '',
  emails         jsonb not null default '[]'::jsonb,
  email_page     text not null default '',         -- the exact page it was read from
  email_found_at timestamptz,
  -- Evidence gathered from their site. The personalised sentence is written by
  -- a person in `note`; the tool never invents a claim about someone.
  site_title     text not null default '',
  site_summary   text not null default '',
  signals        jsonb not null default '{}'::jsonb,
  pages_read     jsonb not null default '[]'::jsonb,
  note           text not null default '',
  subject        text not null default '',
  body           text not null default '',
  needs_human    boolean not null default true,
  enrich_error   text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (campaign_id, domain)
);
create index if not exists prospects_campaign_stage_idx on public.prospects (campaign_id, stage);

create table if not exists public.prospect_sends (
  id          uuid primary key default gen_random_uuid(),
  campaign_id uuid references public.campaigns(id) on delete set null,
  prospect_id uuid references public.prospects(id) on delete set null,
  to_email    text not null,
  kind        text not null,                        -- first | followup
  subject     text not null default '',
  at          timestamptz not null default now()
);
create index if not exists prospect_sends_to_idx on public.prospect_sends (to_email);
create index if not exists prospect_sends_at_idx on public.prospect_sends (at desc);

-- Deliberately NOT scoped to a campaign: somebody who asked not to be written
-- to has asked for all of them. Keyed by address, or by "@domain" for a whole
-- company.
create table if not exists public.prospect_suppressions (
  key    text primary key,
  reason text not null default '',
  at     timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Every read and write goes through the Worker with the service key, and the
-- Worker checks the owner account and the second factor first. So: RLS on, and
-- no policies at all — nothing reaches these tables with an ordinary session.
alter table public.campaigns             enable row level security;
alter table public.prospects             enable row level security;
alter table public.prospect_sends        enable row level security;
alter table public.prospect_suppressions enable row level security;

-- ---------------------------------------------------------------------------
-- A first campaign so the page opens with something in it rather than a blank.
insert into public.campaigns (name, from_name, company_name, site, subject_tpl, body_tpl, followup_tpl, daily_cap, followup_days)
select
  'Summy Garden — team headshots',
  'Tiffany Li', 'Summy Garden Studio', 'summygarden.com',
  'Headshots for the {{company}} team page',
  'Hello,' || chr(10) || chr(10) ||
  '{{note}}' || chr(10) || chr(10) ||
  'We fix that without a studio day: everyone uploads a selfie, everyone gets' || chr(10) ||
  'the same treatment back, and the photos are deleted a fortnight later so you' || chr(10) ||
  'are not left holding a folder of staff pictures.' || chr(10) || chr(10) ||
  '{{proof?}}Happy to do twenty of your people free so you can see it on your own' || chr(10) ||
  'team rather than on a sample.',
  'Hello,' || chr(10) || chr(10) ||
  'Following up once, then I will leave it.' || chr(10) || chr(10) ||
  'If the team page is not a priority just now, no problem at all — is there' || chr(10) ||
  'someone else there I should have written to instead?',
  40, 7
where not exists (select 1 from public.campaigns);
