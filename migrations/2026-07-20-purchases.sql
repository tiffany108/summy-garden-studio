-- Summy Garden Studio — purchase records for the Business Dashboard
-- (run once in Supabase SQL Editor). Rows are written by the Stripe webhook
-- with the service key; only the admin account can read them.

create table if not exists public.purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  session_id text unique,
  pack text not null default '',
  credits int not null default 0,
  amount numeric not null default 0,          -- major units, e.g. 9.99
  currency text not null default 'usd',
  created_at timestamptz not null default now()
);

create index if not exists purchases_created_idx on public.purchases (created_at desc);

alter table public.purchases enable row level security;

drop policy if exists "admin reads purchases" on public.purchases;
create policy "admin reads purchases"
  on public.purchases for select to authenticated
  using ((auth.jwt()->>'email') = 'tiffany123@hotmail.com.hk');
