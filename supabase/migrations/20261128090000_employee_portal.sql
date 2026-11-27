-- Employee Self-Service Payroll Portal (with optional/enforced 2FA).
--
-- Employees are NEVER added to book_members, because book_parts stores all
-- employees and pay runs in one JSONB row ('payroll'). Instead, employees are
-- linked via public.employee_portal_access and read strictly projected slices
-- of their own employee record, pay lines, and leave through SECURITY DEFINER
-- RPCs gated by two_factor_ok(book).
--
-- Leave requests live in public.employee_leave_requests so employees never
-- write to book_parts directly; owners/bookkeepers review and approve them in
-- the Payroll screen.

-- ---------------------------------------------------------------------------
-- 1. Tables (RLS enabled, zero direct table access)
-- ---------------------------------------------------------------------------

create table if not exists public.employee_portal_access (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.books (id) on delete cascade,
  employee_id text not null check (length(trim(employee_id)) between 1 and 120),
  email text not null check (length(trim(email)) between 3 and 320),
  user_id uuid references auth.users (id) on delete set null,
  state text not null default 'invited' check (state in ('invited', 'active', 'revoked')),
  invited_by uuid references auth.users (id) on delete set null,
  invited_at timestamptz not null default now(),
  accepted_at timestamptz,
  revoked_at timestamptz
);

create unique index if not exists employee_portal_access_live_emp
  on public.employee_portal_access (book_id, employee_id)
  where state <> 'revoked';

create index if not exists employee_portal_access_invited_email
  on public.employee_portal_access (lower(email))
  where state = 'invited';

create index if not exists employee_portal_access_active_user
  on public.employee_portal_access (user_id)
  where state = 'active';

alter table public.employee_portal_access enable row level security;
revoke all on public.employee_portal_access from public, anon, authenticated;

create table if not exists public.employee_leave_requests (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.books (id) on delete cascade,
  employee_id text not null check (length(trim(employee_id)) between 1 and 120),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('annual', 'sick', 'bereavement', 'alternative', 'other')),
  from_date date not null,
  to_date date not null,
  days numeric(6,2) not null check (days > 0 and days <= 366),
  note text not null default '' check (length(note) <= 500),
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined', 'cancelled')),
  decision_note text not null default '' check (length(decision_note) <= 500),
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  check (to_date >= from_date)
);

create index if not exists employee_leave_requests_book_status
  on public.employee_leave_requests (book_id, status, created_at desc);

create index if not exists employee_leave_requests_user
  on public.employee_leave_requests (user_id, book_id, created_at desc);

alter table public.employee_leave_requests enable row level security;
revoke all on public.employee_leave_requests from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Account cap: allow invited employees & invited book members to sign up
-- ---------------------------------------------------------------------------

create or replace function public.limit_accounts()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  addr text := lower(coalesce(new.email, ''));
begin
  if addr <> '' and (
    exists (
      select 1 from public.employee_portal_access a
      where a.state = 'invited' and lower(a.email) = addr
    )
    or exists (
      select 1 from public.book_invitations i
      where i.state = 'pending' and lower(i.email) = addr
    )
  ) then
    return new;
  end if;

  if (select count(*) from auth.users) >= 15 then
    raise exception 'Online accounts are limited at this stage. Please contact nzosa@proton.me.'
      using errcode = 'PT429';
  end if;
  return new;
end;
$$;

revoke all on function public.limit_accounts() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Employer RPCs (invite, list, revoke, review leave requests)
-- ---------------------------------------------------------------------------

