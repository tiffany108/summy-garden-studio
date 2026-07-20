-- Summy Garden Studio — saved headshots feature (run once in Supabase SQL Editor)
-- Creates: public.headshots table, private "headshots" storage bucket, and RLS
-- policies so each member can see only their own images. Uploads/inserts are done
-- by the Netlify function with the service key (bypasses RLS), so no insert
-- policies are needed.

create table if not exists public.headshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  scene text not null default '',
  look text not null default '',
  variant int not null default 0,
  path text not null,
  created_at timestamptz not null default now()
);

create index if not exists headshots_user_created_idx
  on public.headshots (user_id, created_at desc);

alter table public.headshots enable row level security;

drop policy if exists "members read own headshots" on public.headshots;
create policy "members read own headshots"
  on public.headshots for select to authenticated
  using (auth.uid() = user_id);

-- Private storage bucket for the image files
insert into storage.buckets (id, name, public)
values ('headshots', 'headshots', false)
on conflict (id) do nothing;

-- Members may read only files inside their own folder (headshots/<their-uid>/...)
drop policy if exists "members read own headshot files" on storage.objects;
create policy "members read own headshot files"
  on storage.objects for select to authenticated
  using (bucket_id = 'headshots' and (storage.foldername(name))[1] = auth.uid()::text);
