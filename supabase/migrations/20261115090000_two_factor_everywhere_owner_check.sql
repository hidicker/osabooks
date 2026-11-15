-- The one switch for two-factor in all of a person's books changes only the
-- books they can open as an owner now, as the per-book switch does.
--
-- It changed every set of books in which they were listed as an owner. A
-- co-owner shut out of a set of books because it needs a code they have not
-- set up could turn the requirement off there, and so could somebody with
-- only an owner's password. Now a set of books is changed only through
-- has_role, which asks for the code a set of books needs, and somebody who
-- has an authenticator must sign in with it to turn the requirement off as
-- well as on.

create or replace function public.set_two_factor_everywhere(p_on boolean)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  changed integer;
begin
  if auth.uid() is null or public.from_outside_app() then
    raise exception 'Only you can change this, signed in to OsaBooks.' using errcode = '42501';
  end if;
  if p_on and public.jwt_aal() <> 'aal2' then
    raise exception 'Set up two-factor sign-in for yourself, and sign in with it, first.' using errcode = '42501';
  end if;
  if not p_on and public.has_two_factor(auth.uid()) and public.jwt_aal() <> 'aal2' then
    raise exception 'Sign in with your authenticator code first.' using errcode = '42501';
  end if;
  insert into public.account_settings (user_id, require_two_factor, updated_at)
  values (auth.uid(), p_on, now())
  on conflict (user_id) do update set require_two_factor = excluded.require_two_factor, updated_at = now();
  update public.books b
  set require_two_factor = p_on
  where b.deleted_at is null
    and public.has_role(b.id, array['owner']::public.book_role[]);
  get diagnostics changed = row_count;
  return changed;
end;
$$;

revoke execute on function public.set_two_factor_everywhere(boolean) from public, anon;
grant execute on function public.set_two_factor_everywhere(boolean) to authenticated;
