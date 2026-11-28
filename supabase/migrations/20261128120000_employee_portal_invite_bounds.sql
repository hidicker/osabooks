-- Employee portal invites: only for employees on the books' payroll, and a
-- bounded number per set of books (review of 28 November 2026).
--
-- An address invited to the portal may sign up past the account cap
-- (limit_accounts, 20261128090000_employee_portal.sql). Invites took any
-- employee id and any address, so anyone with books could invite as many of
-- their own addresses as they liked and sign them all up past the cap. Now an
-- invite names an employee the books' payroll actually has, and a set of
-- books holds at most 100 live portal accesses.

create or replace function public.employee_portal_invite(
  p_book uuid,
  p_employee_id text,
  p_email text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  clean_emp text := trim(coalesce(p_employee_id, ''));
  clean_email text := trim(coalesce(p_email, ''));
  existing public.employee_portal_access;
  created_id uuid;
  live_count integer;
begin
  if not public.has_role(p_book, array['owner', 'bookkeeper']::public.book_role[])
     or not public.book_live(p_book) then
    raise exception 'Only an owner, accountant or bookkeeper can invite employees to the payroll portal.'
      using errcode = '42501';
  end if;
  if clean_emp = '' or length(clean_emp) > 120 then
    raise exception 'Invalid employee id.' using errcode = '22023';
  end if;
  if clean_email = '' or length(clean_email) > 320 or position('@' in clean_email) = 0
     or clean_email ~ E'[\\r\\n]' then
    raise exception 'Enter a valid email address.' using errcode = 'PT400';
  end if;

  -- Only an employee these books' payroll actually has.
  if not exists (
    select 1
    from public.book_parts p,
         jsonb_array_elements(case when jsonb_typeof(p.data -> 'employees') = 'array' then p.data -> 'employees' else '[]'::jsonb end) e
    where p.book_id = p_book
      and p.part = 'payroll'
      and e ->> 'id' = clean_emp
  ) then
    raise exception 'That employee is not on the payroll of these books.' using errcode = '22023';
  end if;

  -- One invite at a time per set of books, so the count below holds.
  perform pg_advisory_xact_lock(hashtext('portal-invite:' || p_book::text));

  select * into existing
  from public.employee_portal_access
  where book_id = p_book and employee_id = clean_emp and state <> 'revoked'
  for update;

  if existing.id is not null then
    if lower(existing.email) = lower(clean_email) and existing.state = 'invited' then
      update public.employee_portal_access
      set email = clean_email, invited_by = auth.uid(), invited_at = now()
      where id = existing.id;
      return existing.id;
    end if;
    if lower(existing.email) = lower(clean_email) and existing.state = 'active' then
      return existing.id;
    end if;
    update public.employee_portal_access
    set state = 'revoked', revoked_at = now(), user_id = null
    where id = existing.id;
  end if;

  select count(*) into live_count
  from public.employee_portal_access
  where book_id = p_book and state <> 'revoked';
  if live_count >= 100 then
    raise exception 'These books already have 100 employees invited to the portal.' using errcode = 'PT429';
  end if;

  insert into public.employee_portal_access (book_id, employee_id, email, invited_by)
  values (p_book, clean_emp, clean_email, auth.uid())
  returning id into created_id;

  return created_id;
end;
$$;

revoke execute on function public.employee_portal_invite(uuid, text, text) from public, anon;
grant execute on function public.employee_portal_invite(uuid, text, text) to authenticated;
