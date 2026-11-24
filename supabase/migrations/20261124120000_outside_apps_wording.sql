-- The refusal an outside app's token meets at PostgREST said "the NZOSA
-- connector", the app's old name (found trying code review 4.2, 24 November
-- 2026). Only the wording changes: the same test, the same error code.
create or replace function public.refuse_outside_apps()
returns void
language plpgsql
stable
set search_path = public, pg_temp
as $$
begin
  if public.from_outside_app() then
    raise exception using
      errcode = '42501',
      message = 'An app connected through the OsaBooks connector can only use the connector.';
  end if;
end;
$$;

grant execute on function public.refuse_outside_apps() to anon, authenticated, service_role;
