import type { PostedJournal } from "./posting.js";
import { splitDocumentKey } from "./document-key.js";

/**
 * Classes: a second way of cutting the profit and loss, across accounts --
 * a department, a location, a job. A class is given to where a posting came
 * from (a bank line, an invoice, a journal), and every income and expense line
 * that source posts falls under it. Nothing is posted differently.
 */

/** Where a posting came from, to the class it is given. */
export type ClassAssignments = Record<string, string>;

/** The name the report gives to what has no class. */
export const UNCLASSIFIED = "Unclassified";

/**
 * The source a posted journal is classed by: the bank line, invoice, or manual
 * journal it came from. An invoice's payment, and the cost of the stock it
 * sold, are classed with the invoice.
 */
export function classSource(journal: Pick<PostedJournal, "transactionId" | "document">): string {
  // A document's journals say which document, by key: its number alone is
  // shared by a sale and a bill, and a job given the sale took the bill too.
  if (journal.document !== undefined) return journal.document;
  const id = journal.transactionId;
  const paid = /^(.*):(?:paid:\d+|cost)$/.exec(id);
  return paid !== null && paid[1] !== undefined ? paid[1] : id;
}

/**
 * What a source is given -- a class, a job -- from what is kept: under the
 * source itself, or, for a document, under its bare number as books saved
 * before document keys kept it. An empty string kept under the key is a
 * taking-off, and stops the bare number answering for it.
 */
export function assignedFor<T>(assignments: Readonly<Record<string, T>>, source: string): T | undefined {
  const own = assignments[source];
  if (own !== undefined) return own;
  const split = splitDocumentKey(source);
  return split === null ? undefined : assignments[split.number];
}

/** The assignments with a source given `value`, or taken off with "". */
export function withAssignment(assignments: Readonly<Record<string, string>>, source: string, value: string): Record<string, string> {
  const next = { ...assignments };
  const split = splitDocumentKey(source);
  if (value !== "") next[source] = value;
  // Still answered by a bare number from older books: said "" so it stays off.
  else if (split !== null && next[split.number] !== undefined && next[split.number] !== "") next[source] = "";
  else delete next[source];
  return next;
}

export interface ClassColumn {
  name: string;
  /** Account code to the sum of its lines, debits positive. */
  byAccount: Map<string, number>;
}

/**
 * Income and expense, account by account, for each class and for what has
 * none. `counts(code)` says which accounts belong in a profit and loss.
 */
export function profitAndLossByClass(
  journals: readonly PostedJournal[],
  assignments: ClassAssignments,
  counts: (code: string) => boolean,
  range: { from: string; to: string },
): ClassColumn[] {
  const columns = new Map<string, ClassColumn>();
  for (const journal of journals) {
    if (journal.date < range.from || journal.date > range.to) continue;
    const name = assignedFor(assignments, classSource(journal)) || UNCLASSIFIED;
    for (const line of journal.lines) {
      const code = line.accountCode.trim();
      if (!counts(code)) continue;
      const column = columns.get(name) ?? { name, byAccount: new Map<string, number>() };
      column.byAccount.set(code, (column.byAccount.get(code) ?? 0) + line.amount);
      columns.set(name, column);
    }
  }
  // Classes by name, what has none last.
  return [...columns.values()].sort((a, b) =>
    a.name === UNCLASSIFIED ? 1 : b.name === UNCLASSIFIED ? -1 : a.name.localeCompare(b.name),
  );
}
