import type { Cents } from "./money.js";
import { parseAmount } from "./money.js";
import type { IsoDate } from "./dates.js";
import { parseDate } from "./dates.js";
import { parseCsvRecords } from "./csv.js";
import type { Invoice, InvoiceKind } from "./invoices.js";
import { invoiceBalances, isPosted } from "./invoices.js";
import type { Account } from "./chart.js";
import { documentKey } from "./document-key.js";
import type { PostedJournal } from "./posting.js";

/**
 * The invoices and bills still open on the day before the books start.
 *
 * A set of books taken over from another system opens with a figure for
 * Accounts Receivable and one for Accounts Payable, and those figures are the
 * sum of particular documents. Which documents, the trial balance does not
 * say. Xero's Aged Receivables Detail and Aged Payables Detail do: each
 * invoice or bill open on the day, and how much of it was still owing.
 *
 * That settles what happens to every document dated before the books start.
 * None is posted as a sale or cost -- that belongs to a year the other system
 * kept, and is already in the opening retained earnings. One that was open
 * stays in play, owing what the report says, so the payment that arrives later
 * clears the receivable it is part of. Every other one was paid before the
 * books began: it is history, offered for matching to nothing.
 *
 * Without the report, a document made in these books is brought in as Xero
 * does: what it still owed opens the receivable or payable on the start day,
 * against Historical Adjustment (`owingAtStart`, `openingDocumentJournals`).
 */

export interface OpeningDocument {
  number: string;
  contact: string;
  date: IsoDate | null;
  due: IsoDate | null;
  /** Owing on the report's date, as the report has it. Negative for a credit. */
  owing: Cents;
}

export interface OpeningDocuments {
  kind: InvoiceKind;
  asAt: IsoDate;
  items: OpeningDocument[];
  /** Where they came from, for saying so. */
  source?: string;
}

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

/** `As at 31 March 2025` as `2025-03-31`. */
function asAtFrom(text: string): IsoDate | null {
  const m = /as at\s+(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})/i.exec(text);
  if (m === null) return null;
  const month = MONTHS[(m[2] ?? "").slice(0, 3).toLowerCase()];
  return month === undefined ? null : (`${m[3]}-${month}-${(m[1] ?? "").padStart(2, "0")}` as IsoDate);
}

/** Whether text is Xero's Aged Receivables or Aged Payables Detail. */
export function isAgedDetail(text: string): boolean {
  return /^\s*"?Aged (Receivables|Payables) Detail/i.test(text) && /Invoice Number|Bill Number|Reference/i.test(text);
}

/**
 * Read Xero's Aged Receivables Detail or Aged Payables Detail.
 *
 * A contact's name stands on a row of its own, its documents follow with the
 * first column empty, and a "Total ..." row closes it. The amount owing is the
 * row's Total column.
 */
export function readAgedDetail(csv: string): { record: OpeningDocuments | null; problem?: string } {
  const rows = parseCsvRecords(csv, { skipEmptyRows: true }).map((r) => r.fields.map((f) => f.trim()));
  const title = (rows[0]?.[0] ?? "").toLowerCase();
  const kind: InvoiceKind | null = title.includes("receivables") ? "sales" : title.includes("payables") ? "purchase" : null;
  if (kind === null) return { record: null, problem: "Not an aged receivables or payables detail report." };
  const asAt = asAtFrom(rows.slice(0, 5).map((r) => r.join(" ")).join(" "));
  if (asAt === null) return { record: null, problem: "The report's date could not be read." };

  // Receivables say "Invoice Number"; payables say "Invoice Reference", and a
  // bill's reference is often left empty -- the supplier's own number, which
  // nobody types in.
  const headerAt = rows.findIndex((r) =>
    r.some((c) => /^(invoice|bill) (number|reference)$/i.test(c) || /^(number|reference)$/i.test(c)),
  );
  if (headerAt < 0) return { record: null, problem: "The report has no invoice number column." };
  const header = (rows[headerAt] ?? []).map((h) => h.toLowerCase());
  const col = (...names: string[]) => header.findIndex((h) => names.includes(h));
  const at = {
    number: col("invoice number", "bill number", "number", "invoice reference", "bill reference", "reference"),
    date: col("invoice date", "bill date", "date"),
    due: col("due date"),
    total: col("total"),
  };
  if (at.number < 0 || at.total < 0) return { record: null, problem: "The report has no number or total column." };

  const items: OpeningDocument[] = [];
  let contact = "";
  for (const r of rows.slice(headerAt + 1)) {
    const first = r[0] ?? "";
    const number = r[at.number] ?? "";
    const totalText = (r[at.total] ?? "").replace(/[$,\s]/g, "");
    // A payee's name stands on a row with no amount; a document's row has one,
    // whether or not it carries a number. Told apart by the number alone, a
    // bill with no reference -- its date in the first column -- was taken for
    // a payee, and none of them came in.
    if (first !== "" && totalText === "") {
      if (!/^(total|percentage)/i.test(first)) contact = first;
      continue;
    }
    if (/^(total|percentage)/i.test(first)) continue;
    const owing = parseAmount(totalText || "0") ?? 0;
    if (owing === 0) continue;
    const date = parseDate(r[at.date] ?? "", { dayFirst: true });
    items.push({
      // Without a reference, the payee and the date name it.
      number: number !== "" ? number : `${contact} ${date ?? (r[at.date] ?? "")}`.trim(),
      contact,
      date,
      due: parseDate(r[at.due] ?? "", { dayFirst: true }),
      owing,
    });
  }
  return { record: { kind, asAt, items } };
}

