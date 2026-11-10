-- Two-factor sign-in: a code from an authenticator app, asked at sign-in.
--
-- Supabase's sign-in already offers it (TOTP factors), and a session that has
-- given the code carries `aal2` in its token. Nothing here asks for the code;
-- this decides when books are reachable without it:
--
-- - Somebody who has set up an authenticator is asked for it on every sign-in,
--   for every set of books. Otherwise a stolen password would still open any
--   books whose owner had not required it, and setting it up would protect
--   nothing.
-- - An owner can require it for a set of books, and then everybody in them,
--   accountant included, must have set it up and signed in with it.
--
-- Checked in is_member and has_role, which every policy, every function, the
-- attachments and the edge functions acting as the person already go through.
-- The connector checks it itself (two_factor_needed), as it checks membership.
--
-- A session that has not given its code still signs in: it can list the books
-- waiting for the code (books_waiting_for_two_factor) and set an authenticator
-- up, and nothing else.

alter table public.books add column if not exists require_two_factor boolean not null default false;

comment on column public.books.require_two_factor is
  'Everybody in these books must sign in with an authenticator code. Set by an owner through set_two_factor_required.';

-- How the request signed in: 'aal2' when the code was given. Never fails: a
-- request it cannot read has not given one.
create or replace function public.jwt_aal()
returns text
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  claims text := current_setting('request.jwt.claims', true);
begin
  if claims is null or claims = '' then
    return '';
  end if;
  return coalesce(claims::jsonb ->> 'aal', '');
exception when others then
  return '';
end;
$$;

grant execute on function public.jwt_aal() to authenticated, service_role;

-- Whether a person has an authenticator set up and confirmed.
create or replace function public.has_two_factor(person uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from auth.mfa_factors f
    where f.user_id = person and f.status = 'verified'
  );
$$;

revoke execute on function public.has_two_factor(uuid) from public, anon, authenticated;
grant execute on function public.has_two_factor(uuid) to service_role;

-- Whether this request may reach these books as far as two-factor goes.
create or replace function public.two_factor_ok(book uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.jwt_aal() = 'aal2'
    or (
      not public.has_two_factor(auth.uid())
      and not coalesce((select b.require_two_factor from public.books b where b.id = book), false)
    );
$$;

revoke execute on function public.two_factor_ok(uuid) from public, anon;
grant execute on function public.two_factor_ok(uuid) to authenticated, service_role;

-- As in 20261031120000_outside_apps.sql, and only with two-factor satisfied.
create or replace function public.is_member(book uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select not public.from_outside_app() and public.two_factor_ok(book) and exists (
    select 1 from public.book_members m
    where m.book_id = book and m.user_id = auth.uid()
      and (m.access_until is null or m.access_until >= current_date)
  );
$$;

create or replace function public.has_role(book uuid, roles public.book_role[])
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select not public.from_outside_app() and public.two_factor_ok(book) and exists (
    select 1 from public.book_members m
    where m.book_id = book
      and m.user_id = auth.uid()
      and (m.access_until is null or m.access_until >= current_date)
      and (
        m.role = any (roles)
        or (m.role::text = 'accountant' and 'bookkeeper' = any (roles::text[]))
        or (
          'owner' = any (roles::text[])
          and 'bookkeeper' = any (roles::text[])
          and 'accountant' = any (roles::text[])
        )
      )
  );
$$;

-- An owner requires it, or stops requiring it. Turning it on needs the owner
-- to have signed in with a code themselves, so nobody can lock out the person
-- doing the locking. Turning it off needs only what has_role already asks.
create or replace function public.set_two_factor_required(p_book uuid, p_on boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.has_role(p_book, array['owner']::public.book_role[]) then
    -- An owner whose code these books are waiting for is told that, not that
    -- they are not an owner.
    if not public.two_factor_ok(p_book) and exists (
      select 1 from public.book_members m
      where m.book_id = p_book and m.user_id = auth.uid() and m.role = 'owner'
    ) then
      raise exception 'Sign in with the code from your authenticator app first.' using errcode = '42501';
    end if;
    raise exception 'Only an owner can change this.' using errcode = '42501';
  end if;
  if p_on and public.jwt_aal() <> 'aal2' then
    raise exception 'Set up two-factor sign-in for yourself, and sign in with it, first.' using errcode = '42501';
  end if;
  update public.books set require_two_factor = p_on where id = p_book;
end;
$$;

revoke execute on function public.set_two_factor_required(uuid, boolean) from public, anon;
grant execute on function public.set_two_factor_required(uuid, boolean) to authenticated;

-- The books this person belongs to that are waiting for their code: named, so
-- the books list can say why they are not there rather than leave them out.
-- `required` says whether the owner asked for it (the person may not have set
-- it up yet) or it is their own authenticator.
create or replace function public.books_waiting_for_two_factor()
returns table (id uuid, name text, required boolean)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select b.id, b.name, b.require_two_factor
  from public.books b
  join public.book_members m on m.book_id = b.id
  where m.user_id = auth.uid()
    and (m.access_until is null or m.access_until >= current_date)
    and b.deleted_at is null
    and not public.from_outside_app()
    and not public.two_factor_ok(b.id)
  order by b.name;
$$;

revoke execute on function public.books_waiting_for_two_factor() from public, anon;
grant execute on function public.books_waiting_for_two_factor() to authenticated;

-- For the members page: whether these books require it, and who has set it up.
create or replace function public.book_two_factor(p_book uuid)
returns table (required boolean, user_id uuid, has_two_factor boolean)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select b.require_two_factor, m.user_id, public.has_two_factor(m.user_id)
  from public.books b
  join public.book_members m on m.book_id = b.id
  where b.id = p_book and public.is_member(p_book);
$$;

revoke execute on function public.book_two_factor(uuid) from public, anon;
grant execute on function public.book_two_factor(uuid) to authenticated;

-- For the connector, which checks membership with the service key: whether
-- this person must have given a code to reach these books.
create or replace function public.two_factor_needed(p_book uuid, p_person uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.has_two_factor(p_person)
    or coalesce((select b.require_two_factor from public.books b where b.id = p_book), false);
$$;

revoke execute on function public.two_factor_needed(uuid, uuid) from public, anon, authenticated;
grant execute on function public.two_factor_needed(uuid, uuid) to service_role;
