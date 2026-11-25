-- Revoke legacy default anon table & function grants on public schema
-- (defense-in-depth; RLS already protected table rows, and no anon caller
-- needs direct table SELECT/TRIGGER or helper EXECUTE except PostgREST's
-- db_pre_request hooks from_outside_app / refuse_outside_apps).

revoke all on table
  public.bank_feeds,
  public.book_members,
  public.book_part_history,
  public.book_parts,
  public.books
from public, anon;

revoke execute on function public.ai_limits() from public, anon;
revoke execute on function public.books_two_factor_from_owner() from public, anon;
revoke execute on function public.claim_new_book() from public, anon;
revoke execute on function public.jwt_aal() from public, anon;
revoke execute on function public.lock_dates_of(jsonb) from public, anon;
revoke execute on function public.lock_watch_dates(jsonb) from public, anon;
revoke execute on function public.lock_watch_doc(jsonb) from public, anon;
revoke execute on function public.refuse_member_reminders_write() from public, anon;
