-- Payment reminders sent by themselves (supabase/functions/reminders).
--
-- The books with reminders turned on, a way to keep beside them what has been
-- sent, and the morning schedule. Like the nightly run's, these are for the
-- function only, which has no user to sign in as.

/** Books with reminders turned on in Settings, and not deleted. */
create or replace function public.reminders_books()
returns table (book_id uuid)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.book_id
  from public.book_parts p
  join public.books b on b.id = p.book_id
  where p.part = 'decisions'
    and b.deleted_at is null
    and (p.data #>> '{settings,reminders,on}') = 'true';
$$;

/**
 * Write the reminders part: what each invoice has been reminded at, and the
 * log. Only ever that part, never the books themselves.
 */
create or replace function public.reminders_put(book uuid, value jsonb)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  next_version bigint;
begin
  insert into public.book_parts (book_id, part, version, data, updated_by)
  values (book, 'reminders', 1, value, null)
  on conflict (book_id, part)
  do update set version = public.book_parts.version + 1, data = excluded.data,
    updated_at = now(), updated_by = null
  returning version into next_version;
  return next_version;
end;
$$;

revoke all on function public.reminders_books() from public, anon, authenticated;
revoke all on function public.reminders_put(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.reminders_books() to service_role;
grant execute on function public.reminders_put(uuid, jsonb) to service_role;

-- 21:00 UTC is 9am in a New Zealand winter and 10am in summer: a business
-- hour, after the morning run has brought in the night's payments.
select cron.unschedule(jobid) from cron.job where jobname = 'nzosa-reminders';

select cron.schedule(
  'nzosa-reminders',
  '0 21 * * *',
  $$
  select net.http_post(
    url := 'https://ronancqtbbqmsiatxmfn.supabase.co/functions/v1/reminders',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-nightly-key', (select decrypted_secret from vault.decrypted_secrets where name = 'nightly-key')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);
