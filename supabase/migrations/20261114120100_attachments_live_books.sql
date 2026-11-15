-- Attachments of deleted books: closed, as the books themselves are.
--
-- Deleting a set of books hides its parts and refuses saves to it
-- (20261012120000_deleted_books_and_locks.sql); its files in the attachments
-- bucket could still be read, added and removed by its members. Now every
-- attachment policy also asks book_live, so the files come back with the
-- books when an owner restores them, and not before.
-- (Security review round 3, 14 November 2026.)

drop policy if exists "attachments: members read" on storage.objects;
create policy "attachments: members read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'attachments'
    and public.has_role(public.attachment_book(name), array['owner', 'bookkeeper', 'accountant']::public.book_role[])
    and public.book_live(public.attachment_book(name))
  );

drop policy if exists "attachments: writers add" on storage.objects;
create policy "attachments: writers add" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'attachments'
    and public.has_role(public.attachment_book(name), array['owner', 'bookkeeper']::public.book_role[])
    and public.book_live(public.attachment_book(name))
  );

drop policy if exists "attachments: writers replace" on storage.objects;
create policy "attachments: writers replace" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'attachments'
    and public.has_role(public.attachment_book(name), array['owner', 'bookkeeper']::public.book_role[])
    and public.book_live(public.attachment_book(name))
  )
  with check (
    bucket_id = 'attachments'
    and public.has_role(public.attachment_book(name), array['owner', 'bookkeeper']::public.book_role[])
    and public.book_live(public.attachment_book(name))
  );

drop policy if exists "attachments: writers remove" on storage.objects;
create policy "attachments: writers remove" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'attachments'
    and public.has_role(public.attachment_book(name), array['owner', 'bookkeeper']::public.book_role[])
    and public.book_live(public.attachment_book(name))
  );
