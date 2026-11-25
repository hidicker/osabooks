-- Deep security audit hardening (Wave 2):
--   M7:  Enforce user_two_factor_ok() on account-scoped SECURITY DEFINER RPCs
--   M8:  Enforce book_live() on book_members RLS and book-scoped RPCs
--   M9:  Enforce 20-book cap in restore_book and serialize book creation/restore
--   M10: Protect last-owner invariant with FOR UPDATE in remove_book_member & accept_invitation
--   M11: Serialize quota checks with advisory locks in ai_take, invitation_email_take, reminder_email_take
--   L1:  Fire lock_watch trigger on BEFORE INSERT OR UPDATE OF data

-- ---------------------------------------------------------------------------
-- M7: Account-scoped 2FA helper
-- ---------------------------------------------------------------------------
create or replace function public.user_two_factor_ok()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null
     and not public.from_outside_app()
     and (public.jwt_aal() = 'aal2' or not public.has_two_factor(auth.uid()));
$$;

revoke all on function public.user_two_factor_ok() from public, anon;
grant execute on function public.user_two_factor_ok() to authenticated;

-- ---------------------------------------------------------------------------
-- M8: book_members RLS hides deleted books
-- ---------------------------------------------------------------------------
drop policy if exists members_read on public.book_members;
create policy members_read on public.book_members
  for select using (public.is_member(book_id) and public.book_live(book_id));

-- ---------------------------------------------------------------------------
-- M7 + M9: create_book & restore_book (2FA check + advisory lock + 20-book cap)
-- ---------------------------------------------------------------------------
create or replace function public.create_book(wanted text)
returns setof public.books
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
  made public.books;
  held integer;
begin
  if me is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if not public.user_two_factor_ok() then
    raise exception 'Sign in with the code from your authenticator app first.' using errcode = '42501';
  end if;
  if coalesce(trim(wanted), '') = '' then
    raise exception 'a set of books needs a name' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('book-cap:' || me::text));

  select count(*) into held from public.books
  where created_by = me and deleted_at is null;
  if held >= 20 then
    raise exception 'that is twenty sets of books already; retire one first'
      using errcode = 'PT429';
  end if;

  insert into public.books (name, created_by)
  values (trim(wanted), me)
  returning * into made;

  return query select * from public.books b where b.id = made.id;
end;
$$;