create or replace function public.employee_portal_list(p_book uuid)
returns table (
  id uuid,
  employee_id text,
  email text,
  state text,
  invited_at timestamptz,
  accepted_at timestamptz,
  has_two_factor boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    a.id,
    a.employee_id,
    a.email,
    a.state,
    a.invited_at,
    a.accepted_at,
    case when a.user_id is not null then public.has_two_factor(a.user_id) else false end as has_two_factor
  from public.employee_portal_access a
  where a.book_id = p_book
    and a.state <> 'revoked'
    and public.is_member(p_book)
    and public.book_live(p_book)
  order by a.invited_at desc;
$$;

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

  insert into public.employee_portal_access (book_id, employee_id, email, invited_by)
  values (p_book, clean_emp, clean_email, auth.uid())
  returning id into created_id;

  return created_id;
end;
$$;

create or replace function public.employee_portal_revoke(
  p_book uuid,
  p_employee_id text
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.has_role(p_book, array['owner', 'bookkeeper']::public.book_role[])
     or not public.book_live(p_book) then
    raise exception 'Only an owner, accountant or bookkeeper can revoke employee portal access.'
      using errcode = '42501';
  end if;

  update public.employee_portal_access
  set state = 'revoked', revoked_at = now(), user_id = null
  where book_id = p_book
    and employee_id = trim(coalesce(p_employee_id, ''))
    and state <> 'revoked';

  return case when found then 'revoked' else 'none' end;
end;
$$;

create or replace function public.employee_leave_requests_for_book(p_book uuid)
returns table (
  id uuid,
  employee_id text,
  kind text,
  from_date date,
  to_date date,
  days numeric,
  note text,
  status text,
  decision_note text,
  decided_at timestamptz,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    r.id, r.employee_id, r.kind, r.from_date, r.to_date, r.days,
    r.note, r.status, r.decision_note, r.decided_at, r.created_at
  from public.employee_leave_requests r
  where r.book_id = p_book
    and public.is_member(p_book)
    and public.book_live(p_book)
  order by
    case when r.status = 'pending' then 0 else 1 end,
    r.created_at desc;
$$;

create or replace function public.employee_leave_request_decide(
  p_request_id uuid,
  p_status text,
  p_note text default ''
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  req public.employee_leave_requests;
begin
  if p_status not in ('approved', 'declined') then
    raise exception 'Decision must be approved or declined.' using errcode = '22023';
  end if;

  select * into req
  from public.employee_leave_requests
  where id = p_request_id
  for update;

  if req.id is null then
    return 'not found';
  end if;

  if not public.has_role(req.book_id, array['owner', 'bookkeeper']::public.book_role[])
     or not public.book_live(req.book_id) then
    raise exception 'Only an owner, accountant or bookkeeper can decide leave requests.'
      using errcode = '42501';
  end if;

  if req.status <> 'pending' then
    return req.status;
  end if;

  update public.employee_leave_requests
  set status = p_status,
      decision_note = left(trim(coalesce(p_note, '')), 500),
      decided_by = auth.uid(),
      decided_at = now()
  where id = req.id;

  return p_status;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Employee Portal RPCs (strictly scoped to the signed-in employee)
-- ---------------------------------------------------------------------------

-- Lists active employers & pending invitations for the signed-in user.
-- Allowed before aal2 so the portal can prompt for a 2FA code or setup.
create or replace function public.employee_portal_employers()
returns table (
  access_id uuid,
  book_id uuid,
  book_name text,
  employee_id text,
  state text,
  invited_at timestamptz,
  accepted_at timestamptz,
  require_two_factor boolean,
  two_factor_ok boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    a.id as access_id,
    a.book_id,
    b.name as book_name,
    a.employee_id,
    a.state,
    a.invited_at,
    a.accepted_at,
    b.require_two_factor,
    public.two_factor_ok(a.book_id) as two_factor_ok
  from public.employee_portal_access a
  join public.books b on b.id = a.book_id
  where auth.uid() is not null
    and not public.from_outside_app()
    and b.deleted_at is null
    and (
      (a.state = 'active' and a.user_id = auth.uid())
      or (a.state = 'invited' and public.my_email() <> '' and lower(a.email) = public.my_email())
    )
  order by
    case when a.state = 'active' then 0 else 1 end,
    b.name;
$$;

create or replace function public.employee_portal_accept(p_access_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  held public.employee_portal_access;
begin
  if auth.uid() is null or public.from_outside_app() then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;
  if not public.user_two_factor_ok() then
    raise exception 'Sign in with the code from your authenticator app first.' using errcode = '42501';
  end if;

  select * into held
  from public.employee_portal_access
  where id = p_access_id
    and state = 'invited'
    and public.my_email() <> ''
    and lower(email) = public.my_email()
  for update;

  if held.id is null or not public.book_live(held.book_id) then
    return 'not yours';
  end if;

  update public.employee_portal_access
  set user_id = auth.uid(),
      state = 'active',
      accepted_at = now()
  where id = held.id;

  return 'accepted';
end;
$$;

-- Returns ONLY the signed-in employee's own payroll data from book_parts.
create or replace function public.employee_portal_data(p_book uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  access_row public.employee_portal_access;
  book_name text;
  payroll_json jsonb;
  entities_json jsonb;
  emp_obj jsonb;
  emp_ird text;
  employer_name text;
  filtered_runs jsonb;
  filtered_leave jsonb;
  emp_leave_settings jsonb;
  emp_requests jsonb;
begin
  if auth.uid() is null or public.from_outside_app() then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;

  select * into access_row
  from public.employee_portal_access
  where book_id = p_book
    and user_id = auth.uid()
    and state = 'active'
  limit 1;

  if access_row.id is null or not public.book_live(p_book) then
    raise exception 'No active employee portal access for these books.' using errcode = '42501';
  end if;

  if not public.two_factor_ok(p_book) then
    raise exception 'Two-factor sign-in is required before viewing payroll.' using errcode = '42501';
  end if;

  select b.name into book_name from public.books b where b.id = p_book;
  select p.data into payroll_json from public.book_parts p where p.book_id = p_book and p.part = 'payroll';
  select p.data into entities_json from public.book_parts p where p.book_id = p_book and p.part = 'entities';

  if payroll_json is null then
    payroll_json := '{}'::jsonb;
  end if;

  emp_ird := coalesce(payroll_json ->> 'employerIrd', '');

  -- Resolve employer display name from entities (matching employerIrd, or first business entity, else book name).
  select coalesce(
    (
      select e ->> 'name'
      from jsonb_array_elements(coalesce(entities_json -> 'entities', '[]'::jsonb)) e
      where emp_ird <> ''
        and regexp_replace(coalesce(e ->> 'gstNumber', ''), '\D', '', 'g') = regexp_replace(emp_ird, '\D', '', 'g')
      limit 1
    ),
    (
      select e ->> 'name'
      from jsonb_array_elements(coalesce(entities_json -> 'entities', '[]'::jsonb)) e
      where coalesce(e ->> 'kind', 'business') in ('business', 'nonprofit')
      limit 1
    ),
    book_name
  ) into employer_name;

  select e into emp_obj
  from jsonb_array_elements(coalesce(payroll_json -> 'employees', '[]'::jsonb)) e
  where e ->> 'id' = access_row.employee_id
  limit 1;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', r -> 'id',
        'periodStart', r -> 'periodStart',
        'periodEnd', r -> 'periodEnd',
        'payDate', r -> 'payDate',
        'taxYear', r -> 'taxYear',
        'employerIrd', coalesce(r -> 'employerIrd', to_jsonb(emp_ird)),
        'lines', (
          select coalesce(jsonb_agg(l), '[]'::jsonb)
          from jsonb_array_elements(coalesce(r -> 'lines', '[]'::jsonb)) l
          where l ->> 'employeeId' = access_row.employee_id
        )
      )
      order by r ->> 'payDate' desc
    ),
    '[]'::jsonb
  )
  into filtered_runs
  from jsonb_array_elements(coalesce(payroll_json -> 'payRuns', '[]'::jsonb)) r
  where exists (
    select 1
    from jsonb_array_elements(coalesce(r -> 'lines', '[]'::jsonb)) l
    where l ->> 'employeeId' = access_row.employee_id
  );

  select coalesce(jsonb_agg(lv), '[]'::jsonb)
  into filtered_leave
  from jsonb_array_elements(coalesce(payroll_json -> 'leave', '[]'::jsonb)) lv
  where lv ->> 'employeeId' = access_row.employee_id;

  select ls into emp_leave_settings
  from jsonb_array_elements(coalesce(payroll_json -> 'leaveSettings', '[]'::jsonb)) ls
  where ls ->> 'employeeId' = access_row.employee_id
  limit 1;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', req.id,
        'kind', req.kind,
        'from_date', req.from_date,
        'to_date', req.to_date,
        'days', req.days,
        'note', req.note,
        'status', req.status,
        'decision_note', req.decision_note,
        'decided_at', req.decided_at,
        'created_at', req.created_at
      )
      order by req.created_at desc
    ),
    '[]'::jsonb
  )
  into emp_requests
  from public.employee_leave_requests req
  where req.book_id = p_book
    and req.employee_id = access_row.employee_id
    and req.user_id = auth.uid();

  return jsonb_build_object(
    'bookId', p_book,
    'bookName', book_name,
    'employerName', employer_name,
    'employerIrd', emp_ird,
    'employeeId', access_row.employee_id,
    'employee', emp_obj,
    'payRuns', filtered_runs,
    'leave', filtered_leave,
    'leaveSettings', emp_leave_settings,
    'leaveRequests', emp_requests
  );
end;
$$;

create or replace function public.employee_leave_request_submit(
  p_book uuid,
  p_kind text,
  p_from date,
  p_to date,
  p_days numeric,
  p_note text default ''
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  access_row public.employee_portal_access;
  created_id uuid;
begin
  if auth.uid() is null or public.from_outside_app() then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;

  select * into access_row
  from public.employee_portal_access
  where book_id = p_book
    and user_id = auth.uid()
    and state = 'active'
  limit 1;

  if access_row.id is null or not public.book_live(p_book) then
    raise exception 'No active employee portal access for these books.' using errcode = '42501';
  end if;
  if not public.two_factor_ok(p_book) then
    raise exception 'Two-factor sign-in is required.' using errcode = '42501';
  end if;
  if p_kind not in ('annual', 'sick', 'bereavement', 'alternative', 'other') then
    raise exception 'Invalid leave type.' using errcode = '22023';
  end if;
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'End date must be on or after start date.' using errcode = '22023';
  end if;
  if p_days is null or p_days <= 0 or p_days > 366 then
    raise exception 'Days must be between 0.01 and 366.' using errcode = '22023';
  end if;

  insert into public.employee_leave_requests (
    book_id, employee_id, user_id, kind, from_date, to_date, days, note
  )
  values (
    p_book, access_row.employee_id, auth.uid(), p_kind, p_from, p_to, p_days,
    left(trim(coalesce(p_note, '')), 500)
  )
  returning id into created_id;

  return created_id;
end;
$$;

create or replace function public.employee_leave_request_cancel(p_request_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or public.from_outside_app() then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;
  if not public.user_two_factor_ok() then
    raise exception 'Sign in with the code from your authenticator app first.' using errcode = '42501';
  end if;

  update public.employee_leave_requests
  set status = 'cancelled', decided_at = now()
  where id = p_request_id
    and user_id = auth.uid()
    and status = 'pending';

  return case when found then 'cancelled' else 'not found' end;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Grants
-- ---------------------------------------------------------------------------

revoke execute on function public.employee_portal_list(uuid) from public, anon;
revoke execute on function public.employee_portal_invite(uuid, text, text) from public, anon;
revoke execute on function public.employee_portal_revoke(uuid, text) from public, anon;
revoke execute on function public.employee_leave_requests_for_book(uuid) from public, anon;
revoke execute on function public.employee_leave_request_decide(uuid, text, text) from public, anon;
revoke execute on function public.employee_portal_employers() from public, anon;
revoke execute on function public.employee_portal_accept(uuid) from public, anon;
revoke execute on function public.employee_portal_data(uuid) from public, anon;
revoke execute on function public.employee_leave_request_submit(uuid, text, date, date, numeric, text) from public, anon;
revoke execute on function public.employee_leave_request_cancel(uuid) from public, anon;

grant execute on function public.employee_portal_list(uuid) to authenticated;
grant execute on function public.employee_portal_invite(uuid, text, text) to authenticated;
grant execute on function public.employee_portal_revoke(uuid, text) to authenticated;
grant execute on function public.employee_leave_requests_for_book(uuid) to authenticated;
grant execute on function public.employee_leave_request_decide(uuid, text, text) to authenticated;
grant execute on function public.employee_portal_employers() to authenticated;
grant execute on function public.employee_portal_accept(uuid) to authenticated;
grant execute on function public.employee_portal_data(uuid) to authenticated;
grant execute on function public.employee_leave_request_submit(uuid, text, date, date, numeric, text) to authenticated;
grant execute on function public.employee_leave_request_cancel(uuid) to authenticated;
