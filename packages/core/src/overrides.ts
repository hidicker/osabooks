import type { GstClassification, GstSide, GstTreatment } from "./gst.js";
import type { Transaction } from "./types.js";

/**
 * Manual corrections that beat every rule.
 *
 * Rules suggest; the user decides. No rule set survives contact with real bank
 * text -- a payout that arrives net of fees, a supplier who deregisters, a
 * one-off that looks like something it is not -- so there has to be a way to
 * say "this one is different" and have it stick.
 *
 * Overrides are keyed by transaction id, which is derived from the transaction
 * itself rather than from its position in a file. That is what makes a
 * correction durable: re-import the same statement, or a later overlapping
 * one, and the override still lands on the same row.
 *
 * Every override carries a `note`. An anonymous correction is indistinguishable
 * from a mistake six months later, and this is exactly the kind of decision
 * that gets questioned at year end.
 */

export interface TransactionOverride {
  /**
   * A human has looked at this transaction and accepted its coding.
   *
   * Rules only ever *suggest*. Without this flag a guess and a decision are
   * indistinguishable, so nothing can tell you how much of a return still
   * rests on unreviewed guesses -- which is the one thing worth knowing before
   * filing it.
   *
   * Confirming without changing anything is a real and common act: it records
   * that the suggestion was correct.
   */
  confirmed?: boolean;
  /** Account code, replacing whatever the rules would have assigned. */
  code?: string;
  /** Who this was to or from, replacing whatever the rule would have named. */
  contact?: string;
  /** GST treatment, replacing whatever the GST rules would have assigned. */
  treatment?: GstTreatment;
  /** Which side of the return. Defaults to the direction of the amount. */
  side?: GstSide;
  /**
   * Claim this transaction's GST in the return ending on this date.
   *
   * For an expense found after its own return was filed. The money still moved
   * when it moved; only the claim shifts, and it lands in Box 9 or Box 13 as an
   * adjustment rather than in Box 5 or Box 11.
   */
  claimIn?: string;
  /**
   * The code kept after checking it against an imported coding that differs.
   * Its own field so that the note can stay whatever the person wrote; once
   * the code changes, the check no longer applies.
   */
  keptAgainstImport?: string;
  /**
   * How the line came to be coded, where nobody wrote why: a suggestion
   * accepted, changed by hand, accepted with others, or an AI suggestion
   * accepted. Kept apart from the note, which is for a person's own words.
   */
  how?: CodedHow;
  /** A model's own reason for its suggestion, when one was accepted. */
  why?: string;
  /** Why this was overridden, in the person's words; empty when they gave none. */
  note: string;
  /** ISO date the override was set, for auditing. */
  at?: string;
}

/** How a line came to be coded, where nobody wrote why. */
export type CodedHow = "accepted" | "changed" | "accepted-all" | "ai";

const HOW_SAID: Readonly<Record<CodedHow, string>> = {
  accepted: "Suggestion accepted unchanged",
  changed: "Changed by hand",
  "accepted-all": "Suggestion accepted unchanged, with others",
  ai: "AI suggestion accepted unchanged, with others",
};

/**
 * What to say of how a line was coded: the person's note if they wrote one,
 * otherwise how it was coded (and the model's reason, for an AI suggestion).
 */
export function overrideSaid(override: Pick<TransactionOverride, "note" | "how" | "why">): string {
  const note = (override.note ?? "").trim();
  if (note !== "") return note;
  if (override.how === undefined) return "";
  const why = (override.why ?? "").trim();
  return why === "" ? HOW_SAID[override.how] : `${HOW_SAID[override.how]} — ${why}`;
}

/**
 * Books from before 3 November 2026 wrote how a line was coded into its note.
 * The words the app wrote, and only those, are moved to `how` (and an AI's
 * reason to `why`), leaving the note empty for the person's own.
 */
export function separateCodingNote(override: TransactionOverride): TransactionOverride {
  const note = override.note ?? "";
  const plain: Readonly<Record<string, CodedHow>> = {
    "Suggestion accepted unchanged": "accepted",
    "Suggestion confirmed unchanged": "accepted",
    "Changed by hand, no description given": "changed",
    "Suggestion accepted unchanged, with others": "accepted-all",
  };
  const how = plain[note];
  if (how !== undefined) return { ...override, how, note: "" };
  const ai = /^AI suggestion accepted unchanged, with others(?: \([^)]*\))? — (.*)$/s.exec(note);
  if (ai !== null) return { ...override, how: "ai", why: note.slice(note.indexOf(" — ") + 3), note: "" };
  return override;
}

/** Every override's note separated, as `separateCodingNote`; the same object when none changed. */
export function separateCodingNotes(overrides: Overrides): Overrides {
  let changed = false;
  const out: Record<string, TransactionOverride> = {};
  for (const [id, override] of Object.entries(overrides)) {
    const next = separateCodingNote(override);
    if (next !== override) changed = true;
    out[id] = next;
  }
  return changed ? out : overrides;
}

/** Overrides keyed by transaction id. */
export type Overrides = Readonly<Record<string, TransactionOverride>>;

export function overrideFor(
  transaction: Transaction,
  overrides: Overrides | undefined,
): TransactionOverride | undefined {
  return overrides?.[transaction.id];
}

/**
 * Apply a GST override, if one exists for this transaction.
 *
 * Returns undefined when there is no override, or when the override only sets
 * a code and says nothing about GST -- correcting a coding should not silently
 * change a GST treatment the user did not touch.
 */
export function gstOverride(
  transaction: Transaction,
  overrides: Overrides | undefined,
): GstClassification | undefined {
  const override = overrideFor(transaction, overrides);
  if (!override || override.treatment === undefined) return undefined;

  return {
    treatment: override.treatment,
    side: override.side ?? (transaction.amount < 0 ? "purchases" : "sales"),
    reason: overrideSaid(override) === "" ? "Manual override" : `Manual override: ${overrideSaid(override)}`,
  };
}
