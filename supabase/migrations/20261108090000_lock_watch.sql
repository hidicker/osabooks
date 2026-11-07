-- Lock dates watched on the server: stage 1, noticing without refusing.
--
-- The page refuses a change that would alter a locked period's figures; the
-- server, until now, only refused moving the lock dates themselves. Before it
-- refuses anything more, it watches: each save that changes something dated
-- in a locked period is noted in lock_watch, and the owner and the
-- accountant see it on Settings, Lock dates. Once a week or two has shown
-- that only genuine changes are caught, a later migration refuses them.
--
-- The server compares records, not figures as the page works them out:
--   * up to the year lock: bank lines, their coding (account, GST treatment
--     and side), their splits and invoice matches, invoices and bills (dates,
--     amounts, tax and lines), and manual journals (dates and lines);
--   * after the year lock and up to the GST lock: the GST parts only -- a
--     line's treatment and side, and an invoice's or journal's amounts.
-- An invoice's paid and owing are left out: a payment made after the lock
-- changes them, and is no change to the locked period.

create table if not exists public.lock_watch (
  id bigserial primary key,
  book_id uuid not null references public.books(id) on delete cascade,
  part text not null,
  noticed_at timestamptz not null default now(),
  by_user uuid,
  what jsonb not null
);
create index if not exists lock_watch_book on public.lock_watch (book_id, noticed_at desc);
alter table public.lock_watch enable row level security;
-- Read through lock_watch_list only; written by the trigger only.
revoke all on table public.lock_watch from public, anon, authenticated;

/** The year and GST lock dates in a decisions part, or nulls. */
create or replace function public.lock_watch_dates(decisions jsonb, out year_lock text, out gst_lock text)
language sql
immutable
set search_path = public, pg_temp
as $$
  select nullif(decisions #>> '{lockDates,year}', ''), nullif(decisions #>> '{lockDates,gst}', '');
$$;

/** An invoice's figure-making fields: what a locked period's figures are made of. */
create or replace function public.lock_watch_doc(doc jsonb)
returns jsonb
language sql
immutable
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'kind', doc -> 'kind', 'issued', doc -> 'issued', 'total', doc -> 'total',
    'tax', doc -> 'tax', 'lines', doc -> 'lines', 'status', case when lower(coalesce(doc ->> 'status', '')) in ('draft', 'voided', 'deleted', 'estimate') then doc -> 'status' end
  );
$$;

/**
 * What a save changed in locked periods: a list of {kind, key, date}, empty
 * when nothing. `txns` is the books' bank lines, for the dates of the lines
 * that codings, splits and matches name.
 */
create or replace function public.lock_watch_changes(
  the_part text, old_data jsonb, new_data jsonb, year_lock text, gst_lock text, txns jsonb
)
returns jsonb
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  upto text := greatest(coalesce(year_lock, ''), coalesce(gst_lock, ''));
  found jsonb := '[]'::jsonb;
