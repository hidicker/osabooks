-- Fixes verified from DeepSeek's 25 November 2026 review:
--   #1: lock_watch_note() INSERT branch treats 'invoices' as '[]'::jsonb (not '{}'::jsonb)
--   #2: lock_watch_changes() checks splits up to greatest(year_lock, gst_lock)
--   #8: Revoke direct UPDATE (deleted_at) on public.books from authenticated
--   Quick win: invitation_email_take() locks both book and inviter to prevent co-owner races

-- ---------------------------------------------------------------------------
-- #8: Force book delete/restore through delete_book() and restore_book() RPCs
-- ---------------------------------------------------------------------------
revoke update on public.books from authenticated;
grant update (name) on public.books to authenticated;

-- ---------------------------------------------------------------------------
-- #2: lock_watch_changes() enforces splits under both year_lock and gst_lock
-- ---------------------------------------------------------------------------
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
      -- Enforced up to both year_lock and gst_lock: changing split amounts/treatments alters GST returns.
      select 'split' as kind, dated.id as k, dated.d as d from dated
      where dated.d <= upto
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

revoke all on function public.lock_watch_changes(text, jsonb, jsonb, text, text, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- #1: lock_watch_note() treats both 'transactions' and 'invoices' as arrays on INSERT
-- ---------------------------------------------------------------------------
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
  old_data jsonb;
  changed jsonb;
begin
  if new.part::text not in ('transactions', 'decisions', 'invoices') then return new; end if;

  old_data := case
    when tg_op = 'INSERT' then
      case when new.part::text in ('transactions', 'invoices') then '[]'::jsonb else '{}'::jsonb end
    else old.data
  end;

  if new.part::text = 'decisions' then
    decisions_now := old_data;
    if public.lock_dates_of(new.data) is distinct from public.lock_dates_of(old_data) then return new; end if;
  else
    select data into decisions_now from public.book_parts where book_id = new.book_id and part = 'decisions';
  end if;

  dates := public.lock_watch_dates(decisions_now);
  if dates.year_lock is null and dates.gst_lock is null then return new; end if;

  if new.part::text = 'transactions' then
    txns := old_data;
  else
    select data into txns from public.book_parts where book_id = new.book_id and part = 'transactions';
  end if;

  changed := public.lock_watch_changes(new.part::text, old_data, new.data, dates.year_lock, dates.gst_lock, txns);
  if jsonb_array_length(changed) > 0 then
    raise exception 'That period is locked; move the lock date first.' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.lock_watch_note() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Quick win: invitation_email_take() locks both book and inviter
-- ---------------------------------------------------------------------------
create or replace function public.invitation_email_take(book uuid, who text, inviter uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  waiting public.book_invitations;
  books_name text;
  to_address integer;
  from_books integer;
  from_person integer;
begin
  select name into books_name from public.books where id = book and deleted_at is null;
  if not found then
    return jsonb_build_object('ok', false, 'why', 'no-invitation');
  end if;

  select * into waiting from public.book_invitations
  where book_id = book and lower(email) = lower(trim(who)) and state = 'pending';
  if not found then
    return jsonb_build_object('ok', false, 'why', 'no-invitation');
  end if;

  -- Acquire both locks in deterministic order so co-owners cannot race per-book or per-person caps.
  perform pg_advisory_xact_lock(hashtext('invite-book:' || book::text));
  perform pg_advisory_xact_lock(hashtext('invite-person:' || inviter::text));

  select count(*) into to_address from public.invitation_emails
  where book_id = book and lower(email) = lower(trim(who)) and sent_at > now() - interval '1 day';
  if to_address >= 3 then
    return jsonb_build_object('ok', false, 'why', 'address-limit');
  end if;

  select count(*) into from_books from public.invitation_emails
  where book_id = book and sent_at > now() - interval '1 day';
  if from_books >= 20 then
    return jsonb_build_object('ok', false, 'why', 'books-limit');
  end if;

  select count(*) into from_person from public.invitation_emails
  where invited_by = inviter and sent_at > now() - interval '1 day';
  if from_person >= 100 then
    return jsonb_build_object('ok', false, 'why', 'person-limit', 'sent_today', from_person);
  end if;

  insert into public.invitation_emails (book_id, email, invited_by) values (book, trim(who), inviter);
  return jsonb_build_object(
    'ok', true, 'books', books_name, 'role', waiting.role, 'email', waiting.email,
    'sent_today', from_person + 1
  );
end;
$$;

revoke all on function public.invitation_email_take(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.invitation_email_take(uuid, text, uuid) to service_role;
