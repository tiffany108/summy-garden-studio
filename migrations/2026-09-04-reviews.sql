-- Summy Garden Studio — customer reviews
-- Run ONCE in the Supabase SQL Editor. Safe to re-run.
--
-- Reviews are REAL or they are worthless. Inventing them to inflate the
-- AggregateRating below is the exact manipulation Google penalises and AI
-- assistants are trained to discount — and in the UK and Hong Kong, publishing
-- fabricated consumer reviews is unlawful. So:
--   * only a signed-in member who has actually generated headshots can leave one
--   * one review per member, enforced by the primary key
--   * `verified` records that they had a completed shoot at the time of writing
--   * nothing is public until you approve it
--
-- The rating shown on the site is computed from approved rows, so it is always
-- a true statement about real customers.

create table if not exists public.reviews (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  name        text not null default '',      -- display name, defaults to their first name
  rating      int  not null check (rating between 1 and 5),
  comment     text not null default '',
  status      text not null default 'pending',  -- pending | approved | rejected
  verified    bool not null default false,      -- had a completed shoot when written
  shots       int  not null default 0,          -- how many photos they had generated
  lang        text not null default 'en',
  created_at  timestamptz not null default now(),
  reviewed_at timestamptz,                      -- when YOU actioned it
  token       text                              -- one-click approve/reject from email
);

create index if not exists reviews_status_idx on public.reviews (status, created_at desc);
create index if not exists reviews_token_idx on public.reviews (token) where token is not null;

alter table public.reviews enable row level security;

-- Anyone may read APPROVED reviews — that is the point of publishing them.
drop policy if exists "public reads approved reviews" on public.reviews;
create policy "public reads approved reviews"
  on public.reviews for select to anon, authenticated
  using (status = 'approved');

-- A member may read their own, whatever its status, so the form can show
-- "thanks, yours is awaiting approval" instead of pretending nothing happened.
drop policy if exists "members read own review" on public.reviews;
create policy "members read own review"
  on public.reviews for select to authenticated
  using (auth.uid() = user_id);

-- Writes go through /api/review with the service key: the browser must not be
-- able to set `status`, `verified` or `token` itself.
drop policy if exists "admin manages reviews" on public.reviews;
create policy "admin manages reviews"
  on public.reviews for all to authenticated
  using ((auth.jwt()->>'email') = 'tiffany123@hotmail.com.hk')
  with check ((auth.jwt()->>'email') = 'tiffany123@hotmail.com.hk');

-- ---------------------------------------------------------------------------
-- The published rating. A view rather than a stored number, so it can never
-- drift from the reviews it claims to summarise.
-- ---------------------------------------------------------------------------
create or replace view public.review_summary as
  select count(*)::int                       as review_count,
         round(avg(rating)::numeric, 1)      as average_rating,
         count(*) filter (where verified)::int as verified_count
    from public.reviews
   where status = 'approved';

grant select on public.review_summary to anon, authenticated;
