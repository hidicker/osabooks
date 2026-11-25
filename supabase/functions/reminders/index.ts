/**
 * Payment reminders, sent by themselves, for books on the server.
 *
 * Started by pg_cron each morning (supabase/migrations/*_reminders.sql) with
 * the morning run's key. It finds the sets of books with reminders turned on
 * (Settings) and, for each in a call of its own, works out who is due one with
 * the page's own code (run.js, built by tools/build-nightly-function.mjs from
 * apps/web/src/reminders-run.ts), sends each, and keeps beside the books which
 * stage each invoice has been reminded at, so none goes twice.
 *
 * Sent through Resend where RESEND_API_KEY is set, otherwise through the SMTP
 * mailbox the invitations use. Either way it comes from REMINDERS_FROM (or
 * the mailbox's own address), named for the business, with replies to the
 * business's own email. It puts nothing into the books themselves.
 *
 * Deploy with --no-verify-jwt: pg_cron has no user. The x-nightly-key header
 * is the check instead.
 */
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";
import { remindersRun, sendReminders } from "./run.js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const NIGHTLY_KEY = Deno.env.get("NIGHTLY_KEY") ?? "";
const SMTP_HOST = Deno.env.get("SMTP_HOST") ?? "";
const SMTP_USER = Deno.env.get("SMTP_USER") ?? "";
const SMTP_PASSWORD = Deno.env.get("SMTP_PASSWORD") ?? "";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const FROM = Deno.env.get("REMINDERS_FROM") ?? SMTP_USER;
/** Where a warning goes when one account sends many reminders in a day. */
const ALERT_EMAIL = Deno.env.get("ALERT_EMAIL") ?? "";

/** The most one set of books sends in a morning, so a mistake cannot flood anybody. */
const PER_BOOK = 50;
/** Past this many reminders in 24 hours across an account's books, tell the site's owner once. */
const ALERT_AFTER = 10;
/** How many sets of books run in parallel each morning (code review 7.2). */
const BATCH = 5;
/** How many runs the log keeps. */
const LOG_LENGTH = 60;

const service = { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}`, "content-type": "application/json" };

function reply(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function rpc<T>(fn: string, args: unknown): Promise<T> {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, { method: "POST", headers: service, body: JSON.stringify(args) });
  if (!response.ok) throw new Error(`${fn}: database said ${response.status}`);
  const text = await response.text();
  return (text === "" ? null : JSON.parse(text)) as T;
}

async function partsOf(book: string): Promise<Record<string, { version: number; data: unknown }>> {
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/book_parts?book_id=eq.${encodeURIComponent(book)}&select=part,version,data`,
    { headers: service },
  );
  if (!response.ok) throw new Error(`reading the books: database said ${response.status}`);
  const rows = (await response.json()) as { part: string; version: number; data: unknown }[];
  return Object.fromEntries(rows.map((row) => [row.part, { version: row.version, data: row.data }]));
}

interface Email {
  to: string;
  replyTo: string;
  fromName: string;
  subject: string;
  text: string;
  html: string;
  customer: string;
}

/** A name safe in a From line: no quotes, angle brackets or line breaks. */
const cleanName = (name: string): string => name.replace(/["<>\r\n]/g, "").trim().slice(0, 80);
/**
 * A header value on one line. The subject is the business's own wording and
 * the addresses come from its contacts: a line break in any of them would
 * start a header of somebody's choosing (a Bcc), so each is flattened.
 */
const oneLine = (text: string): string => text.replace(/[\r\n\u0085\u2028\u2029]+/g, " ").trim();
const fileName = (customer: string): string => `reminder-${customer.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "") || "statement"}.html`;

async function sendByResend(email: Email): Promise<void> {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: `${cleanName(email.fromName)} via OsaBooks <${FROM}>`,
      to: [oneLine(email.to)],
      reply_to: oneLine(email.replyTo),
      subject: oneLine(email.subject),
      text: email.text,
      attachments: [{ filename: fileName(email.customer), content: btoa(unescape(encodeURIComponent(email.html))) }],
    }),
  });
  if (!response.ok) throw new Error(`Resend said ${response.status}: ${(await response.text()).slice(0, 200)}`);
}

async function sendBySmtp(client: SMTPClient, email: Email): Promise<void> {
  await client.send({
    from: `${cleanName(email.fromName)} via OsaBooks <${FROM}>`,
    to: oneLine(email.to),
    replyTo: oneLine(email.replyTo),
    subject: oneLine(email.subject),
    content: email.text,
    attachments: [{ filename: fileName(email.customer), content: email.html, encoding: "text", contentType: "text/html" }],
  });
}

async function sendAlert(client: SMTPClient | null, subject: string, text: string): Promise<void> {
  if (ALERT_EMAIL === "") return;
  if (client === null) {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${RESEND_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ from: `OsaBooks <${FROM}>`, to: [ALERT_EMAIL], subject: oneLine(subject), text }),
    });
    if (!response.ok) throw new Error(`Resend alert said ${response.status}`);
    return;
  }
  await client.send({ from: `OsaBooks <${FROM}>`, to: ALERT_EMAIL, subject: oneLine(subject), content: text });
}

const CAP_WHY: Record<string, string> = {
  "too-new": "new books wait 24 hours before sending reminders",
  "address-limit": "already sent three reminders to this address in the last 24 hours",
  "books-limit": `more than ${PER_BOOK} in 24 hours; sent tomorrow`,
  "account-limit": "account daily limit of 100 reminder emails reached; sent tomorrow",
};

