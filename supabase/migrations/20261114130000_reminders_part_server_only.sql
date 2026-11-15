-- The reminders part is written by the reminders function only.
--
-- It records which reminders have gone to which customers. A member saving it
-- (save_part and save_part_changes take any part the type allows) could clear
-- it and have the next morning email every overdue customer again. Refused
-- here for anybody signed in or anonymous; the function writes as the service
-- role, and the owner's settings (on, stages, wording) live in decisions.
-- (Security review round 4, 14 November 2026.)

create or replace function public.refuse_member_reminders_write()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.part::text = 'reminders' and coalesce(auth.role(), '') in ('authenticated', 'anon') then
    raise exception using
      errcode = '42501',
      message = 'Payment reminders keep their own record; it is not changed from the books.';
  end if;
  return new;
end;
$$;

drop trigger if exists reminders_part_server_only on public.book_parts;
create trigger reminders_part_server_only
  before insert or update on public.book_parts
  for each row execute function public.refuse_member_reminders_write();
