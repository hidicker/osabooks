-- Connector consents hardening & revocation (Antigravity review 25 November, H2 / L11).
-- Adds explicit PUBLIC revoke on the table, aligns note_connector_consent with
-- public.jwt_aal(), and adds revoke_connector_consent so denying or revoking an
-- app clears the recorded aal2 consent.

revoke all on public.connector_consents from public, anon, authenticated;

create or replace function public.note_connector_consent(p_client_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    return false;
  end if;
  if public.from_outside_app() then
    return false;
  end if;
  if public.jwt_aal() <> 'aal2' then
    return false;
  end if;
  if not exists (select 1 from auth.oauth_clients where id = p_client_id and deleted_at is null) then
    return false;
  end if;
  insert into public.connector_consents (user_id, client_id, made_at)
  values (auth.uid(), p_client_id, now())
  on conflict (user_id, client_id) do update set made_at = now();
  return true;
end;
$$;

revoke execute on function public.note_connector_consent(uuid) from public, anon;
grant execute on function public.note_connector_consent(uuid) to authenticated;

create or replace function public.revoke_connector_consent(p_client_id uuid default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or public.from_outside_app() then
    return;
  end if;
  if p_client_id is null then
    delete from public.connector_consents where user_id = auth.uid();
  else
    delete from public.connector_consents where user_id = auth.uid() and client_id = p_client_id;
  end if;
end;
$$;

revoke execute on function public.revoke_connector_consent(uuid) from public, anon;
grant execute on function public.revoke_connector_consent(uuid) to authenticated;
