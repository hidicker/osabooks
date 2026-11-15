-- The part payment reminders keep what they have sent in.
--
-- reminders_put writes the part 'reminders', and the value was never added to
-- the type: the morning's emails went out, then recording them failed, so the
-- next morning would send them again. No books had reminders on when this was
-- found (14 November 2026, security review round 3), so none were sent twice.
-- A value added to an enum cannot be used in the transaction that adds it, so
-- this runs on its own.
alter type public.book_part add value if not exists 'reminders';
