-- Pair invoices by (kind, number) in lock_watch_changes so a sales invoice and
-- a supplier bill that share a number never collide under Stage 2 lock dates.
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
      from (
        select
          coalesce(t ->> 'kind', '') || ':' || coalesce(t ->> 'number', '') as doc_key,
          t ->> 'number' as num,
          t ->> 'issued' as d,
          public.lock_watch_doc(t) as v
        from jsonb_array_elements(coalesce(old_data, '[]')) t
        where t ->> 'issued' <= upto
      ) o
      full join (
        select
          coalesce(t ->> 'kind', '') || ':' || coalesce(t ->> 'number', '') as doc_key,
          t ->> 'number' as num,
          t ->> 'issued' as d,
          public.lock_watch_doc(t) as v
        from jsonb_array_elements(coalesce(new_data, '[]')) t
        where t ->> 'issued' <= upto
      ) n
        on o.doc_key = n.doc_key
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
