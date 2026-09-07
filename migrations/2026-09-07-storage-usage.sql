-- Summy Garden Studio — measure how much Supabase storage the headshots use.
--
-- WHY
-- The Free plan stops at 1 GB of file storage, and the upload in generate.js is
-- wrapped in a try/catch that never blocks delivery. So when the bucket fills,
-- photos silently stop being saved: the customer still watches them stream in,
-- and their dashboard is empty afterwards. There was no number anywhere that
-- would have warned us. This records the size of every file as it is written
-- and exposes one cheap aggregate for the admin dashboard.
--
-- NOTE ON HISTORY
-- Rows written before this migration have bytes = 0, so the total under-counts
-- until they age out of the 6-month retention window. `measured` in the result
-- says how many rows actually carry a size, and the dashboard shows that
-- rather than implying the total is complete.

alter table public.headshots
  add column if not exists bytes bigint not null default 0;

create or replace function public.sgs_storage_usage()
returns table (total_bytes bigint, photos bigint, measured bigint, oldest timestamptz)
language sql
security definer
set search_path to 'public'
as $function$
  select coalesce(sum(bytes), 0)::bigint            as total_bytes,
         count(*)::bigint                            as photos,
         count(*) filter (where bytes > 0)::bigint   as measured,
         min(created_at)                             as oldest
    from public.headshots;
$function$;

-- Only the service key (the Worker, on behalf of the admin endpoint) may call
-- this. It reports across every member, so it must not be reachable by a
-- signed-in customer.
revoke execute on function public.sgs_storage_usage() from anon, authenticated;
