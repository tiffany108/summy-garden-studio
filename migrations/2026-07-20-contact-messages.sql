-- Summy Garden Studio — "Contact us" messages (run once in Supabase SQL Editor)
-- Anyone (signed in or not) may send a message; only the admin account can read them.

create table if not exists public.contact_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  name text not null default '',
  email text not null,
  topic text not null default 'Other',
  message text not null,
  status text not null default 'new',
  created_at timestamptz not null default now()
);

create index if not exists contact_messages_created_idx
  on public.contact_messages (created_at desc);

alter table public.contact_messages enable row level security;

drop policy if exists "anyone can send a message" on public.contact_messages;
create policy "anyone can send a message"
  on public.contact_messages for insert to anon, authenticated
  with check (true);

drop policy if exists "admin reads messages" on public.contact_messages;
create policy "admin reads messages"
  on public.contact_messages for select to authenticated
  using ((auth.jwt()->>'email') = 'tiffany123@hotmail.com.hk');