interface Held {
  sent?: Record<string, number>;
  log?: { at: string; to: string; customer: string; invoices: string[]; failed?: string }[];
  ran?: { at: string; sent: number; skipped: { customer: string; why: string }[] };
}

async function runBook(book: string): Promise<string> {
  const parts = await partsOf(book);
  const decisions = (parts["decisions"]?.data ?? {}) as { settings?: { reminders?: { on?: boolean } } };
  if (decisions.settings?.reminders?.on !== true) return "not turned on";
  const held = (parts["reminders"]?.data ?? {}) as Held;
  const sent = { ...(held.sent ?? {}) };
  const result = remindersRun({ parts, sent });
  const useResend = RESEND_API_KEY !== "";
  if (!useResend && (SMTP_HOST === "" || SMTP_USER === "")) throw new Error("no mail service set up");
  const client = useResend
    ? null
    : new SMTPClient({ connection: { hostname: SMTP_HOST, port: 465, tls: true, auth: { username: SMTP_USER, password: SMTP_PASSWORD } } });

  // Reserve quota in the database before sending (code review 7.1): enforces
  // 24h cooling-off for new books, per-address, per-book, and per-account caps.
  const allowed: Email[] = [];
  const capSkipped: { customer: string; why: string }[] = [];
  let alertInfo: { owner: string; books: string; to: string } | null = null;
  for (const email of result.emails.slice(0, PER_BOOK)) {
    const take = await rpc<{ ok: boolean; why?: string; books?: string; owner_id?: string; owner_email?: string; sent_today?: number }>(
      "reminder_email_take",
      { book, who: email.to },
    );
    if (!take.ok) {
      capSkipped.push({ customer: email.customer, why: CAP_WHY[take.why ?? ""] ?? "daily reminder limit reached" });
      continue;
    }
    allowed.push(email);
    if (take.sent_today === ALERT_AFTER + 1) {
      alertInfo = { owner: take.owner_email || take.owner_id || "unknown", books: take.books ?? book, to: email.to };
    }
  }

  // Each email recorded as soon as it has gone, so a run that stops part way
  // never leaves an email sent and unrecorded to go again tomorrow.
  const done = await (async () => {
    try {
      const res = await sendReminders(
        allowed,
        { sent, log: [...(held.log ?? [])] },
        (email: Email) => (client === null ? sendByResend(email) : sendBySmtp(client, email)),
        async (now: { sent: Record<string, number>; log: NonNullable<Held["log"]> }) => {
          await rpc("reminders_put", { book, value: { ...held, sent: now.sent, log: now.log.slice(0, LOG_LENGTH) } });
        },
      );
      if (alertInfo !== null && ALERT_EMAIL !== "") {
        await sendAlert(
          client,
          `OsaBooks: ${alertInfo.owner} has sent ${ALERT_AFTER + 1} payment reminders today`,
          [
            `${alertInfo.owner} has now sent ${ALERT_AFTER + 1} payment reminder emails in the last 24 hours.`,
            `Latest: to ${alertInfo.to}, for the books "${alertInfo.books}".`,
            "",
            "One account may send at most 100 a day across all its books.",
          ].join("\n"),
        ).catch((error) => console.error("reminder alert:", (error as Error).message));
      }
      return res;
    } finally {
      await client?.close();
    }
  })();
  const log: NonNullable<Held["log"]> = done.log;
  const count: number = done.count;
  Object.assign(sent, done.sent);
  const skipped = [
    ...result.skipped,
    ...capSkipped,
    ...result.emails.slice(PER_BOOK).map((e: Email) => ({ customer: e.customer, why: `more than ${PER_BOOK} in one morning; sent tomorrow` })),
  ];
  await rpc("reminders_put", {
    book,
    value: { sent, log: log.slice(0, LOG_LENGTH), ran: { at: new Date().toISOString(), sent: count, skipped } },
  });
  return `${count} sent, ${skipped.length} not`;
}

function isNightlyKey(given: string | null): boolean {
  if (NIGHTLY_KEY === "" || given === null) return false;
  const a = new TextEncoder().encode(given);
  const b = new TextEncoder().encode(NIGHTLY_KEY);
  let differ = a.length ^ b.length;
  for (let i = 0; i < b.length; i++) differ |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return differ === 0;
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return reply({ error: "POST only" }, 405);
  if (!isNightlyKey(request.headers.get("x-nightly-key"))) return reply({ error: "not the morning run" }, 403);
  const body = (await request.json().catch(() => ({}))) as { book?: string };

  if (typeof body.book === "string" && body.book !== "") {
    try {
      return reply({ book: body.book, said: await runBook(body.book) });
    } catch (error) {
      console.error(`reminders for ${body.book}:`, (error as Error).message);
      return reply({ book: body.book, error: (error as Error).message }, 500);
    }
  }

  // Each set of books in a call of its own, in small batches so many books
  // never open hundreds of simultaneous mail connections (code review 7.2).
  const books = await rpc<{ book_id: string }[]>("reminders_books", {});
  const self = `${SUPABASE_URL}/functions/v1/reminders`;
  const calls = (async () => {
    for (let i = 0; i < books.length; i += BATCH) {
      await Promise.allSettled(
        books.slice(i, i + BATCH).map((one) =>
          fetch(self, {
            method: "POST",
            headers: { "content-type": "application/json", "x-nightly-key": NIGHTLY_KEY },
            body: JSON.stringify({ book: one.book_id }),
          }).then(async (response) => console.log(await response.text())),
        ),
      );
    }
  })();
  // @ts-ignore EdgeRuntime is Supabase's: keep working after the reply.
  if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(calls);
  else await calls;
  return reply({ started: books.length });
});
