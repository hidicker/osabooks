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
import { remindersRun } from "./run.js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const NIGHTLY_KEY = Deno.env.get("NIGHTLY_KEY") ?? "";
const SMTP_HOST = Deno.env.get("SMTP_HOST") ?? "";
const SMTP_USER = Deno.env.get("SMTP_USER") ?? "";
const SMTP_PASSWORD = Deno.env.get("SMTP_PASSWORD") ?? "";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const FROM = Deno.env.get("REMINDERS_FROM") ?? SMTP_USER;

/** The most one set of books sends in a morning, so a mistake cannot flood anybody. */
const PER_BOOK = 50;
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
const fileName = (customer: string): string => `reminder-${customer.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "") || "statement"}.html`;

async function sendByResend(email: Email): Promise<void> {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: `${cleanName(email.fromName)} via OsaBooks <${FROM}>`,
      to: [email.to],
      reply_to: email.replyTo,
      subject: email.subject,
      text: email.text,
      attachments: [{ filename: fileName(email.customer), content: btoa(unescape(encodeURIComponent(email.html))) }],
    }),
  });
  if (!response.ok) throw new Error(`Resend said ${response.status}: ${(await response.text()).slice(0, 200)}`);
}

async function sendBySmtp(client: SMTPClient, email: Email): Promise<void> {
  await client.send({
    from: `${cleanName(email.fromName)} via OsaBooks <${FROM}>`,
    to: email.to,
    replyTo: email.replyTo,
    subject: email.subject,
    content: email.text,
    attachments: [{ filename: fileName(email.customer), content: email.html, encoding: "text", contentType: "text/html" }],
  });
}

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
  const log = [...(held.log ?? [])];
  let count = 0;
  const useResend = RESEND_API_KEY !== "";
  if (!useResend && (SMTP_HOST === "" || SMTP_USER === "")) throw new Error("no mail service set up");
  const client = useResend
    ? null
    : new SMTPClient({ connection: { hostname: SMTP_HOST, port: 465, tls: true, auth: { username: SMTP_USER, password: SMTP_PASSWORD } } });
  try {
    for (const email of result.emails.slice(0, PER_BOOK)) {
      const at = new Date().toISOString();
      try {
        if (client === null) await sendByResend(email);
        else await sendBySmtp(client, email);
        Object.assign(sent, email.stages);
        log.unshift({ at, to: email.to, customer: email.customer, invoices: Object.keys(email.stages) });
        count += 1;
      } catch (error) {
        log.unshift({ at, to: email.to, customer: email.customer, invoices: Object.keys(email.stages), failed: (error as Error).message });
      }
    }
  } finally {
    await client?.close();
  }
  const skipped = [
    ...result.skipped,
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

  // Each set of books in a call of its own, as the morning run does.
  const books = await rpc<{ book_id: string }[]>("reminders_books", {});
  const self = `${SUPABASE_URL}/functions/v1/reminders`;
  const calls = Promise.allSettled(
    books.map((one) =>
      fetch(self, {
        method: "POST",
        headers: { "content-type": "application/json", "x-nightly-key": NIGHTLY_KEY },
        body: JSON.stringify({ book: one.book_id }),
      }).then(async (response) => console.log(await response.text())),
    ),
  );
  // @ts-ignore EdgeRuntime is Supabase's: keep working after the reply.
  if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(calls);
  else await calls;
  return reply({ started: books.length });
});
