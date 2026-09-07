-- Summy Garden Studio — hand the credit back when a shoot never happened.
--
-- WHY
-- consume_credit() spends the credit at variant 0, BEFORE the first Gemini
-- call. Every failure after that point — an empty prepay balance, a 429 from
-- the daily rate limit, a safety block, a timeout — returned a 502 and left
-- the customer charged with nothing to show for it. No path returned it.
--
-- THE TESTER RULE
-- consume_credit() deliberately does not charge tester accounts: it returns
-- their balance untouched. So a tester never spent a credit, and must never be
-- given one back — otherwise every failed test would mint a credit. This
-- function mirrors that branch exactly. Change one, change the other.
--
-- WHO MAY CALL IT
-- security definer + the revoke at the bottom means only the service key (the
-- Cloudflare Worker) can call this. Without the revoke, any signed-in member
-- could POST to /rest/v1/rpc/refund_credit and mint themselves credits.

create or replace function public.refund_credit(uid uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare remaining int;
begin
  -- tester accounts never spent one, so there is nothing to give back
  select credits into remaining from public.profiles where id = uid and is_tester;
  if remaining is not null then return remaining; end if;

  -- single statement, so two concurrent refunds cannot lose an increment
  update public.profiles set credits = credits + 1
   where id = uid
   returning credits into remaining;

  if remaining is null then return -1; end if;   -- no such profile
  return remaining;
end; $function$;

revoke execute on function public.refund_credit(uuid) from anon, authenticated;