begin
  if upto = '' then return found; end if;

  if the_part = 'transactions' then
    -- A bank line dated up to either lock, added, removed or changed.
    select coalesce(jsonb_agg(jsonb_build_object('kind', 'bank line', 'key', k, 'date', d)), '[]'::jsonb) into found
    from (
      select coalesce(o.id, n.id) as k, coalesce(o.d, n.d) as d
      from (select t ->> 'id' as id, t ->> 'date' as d, t - 'extras' as v from jsonb_array_elements(coalesce(old_data, '[]')) t where t ->> 'date' <= upto) o
      full join (select t ->> 'id' as id, t ->> 'date' as d, t - 'extras' as v from jsonb_array_elements(coalesce(new_data, '[]')) t where t ->> 'date' <= upto) n
        on o.id = n.id
      where o.v is distinct from n.v
      limit 50
    ) x;

  elsif the_part = 'invoices' then
    select coalesce(jsonb_agg(jsonb_build_object('kind', 'invoice', 'key', k, 'date', d)), '[]'::jsonb) into found
    from (
      select coalesce(o.num, n.num) as k, coalesce(o.d, n.d) as d
      from (select t ->> 'number' as num, t ->> 'issued' as d, public.lock_watch_doc(t) as v from jsonb_array_elements(coalesce(old_data, '[]')) t where t ->> 'issued' <= upto) o
      full join (select t ->> 'number' as num, t ->> 'issued' as d, public.lock_watch_doc(t) as v from jsonb_array_elements(coalesce(new_data, '[]')) t where t ->> 'issued' <= upto) n
        on o.num = n.num
      where o.v is distinct from n.v
      limit 50
    ) x;

  elsif the_part = 'decisions' then
    with dated as (
      select t ->> 'id' as id, t ->> 'date' as d from jsonb_array_elements(coalesce(txns, '[]')) t where t ->> 'date' <= upto
    ),
    coding as (
      -- Up to the year lock, the account as well; after it, up to the GST lock, the GST only.
      select 'coding' as kind, dated.id as k, dated.d as d
      from dated
      where (
        case when year_lock is not null and dated.d <= year_lock
          then jsonb_build_object('code', old_data #> array['overrides', dated.id, 'code'], 'treatment', old_data #> array['overrides', dated.id, 'treatment'], 'side', old_data #> array['overrides', dated.id, 'side'], 'claimIn', old_data #> array['overrides', dated.id, 'claimIn'])
          else jsonb_build_object('treatment', old_data #> array['overrides', dated.id, 'treatment'], 'side', old_data #> array['overrides', dated.id, 'side'], 'claimIn', old_data #> array['overrides', dated.id, 'claimIn'])
        end
      ) is distinct from (
        case when year_lock is not null and dated.d <= year_lock
          then jsonb_build_object('code', new_data #> array['overrides', dated.id, 'code'], 'treatment', new_data #> array['overrides', dated.id, 'treatment'], 'side', new_data #> array['overrides', dated.id, 'side'], 'claimIn', new_data #> array['overrides', dated.id, 'claimIn'])
          else jsonb_build_object('treatment', new_data #> array['overrides', dated.id, 'treatment'], 'side', new_data #> array['overrides', dated.id, 'side'], 'claimIn', new_data #> array['overrides', dated.id, 'claimIn'])
        end
      )
    ),
    split as (
      select 'split' as kind, dated.id as k, dated.d as d from dated
      where year_lock is not null and dated.d <= year_lock
        and (old_data #> array['splits', dated.id]) is distinct from (new_data #> array['splits', dated.id])
    ),
    matched as (
      select 'invoice match' as kind, dated.id as k, dated.d as d from dated
      where year_lock is not null and dated.d <= year_lock
        and (old_data #> array['invoiceMatches', dated.id]) is distinct from (new_data #> array['invoiceMatches', dated.id])
    ),
    journals as (
      select 'manual journal' as kind, coalesce(o.id, n.id) as k, coalesce(o.d, n.d) as d
      from (select j ->> 'id' as id, j ->> 'date' as d, jsonb_build_object('date', j -> 'date', 'lines', j -> 'lines', 'deleted', j -> 'deleted') as v from jsonb_array_elements(coalesce(old_data -> 'manualJournals', '[]')) j where j ->> 'date' <= upto) o
      full join (select j ->> 'id' as id, j ->> 'date' as d, jsonb_build_object('date', j -> 'date', 'lines', j -> 'lines', 'deleted', j -> 'deleted') as v from jsonb_array_elements(coalesce(new_data -> 'manualJournals', '[]')) j where j ->> 'date' <= upto) n
        on o.id = n.id
      where o.v is distinct from n.v
    )
    select coalesce(jsonb_agg(jsonb_build_object('kind', kind, 'key', k, 'date', d)), '[]'::jsonb) into found
    from (
      select * from coding union all select * from split union all select * from matched union all select * from journals
      limit 50
    ) x;
  end if;
  return found;
end;
$$;

/** The trigger: after a save of a watched part, note what changed in locked periods. Never refuses. */
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
  -- Everything inside the guard: watching never stops a save.
  begin
    -- The lock dates as they stood before this save: a save that moves them
    -- is a deliberate act by an owner or the accountant, refused to anyone else.
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
      insert into public.lock_watch (book_id, part, by_user, what)
      values (new.book_id, new.part::text, auth.uid(), jsonb_build_object('locks', jsonb_build_object('year', dates.year_lock, 'gst', dates.gst_lock), 'changed', changed));
    end if;
  exception when others then
    -- Watching never stops a save.
    raise warning 'lock_watch: %', sqlerrm;
  end;
  return new;
end;
$$;

drop trigger if exists lock_watch on public.book_parts;
create trigger lock_watch
  after update of data on public.book_parts
  for each row execute function public.lock_watch_note();

/** What the server noticed in a set of books, newest first: for the owner and the accountant. */
create or replace function public.lock_watch_list(p_book uuid)
returns table (noticed_at timestamptz, part text, by_email text, what jsonb)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.has_role(p_book, array['owner', 'accountant']::public.book_role[]) then
    raise exception 'only an owner or the accountant' using errcode = '42501';
  end if;
  return query
    select w.noticed_at, w.part, u.email::text, w.what
    from public.lock_watch w
    left join auth.users u on u.id = w.by_user
    where w.book_id = p_book
    order by w.noticed_at desc
    limit 100;
end;
$$;

revoke all on function public.lock_watch_list(uuid) from public, anon;
grant execute on function public.lock_watch_list(uuid) to authenticated;
revoke all on function public.lock_watch_changes(text, jsonb, jsonb, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.lock_watch_note() from public, anon, authenticated;
