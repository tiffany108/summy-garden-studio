-- Summy Garden Studio — partner applications and payout details
-- Run ONCE in the Supabase SQL Editor. Safe to re-run.
--
-- TWO TABLES, ON PURPOSE.
--
--   partner_applications  — what someone submits from the public Join us form:
--     real name, email, phone, address, and the channel they would share on.
--     Anyone may insert; only you may read.
--
--   partner payout fields — bank or PayPal details, entered by the partner
--     THEMSELVES inside their portal after you approve them, never on a public
--     form.
--
-- Why the split. Asking a stranger for a bank account number on an open web form
-- is the exact shape of a phishing page: no relationship yet, no login, no way
-- for them to verify who is receiving it. Good applicants hesitate and bad actors
-- fill it with someone else's details. Collecting it inside an authenticated
-- portal after approval is both safer and the way every affiliate programme
-- worth trusting does it.

-- ---------------------------------------------------------------------------
-- 1. Applications
-- ---------------------------------------------------------------------------
create table if not exists public.partner_applications (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null default 'partner',   -- partner | salesperson
  name        text not null default '',          -- real name, for the agreement
  email       text not null default '',
  phone       text not null default '',
  address     text not null default '',
  channel     text not null default '',          -- where they would share it
  channel_url text not null default '',
  audience    text not null default '',          -- rough size, in their words
  message     text not null default '',
  status      text not null default 'new',       -- new | contacted | approved | declined
  notes       text not null default '',          -- your private notes
  created_at  timestamptz not null default now()
);

create index if not exists partner_apps_status_idx on public.partner_applications (status, created_at desc);

alter table public.partner_applications enable row level security;

-- Anyone may apply. They may not read applications back — not their own and
-- certainly not anybody else's, since these carry personal contact details.
drop policy if exists "anyone may apply" on public.partner_applications;
create policy "anyone may apply"
  on public.partner_applications for insert to anon, authenticated
  with check (true);

drop policy if exists "admin reads applications" on public.partner_applications;
create policy "admin reads applications"
  on public.partner_applications for all to authenticated
  using ((auth.jwt()->>'email') = 'tiffany123@hotmail.com.hk')
  with check ((auth.jwt()->>'email') = 'tiffany123@hotmail.com.hk');

-- ---------------------------------------------------------------------------
-- 2. Payout and contact details on the partner record
-- ---------------------------------------------------------------------------
-- Filled in by the partner in their own portal, or by you from the admin page.
alter table public.partners add column if not exists real_name  text not null default '';
alter table public.partners add column if not exists phone      text not null default '';
alter table public.partners add column if not exists address    text not null default '';
alter table public.partners add column if not exists channel    text not null default '';
alter table public.partners add column if not exists channel_url text not null default '';

-- Payment destination. Stored as free text because it spans bank accounts,
-- PayPal addresses and FPS IDs across five markets; validating it would reject
-- more legitimate formats than it caught.
alter table public.partners add column if not exists payout_method text not null default '';  -- bank | paypal | fps | other
alter table public.partners add column if not exists payout_name   text not null default '';  -- name on the account
alter table public.partners add column if not exists payout_detail text not null default '';  -- account number / email / ID
alter table public.partners add column if not exists payout_bank   text not null default '';
alter table public.partners add column if not exists payout_updated_at timestamptz;

/* The existing "partners read own row" SELECT policy already limits a partner to
   their own record. This adds the matching UPDATE so they can maintain their own
   payment details — and ONLY those. The WITH CHECK keeps the row theirs; the
   commercial fields (code, commission, active) are protected by the trigger
   below rather than by trusting the client. */
drop policy if exists "partners update own details" on public.partners;
create policy "partners update own details"
  on public.partners for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

/* A partner must never be able to raise their own commission, change their code,
   or un-pause themselves. RLS can restrict WHICH row they touch but not WHICH
   COLUMNS, so this trigger puts the commercial fields back to their stored
   values on any update that is not made by the service key. */
create or replace function public.sgs_partner_guard()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  if current_setting('role', true) is distinct from 'service_role' then
    new.code       := old.code;
    new.commission := old.commission;
    new.active     := old.active;
    new.kind       := old.kind;
    new.user_id    := old.user_id;
  end if;
  if new.payout_detail is distinct from old.payout_detail
     or new.payout_method is distinct from old.payout_method then
    new.payout_updated_at := now();
  end if;
  return new;
end $fn$;

drop trigger if exists sgs_partners_guard on public.partners;
create trigger sgs_partners_guard
  before update on public.partners
  for each row execute function public.sgs_partner_guard();
