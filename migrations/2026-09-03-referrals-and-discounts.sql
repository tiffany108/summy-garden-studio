-- Summy Garden Studio — referral programme + campaign discount codes
-- Run ONCE in the Supabase SQL Editor (Dashboard → SQL Editor → New query → Run).
-- Safe to re-run: every statement is idempotent.
--
-- WHAT THIS SETS UP
--   Referrals   1 credit = 1 shoot = 30 finished photos. A referral pays the
--               referrer 10 *photo* credits, and 30 photo credits convert into
--               one free shoot. Payout happens when the referred friend makes
--               their FIRST PURCHASE, not at signup — so the programme costs
--               nothing until real revenue arrives and cannot be farmed with
--               disposable email addresses.
--   Discounts   Percentage-off codes you create in the admin page and hand out
--               in campaigns. Percentages (rather than fixed amounts) scale
--               correctly across all five currencies with no per-currency
--               setup.
--
-- All writes are done by the Cloudflare Functions with the service key, which
-- bypasses RLS. The policies below therefore only need to grant the narrow
-- reads the browser genuinely needs.

-- ---------------------------------------------------------------------------
-- 1. Referral fields on profiles
-- ---------------------------------------------------------------------------

-- ref_code / ref_count already exist on this project; these are no-ops there and
-- create the columns on a fresh database.
alter table public.profiles add column if not exists ref_code text;
alter table public.profiles add column if not exists ref_count int not null default 0;

-- Photo credits earned from referrals but not yet turned into a shoot. Kept
-- separate from `credits` (whole shoots) so the two units can never be confused
-- by a stray update: 30 photo credits convert into 1 shoot credit.
alter table public.profiles add column if not exists photo_credits int not null default 0;

-- Who introduced this member. Set once at signup and never changed.
alter table public.profiles add column if not exists referred_by uuid references auth.users(id) on delete set null;

-- Give every existing member a code. 8 characters from an unambiguous alphabet
-- (no O/0, I/1) because these get read aloud and retyped from phone screens.
create or replace function public.sgs_new_code(len int default 8)
returns text language plpgsql as $$
declare
  alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  out text := '';
  i int;
begin
  for i in 1..len loop
    out := out || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
  end loop;
  return out;
end $$;

do $$
declare r record; c text;
begin
  for r in select id from public.profiles where ref_code is null or ref_code = '' loop
    loop
      c := public.sgs_new_code(8);
      exit when not exists (select 1 from public.profiles where ref_code = c);
    end loop;
    update public.profiles set ref_code = c where id = r.id;
  end loop;
end $$;

-- One code per member, and lookups by code must be fast because every visit to a
-- /?ref=CODE link does one.
create unique index if not exists profiles_ref_code_idx on public.profiles (ref_code) where ref_code is not null;

-- New signups get a code automatically, so the API never has to backfill.
create or replace function public.sgs_assign_ref_code()
returns trigger language plpgsql security definer set search_path = public as $$
declare c text;
begin
  if new.ref_code is null or new.ref_code = '' then
    loop
      c := public.sgs_new_code(8);
      exit when not exists (select 1 from public.profiles where ref_code = c);
    end loop;
    new.ref_code := c;
  end if;
  return new;
end $$;

drop trigger if exists sgs_profiles_ref_code on public.profiles;
create trigger sgs_profiles_ref_code
  before insert on public.profiles
  for each row execute function public.sgs_assign_ref_code();

-- ---------------------------------------------------------------------------
-- 2. Referral ledger
-- ---------------------------------------------------------------------------
-- One row per referred friend. `status` moves pending → earned when that friend
-- first pays. The unique constraint on referred_id is what makes the webhook
-- idempotent: a retried Stripe event cannot pay the same referral twice.

create table if not exists public.referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_id  uuid not null references auth.users(id) on delete cascade,
  referred_id  uuid not null references auth.users(id) on delete cascade,
  code         text not null default '',
  status       text not null default 'pending',   -- pending | earned
  photo_credits int not null default 0,           -- paid out to the referrer
  created_at   timestamptz not null default now(),
  earned_at    timestamptz,
  constraint referrals_one_per_friend unique (referred_id),
  constraint referrals_no_self check (referrer_id <> referred_id)
);

create index if not exists referrals_referrer_idx on public.referrals (referrer_id, created_at desc);

alter table public.referrals enable row level security;

-- A member may see the referrals they made (to render their dashboard). They can
-- never see who referred them, or anybody else's.
drop policy if exists "members read own referrals" on public.referrals;
create policy "members read own referrals"
  on public.referrals for select to authenticated
  using (auth.uid() = referrer_id);

-- ---------------------------------------------------------------------------
-- 3. Discount codes
-- ---------------------------------------------------------------------------

create table if not exists public.discount_codes (
  code         text primary key,                  -- stored UPPERCASE
  percent_off  int  not null check (percent_off between 1 and 100),
  label        text not null default '',          -- internal note, e.g. "LinkedIn campaign"
  active       bool not null default true,
  max_uses     int,                               -- null = unlimited
  used_count   int  not null default 0,
  once_per_user bool not null default true,
  starts_at    timestamptz,
  expires_at   timestamptz,
  created_at   timestamptz not null default now()
);

