import { depreciationSchedule } from "./assets.js";
import type { FixedAsset } from "./assets.js";
import type { Account } from "./chart.js";
import { financialYear, financialYearOf } from "./dates.js";
import type { FinancialYearOptions } from "./dates.js";
import { postDepreciation } from "./posting.js";
import type { PostedJournal } from "./posting.js";
import type { Transaction } from "./types.js";

/**
 * Depreciation, posted year by year against the right contra account.
 *
 * The charge itself is arithmetic the asset register decides. What this adds
 * is where it lands: a chart carries one accumulated depreciation account per
 * class of asset, and the schedule groups by the asset's own type, so the two
 * have to be matched by name.
 *
 * Matched by scoring rather than by first hit, and the reason is a bug this
 * had: "Roasting Equipment" shares the word *equipment* with "Office
 * Equipment", and taking the first account that matched put an entire year of
 * roasting depreciation against the office contra. The distinctive word is
 * the long one, so a longer match counts for more.
 */
export interface DepreciationJournalsOptions {
  assets: readonly FixedAsset[];
  /** Only the years the transactions reach are posted. */
  transactions: readonly Transaction[];
  chart: readonly Account[];
  /** Where the charge goes when the chart has no account named Depreciation. */
  fallbackExpenseCode?: string;
  /** The expense account chosen for an asset type, by its code, where one was. */
  expenseFor?: (type: string) => string | undefined;
  /**
   * Today, for the year in progress. That year is posted month by month, for
   * the months already finished, rather than as a whole year dated a 31 March
   * still to come: a profit and loss to 30 September then carries six
   * months' depreciation, not twelve. Without it every year is posted whole.
   */
  today?: string;
  /** The books' year end, 31 March (New Zealand's) where not given. */
  yearEnd?: FinancialYearOptions;
  /** Share the year out by days held, as Australia does, not by whole months. */
  byDays?: boolean;
}

/**
 * The account whose name best fits a class of asset.
 *
 * Used for both halves of an asset posting -- the asset account and the
 * accumulated depreciation contra -- because the question is the same one and
 * getting two answers to it is how a class's depreciation ends up credited
 * against another class's contra.
 */
export function bestAccountMatch(
  candidates: readonly Account[],
  type: string,
): Account | undefined {
  const words = type.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
  let best = 0;
  let chosen = candidates[0];
  for (const account of candidates) {
    const name = account.name.toLowerCase();
    const score = words.reduce((sum, w) => (name.includes(w) ? sum + w.length : sum), 0);
    if (score > best) {
      best = score;
      chosen = account;
    }
  }
  return chosen;
}

export function depreciationJournals(options: DepreciationJournalsOptions): PostedJournal[] {
  const { assets, transactions, chart } = options;
  if (assets.length === 0) return [];

  const yearEnd = options.yearEnd ?? {};
  const years = [...new Set(transactions.map((t) => financialYearOf(t.date, yearEnd)))];
  const accumulated = chart.filter((a) => /accumulated depreciation/i.test(a.name));
  const named = chart.filter((a) => /^depreciation$/i.test(a.name.trim()));
  const ending = (code: string): string => code.replace(/^[0-9]+/, "");

  const post = (type: string, amount: number, date: string): PostedJournal => {
    const contra = bestAccountMatch(accumulated, type);
    // The type's own expense account where one was chosen; otherwise the
    // Depreciation account of the asset's entity -- the one whose code ends
    // as the contra's does (416KC beside 711KC) -- or the first there is.
    const chosen = options.expenseFor?.(type);
    const expense =
      (chosen === undefined ? undefined : chart.find((a) => a.code === chosen)) ??
      (contra === undefined ? undefined : named.find((a) => ending(a.code) === ending(contra.code))) ??
      named[0];
    return postDepreciation({
      name: type,
      expenseCode: expense?.code ?? options.fallbackExpenseCode ?? "416",
      expenseName: expense?.name ?? "Depreciation",
      accumulatedCode: contra?.code ?? "",
      accumulatedName: contra?.name ?? `Less Accumulated Depreciation — ${type}`,
      amount,
      date,
    });
  };
  const byType = (to: string, year: number): Map<string, number> =>
    new Map(
      depreciationSchedule(assets, { from: financialYear(year, yearEnd).from, to }, { byDays: options.byDays === true }).byType.map((g) => [g.type, g.depreciation]),
    );

  const out: PostedJournal[] = [];
  const current = options.today === undefined ? null : financialYearOf(options.today as never, yearEnd);
  for (const year of years) {
    if (year === current && options.today !== undefined) {
      // Month by month, each the change in the year's depreciation to date,
      // so the months always add up to what the schedule says for them --
      // and an asset sold part-way through the year, which takes none that
      // year, has what was charged taken back in the month it went.
      let before = new Map<string, number>();
      for (const end of monthEndsOfYear(financialYear(year, yearEnd).from)) {
        if (end >= options.today) break;
        const now = byType(end, year);
        for (const type of new Set([...now.keys(), ...before.keys()])) {
          const change = (now.get(type) ?? 0) - (before.get(type) ?? 0);
          if (change !== 0) out.push(post(type, change, end));
        }
        before = now;
      }
      continue;
    }
    const end = financialYear(year, yearEnd).to;
    for (const [type, amount] of byType(end, year)) {
      if (amount !== 0) out.push(post(type, amount, end));
    }
  }
  return out;
}

