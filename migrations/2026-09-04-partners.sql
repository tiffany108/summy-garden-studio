-- Summy Garden Studio — sales partner / KOL programme
-- Run ONCE in the Supabase SQL Editor. Safe to re-run.
--
-- HOW IT WORKS
--   A partner gets their own discount code (20% off for the customer). When
--   somebody buys with it, the partner earns 20% OF THE AMOUNT ACTUALLY PAID —
--   not of list price. That matters: it means a partner can never increase their
--   own commission by pushing a bigger discount, and the number you owe is
--   always a fixed share of money you actually received.
--
--   Commission is written as `pending` and becomes `confirmed` 30 days later,
--   which is when the quality guarantee expires. Paying immediately would mean
--   paying commission on sales you later refund, with no way to claw it back.
--
--   Nothing here moves money. It records what is owed; you settle by transfer
--   and mark it paid. That keeps you out of payment-services territory entirely.

-- ---------------------------------------------------------------------------
-- 1. Partners
-- ---------------------------------------------------------------------------
create table if not exists public.partners (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  name         text not null default '',
  code         text not null unique,          -- their discount code, UPPERCASE
  commission   int  not null default 20 check (commission between 0 and 90),
  kind         text not null default 'partner',  -- partner | salesperson
  active       bool not null default true,
  notes        text not null default '',      -- internal: which KOL, agreed terms
  created_at   timestamptz not null default now()
);

create index if not exists partners_code_idx on public.partners (code);

alter table public.partners enable row level security;

-- A partner may read their own row and nothing else — not other partners' codes,
-- rates or earnings.
drop policy if exists "partners read own row" on public.partners;
create policy "partners read own row"
  on public.partners for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "admin manages partners" on public.partners;
create policy "admin manages partners"
  on public.partners for all to authenticated
  using ((auth.jwt()->>'email') = 'tiffany123@hotmail.com.hk')
  with check ((auth.jwt()->>'email') = 'tiffany123@hotmail.com.hk');

-- ---------------------------------------------------------------------------
-- 2. Commission ledger
-- ---------------------------------------------------------------------------
-- One row per qualifying sale. session_id is unique, so a replayed Stripe
-- webhook cannot pay the same commission twice.

create table if not exists public.commissions (
  id           uuid primary key default gen_random_uuid(),
  partner_id   uuid not null references auth.users(id) on delete cascade,
  session_id   text unique,                   -- Stripe checkout session
  customer_id  uuid references auth.users(id) on delete set null,
  code         text not null default '',
  pack         text not null default '',
  amount_paid  numeric not null default 0,    -- what the customer actually paid
  currency     text not null default 'usd',
  rate         int  not null default 20,      -- % applied, frozen at sale time
  commission   numeric not null default 0,    -- amount_paid * rate / 100
  status       text not null default 'pending',  -- pending | confirmed | paid | void
  confirms_at  timestamptz,                   -- when the guarantee window closes
  paid_at      timestamptz,
  created_at   timestamptz not null default now()
);

create index if not exists commissions_partner_idx on public.commissions (partner_id, created_at desc);
create index if not exists commissions_status_idx on public.commissions (status, confirms_at);

alter table public.commissions enable row level security;

-- A partner sees only their own earnings.
drop policy if exists "partners read own commissions" on public.commissions;
create policy "partners read own commissions"
  on public.commissions for select to authenticated
  using (auth.uid() = partner_id);

drop policy if exists "admin manages commissions" on public.commissions;
create policy "admin manages commissions"
  on public.commissions for all to authenticated
  using ((auth.jwt()->>'email') = 'tiffany123@hotmail.com.hk')
  with check ((auth.jwt()->>'email') = 'tiffany123@hotmail.com.hk');

-- ---------------------------------------------------------------------------
-- 3. Recording a commission
-- ---------------------------------------------------------------------------
-- Called by the Stripe webhook. Everything is decided here rather than in the
-- Worker: the partner lookup, the rate that applies, and the arithmetic. That
-- keeps the number owed derivable from the database alone.

create or replace function public.sgs_record_commission(
    p_code text, p_session text, p_customer uuid,
    p_pack text, p_amount numeric, p_currency text)
returns table (out_partner uuid, out_commission numeric)
language plpgsql security definer set search_path = public as $fn$
declare v_partner uuid; v_rate int; v_amt numeric;
begin
  select user_id, commission into v_partner, v_rate
    from public.partners
   where code = upper(p_code) and active
   limit 1;

  if v_partner is null then
    return;                       -- an ordinary campaign code, not a partner one
  end if;

  -- A partner must not earn commission on their own purchase.
  if v_partner = p_customer then
    return;
  end if;

  v_amt := round(p_amount * v_rate / 100.0, 2);

  insert into public.commissions
    (partner_id, session_id, customer_id, code, pack, amount_paid, currency,
     rate, commission, status, confirms_at)
  values
    (v_partner, p_session, p_customer, upper(p_code), p_pack, p_amount, p_currency,
     v_rate, v_amt, 'pending', now() + interval '30 days')
  on conflict (session_id) do nothing;

  out_partner := v_partner;
  out_commission := v_amt;
  return next;
end $fn$;

-- Nightly: anything past its guarantee window becomes payable.
create or replace function public.sgs_confirm_commissions()
returns int language plpgsql security definer set search_path = public as $fn$
declare n int;
begin
  update public.commissions
     set status = 'confirmed'
   where status = 'pending' and confirms_at is not null and confirms_at < now();
  get diagnostics n = row_count;
  return n;
end $fn$;

revoke execute on function public.sgs_record_commission(text, text, uuid, text, numeric, text) from anon, authenticated;
revoke execute on function public.sgs_confirm_commissions() from anon, authenticated;

-- Run it nightly, just after the photo pruning job.
select cron.unschedule('confirm-commissions')
 where exists (select 1 from cron.job where jobname = 'confirm-commissions');
select cron.schedule('confirm-commissions', '30 3 * * *',
                     $job$select public.sgs_confirm_commissions();$job$);