create table if not exists public.discount_redemptions (
  id          uuid primary key default gen_random_uuid(),
  code        text not null references public.discount_codes(code) on delete cascade,
  user_id     uuid references auth.users(id) on delete set null,
  session_id  text unique,                        -- Stripe checkout session
  percent_off int not null default 0,
  created_at  timestamptz not null default now()
);

create index if not exists discount_red_code_idx on public.discount_redemptions (code, created_at desc);
create index if not exists discount_red_user_idx on public.discount_redemptions (user_id);

alter table public.discount_codes enable row level security;
alter table public.discount_redemptions enable row level security;

-- Deliberately NO member-facing select policy on discount_codes. Codes are
-- validated server-side by /api/discount; if the browser could read this table
-- it could also list every unreleased campaign code.
drop policy if exists "admin manages discount codes" on public.discount_codes;
create policy "admin manages discount codes"
  on public.discount_codes for all to authenticated
  using ((auth.jwt()->>'email') = 'tiffany123@hotmail.com.hk')
  with check ((auth.jwt()->>'email') = 'tiffany123@hotmail.com.hk');

drop policy if exists "admin reads redemptions" on public.discount_redemptions;
create policy "admin reads redemptions"
  on public.discount_redemptions for select to authenticated
  using ((auth.jwt()->>'email') = 'tiffany123@hotmail.com.hk');

-- ---------------------------------------------------------------------------
-- 4. Atomic helpers
-- ---------------------------------------------------------------------------
-- Read-modify-write from a Worker is not safe under concurrency: two Stripe
-- retries arriving together would both read the same balance and one increment
-- would vanish. These do the arithmetic inside a single statement instead.

create or replace function public.sgs_award_referral(p_referred uuid, p_photo_credits int)
returns table (referrer uuid, awarded int)
language plpgsql security definer set search_path = public as $$
declare v_referrer uuid;
begin
  -- Claim the row only if it is still pending, so a retried webhook is a no-op.
  -- A plain uuid variable (not a record) is used because `returning ... into`
  -- leaves a record unassigned when nothing matched, and touching its fields
  -- would then raise rather than simply doing nothing.
  update public.referrals
     set status = 'earned', earned_at = now(), photo_credits = p_photo_credits
   where referred_id = p_referred and status = 'pending'
   returning referrer_id into v_referrer;

  if v_referrer is null then
    return;                       -- no referral, or already paid
  end if;

  update public.profiles
     set photo_credits = photo_credits + p_photo_credits,
         ref_count     = ref_count + 1
   where id = v_referrer;

  referrer := v_referrer;
  awarded  := p_photo_credits;
  return next;
end $$;

-- Convert 30 photo credits into 1 shoot. Returns the new balances, or nulls when
-- the member does not have enough — the check and the deduction happen in the
-- same statement so it cannot be raced by two browser tabs.
-- The OUT parameters are deliberately NOT named photo_credits/credits. In
-- PL/pgSQL an OUT name that matches a column makes every reference to it
-- ambiguous, including inside RETURNING, and the function fails at runtime
-- rather than at creation — the worst time to find out.
create or replace function public.sgs_convert_photo_credits(p_user uuid, p_need int default 30)
returns table (out_photo_credits int, out_credits int)
language plpgsql security definer set search_path = public as $$
begin
  return query
  update public.profiles p
     set photo_credits = p.photo_credits - p_need,
         credits       = p.credits + 1
   where p.id = p_user and p.photo_credits >= p_need
   returning p.photo_credits, p.credits;
end $$;

create or replace function public.sgs_redeem_discount(p_code text, p_user uuid, p_session text, p_percent int)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.discount_redemptions (code, user_id, session_id, percent_off)
  values (upper(p_code), p_user, p_session, p_percent)
  on conflict (session_id) do nothing;

  update public.discount_codes
     set used_count = used_count + 1
   where code = upper(p_code);
end $$;

-- Members must not be able to call these directly from the browser; only the
-- service key (used by the Cloudflare Functions) may.
revoke execute on function public.sgs_award_referral(uuid, int) from anon, authenticated;
revoke execute on function public.sgs_convert_photo_credits(uuid, int) from anon, authenticated;
revoke execute on function public.sgs_redeem_discount(text, uuid, text, int) from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Optional starter campaign code — delete or edit as you like
-- ---------------------------------------------------------------------------
insert into public.discount_codes (code, percent_off, label, active, max_uses)
values ('WELCOME15', 15, 'Evergreen first-purchase offer', true, null)
on conflict (code) do nothing;

-- The code new members get from a referral link. Referred friends are shown this
-- automatically; keeping it as an ordinary code means it shows up in your
-- redemption reporting alongside every campaign.
insert into public.discount_codes (code, percent_off, label, active, max_uses)
values ('FRIEND20', 20, 'Referred friend — first purchase', true, null)
on conflict (code) do nothing;
