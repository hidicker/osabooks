-- Payment reminder email limits: per address, per book, per account, plus a
-- 24-hour cooling-off period for brand-new books (code review 7.1).
--
-- Mirrors invitation_email_take (20261012090000_invitation_caps.sql) so a
-- single account with up to 20 books cannot send 1,000 arbitrary emails a day
-- from OsaBooks's mailbox, and the site's owner hears once when an account
-- passes 10 reminders in a day.

create table if not exists public.reminder_emails (
  id bigserial primary key,
  book_id uuid not null references public.books (id) on delete cascade,
  owner_id uuid references auth.users (id) on delete set null,
  email text not null,
  sent_at timestamptz not null default now()
);

alter table public.reminder_emails enable row level security;
revoke all on public.reminder_emails from public, anon, authenticated;

create index if not exists reminder_emails_by_book
  on public.reminder_emails (book_id, sent_at);
create index if not exists reminder_emails_by_owner
  on public.reminder_emails (owner_id, sent_at);

/**
 * May a payment reminder email go to this address now, and if so record that
 * it did. For the reminders edge function (service_role) only.
 */
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

  -- Cooling-off period: brand-new books wait 24 hours before sending mail.
  if b.created_at > now() - interval '1 day' then
    return jsonb_build_object('ok', false, 'why', 'too-new');
  end if;

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

revoke all on function public.reminder_email_take(uuid, text) from public, anon, authenticated;
grant execute on function public.reminder_email_take(uuid, text) to service_role;
