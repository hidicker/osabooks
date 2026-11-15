-- Two-factor required in all the books a person owns, with one switch.
--
-- An owner could require it one set of books at a time
-- (set_two_factor_required). This turns it on, or off, in every set they own,
-- and keeps it on for books they start afterwards: their choice is kept in
-- account_settings, and a trigger on new books reads it. Each set of books can
-- still be changed on its own afterwards. Turning it on needs the owner signed
-- in with their own code, as the per-book switch does.

create table if not exists public.account_settings (
  user_id            uuid primary key references auth.users(id) on delete cascade,
  require_two_factor boolean not null default false,
  updated_at         timestamptz not null default now()
);

alter table public.account_settings enable row level security;
revoke all on public.account_settings from anon, authenticated;
-- Read through two_factor_everywhere() only; written through the function below.

/** The owner's books, and who in them has not set up an authenticator. */
create or replace function public.two_factor_everywhere()
returns table (on_for_new_books boolean, owned integer, required integer, people_without integer)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with mine as (
    select b.id, b.require_two_factor
    from public.books b
    join public.book_members m on m.book_id = b.id
    where m.user_id = auth.uid() and m.role = 'owner' and b.deleted_at is null
      and not public.from_outside_app()
  )
  select
    coalesce((select s.require_two_factor from public.account_settings s where s.user_id = auth.uid()), false),
    (select count(*)::integer from mine),
    (select count(*)::integer from mine where require_two_factor),
    (select count(distinct m.user_id)::integer
       from public.book_members m
       where m.book_id in (select id from mine)
         and m.user_id <> auth.uid()
         and (m.access_until is null or m.access_until >= current_date)
         and not public.has_two_factor(m.user_id));
$$;

revoke execute on function public.two_factor_everywhere() from public, anon;
grant execute on function public.two_factor_everywhere() to authenticated;

/** On or off in every set of books the caller owns, and for books they start later. */
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
  insert into public.account_settings (user_id, require_two_factor, updated_at)
  values (auth.uid(), p_on, now())
  on conflict (user_id) do update set require_two_factor = excluded.require_two_factor, updated_at = now();
  update public.books b
  set require_two_factor = p_on
  where b.deleted_at is null
    and exists (
      select 1 from public.book_members m
      where m.book_id = b.id and m.user_id = auth.uid() and m.role = 'owner'
    );
  get diagnostics changed = row_count;
  return changed;
end;
$$;

revoke execute on function public.set_two_factor_everywhere(boolean) from public, anon;
grant execute on function public.set_two_factor_everywhere(boolean) to authenticated;

/** Books somebody starts are required from the start when they chose that for all theirs. */
create or replace function public.books_two_factor_from_owner()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if exists (select 1 from public.account_settings s where s.user_id = auth.uid() and s.require_two_factor) then
    new.require_two_factor := true;
  end if;
  return new;
end;
$$;

drop trigger if exists books_two_factor_from_owner on public.books;
create trigger books_two_factor_from_owner
  before insert on public.books
  for each row execute function public.books_two_factor_from_owner();
