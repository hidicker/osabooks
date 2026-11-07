import type { InvoiceKind, Numbering } from "@nzosa/core";
import { state } from "./state.js";
import type { BookSettings } from "./store.js";

/** The books' own settings, as chosen on the Settings page. */
export function bookSettings(): BookSettings {
  return state.ledger.settings ?? {};
}

/** The numbering chosen for invoices or bills, or none (the usual INV- and BILL- series). */
export function numberingFor(kind: InvoiceKind): Numbering | undefined {
  const s = bookSettings();
  const prefix = kind === "purchase" ? s.billPrefix : s.invoicePrefix;
  const next = kind === "purchase" ? s.billNext : s.invoiceNext;
  if (prefix === undefined && next === undefined) return undefined;
  return { ...(prefix !== undefined ? { prefix } : {}), ...(next !== undefined ? { next } : {}) };
}
