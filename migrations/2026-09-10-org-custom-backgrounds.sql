-- Summy Garden Studio — 2026-09-10
-- Company-specific backgrounds: a scene written for one client's brand rather
-- than picked out of the shared library.
--
-- org_backgrounds could previously only point at a library scene by id. These
-- columns let a row carry its own name, its own description (which IS the
-- prompt the image model receives) and its own colours for the preview swatch.
-- A row with an empty prompt is still a library scene and behaves exactly as
-- before, so nothing existing changes.
--
-- Safe to run more than once.

alter table public.org_backgrounds
  add column if not exists name   text  not null default '',
  add column if not exists prompt text  not null default '',
  -- Which of the studio's swatch drawings to render the preview with
  -- (office | bizpark | street | park | lake | tennis | cafe | campus | studio).
  add column if not exists art    text  not null default 'office',
  -- Up to four brand hex colours, in the order the swatch drawings expect:
  -- [background top, background bottom, mid tone, accent].
  add column if not exists colors jsonb not null default '[]'::jsonb;

-- The description is what reaches the image model, so it is capped here as well
-- as in org.js. A database that cannot hold a 5,000-word prompt cannot be talked
-- into sending one.
alter table public.org_backgrounds drop constraint if exists org_backgrounds_prompt_len_ck;
alter table public.org_backgrounds add constraint org_backgrounds_prompt_len_ck
  check (char_length(prompt) <= 300 and char_length(name) <= 60 and char_length(art) <= 20);
