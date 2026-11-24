-- Connecting an AI app while signed in with the authenticator code.
--
-- Supabase issues an outside app's (OAuth) token at aal1 whatever the sign-in
-- that approved it gave (tried on the test project, 24 November 2026), so the
-- connector, which wants aal2 for books that need the code, refused every
-- connection made by somebody with an authenticator. The consent screen asks
-- for the code before it offers Allow; this records that it was given, for the
-- connector to read: this person approved this app while signed in with it.
--
-- Written only through note_connector_consent, which the database itself
-- refuses unless the caller's own sign-in is aal2 -- so a password without the
-- authenticator still cannot connect an app to books that need the code.

create table if not exists public.connector_consents (
  user_id uuid not null references auth.users (id) on delete cascade,
  client_id uuid not null,
  made_at timestamptz not null default now(),
  primary key (user_id, client_id)
);

-- No policies: nobody reads or writes it through the API. The connector reads
-- it with the service key; the function below writes it.
alter table public.connector_consents enable row level security;
revoke all on public.connector_consents from anon, authenticated;
-- The connector reads it with the service key; nothing is granted by default.
grant select on public.connector_consents to service_role;

create or replace function public.note_connector_consent(p_client_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or public.from_outside_app() then
    return false;
  end if;
  -- Only a sign-in that gave the authenticator code.
  if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' then
    return false;
  end if;
  -- Only an app that is registered and not deleted.
  if not exists (select 1 from auth.oauth_clients c where c.id = p_client_id and c.deleted_at is null) then
    return false;
  end if;
  insert into public.connector_consents (user_id, client_id) values (auth.uid(), p_client_id)
  on conflict (user_id, client_id) do update set made_at = now();
  return true;
end;
$$;

revoke all on function public.note_connector_consent(uuid) from public, anon;
grant execute on function public.note_connector_consent(uuid) to authenticated;
