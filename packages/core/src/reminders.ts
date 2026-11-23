import type { Cents } from "./money.js";
import type { Invoice } from "./invoices.js";
import { owingByCurrency } from "./invoice-document.js";

/**
 * Reminders sent by themselves: which customers are due one today.
 *
 * Each overdue invoice has a stage: how many of the chosen days overdue it
 * has passed (with 7, 14 and 21, an invoice 15 days late is at stage 2). A
 * customer is sent one reminder, covering everything past due, when any of
 * their invoices has reached a stage it was not yet reminded at. So a
 * reminder goes once at each step, and never twice for the same one.
 */

export interface ReminderSettings {
  /** Days overdue a reminder goes at, e.g. [7, 14, 21]. */
  days: readonly number[];
  /** Nothing is sent to a customer whose past-due total is less than this, in cents. */
  minimum?: Cents;
}

export interface ReminderBalance {
  invoice: Pick<Invoice, "number" | "contact" | "kind" | "issued" | "due" | "total" | "reference"> & { currency?: string };
  /** What is owing, in the invoice's own currency. */
  remaining: Cents;
}

export interface ReminderContact {
  email?: string | undefined;
  /** Never sent a reminder by itself. */
  noReminders?: boolean | undefined;
}

export interface ReminderDue {
  customer: string;
  email: string;
  /** Everything past due, oldest first, each with its stage now. */
  invoices: { balance: ReminderBalance; daysLate: number; stage: number }[];
  /** Everything past due, in the books' currency (as `inBooks` gives it). */
  pastDue: Cents;
  /** Everything past due in each currency, as the customer is told it. */
  pastDueByCurrency: { currency: string; owing: Cents }[];
  /** Days past due of the oldest. */
  lateDays: number;
}

export interface RemindersToday {
  due: ReminderDue[];
  /** Customers who would have had one, and why they did not. */
  skipped: { customer: string; why: string }[];
}

const daysBetween = (from: string, to: string): number =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** How many of the chosen days an invoice this late has passed. */
export function reminderStage(daysLate: number, days: readonly number[]): number {
  return days.filter((d) => d > 0 && daysLate >= d).length;
}

/**
 * The reminders due today.
 *
 * `sent` is the stage each invoice was last reminded at, by its number;
 * `contactOf` finds a customer's record, `emailOf` an address where the
 * record has none (an invoice's own).
 */
export function remindersDue(options: {
  balances: readonly ReminderBalance[];
  today: string;
  settings: ReminderSettings;
  sent: Readonly<Record<string, number>>;
  contactOf: (name: string) => ReminderContact | undefined;
  emailOf?: (name: string) => string | undefined;
  /**
   * What an invoice's balance is in the books' currency, for the minimum.
   * Unset, the balance as it is: right where nothing is in another currency.
   */
  inBooks?: (balance: ReminderBalance) => Cents;
  /** The books' currency, for the totals by currency. */
  books?: string;
}): RemindersToday {
  const { balances, today, settings, sent } = options;
  const days = [...settings.days].filter((d) => Number.isFinite(d) && d > 0).sort((a, b) => a - b);
  const byCustomer = new Map<string, ReminderDue["invoices"]>();
  for (const balance of balances) {
    if (balance.invoice.kind !== "sales" || balance.remaining <= 0) continue;
    const due = balance.invoice.due ?? balance.invoice.issued;
    const daysLate = daysBetween(due, today);
    if (daysLate <= 0) continue;
    const key = balance.invoice.contact.trim();
    const list = byCustomer.get(key) ?? [];
    list.push({ balance, daysLate, stage: reminderStage(daysLate, days) });
    byCustomer.set(key, list);
  }

  const out: RemindersToday = { due: [], skipped: [] };
  for (const [customer, invoices] of byCustomer) {
    const fresh = invoices.some((one) => one.stage > (sent[one.balance.invoice.number] ?? 0));
    if (!fresh) continue;
    // In the books' currency, as the minimum is; told to the customer in
    // each invoice's own (code review of 20 November, 1.5).
    const inBooks = options.inBooks ?? ((b: ReminderBalance) => b.remaining);
    const pastDue = invoices.reduce((sum, one) => sum + inBooks(one.balance), 0);
    if (settings.minimum !== undefined && pastDue < settings.minimum) continue;
    const pastDueByCurrency = owingByCurrency(
      invoices.map((one) => ({ owing: one.balance.remaining, ...(one.balance.invoice.currency !== undefined ? { currency: one.balance.invoice.currency } : {}) })),
      options.books,
    );
    const contact = options.contactOf(customer);
    if (contact?.noReminders === true) {
      out.skipped.push({ customer, why: "set to have no reminders" });
      continue;
    }
    const email = (contact?.email ?? options.emailOf?.(customer) ?? "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      out.skipped.push({ customer, why: "no email address" });
      continue;
    }
    invoices.sort((a, b) => b.daysLate - a.daysLate);
    out.due.push({ customer, email, invoices, pastDue, pastDueByCurrency, lateDays: invoices[0]?.daysLate ?? 0 });
  }
  out.due.sort((a, b) => a.customer.localeCompare(b.customer));
  return out;
}
