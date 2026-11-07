/**
 * Dates are stored as ISO `YYYY-MM-DD` strings -- no time, no timezone.
 *
 * A bank transaction happens on a calendar day in the account's own
 * jurisdiction. Putting it through a `Date` object invites the classic
 * off-by-one where a UTC conversion moves a NZ transaction to the previous
 * day, so parsing here goes straight from text to Y/M/D integers.
 */

export type IsoDate = string;

export interface DateParseOptions {
  /**
   * Interpret ambiguous `03/04/2024` as 3 April (true, the NZ/UK convention)
   * or 4 March (false, US). Defaults to true.
   */
  dayFirst?: boolean;
}

/** Keyed on the first three letters, so `Sep`, `Sept` and `September` all hit. */
const MONTHS: Readonly<Record<string, number>> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function monthFromName(name: string): number | undefined {
  return MONTHS[name.slice(0, 3).toLowerCase()];
}

/**
 * Excel's day 0 is 1899-12-30 rather than 1899-12-31, because Excel
 * deliberately reproduces a Lotus 1-2-3 bug that treats 1900 as a leap year.
 */
const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30);

/** Serials outside this window are almost certainly not dates. 1970..2100. */
const MIN_SERIAL = 25569;
const MAX_SERIAL = 73415;

/**
 * Parse a date from a bank export or a spreadsheet cell.
 *
 * Accepts ISO (`2024-04-03`), day/month/year and month/day/year with `/`, `-`
 * or `.` separators, textual months (`3 Apr 2024`, `03-APR-24`), and raw Excel
 * serial numbers, which is what the source workbook stores. Returns `null` if
 * the value is not a date the caller should trust.
 */
/**
 * Whether a date with nothing else to go on is read day first, as the books'
 * country writes it: set once when the books open (New Zealand's until then).
 * A file whose own order is known -- a bank file, a QuickBooks export -- says
 * so through `dayFirst` and is read that way regardless. Exports from an
 * accounting system (Xero's, the coding to compare, a filed return) follow
 * the country they were kept in, so a US Xero export's 3/4/2026 is 4 March.
 */
let booksDayFirst = true;

export function setBooksDayFirst(dayFirst: boolean): void {
  booksDayFirst = dayFirst;
}

export function parseDate(input: unknown, options: DateParseOptions = {}): IsoDate | null {
  const dayFirst = options.dayFirst ?? booksDayFirst;

  if (input === null || input === undefined) return null;

  if (input instanceof Date) {
    return Number.isNaN(input.getTime())
      ? null
      : toIso(input.getFullYear(), input.getMonth() + 1, input.getDate());
  }

  if (typeof input === "number") return fromExcelSerial(input);

  const text = String(input).trim();
  if (text === "") return null;

  // A bare number is an Excel serial. Fractional serials carry a time of day,
  // which Wise exports use; the fraction is dropped.
  if (/^\d+(\.\d+)?$/.test(text)) {
    const serial = Number(text);
    if (serial >= MIN_SERIAL && serial <= MAX_SERIAL) return fromExcelSerial(serial);
  }

  // ISO first -- it is unambiguous, so it never needs the dayFirst hint.
  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/);
  if (iso) return build(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  // Eight digits, year first: 20260312, as Korean exports and many systems
  // write it. Far beyond any Excel serial, so it cannot be one.
  const compact = text.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compact) return build(Number(compact[1]), Number(compact[2]), Number(compact[3]));

  // Year first with spaces after the separators, as Korean dates are written
  // (2026. 3. 12.), with or without the closing point and a time of day.
  const spaced = text.match(/^(\d{4})\s*[./-]\s*(\d{1,2})\s*[./-]\s*(\d{1,2})\s*\.?(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?$/);
  if (spaced) return build(Number(spaced[1]), Number(spaced[2]), Number(spaced[3]));

  // Textual month: `3 Apr 2024`, `3-Apr-24`, `Apr 3 2024`.
  const textual = text.match(/^(\d{1,2})[\s\-/.]([A-Za-z]{3,9})[\s\-/.](\d{2,4})$/);
  if (textual) {
    const month = monthFromName(textual[2] ?? "");
    if (month) return build(expandYear(Number(textual[3])), month, Number(textual[1]));
  }
  const textualFirst = text.match(/^([A-Za-z]{3,9})[\s\-/.](\d{1,2}),?[\s\-/.](\d{2,4})$/);
  if (textualFirst) {
    const month = monthFromName(textualFirst[1] ?? "");
    if (month) return build(expandYear(Number(textualFirst[3])), month, Number(textualFirst[2]));
  }

  const numeric = text.match(/^(\d{1,4})[/\-.](\d{1,2})[/\-.](\d{1,4})$/);
  if (numeric) {
    const a = Number(numeric[1]);
    const b = Number(numeric[2]);
    const c = Number(numeric[3]);

    // `2024/04/03` -- four-digit year leading.
    if (String(numeric[1]).length === 4) return build(a, b, c);

    // Resolve day/month by the dayFirst convention, but let an out-of-range
    // value overrule it: `13/04/2024` can only be 13 April.
    let day = dayFirst ? a : b;
    let month = dayFirst ? b : a;
    if (month > 12 && day <= 12) [day, month] = [month, day];

    return build(expandYear(c), month, day);
  }

  return null;
}