/** The last day of each of the twelve months from a year's first day. */
/**
 * Depreciation the year in progress will carry that is not posted yet, as an
 * estimate for a report whose period runs past today.
 *
 * The year in progress is posted for the months already ended
 * (`depreciationJournals`), so a full-year report part-way through the year
 * carries only those. This is the rest, to the report's end -- and never past
 * the financial year's end, since next year's depreciation turns on what is
 * bought and sold before then. Nothing is posted: it is said beside the
 * report, marked as an estimate, and kept out of every return.
 *
 * Zero where the report ends before the months still to post, or in a year
 * already over (posted whole at its end), or with nothing to depreciate.
 */
export function depreciationStillToPost(
  assets: readonly FixedAsset[],
  options: {
    today: string;
    to: string;
    yearEnd?: FinancialYearOptions;
    byDays?: boolean;
    /**
     * The lines `depreciationJournals` was given. It posts only the years they
     * reach, so a year in progress with none of them has nothing posted yet,
     * and the estimate is the whole of it. Absent, the months already ended
     * are taken as posted.
     */
    transactions?: readonly Transaction[];
  },
): { amount: number; to: string; byType: { type: string; amount: number }[] } {
  const yearEnd = options.yearEnd ?? {};
  const year = financialYearOf(options.today as never, yearEnd);
  const span = financialYear(year, yearEnd);
  const to = options.to < span.to ? options.to : span.to;
  const none = { amount: 0, to, byType: [] };
  if (assets.length === 0 || to < options.today) return none;
  const posting =
    options.transactions === undefined || options.transactions.some((t) => financialYearOf(t.date, yearEnd) === year);
  // Where the posting stops: the last month end before today, as above.
  let postedTo: string | null = null;
  for (const end of monthEndsOfYear(span.from)) {
    if (!posting || end >= options.today) break;
    postedTo = end;
  }
  const schedule = (end: string): Map<string, number> =>
    new Map(depreciationSchedule(assets, { from: span.from, to: end } as never, { byDays: options.byDays === true }).byType.map((g) => [g.type, g.depreciation]));
  const whole = schedule(to);
  const posted = postedTo === null ? new Map<string, number>() : schedule(postedTo);
  const byType = [...new Set([...whole.keys(), ...posted.keys()])]
    .map((type) => ({ type, amount: (whole.get(type) ?? 0) - (posted.get(type) ?? 0) }))
    .filter((t) => t.amount !== 0);
  return { amount: byType.reduce((s, t) => s + t.amount, 0), to, byType };
}

function monthEndsOfYear(start: string): string[] {
  const out: string[] = [];
  const y0 = Number(start.slice(0, 4));
  const m0 = Number(start.slice(5, 7)) - 1;
  for (let i = 0; i < 12; i++) {
    const last = new Date(Date.UTC(y0, m0 + i + 1, 0));
    out.push(last.toISOString().slice(0, 10));
  }
  return out;
}
