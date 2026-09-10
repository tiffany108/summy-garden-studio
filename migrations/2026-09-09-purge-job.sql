-- Summy Garden Studio — 2026-09-09
-- Schedules the retention purge that functions/api/purge.js performs.
--
-- Read this before running it: the last section DELETES PHOTOGRAPHS on a
-- schedule. Run parts 1 and 2, then do a dry run (see the comment at the end of
-- part 2) and read what it says it would delete. Only then run part 3.
--
-- Safe to run more than once.

-- ---------------------------------------------------------------------------
-- 1. Remember which deadline each member has already been warned about
-- ---------------------------------------------------------------------------
-- Not "have we reminded them" but "which deletion date did we tell them about",
-- so a member who shoots again gets a fresh reminder for the new deadline
-- without anybody resetting a flag.
alter table public.org_members
  add column if not exists download_reminded_for timestamptz;

-- ---------------------------------------------------------------------------
-- 2. Extensions and the shared secret
-- ---------------------------------------------------------------------------
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- The secret lives in Supabase Vault, encrypted, rather than in the cron
-- command — where it would be readable by anyone who can list scheduled jobs.
--
-- GENERATE YOUR OWN and paste it in below. In PowerShell:
--   [Convert]::ToBase64String((1..32|%{Get-Random -Max 256}))
-- Put the SAME value in Cloudflare → Pages → Settings → Environment variables
-- as PURGE_SECRET, and never commit it to the repo.
--
--   select vault.create_secret('PASTE-YOUR-SECRET-HERE',
--                              'sgs_purge_key',
--                              'Shared secret for POST /api/purge');
--
-- To change it later:
--   select vault.update_secret(
--     (select id from vault.secrets where name = 'sgs_purge_key'),
--     'PASTE-THE-NEW-SECRET');

-- Dry run — deletes nothing, reports what it would delete. Do this first, and
-- read the reply in net._http_response (part 4) before scheduling anything.
--
--   select net.http_post(
--     url     := 'https://summygarden.com/api/purge',
--     headers := jsonb_build_object(
--                  'Content-Type', 'application/json',
--                  'x-purge-key',  (select decrypted_secret from vault.decrypted_secrets
--                                    where name = 'sgs_purge_key')),
--     body    := '{"dry_run": true}'::jsonb,
--     timeout_milliseconds := 60000);

-- ---------------------------------------------------------------------------
-- 3. The daily job  ⚠ this one really deletes
-- ---------------------------------------------------------------------------
-- 03:20 UTC: late enough that a member finishing a shoot at midnight still has
-- their full window, early enough that the reminder email lands before the
-- working day rather than during it.
select cron.unschedule('sgs-daily-purge')
  where exists (select 1 from cron.job where jobname = 'sgs-daily-purge');

select cron.schedule('sgs-daily-purge', '20 3 * * *', $job$
  select net.http_post(
    url     := 'https://summygarden.com/api/purge',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'x-purge-key',  (select decrypted_secret from vault.decrypted_secrets
                                   where name = 'sgs_purge_key')),
    body    := '{}'::jsonb,
    timeout_milliseconds := 60000);
$job$);

-- ---------------------------------------------------------------------------
-- 4. Checking on it
-- ---------------------------------------------------------------------------
-- What the endpoint replied, most recent first. A run reporting "more": true
-- hit its per-run cap and the next run continues — expect that only on the
-- first run after a long backlog.
--
--   select created, status_code, content::jsonb
--     from net._http_response
--    order by created desc
--    limit 20;
--
-- Whether the schedule itself is firing:
--
--   select jobname, schedule, active from cron.job;
--   select start_time, status, return_message
--     from cron.job_run_details
--    where jobname = 'sgs-daily-purge'
--    order by start_time desc limit 20;
--
-- What was deleted, for the conversation that follows a contract ending:
--
--   select o.name, d.reason, d.photos, d.at
--     from public.org_deletions d
--     join public.organisations o on o.id = d.org_id
--    order by d.at desc limit 50;
--
-- To stop it:  select cron.unschedule('sgs-daily-purge');
