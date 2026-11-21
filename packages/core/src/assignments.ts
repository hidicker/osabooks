import type { Invoice, PaymentAllocation } from "./invoices.js";
import { matchInvoices } from "./invoice-matching.js";
import { splitPartId } from "./splits.js";
import type { Splits } from "./splits.js";
import type { Transaction } from "./types.js";
import { DocumentIndex, documentKey, settlesInDirection } from "./document-key.js";
import type { DocumentKey } from "./document-key.js";

/**
 * Which receipt settled which invoice, from every source that has an opinion.
 *
 * Three of them, and the order is the whole of the logic:
 *
 *  1. **What a person accepted.** Recorded, and it wins. Somebody looked.
 *  2. **What a split part says.** A payment divided across several invoices
 *     has answered the question more precisely than any matcher could.
 *  3. **What the matcher found**, for everything still unanswered.
 *
 * The second beats the third for a reason that costs money. A payment whose
 * parts each settle an invoice is already assigned; if the matcher is also
 * allowed to claim the parent transaction, the same money is counted twice --
 * once as the whole payment against one invoice, and again as its parts
 * against several.
 *
 * An empty string is not an assignment. It is a refusal, recorded so the
 * matcher stops offering a line somebody has already rejected, and it does not
 * leave this function looking like an answer.
 *
 * Every answer comes out as a document key. What a person accepted is stored
 * as a key now, and as a bare number in books saved before; a bare number a
 * sale and a bill share is told apart by the money's direction. One that
 * still cannot be is left out -- shown as unmatched, to be matched again --
 * and not handed to the matcher, since somebody did answer it.
 */
export interface AssignmentOptions {
  invoices: readonly Invoice[];
  transactions: readonly Transaction[];
  allocations?: readonly PaymentAllocation[];
  /** Assignments a person has accepted, and refusals recorded as empty. */
  accepted: Readonly<Record<string, string>>;
  splits: Splits;
}

export function invoiceAssignments(options: AssignmentOptions): Map<string, DocumentKey> {
  const { invoices, transactions, allocations, accepted, splits } = options;
  const index = new DocumentIndex(invoices);
  const amountOf = lineAmounts(transactions, splits);

  const answered = new Set<string>();
  const settled = new Map<string, DocumentKey>();
  for (const [id, ref] of Object.entries(accepted)) {
    answered.add(id);
    if (ref === "") continue;
    const amount = amountOf.get(id);
    const key = index.resolveKey(ref, amount === undefined ? undefined : (d) => settlesInDirection(d, amount));
    if (key !== undefined) settled.set(id, key);
  }

  if (invoices.length > 0) {
    const found = matchInvoices({
      invoices,
      transactions,
      ...(allocations ? { allocations } : {}),
    });

    const splitAcross = new Set<string>();
    for (const [id, parts] of Object.entries(splits)) {
      if (parts.some((_, i) => answered.has(splitPartId(id, i)))) splitAcross.add(id);
    }

    for (const match of found.matched) {
      for (const t of match.transactions) {
        if (splitAcross.has(t.id) || answered.has(t.id)) continue;
        settled.set(t.id, documentKey(match.invoice));
      }
    }
  }

  return settled;
}

/** Each bank line's amount, and each split part's, by the id an assignment names it by. */
function lineAmounts(transactions: readonly Transaction[], splits: Splits): Map<string, number> {
  const out = new Map<string, number>();
  for (const t of transactions) out.set(t.id, t.amount);
  for (const [id, parts] of Object.entries(splits)) {
    parts.forEach((part, i) => out.set(splitPartId(id, i), part.amount));
  }
  return out;
}