/**
 * The documents in play for books starting on `start`.
 *
 * Dated from the start: as they are. Dated before it, where the opening
 * documents for their kind are known: the open ones carried forward owing
 * what the report says, and the rest left out. Where they are not known,
 * every earlier document stays in play as it was -- the only thing known to
 * be wrong is posting it, which the ledger no longer does -- so nothing
 * disappears for want of a report.
 */
export function documentsInPlay(
  invoices: readonly Invoice[],
  start: IsoDate | undefined,
  opening: readonly OpeningDocuments[],
): Invoice[] {
  if (start === undefined || start === "") return [...invoices];
  const open = new Map<string, Map<string, Cents>>();
  for (const list of opening) {
    const byNumber = open.get(list.kind) ?? new Map<string, Cents>();
    for (const item of list.items) byNumber.set(item.number.trim().toLowerCase(), item.owing);
    open.set(list.kind, byNumber);
  }
  const out: Invoice[] = [];
  for (const invoice of invoices) {
    if (invoice.issued >= start) {
      out.push(invoice);
      continue;
    }
    const known = open.get(invoice.kind);
    if (known === undefined) {
      out.push(invoice);
      continue;
    }
    // By number, or -- for a document that had none -- by contact and date,
    // which is how the aged report names it ("Google 2024-08-20") and how the
    // document is known here ("Google/2024-08-20"). Matched by number alone,
    // every numberless bill open at the start was left out of the books.
    // The contact-and-date name is only for a document with no number of its
    // own: a numbered bill on the same day from the same supplier -- paid,
    // and so not on the report -- took the open numberless one's balance.
    const own = invoice.number.trim();
    const numberless = own === "" || own === `${invoice.contact}/${invoice.issued}`;
    const owing =
      known.get(own.toLowerCase()) ??
      (numberless ? known.get(`${invoice.contact} ${invoice.issued}`.trim().toLowerCase()) : undefined);
    if (owing !== undefined) out.push({ ...invoice, broughtForward: owing });
  }
  return out;
}

/** What the opening documents come to, against the opening balance for their control account. */
export function openingDocumentsTotal(list: OpeningDocuments): Cents {
  return list.items.reduce((sum, item) => sum + item.owing, 0);
}

/**
 * Where a document owed before the books start is balanced: Xero's Historical
 * Adjustment, or -- in a chart without one, such as QuickBooks' -- retained
 * earnings, where last year's sale or cost belongs. Null when the chart has
 * neither, and then nothing is posted from before the start.
 */
export function historicalAccountIn(
  chart: readonly Account[],
  /**
   * The receivable or payable it balances, where the books keep several
   * entities: 610KC is balanced in 840KC, so each entity's own balance sheet
   * still balances.
   */
  forCode?: string,
): { code: string; name: string } | null {
  const ending = (code: string): string => /^\d+([A-Za-z]{1,3})$/.exec(code.trim())?.[1] ?? "";
  const wanted = forCode === undefined ? undefined : ending(forCode);
  const kinds: ((a: Account) => boolean)[] = [
    (a) => a.type.trim().toLowerCase() === "historical",
    (a) => /historical adjustment/i.test(a.name),
    (a) => /retained earnings/i.test(a.type),
    (a) => /equity/i.test(a.type) && /retained/i.test(a.name),
  ];
  // The entity's own first, of any of the kinds; then any at all.
  const passes: ((a: Account) => boolean)[] =
    wanted === undefined ? [() => true] : [(a) => ending(a.code) === wanted, () => true];
  for (const pass of passes) {
    for (const kind of kinds) {
      const found = chart.find((a) => kind(a) && pass(a));
      if (found !== undefined) return { code: found.code, name: found.name };
    }
  }
  return null;
}

export type HistoricalAccount = { code: string; name: string };

/** A document dated before the start that was still owing on it. */
export interface OwingAtStart {
  invoice: Invoice;
  control: { code: string; name: string };
  /** Owing on the start day: positive for an invoice or bill, negative for a credit note. */
  owing: Cents;
}

