import { invoiceBalanceMap } from "./books.js";
import { applyCountryRules, booksLocale, booksMoney, documentOptions } from "./country.js";
import { supplierFor } from "./daily/invoices.js";
import { state } from "./state.js";
import { holdWrites, ledgerFromParts } from "./store.js";
import type { StoredLedger } from "./store.js";
import {
  collectionLetter,
  emailForContact,
  fillWording,
  findContact,
  isPosted,
  localToday,
  reminderStageFor,
  remindersDue,
  wordingFor,
} from "@nzosa/core";
import type { ReminderDue, RemindersToday } from "@nzosa/core";

/**
 * The reminders due today, worked out from a set of books with the page's own
 * code, so a reminder sent by itself says what the Reminder button would.
 * Run by the reminders edge function for books on the server, and by the page
 * for the list of who is due. It saves nothing.
 */

export interface ReminderEmail {
  customer: string;
  to: string;
  /** Where replies go: the business's own address. */
  replyTo: string;
  /** Who it is from, by name: the business. */
  fromName: string;
  subject: string;
  text: string;
  html: string;
  /** The stage each invoice is now reminded at, to record once it is sent. */
  stages: Record<string, number>;
}

export interface RemindersRunResult {
  emails: ReminderEmail[];
  skipped: { customer: string; why: string }[];
}

/** Who is due a reminder in the books open now, and who is not and why. */
export function remindersToday(ledger: StoredLedger, sent: Readonly<Record<string, number>>, today = localToday()): RemindersToday {
  const settings = ledger.settings?.reminders;
  if (settings === undefined || settings.days.length === 0) return { due: [], skipped: [] };
  const balances = [...invoiceBalanceMap().values()].filter((b) => isPosted(b.invoice) && b.invoice.kind === "sales");
  return remindersDue({
    balances,
    today,
    settings: { days: settings.days, ...(settings.minimum !== undefined ? { minimum: settings.minimum } : {}) },
    sent,
    contactOf: (name) => findContact(ledger.contacts ?? [], name),
    emailOf: (name) => emailForContact(ledger.invoices ?? [], name) ?? undefined,
  });
}

/** The email for one customer due a reminder; or why it cannot go. */
export function reminderEmail(one: ReminderDue, today = localToday()): ReminderEmail | { why: string } {
  const first = one.invoices[0]?.balance.invoice;
  const full = (state.ledger.invoices ?? []).find((i) => i.number === first?.number);
  const supplier = full === undefined ? null : supplierFor(full);
  if (supplier === null) return { why: "no entity to send it from" };
  const replyTo = (supplier.email ?? "").trim();
  if (replyTo === "") return { why: `no email for ${supplier.name}, for replies (Entities & accounts, Invoice details)` };
  const lines = one.invoices.map(({ balance }) => ({
    number: balance.invoice.number,
    issued: balance.invoice.issued,
    due: balance.invoice.due,
    total: balance.invoice.total,
    owing: balance.remaining,
    reference: balance.invoice.reference === "QuickBooks" ? "" : balance.invoice.reference,
  }));
  const owedToUs = [...invoiceBalanceMap().values()]
    .filter((b) => b.invoice.kind === "sales" && isPosted(b.invoice) && b.invoice.contact.trim() === one.customer)
    .reduce((sum, b) => sum + b.remaining, 0);
  const words = fillWording(wordingFor("reminder", state.ledger.emailWording), {
    customer: one.customer,
    business: supplier.name,
    date: new Date(`${today}T12:00:00Z`).toLocaleDateString(booksLocale(), { day: "numeric", month: "short", year: "numeric" }),
    owing: booksMoney(owedToUs),
    pastdue: booksMoney(one.pastDue),
    payment: (supplier.payTo ?? "").trim(),
  });
  return {
    customer: one.customer,
    to: one.email,
    replyTo,
    fromName: supplier.name,
    subject: words.subject,
    text: words.body,
    html: collectionLetter(one.customer, lines, today, supplier, reminderStageFor(one.lateDays), documentOptions()),
    stages: Object.fromEntries(one.invoices.map((i) => [i.balance.invoice.number, i.stage])),
  };
}

/** Money in that might be a payment not yet matched to its invoice. */
interface MoneyIn {
  date: string;
  amount: number;
  text: string;
}

/**
 * Whether a customer may have paid already: money in during the last two
 * weeks, not matched to an invoice, for one of their overdue amounts or with
 * their name on it. A reminder to somebody who has just paid is worse than
 * one a day late, so it waits until the line is matched on Reconcile.
 */
function mayHavePaid(one: ReminderDue, lines: readonly MoneyIn[], today: string): boolean {
  const since = new Date(Date.parse(`${today}T00:00:00Z`) - 14 * 86_400_000).toISOString().slice(0, 10);
  const amounts = new Set([one.pastDue, ...one.invoices.map((i) => i.balance.remaining)]);
  const word = one.customer.toLowerCase().split(/[^a-z0-9]+/).find((w) => w.length >= 4);
  return lines.some(
    (line) => line.date >= since && line.amount > 0 && (amounts.has(line.amount) || (word !== undefined && line.text.toLowerCase().includes(word))),
  );
}

/** For the edge function: the books' parts in, the emails to send out. */
export function remindersRun(input: {
  parts: Record<string, { version: number; data: unknown }>;
  sent: Readonly<Record<string, number>>;
  today?: string;
}): RemindersRunResult {
  holdWrites();
  state.ledger = ledgerFromParts(input.parts);
  applyCountryRules();
  state.chart = state.ledger.chart ?? [];
  const today = input.today ?? localToday();
  const found = remindersToday(state.ledger, input.sent, today);
  const emails: ReminderEmail[] = [];
  const skipped = [...found.skipped];
  // Money in not yet matched to an invoice: in the books, and waiting from
  // the morning's bank feed, which comes in only when the books are opened.
  const matched = state.ledger.invoiceMatches ?? {};
  const moneyIn: MoneyIn[] = [
    ...state.ledger.transactions
      .filter((t) => t.amount > 0 && matched[t.id] === undefined)
      .map((t) => ({ date: t.date, amount: t.amount, text: `${t.otherParty} ${t.particulars} ${t.reference} ${t.code}` })),
    ...((input.parts["nightly"]?.data as { inbox?: { items?: Record<string, unknown>[] } } | undefined)?.inbox?.items ?? []).map((item) => ({
      date: String(item["date"] ?? "").slice(0, 10),
      amount: Math.round(Number(item["amount"] ?? 0) * 100),
      text: `${String(item["description"] ?? "")} ${String((item["merchant"] as { name?: string } | undefined)?.name ?? "")}`,
    })),
  ];
  for (const one of found.due) {
    if (mayHavePaid(one, moneyIn, today)) {
      skipped.push({ customer: one.customer, why: "money came in that may be their payment: match it on Reconcile" });
      continue;
    }
    const made = reminderEmail(one, today);
    if ("why" in made) skipped.push({ customer: one.customer, why: made.why });
    else emails.push(made);
  }
  return { emails, skipped };
}
