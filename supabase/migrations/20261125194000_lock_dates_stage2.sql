-- Lock dates enforced on the server: Stage 2, refusing changes in locked periods.
--
-- Stage 1 (20261108090000_lock_watch.sql) watched live saves from 8 November to
-- 25 November 2026 with zero false positives. This promotes the trigger to
-- BEFORE UPDATE and refuses any save that changes a record dated up to the
-- year or GST lock date, unless the save is moving the lock date itself
-- (which save_part already restricts to owners and accountants).

create or replace function public.lock_watch_note()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  decisions_now jsonb;
  dates record;
  txns jsonb;
  changed jsonb;
begin
  if new.part::text not in ('transactions', 'decisions', 'invoices') then return new; end if;

  -- The lock dates as they stood before this save: moving them is a deliberate
  -- act by an owner or the accountant (already checked by save_part).
  if new.part::text = 'decisions' then
    decisions_now := old.data;
    if public.lock_dates_of(new.data) is distinct from public.lock_dates_of(old.data) then return new; end if;
  else
    select data into decisions_now from public.book_parts where book_id = new.book_id and part = 'decisions';
  end if;

  dates := public.lock_watch_dates(decisions_now);
  if dates.year_lock is null and dates.gst_lock is null then return new; end if;

  if new.part::text = 'transactions' then
    txns := old.data;
  else
    select data into txns from public.book_parts where book_id = new.book_id and part = 'transactions';
  end if;

  changed := public.lock_watch_changes(new.part::text, old.data, new.data, dates.year_lock, dates.gst_lock, txns);
  if jsonb_array_length(changed) > 0 then
    raise exception 'That period is locked; move the lock date first.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists lock_watch on public.book_parts;
create trigger lock_watch
  before update of data on public.book_parts
  for each row execute function public.lock_watch_note();

revoke all on function public.lock_watch_note() from public, anon, authenticated;
