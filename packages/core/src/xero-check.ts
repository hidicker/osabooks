import type { Cents } from "./money.js";
import type { IsoDate } from "./dates.js";
import type { OpeningBalances } from "./balance-sheet.js";
import type { PostedJournal } from "./posting.js";

/**
 * Another system's figures set beside these books', account by account.
 *
 * For the report that sums up a set of books brought in from Xero: whether
 * each account comes to what Xero says it does. Two comparisons are made of
 * it -- the balances at a year end, from Xero's trial balance, and the year's
 * movement on every account, from Xero's journal report -- and both come down
 * to the same thing: two sets of balances, keyed alike, and the accounts where
 * they part.
 */

export interface AccountDifference {
  /** The account, as both sides key it: a chart code, or a bank account. */
  account: string;
  /** Debit positive, credit negative, as the books hold it. */
  theirs: Cents;
  ours: Cents;
  /** Ours less theirs. */
  difference: Cents;
}

export interface AccountComparison {
  /** Accounts with an amount on either side. */
  compared: number;
  /** Of those, the ones that come to the same figure. */
  agree: number;
  /** The rest, largest difference first. */
  differences: AccountDifference[];
}

/**
 * Two sets of balances, account by account. An account on one side only is
 * compared with nothing on the other, so it shows rather than drops out; one
 * with nothing on either side is not counted.
 */
export function compareBalances(
  theirs: Readonly<Record<string, Cents>>,
  ours: Readonly<Record<string, Cents>>,
  tolerance: Cents = 0,
): AccountComparison {
  const keys = new Set([...Object.keys(theirs), ...Object.keys(ours)]);
  let compared = 0;
  let agree = 0;
  const differences: AccountDifference[] = [];
  for (const account of keys) {
    const t = theirs[account] ?? 0;
    const o = ours[account] ?? 0;
    if (t === 0 && o === 0) continue;
    compared += 1;
    if (Math.abs(o - t) <= tolerance) {
      agree += 1;
      continue;
    }
    differences.push({ account, theirs: t, ours: o, difference: (o - t) as Cents });
  }
  differences.sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference) || a.account.localeCompare(b.account));
  return { compared, agree, differences };
}

/** The key a posting line is kept under, as the balance sheet keys it. */
function keyOf(line: { accountCode: string; accountName: string }): string {
  return line.accountCode || line.accountName;
}

/**
 * Each account's movement over a stretch of days, keyed as the balance sheet
 * keys accounts: by code, or for a bank line by the account itself.
 */
export function movementsBetween(
  journals: readonly PostedJournal[],
  from: IsoDate,
  to: IsoDate,
): Record<string, Cents> {
  const out: Record<string, Cents> = {};
  for (const journal of journals) {
    if (journal.date < from || journal.date > to) continue;
    for (const line of journal.lines) {
      const key = keyOf(line);
      out[key] = ((out[key] ?? 0) + line.amount) as Cents;
    }
  }
  return out;
}

/**
 * The balance-sheet accounts' balances at the end of a day, as a trial
 * balance column read in states them: the opening balances and everything
 * posted since, with the profit since the opening balances -- the income and
 * expense accounts' movement -- carried into retained earnings, which is
 * where reading a trial balance puts what it does not list.
 *
 * Null for a day before the opening balances: these books hold nothing then
 * to set beside it. Null too for the day just before them, which is the very
 * column the opening balances were read from: compared with itself, it would
 * always agree and prove nothing.
 */
export function balancesOn(
  opening: OpeningBalances,
  journals: readonly PostedJournal[],
  date: IsoDate,
  isProfitAndLoss: (key: string) => boolean,
  retainedEarningsKey: string,
): Record<string, Cents> | null {
  if (date < opening.asAt) return null;
  const out: Record<string, Cents> = { ...opening.accounts };
  let profit = 0;
  for (const journal of journals) {
    if (journal.date < opening.asAt || journal.date > date) continue;
    for (const line of journal.lines) {
      const key = keyOf(line);
      if (isProfitAndLoss(key)) {
        profit += line.amount;
        continue;
      }
      out[key] = ((out[key] ?? 0) + line.amount) as Cents;
    }
  }
  if (profit !== 0) out[retainedEarningsKey] = ((out[retainedEarningsKey] ?? 0) + profit) as Cents;
  for (const [key, amount] of Object.entries(out)) if (amount === 0) delete out[key];
  return out;
}
