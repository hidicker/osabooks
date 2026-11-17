import { parseCsvRecords } from "./csv.js";
import type { IsoDate } from "./dates.js";

/**
 * Xero's History and notes report: who changed what in the books, and when.
 *
 * What an accountant did in Xero after the fact -- a journal voided and
 * written again, a GST return's box 9 changed before filing, a year's lock
 * date moved back and forward, fourteen lines recoded at once -- shows in no
 * other export. The journal report has the journals as they ended up; this has
 * how they got there. Read so the AI accounts check and the summary of the
 * books can say it.
 *
 * Xero writes it as a workbook: a title, the organisation and the dates asked
 * for, then one row per event -- when (in the organisation's time zone), who,
 * the kind of thing, an "Item" that is always "-", and what happened. It stops
 * at 1,000 rows whatever dates were asked for, which is said rather than
 * passed over: a file that stops there has lost its earlier history.
 */

export interface XeroHistoryEntry {
  /** When, as Xero wrote it in the organisation's time zone: "2026-11-10T12:29". */
  at: string;
  user: string;
  /** Xero's kind of thing: "Manual journal", "Tax Return", "Financial settings". */
  type: string;
  /** What happened, as plain text: "Edited - Lock date (for all users) - changed from ...". */
  detail: string;
}

export interface XeroHistoryRead {
  entries: XeroHistoryEntry[];
  organisation: string;
  /** The dates the report was asked for, as Xero wrote them. */
  asked: string;
  /** True when it holds 1,000 entries: Xero stopped there, and earlier ones are missing. */
  cutShort: boolean;
}

/** Xero's limit on one History and notes export. */
export const XERO_HISTORY_LIMIT = 1000;

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

/** "10 Nov 2026 12:29", "22 Oct 2026 4:42 am", "2 Sept 2026 09:18" as "2026-11-10T12:29". */
export function xeroHistoryTime(text: string): string | null {
  const m = /^\s*(\d{1,2})\s+([A-Za-z]+)\.?\s+(\d{4})\s+(\d{1,2}):(\d{2})\s*(am|pm)?\s*$/i.exec(text);
  if (m === null) return null;
  const month = MONTHS[(m[2] ?? "").toLowerCase()];
  if (month === undefined) return null;
  let hour = Number(m[4]);
  const half = (m[6] ?? "").toLowerCase();
  if (half === "pm" && hour < 12) hour += 12;
  if (half === "am" && hour === 12) hour = 0;
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${m[3]}-${pad(month)}-${pad(Number(m[1]))}T${pad(hour)}:${m[5]}`;
}

/** The detail as text: Xero puts a link round an attached file's name. */
function plain(text: string): string {
  return text
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** Whether a file (as CSV) is Xero's History and notes report. */
export function isXeroHistory(text: string): boolean {
  const head = parseCsvRecords(text.slice(0, 2000)).slice(0, 6).map((r) => r.fields.map((f) => f.trim()));
  return (
    head.some((r) => r[0] === "Title:" && r[1] === "History and notes") &&
    head.some((r) => /^Date\b/.test(r[0] ?? "") && r[1] === "User" && r[2] === "Type")
  );
}

export function readXeroHistory(text: string): XeroHistoryRead | null {
  if (!isXeroHistory(text)) return null;
  const records = parseCsvRecords(text);
  let organisation = "";
  let asked = "";
  const entries: XeroHistoryEntry[] = [];
  let started = false;
  for (const record of records) {
    const f = record.fields.map((x) => x.trim());
    if (!started) {
      if (f[0] === "Organisation:") organisation = f[1] ?? "";
      if (f[0] === "Selected date range:") asked = f[1] ?? "";
      if (/^Date\b/.test(f[0] ?? "") && f[1] === "User") started = true;
      continue;
    }
    const at = xeroHistoryTime(f[0] ?? "");
    if (at === null) continue;
    entries.push({ at, user: f[1] ?? "", type: f[2] ?? "", detail: plain(f[4] ?? f[3] ?? "") });
  }
  return { entries, organisation, asked, cutShort: entries.length >= XERO_HISTORY_LIMIT };
}

/**
 * Whether an entry says something about the accounts worth keeping: what was
 * done to manual journals, GST returns, settings and accounts, bulk recodes,
 * and notes somebody wrote. Not the run of creating and reconciling bank lines,
 * invoices viewed and reminders sent, which are most of a report and say
 * nothing the books do not.
 */
export function xeroHistoryWorthKeeping(entry: XeroHistoryEntry): boolean {
  if (/^Note\b/i.test(entry.detail)) return true;
  switch (entry.type) {
    case "Manual journal":
    case "Tax Return":
    case "Financial settings":
    case "Account":
      return true;
    case "History event":
      return /^Recode\b/i.test(entry.detail);
    default:
      return false;
  }
}

/** Entries kept already and those read, together: each once, newest first. */
export function mergeXeroHistory(
  held: readonly XeroHistoryEntry[],
  incoming: readonly XeroHistoryEntry[],
): { entries: XeroHistoryEntry[]; added: number } {
  const key = (e: XeroHistoryEntry): string => [e.at, e.user, e.type, e.detail].join("\u0001");
  const seen = new Set(held.map(key));
  const added = incoming.filter((e) => !seen.has(key(e)));
  const fresh = new Set<string>();
  const unique = added.filter((e) => (fresh.has(key(e)) ? false : (fresh.add(key(e)), true)));
  const entries = [...held, ...unique].sort((a, b) => b.at.localeCompare(a.at));
  return { entries, added: unique.length };
}

/**
 * What happened to one manual journal, as near as the report can say: the
 * report names no journal, so it is the manual-journal events on the day the
 * journal was posted, by whoever posted it -- created, posted, edited, voided,
 * files attached -- oldest first. Where one person posted two journals that
 * day, both are given the day's events, and `shared` says so.
 */
export function manualJournalHistory(
  entries: readonly XeroHistoryEntry[],
  posted: { date: IsoDate | null; by: string },
  othersThatDay = 0,
): { events: XeroHistoryEntry[]; shared: boolean } {
  if (posted.date === null) return { events: [], shared: false };
  const events = entries
    .filter((e) => e.type === "Manual journal" && e.at.slice(0, 10) === posted.date && e.user.trim() === posted.by.trim())
    .sort((a, b) => a.at.localeCompare(b.at));
  return { events, shared: othersThatDay > 0 && events.length > 0 };
}

/**
 * The changes worth knowing about for a year's books: settings, GST returns,
 * bulk recodes, journals voided or edited after they were posted. Made during
 * the year, or in the year after it while it was being finished.
 */
export function changesForYear(
  entries: readonly XeroHistoryEntry[],
  year: { from: IsoDate; to: IsoDate },
): XeroHistoryEntry[] {
  const until = `${Number(year.to.slice(0, 4)) + 1}${year.to.slice(4)}`;
  return entries
    .filter((e) => {
      const day = e.at.slice(0, 10);
      if (day < year.from || day > until) return false;
      if (e.type === "Financial settings" || (e.type === "History event" && /^Recode\b/i.test(e.detail))) return true;
      if (e.type === "Tax Return") return /^Changed\b|reverted|filed/i.test(e.detail);
      if (e.type === "Manual journal") return /^(Voided|Edited|Deleted)\b/i.test(e.detail);
      return /^Note\b/i.test(e.detail);
    })
    .sort((a, b) => a.at.localeCompare(b.at));
}