/** Convert an Excel/Sheets date serial to an ISO date. */
export function fromExcelSerial(serial: number): IsoDate | null {
  if (!Number.isFinite(serial)) return null;
  const days = Math.floor(serial);
  if (days < MIN_SERIAL || days > MAX_SERIAL) return null;
  const date = new Date(EXCEL_EPOCH_UTC + days * 86_400_000);
  return toIso(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

/** Two-digit years map to 1970..2069, matching Excel's own pivot. */
function expandYear(year: number): number {
  if (year >= 1000) return year;
  if (year >= 100) return year;
  return year < 70 ? 2000 + year : 1900 + year;
}

/** Reject impossible dates such as 31 February rather than rolling them over. */
function build(year: number, month: number, day: number): IsoDate | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (year < 1900 || year > 2100) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  return toIso(year, month, day);
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function toIso(year: number, month: number, day: number): IsoDate {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Whole days from `a` to `b`. Negative when `b` is earlier. */
export function daysBetween(a: IsoDate, b: IsoDate): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/**
 * The next day.
 *
 * Through UTC rather than by adding to the string, because a month or a year
 * boundary is not arithmetic on the last two characters, and a local-time date
 * shifts under daylight saving -- which would silently move a transaction
 * between two tax years twice a year.
 */
export function dayAfter(date: IsoDate): IsoDate {
  const at = new Date(`${date}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + 1);
  return at.toISOString().slice(0, 10) as IsoDate;
}

/**
 * Today's date where the person is, as YYYY-MM-DD.
 *
 * Not `toISOString()`, which is the date in UTC: in New Zealand that is still
 * yesterday until noon or 1pm, so an invoice made in the morning was dated the
 * day before.
 */
export function localToday(now?: Date): IsoDate {
  // Today where the books are kept, when they keep a time zone: a computer
  // set to Korea's clock is still on yesterday for New Zealand books until 4am.
  if (now === undefined && booksTimeZone !== undefined) {
    try {
      const parts = new Intl.DateTimeFormat("en-CA", { timeZone: booksTimeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
      if (/^\d{4}-\d{2}-\d{2}$/.test(parts)) return parts as IsoDate;
    } catch {
      // An unknown zone: the computer's today, as before.
    }
  }
  const at = now ?? new Date();
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}` as IsoDate;
}

let booksTimeZone: string | undefined;

/** The time zone "today" is taken in, from the books' settings; undefined for the computer's. */
export function setBooksTimeZone(zone: string | undefined): void {
  booksTimeZone = zone === undefined || zone.trim() === "" ? undefined : zone;
}

/** A moment as the person's own clock shows it, "2026-11-03 09:15", from a Date or an ISO time. */
export function localStamp(at: Date | string = new Date()): string {
  const when = typeof at === "string" ? new Date(at) : at;
  if (Number.isNaN(when.getTime())) return typeof at === "string" ? at.slice(0, 16).replace("T", " ") : "";
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${localToday(when)} ${pad(when.getHours())}:${pad(when.getMinutes())}`;
}

/** The day before, the same way as `dayAfter`. */
export function dayBefore(date: IsoDate): IsoDate {
  const at = new Date(`${date}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() - 1);
  return at.toISOString().slice(0, 10) as IsoDate;
}

export interface DateRange {
  from: IsoDate;
  to: IsoDate;
}

export interface FinancialYearOptions {
  /** Month the year ends in, 1-12. Defaults to 3 (March), the NZ/AU convention. */
  endMonth?: number;
  /** Day of that month the year ends on. Defaults to 31. */
  endDay?: number;
}

/**
 * The date range of a financial year, labelled by the year it ends in.
 *
 * `financialYear(2026)` is 1 April 2025 to 31 March 2026 -- what a New Zealand
 * accountant means by "the 2026 year". The end date is configurable because the
 * UK ends on 5 April and the US on 31 December, and getting this boundary wrong
 * moves transactions between tax years, which is the expensive kind of bug.
 */
export function financialYear(
  endingYear: number,
  options: FinancialYearOptions = {},
): DateRange {
  const endMonth = options.endMonth ?? 3;
  const endDay = options.endDay ?? 31;

  const to = clampToMonth(endingYear, endMonth, endDay);
  const from = addDay(to, endingYear - 1);

  return { from, to };
}

/**
 * Which financial year a date falls in, labelled by the year it ends in.
 *
 * The inverse of `financialYear`: 15 April 2025 is in the 2026 year, and
 * 15 March 2026 is too. Configurable for the same reason, and wrong in the
 * same expensive way -- a date placed in the wrong year moves income between
 * tax returns.
 *
 * Lived in the web app, where nothing could test it, and was used nine times.
 */
export function financialYearOf(date: IsoDate, options: FinancialYearOptions = {}): number {
  const endMonth = options.endMonth ?? 3;
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  return month > endMonth ? year + 1 : year;
}

/** The day after the previous year's end, which is where the year starts. */
function addDay(end: IsoDate, previousYear: number): IsoDate {
  const month = Number(end.slice(5, 7));
  const day = Number(end.slice(8, 10));

  const previousEnd = clampToMonth(previousYear, month, day);
  const next = new Date(Date.parse(`${previousEnd}T00:00:00Z`) + 86_400_000);

  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
}

/** Guard against 31 February and against 29 February in a non-leap year. */
function clampToMonth(year: number, month: number, day: number): IsoDate {
  return `${year}-${pad(month)}-${pad(Math.min(day, daysInMonth(year, month)))}`;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** True when `date` falls inside `range`, inclusive of both ends. */
export function inRange(date: IsoDate, range: Partial<DateRange>): boolean {
  if (range.from !== undefined && date < range.from) return false;
  if (range.to !== undefined && date > range.to) return false;
  return true;
}