create or replace function public.restore_book(book uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  creator uuid;
  held integer;
begin
  if not public.has_role(book, array['owner']::public.book_role[]) then
    raise exception 'only an owner may restore these books' using errcode = '42501';
  end if;

  select created_by into creator from public.books
  where id = book and deleted_at is not null;
  if creator is null then
    return 'restored';
  end if;

  perform pg_advisory_xact_lock(hashtext('book-cap:' || creator::text));

  select count(*) into held from public.books
  where created_by = creator and deleted_at is null;
  if held >= 20 then
    raise exception 'that is twenty sets of books already; retire one first'
      using errcode = 'PT429';
  end if;

  update public.books set deleted_at = null where id = book and deleted_at is not null;
  return 'restored';
end;
$$;

-- ---------------------------------------------------------------------------
-- M7 + M8 + M10: invitations & membership RPCs
-- ---------------------------------------------------------------------------
create or replace function public.invite_to_book(
  book uuid,
  who text,
  as_role public.book_role
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.has_role(book, array['owner']::public.book_role[]) or not public.book_live(book) then
    raise exception 'only an owner may invite somebody to these books'
      using errcode = '42501';
  end if;
  if coalesce(trim(who), '') = '' or position('@' in who) = 0 or who ~ E'[\\r\\n,<>]' then
    raise exception 'that is not an email address' using errcode = 'PT400';
  end if;

  insert into public.book_invitations (book_id, email, role, invited_by)
  values (book, trim(who), as_role, auth.uid())
  on conflict (book_id, lower(email)) where state = 'pending'
  do update set role = excluded.role, created_at = now(), invited_by = auth.uid();

  return 'invited';
end;
$$;

create or replace function public.my_invitations()
returns table (id uuid, books text, role public.book_role, invited_by text, sent timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select i.id, b.name, i.role, coalesce(u.email::text, ''), i.created_at
  from public.book_invitations i
  join public.books b on b.id = i.book_id
  left join auth.users u on u.id = i.invited_by
  where public.user_two_factor_ok()
    and i.state = 'pending'
    and lower(i.email) = public.my_email()
    and public.my_email() <> ''
    and b.deleted_at is null
  order by i.created_at;
$$;

create or replace function public.decline_invitation(invitation uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.user_two_factor_ok() then
    raise exception 'Sign in with the code from your authenticator app first.' using errcode = '42501';
  end if;
  update public.book_invitations
  set state = 'declined', responded_at = now()
  where id = invitation and state = 'pending' and lower(email) = public.my_email();
  return case when found then 'declined' else 'not yours' end;
end;
$$;

create or replace function public.accept_invitation(invitation uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  held public.book_invitations;
  current_role public.book_role;
  owners integer;
begin
  if not public.user_two_factor_ok() then
    raise exception 'Sign in with the code from your authenticator app first.' using errcode = '42501';
  end if;
  select * into held from public.book_invitations
  where id = invitation and state = 'pending' and lower(email) = public.my_email();
  if held.id is null or not public.book_live(held.book_id) then
    return 'not yours';
  end if;

  -- Lock parent book row to serialize role / owner updates.
  perform 1 from public.books where id = held.book_id for update;

  select role into current_role from public.book_members
  where book_id = held.book_id and user_id = auth.uid();
  if current_role = 'owner' and held.role <> 'owner' then
    select count(*) into owners from public.book_members
    where book_id = held.book_id and role = 'owner';
    if owners <= 1 then
      return 'last owner';
    end if;
  end if;

  insert into public.book_members (book_id, user_id, role, added_by, access_until)
  values (
    held.book_id,
    auth.uid(),
    held.role,
    held.invited_by,
    case when held.role = 'owner' then null else held.access_until end
  )
  on conflict (book_id, user_id) do update
  set role = excluded.role,
      access_until = case when excluded.role = 'owner' then null else excluded.access_until end;

  update public.book_invitations
  set state = 'accepted', responded_at = now()
  where id = invitation;
  return 'accepted';
end;
$$;

create or replace function public.remove_book_member(book uuid, who uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  owners integer;
  their_role public.book_role;
begin
  if not public.has_role(book, array['owner']::public.book_role[]) or not public.book_live(book) then
    raise exception 'only an owner may remove somebody from these books' using errcode = '42501';
  end if;

  -- Lock parent book row so concurrent co-owner removals cannot leave zero owners.
  perform 1 from public.books where id = book for update;

  select role into their_role from public.book_members
  where book_id = book and user_id = who;
  if their_role is null then
    return 'not a member';
  end if;

  select count(*) into owners from public.book_members
  where book_id = book and role = 'owner';
  if their_role = 'owner' and owners <= 1 then
    return 'last owner';
  end if;

  delete from public.book_members where book_id = book and user_id = who;
  return 'removed';
end;
$$;

create or replace function public.set_access_until(book uuid, who text, until date)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  touched integer := 0;
  n integer;
begin
  if not public.has_role(book, array['owner']::public.book_role[]) or not public.book_live(book) then
    raise exception 'only an owner may say how long somebody has these books' using errcode = '42501';
  end if;
  if until is not null and until < current_date then
    raise exception 'that date has passed' using errcode = 'PT400';
  end if;

  update public.book_invitations
  set access_until = until
  where book_id = book and state = 'pending' and lower(email) = lower(trim(who)) and role <> 'owner';
  get diagnostics n = row_count;
  touched := touched + n;

  update public.book_members m
  set access_until = until
  from auth.users u
  where m.book_id = book and m.user_id = u.id and lower(u.email) = lower(trim(who)) and m.role <> 'owner';
  get diagnostics n = row_count;
  touched := touched + n;

  return case when touched > 0 then 'set' else 'nobody' end;
end;
$$;

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
    case
      when public.has_role(book, array['owner']::public.book_role[]) then u.last_sign_in_at
      else null::timestamptz
    end
  from public.book_members m
  join auth.users u on u.id = m.user_id
  where m.book_id = book and public.is_member(book) and public.book_live(book)
  order by m.created_at;
$$;

create or replace function public.book_invitation_list(book uuid)
returns table (id uuid, email text, role public.book_role, sent timestamptz, access_until date)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select i.id, i.email, i.role, i.created_at, i.access_until
  from public.book_invitations i
  where i.book_id = book and i.state = 'pending' and public.is_member(book) and public.book_live(book)
  order by i.created_at;
$$;

-- ---------------------------------------------------------------------------
-- M7 + M8: 2FA, feeds, AI, lock_watch RPCs enforce book_live / user_two_factor_ok
-- ---------------------------------------------------------------------------
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
    where public.user_two_factor_ok()
      and m.user_id = auth.uid() and m.role = 'owner' and b.deleted_at is null
  )
  select
    case when public.user_two_factor_ok()
      then coalesce((select s.require_two_factor from public.account_settings s where s.user_id = auth.uid()), false)
      else false
    end,
    (select count(*)::integer from mine),
    (select count(*)::integer from mine where require_two_factor),
    (select count(distinct m.user_id)::integer
       from public.book_members m
       where m.book_id in (select id from mine)
         and m.user_id <> auth.uid()
         and (m.access_until is null or m.access_until >= current_date)
         and not public.has_two_factor(m.user_id));
$$;

create or replace function public.set_two_factor_required(p_book uuid, p_on boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.book_live(p_book) then
    raise exception 'Only an owner can change this.' using errcode = '42501';
  end if;
  if not public.has_role(p_book, array['owner']::public.book_role[]) then
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
  where b.id = p_book and public.is_member(p_book) and public.book_live(p_book);
$$;

create or replace function public.feed_status(book uuid)
returns table (connected boolean, accounts jsonb, settings jsonb, balances jsonb, last_fetch timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select true, f.accounts, f.settings, f.balances, f.last_fetch
  from public.bank_feeds f
  where f.book_id = book and public.is_member(book) and public.book_live(book);
$$;

create or replace function public.set_ai_key(book uuid, key text, model text default null)
returns void
language plpgsql
security definer
set search_path = public, vault, pg_temp
as $$
declare
  held public.ai_secrets;
  made uuid;
begin
  if not public.has_role(book, array['owner', 'bookkeeper']::public.book_role[]) or not public.book_live(book) then
    raise exception 'not your books' using errcode = 'PT403';
  end if;

  select * into held from public.ai_secrets s where s.book = set_ai_key.book;
  if held is null then
    made := vault.create_secret(key, 'ai-key-' || book::text, 'Model API key');
    insert into public.ai_secrets (book, key_secret, model)
    values (book, made, coalesce(model, 'gemini-3.6-flash'));
  else
    perform vault.update_secret(held.key_secret, key);
    update public.ai_secrets s
    set model = coalesce(set_ai_key.model, s.model)
    where s.book = set_ai_key.book;
  end if;
end;
$$;

create or replace function public.set_ai_model(book uuid, model text, models jsonb default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.has_role(book, array['owner', 'bookkeeper']::public.book_role[]) or not public.book_live(book) then
    raise exception 'not your books' using errcode = 'PT403';
  end if;
  update public.ai_secrets s
  set model = set_ai_model.model,
      models = coalesce(set_ai_model.models, s.models)
  where s.book = set_ai_model.book;
end;
$$;

create or replace function public.clear_ai_key(book uuid)
returns void
language plpgsql
security definer
set search_path = public, vault, pg_temp
as $$
declare
  held public.ai_secrets;
begin
  if not public.has_role(book, array['owner', 'bookkeeper']::public.book_role[]) or not public.book_live(book) then
    raise exception 'not your books' using errcode = 'PT403';
  end if;
  select * into held from public.ai_secrets s where s.book = clear_ai_key.book;
  if held is null then
    return;
  end if;
  delete from public.ai_secrets s where s.book = clear_ai_key.book;
  delete from vault.secrets where id = held.key_secret;
end;
$$;

create or replace function public.ai_state(book uuid)
returns table (
  configured boolean,
  key text,
  model text,
  models jsonb,
  used_today integer,
  demo_used integer,
  batch integer,
  per_person integer,
  own_batch integer
)
language plpgsql
security definer
set search_path = public, vault, pg_temp
as $$
declare
  limits record;
  who uuid := auth.uid();
begin
  if not public.has_role(book, array['owner', 'bookkeeper', 'accountant']::public.book_role[]) or not public.book_live(book) then
    raise exception 'not your books' using errcode = 'PT403';
  end if;
  select * into limits from public.ai_limits();

  return query
  select
    s.book is not null,
    case
      when s.book is null then ''
      else left(v.decrypted_secret, 6) || '…' || right(v.decrypted_secret, 4)
    end,
    coalesce(s.model, 'gemini-3.6-flash'),
    coalesce(s.models, '[]'::jsonb),
    coalesce((select u.used from public.ai_usage u
              where u.person = who and u.day = (now() at time zone 'utc')::date), 0),
    coalesce((select sum(u.demo_used)::integer from public.ai_usage u
              where u.person = who), 0),
    limits.batch,
    limits.per_person,
    limits.own_batch
  from (select ai_state.book as book) probe
  left join public.ai_secrets s on s.book = probe.book
  left join vault.decrypted_secrets v on v.id = s.key_secret;
end;
$$;

create or replace function public.lock_watch_list(p_book uuid)
returns table (noticed_at timestamptz, part text, by_email text, what jsonb)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.has_role(p_book, array['owner', 'accountant']::public.book_role[]) or not public.book_live(p_book) then
    raise exception 'only an owner or the accountant' using errcode = '42501';
  end if;
  return query
    select w.noticed_at, w.part, u.email::text, w.what
    from public.lock_watch w
    left join auth.users u on u.id = w.by_user
    where w.book_id = p_book
    order by w.noticed_at desc
    limit 100;
end;
$$;

-- ---------------------------------------------------------------------------
-- M8 + M11: Quota / rate-limit RPCs serialized with advisory locks
-- ---------------------------------------------------------------------------
create or replace function public.ai_take(book uuid, asking integer, demo boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  limits record;
  today date := (now() at time zone 'utc')::date;
  who uuid := auth.uid();
  most integer;
  spent integer;
begin
  if who is null then
    raise exception 'not signed in' using errcode = 'PT401';
  end if;
  if not public.has_role(book, array['owner', 'bookkeeper']::public.book_role[]) or not public.book_live(book) then
    raise exception 'not your books' using errcode = 'PT403';
  end if;

  select * into limits from public.ai_limits();
  most := case when demo then limits.batch else limits.own_batch end;
  if asking < 1 or asking > most then
    raise exception 'ask about between 1 and % at a time', most using errcode = 'PT400';
  end if;

  perform pg_advisory_xact_lock(hashtext('ai-take:' || who::text));

  if demo then
    select coalesce(sum(u.demo_used), 0) into spent
    from public.ai_usage u where u.person = who;
    if spent + asking > limits.per_person then
      raise exception
        'You have used % of the % transactions the shared key allows. Add a key of your own to carry on.',
        spent, limits.per_person
        using errcode = 'PT429';
    end if;
  end if;

  insert into public.ai_usage (person, day, used, demo_used)
  values (who, today, asking, case when demo then asking else 0 end)
  on conflict (person, day) do update
  set used = public.ai_usage.used + asking,
      demo_used = public.ai_usage.demo_used + case when demo then asking else 0 end;
end;
$$;

create or replace function public.invitation_email_take(book uuid, who text, inviter uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  waiting public.book_invitations;
  books_name text;
  to_address integer;
  from_books integer;
  from_person integer;
begin
  select name into books_name from public.books where id = book and deleted_at is null;
  if not found then
    return jsonb_build_object('ok', false, 'why', 'no-invitation');
  end if;

  select * into waiting from public.book_invitations
  where book_id = book and lower(email) = lower(trim(who)) and state = 'pending';
  if not found then
    return jsonb_build_object('ok', false, 'why', 'no-invitation');
  end if;

  perform pg_advisory_xact_lock(hashtext('invite-email:' || inviter::text));

  select count(*) into to_address from public.invitation_emails
  where book_id = book and lower(email) = lower(trim(who)) and sent_at > now() - interval '1 day';
  if to_address >= 3 then
    return jsonb_build_object('ok', false, 'why', 'address-limit');
  end if;

  select count(*) into from_books from public.invitation_emails
  where book_id = book and sent_at > now() - interval '1 day';
  if from_books >= 20 then
    return jsonb_build_object('ok', false, 'why', 'books-limit');
  end if;

  select count(*) into from_person from public.invitation_emails
  where invited_by = inviter and sent_at > now() - interval '1 day';
  if from_person >= 100 then
    return jsonb_build_object('ok', false, 'why', 'person-limit', 'sent_today', from_person);
  end if;

  insert into public.invitation_emails (book_id, email, invited_by) values (book, trim(who), inviter);
  return jsonb_build_object(
    'ok', true, 'books', books_name, 'role', waiting.role, 'email', waiting.email,
    'sent_today', from_person + 1
  );
end;
$$;

create or replace function public.reminder_email_take(book uuid, who text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  b public.books;
  owner_email text;
  to_address integer;
  from_books integer;
  from_owner integer;
begin
  select * into b from public.books where id = book and deleted_at is null;
  if not found then
    return jsonb_build_object('ok', false, 'why', 'no-books');
  end if;

  if b.created_at > now() - interval '1 day' then
    return jsonb_build_object('ok', false, 'why', 'too-new');
  end if;

  perform pg_advisory_xact_lock(hashtext('reminder-email:' || b.created_by::text));

  select count(*) into to_address from public.reminder_emails
  where book_id = book and lower(email) = lower(trim(who)) and sent_at > now() - interval '1 day';
  if to_address >= 3 then
    return jsonb_build_object('ok', false, 'why', 'address-limit');
  end if;

  select count(*) into from_books from public.reminder_emails
  where book_id = book and sent_at > now() - interval '1 day';
  if from_books >= 50 then
    return jsonb_build_object('ok', false, 'why', 'books-limit');
  end if;

  select count(*) into from_owner from public.reminder_emails
  where owner_id = b.created_by and sent_at > now() - interval '1 day';
  if from_owner >= 100 then
    return jsonb_build_object('ok', false, 'why', 'account-limit', 'sent_today', from_owner);
  end if;

  select email into owner_email from auth.users where id = b.created_by;

  insert into public.reminder_emails (book_id, owner_id, email)
  values (book, b.created_by, trim(who));

  return jsonb_build_object(
    'ok', true,
    'books', b.name,
    'owner_id', b.created_by,
    'owner_email', coalesce(owner_email, ''),
    'sent_today', from_owner + 1
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- L1: Lock Dates Stage 2 trigger fires on BEFORE INSERT OR UPDATE OF data
-- ---------------------------------------------------------------------------
create or replace function public.lock_watch_note()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  decisions_now jsonb;
  dates record;
  txns jsonb;
  old_data jsonb;
  changed jsonb;
begin
  if new.part::text not in ('transactions', 'decisions', 'invoices') then return new; end if;

  old_data := case
    when tg_op = 'INSERT' then
      case when new.part::text = 'transactions' then '[]'::jsonb else '{}'::jsonb end
    else old.data
  end;

  if new.part::text = 'decisions' then
    decisions_now := old_data;
    if public.lock_dates_of(new.data) is distinct from public.lock_dates_of(old_data) then return new; end if;
  else
    select data into decisions_now from public.book_parts where book_id = new.book_id and part = 'decisions';
  end if;

  dates := public.lock_watch_dates(decisions_now);
  if dates.year_lock is null and dates.gst_lock is null then return new; end if;

  if new.part::text = 'transactions' then
    txns := old_data;
  else
    select data into txns from public.book_parts where book_id = new.book_id and part = 'transactions';
  end if;

  changed := public.lock_watch_changes(new.part::text, old_data, new.data, dates.year_lock, dates.gst_lock, txns);
  if jsonb_array_length(changed) > 0 then
    raise exception 'That period is locked; move the lock date first.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists lock_watch on public.book_parts;
create trigger lock_watch
  before insert or update of data on public.book_parts
  for each row execute function public.lock_watch_note();

revoke all on function public.lock_watch_note() from public, anon, authenticated;
