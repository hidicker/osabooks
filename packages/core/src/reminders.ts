import type { Cents } from "./money.js";
import type { Invoice } from "./invoices.js";

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
  invoice: Pick<Invoice, "number" | "contact" | "kind" | "issued" | "due" | "total" | "reference">;
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
  pastDue: Cents;
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
    const pastDue = invoices.reduce((sum, one) => sum + one.balance.remaining, 0);
    if (settings.minimum !== undefined && pastDue < settings.minimum) continue;
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
    out.due.push({ customer, email, invoices, pastDue, lateDays: invoices[0]?.daysLate ?? 0 });
  }
  out.due.sort((a, b) => a.customer.localeCompare(b.customer));
  return out;
}
