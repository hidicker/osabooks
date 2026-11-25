-- Code review 4.4: return last_sign_in in book_member_list to owners only.
-- Read-only members and bookkeepers still see the member list (needed for
-- sharing), while last_sign_in is null for anyone who is not an owner.

create or replace function public.book_member_list(book uuid)
returns table (
  user_id uuid,
  email text,
  role public.book_role,
  since timestamptz,
  access_until date,
  last_sign_in timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    m.user_id,
    u.email::text,
    m.role,
    m.created_at,
    m.access_until,
    case when public.has_role(book, array['owner']::public.book_role[]) then u.last_sign_in_at else null end
  from public.book_members m
  join auth.users u on u.id = m.user_id
  where m.book_id = book and public.is_member(book)
  order by m.created_at;
$$;

revoke execute on function public.book_member_list(uuid) from public, anon;
grant execute on function public.book_member_list(uuid) to authenticated;
