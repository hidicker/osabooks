import type { Invoice, InvoiceKind } from "./invoices.js";

/**
 * Which document a reference means: its kind and its number together.
 *
 * A document's number is unique only within its kind. Sales are numbered by
 * the business, and a bill carries the *supplier's* own number, so after a
 * move from Xero a sale `INV-0012` and a bill `INV-0012` from a supplier who
 * also uses Xero is the ordinary case, not an edge one. Anything that finds a
 * document by its number alone finds whichever of the two came last: the
 * sale's balance disappeared from receivables, and a customer's receipt was
 * posted to Accounts Payable.
 *
 * So documents are found by this key, never by a bare number. It is a type of
 * its own so the compiler, not a reviewer, finds a lookup that forgot the kind:
 * a `Map<DocumentKey, …>` will not take a plain string.
 */
export type DocumentKey = string & { readonly __documentKey: unique symbol };

const KINDS: readonly InvoiceKind[] = ["sales", "purchase"];

export function documentKey(kind: InvoiceKind, number: string): DocumentKey;
export function documentKey(document: Pick<Invoice, "kind" | "number">): DocumentKey;
export function documentKey(a: InvoiceKind | Pick<Invoice, "kind" | "number">, b?: string): DocumentKey {
  return (typeof a === "string" ? `${a}:${b ?? ""}` : `${a.kind}:${a.number}`) as DocumentKey;
}

/** The kind and number in a key, or null for a reference written before keys: a bare number. */
export function splitDocumentKey(ref: string): { kind: InvoiceKind; number: string } | null {
  const colon = ref.indexOf(":");
  if (colon < 0) return null;
  const kind = ref.slice(0, colon) as InvoiceKind;
  return KINDS.includes(kind) ? { kind, number: ref.slice(colon + 1) } : null;
}

/** The number a reference names, for showing it: the key's own, or the bare number as it was stored. */
export function documentNumberOf(ref: string): string {
  return splitDocumentKey(ref)?.number ?? ref;
}

/**
 * A record kept by document -- credit note to what it credits, say -- read
 * for one document: under its key, or under its bare number as older books
 * wrote it.
 */
export function storedFor<T>(record: Readonly<Record<string, T>>, document: Pick<Invoice, "kind" | "number">): T | undefined {
  return record[documentKey(document)] ?? record[document.number];
}

/**
 * The direction money settles a document in: a receipt (positive) pays a sale
 * or is a supplier's refund against their credit note; a payment (negative)
 * pays a bill or refunds a customer's credit note.
 */
export function settlesInDirection(document: Pick<Invoice, "kind" | "total">, amount: number): boolean {
  const owedToUs = (document.kind === "sales") === (document.total >= 0);
  return amount >= 0 ? owedToUs : !owedToUs;
}

/**
 * The books' documents, found by key, and by the references stored before
 * keys existed.
 *
 * References written now are keys. Books saved earlier hold bare numbers in
 * their bank matches, credit notes, credit allocations and jobs. Those are not
 * rewritten -- a stored match in a locked period changing would be recorded
 * as a change after the lock -- but read here: a bare number used by one
 * document is that document, and one shared by a sale and a bill is decided
 * by `prefer` (the direction of the money, the kind of the credit note it
 * belongs with). One that still cannot be told apart resolves to nothing,
 * which leaves it to be matched again rather than settling the wrong one.
 */
export class DocumentIndex {
  private readonly byKey = new Map<DocumentKey, Invoice>();
  private readonly byNumber = new Map<string, Invoice[]>();

  constructor(documents: readonly Invoice[]) {
    for (const document of documents) {
      // Within a kind the last one wins, as it always has: import keeps them unique there.
      this.byKey.set(documentKey(document), document);
      const same = this.byNumber.get(document.number) ?? [];
      same.push(document);
      this.byNumber.set(document.number, same);
    }
  }

  get(key: DocumentKey): Invoice | undefined {
    return this.byKey.get(key);
  }

  has(key: DocumentKey): boolean {
    return this.byKey.has(key);
  }

  /** The document a stored reference means, key or bare number; undefined when none, or none can be told apart. */
  resolve(ref: string | undefined, prefer?: (document: Invoice) => boolean): Invoice | undefined {
    if (ref === undefined || ref === "") return undefined;
    const split = splitDocumentKey(ref);
    if (split !== null) {
      const found = this.byKey.get(documentKey(split.kind, split.number));
      if (found !== undefined) return found;
      // A number that itself begins "sales:" or "purchase:" and was stored bare.
    }
    const candidates = [...new Map((this.byNumber.get(ref) ?? []).map((d) => [documentKey(d), d])).values()];
    if (candidates.length <= 1) return candidates[0];
    if (prefer === undefined) return undefined;
    const preferred = candidates.filter(prefer);
    return preferred.length === 1 ? preferred[0] : undefined;
  }

  /** The key a stored reference means, as resolve() finds it. */
  resolveKey(ref: string | undefined, prefer?: (document: Invoice) => boolean): DocumentKey | undefined {
    const found = this.resolve(ref, prefer);
    return found === undefined ? undefined : documentKey(found);
  }

  /** Numbers used by more than one kind of document: a sale and a bill sharing a number. */
  sharedNumbers(): string[] {
    return [...this.byNumber.entries()]
      .filter(([, same]) => new Set(same.map((d) => d.kind)).size > 1)
      .map(([number]) => number);
  }
}