/**
 * The documents dated before the books start that were still owing then, as
 * far as these books can tell.
 *
 * Xero's way: the opening receivables and payables are made of the documents
 * open on the day, not typed in as one figure. Only where the amount owing on
 * the start day is known here, though:
 *
 * - a document made in these books (`enteredHere`): its total, less what it
 *   says was paid outside the bank before the start -- as the Invoices page
 *   counts it;
 * - not one of a kind whose opening aged list is loaded -- that list already
 *   says what was owing, and the documents on it are carried forward as they
 *   always were;
 * - not one imported from another system without that list: its paid and
 *   outstanding figures are as of the export, not the start, so what it owed
 *   then is not known.
 */
export function owingAtStart(
  invoices: readonly Invoice[],
  start: IsoDate,
  options: {
    controlOf: (invoice: Invoice) => { code: string; name: string };
    /** Kinds whose opening aged list is loaded. */
    agedKinds: readonly InvoiceKind[];
  },
): OwingAtStart[] {
  const out: OwingAtStart[] = [];
  for (const invoice of invoices) {
    if (invoice.issued >= start || !isPosted(invoice) || invoice.receipt === true) continue;
    if (options.agedKinds.includes(invoice.kind) || invoice.broughtForward !== undefined) continue;
    if (invoice.enteredHere !== true) continue;
    const before = { ...invoice, paidOutside: (invoice.paidOutside ?? []).filter((p) => p.date < start) };
    const balance = invoiceBalances([before], []).get(documentKey(invoice));
    const owing = balance?.remaining ?? 0;
    if (owing === 0) continue;
    out.push({ invoice, control: options.controlOf(invoice), owing });
  }
  return out;
}

/** Per control account: what the documents make it, against the opening figure. */
export interface OpeningFromDocuments {
  control: { code: string; name: string };
  /** What the documents come to, debit positive. */
  documents: Cents;
  /** The opening balance typed or imported for the account, debit positive. */
  opening: Cents;
  /** `opening` less `documents`: left in the historical account until it is explained. */
  difference: Cents;
}

/**
 * The journals that bring documents owing at the start into the books, on the
 * start day, and what each control account then holds.
 *
 * Each document posts its owing to its receivable or payable against the
 * historical account -- not to sales or costs, which were last year's. Where an
 * opening figure was also given for that account it is moved out to the
 * historical account, so the documents are the opening figure, as in Xero, and
 * nothing is counted twice. A difference between the two is then what is left
 * in the historical account, and is said.
 */
export function openingDocumentJournals(
  owing: readonly OwingAtStart[],
  options: {
    start: IsoDate;
    /** The account balancing them, or one for each receivable or payable (see `historicalAccountIn`). */
    historical: HistoricalAccount | ((control: { code: string; name: string }) => HistoricalAccount);
    /** Opening balances by account code, debit positive. */
    openingFigures: Readonly<Record<string, Cents>>;
  },
): { journals: PostedJournal[]; accounts: OpeningFromDocuments[] } {
  const journals: PostedJournal[] = [];
  const byControl = new Map<string, OpeningFromDocuments>();
  const { start } = options;
  const historicalFor = (control: { code: string; name: string }): HistoricalAccount =>
    typeof options.historical === "function" ? options.historical(control) : options.historical;
  for (const one of owing) {
    const historical = historicalFor(one.control);
    const sale = one.invoice.kind === "sales";
    // Debit positive: an invoice owed to us is a debit to receivables, a bill
    // owed by us a credit to payables; a credit note turns either round.
    const toControl = sale ? one.owing : -one.owing;
    const who = [one.invoice.number, one.invoice.contact].filter((s) => s.trim() !== "").join(" ");
    journals.push({
      transactionId: `start:${documentKey(one.invoice)}`,
      date: start,
      narration: `Owing at the start: ${who}, dated ${one.invoice.issued}`,
      lines: [
        { accountCode: one.control.code, accountName: one.control.name, amount: toControl, taxType: "NONE", description: who },
        { accountCode: historical.code, accountName: historical.name, amount: -toControl, taxType: "NONE", description: who },
      ],
      source: "manual",
      taxBasis: "both",
      document: documentKey(one.invoice),
    });
    const held = byControl.get(one.control.code) ?? {
      control: one.control,
      documents: 0,
      opening: options.openingFigures[one.control.code] ?? 0,
      difference: 0,
    };
    held.documents += toControl;
    byControl.set(one.control.code, held);
  }
  const accounts = [...byControl.values()].map((a) => ({ ...a, difference: a.opening - a.documents }));
  for (const account of accounts) {
    if (account.opening === 0) continue;
    const historical = historicalFor(account.control);
    journals.push({
      transactionId: `start:opening:${account.control.code}`,
      date: start,
      narration: `Opening ${account.control.name} taken from the documents open at the start`,
      lines: [
        { accountCode: account.control.code, accountName: account.control.name, amount: -account.opening, taxType: "NONE", description: "Opening balance, now made of documents" },
        { accountCode: historical.code, accountName: historical.name, amount: account.opening, taxType: "NONE", description: "Opening balance, now made of documents" },
      ],
      source: "manual",
      taxBasis: "both",
    });
  }
  return { journals, accounts };
}
