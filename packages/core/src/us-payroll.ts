/**
 * Payroll for United States books: each paycheck's federal withholding, Social
 * Security, Medicare and FUTA, and the state's taxes where the state is one
 * worked out here.
 *
 * Federal income tax withholding follows IRS Publication 15-T (2026), the
 * percentage method for automated payroll systems (Worksheet 1A), from the
 * employee's Form W-4: the 2020-and-later form (filing status, the Step 2
 * checkbox, Step 3 credits, Step 4 other income, deductions and extra
 * withholding) or an older one's allowances ($4,300 each). Social Security is
 * 6.2% each side up to the year's wage base; Medicare 1.45% each side, and the
 * employee's 0.9% Additional Medicare Tax on wages over $200,000 in the year;
 * FUTA 0.6% on each employee's first $7,000.
 *
 * States, from each state's own publication:
 * - California: EDD's 2026 Method B (exact calculation), annualized as EDD
 *   allows (its Examples E and F), from the DE 4; SDI withheld on all wages;
 *   UI and ETT paid by the employer on each employee's first $7,000.
 * - Texas: no income tax; unemployment tax paid by the employer on each
 *   employee's first $9,000, at the employer's own rate from TWC.
 * Any other state: its withholding is entered on each pay run, and its
 * unemployment tax worked at the rate and wage base the employer gives.
 *
 * The tables are 2026's. A pay date in another year is worked with them and
 * says so. Every figure on a pay run can be changed: the employer files and
 * pays, and a payroll service or the state's own calculator may differ by
 * rounding.
 */
import type { Cents } from "./money.js";
import type { IsoDate } from "./dates.js";
import type { PayAccount, PayAmount, RegisterPayday } from "./payroll-register.js";
import { payOutBy } from "./payroll-register.js";

export type UsPayFrequency = "weekly" | "biweekly" | "semimonthly" | "monthly";

export const US_PERIODS: Readonly<Record<UsPayFrequency, number>> = { weekly: 52, biweekly: 26, semimonthly: 24, monthly: 12 };

export type UsFilingStatus = "single" | "married" | "head";

/** The employee's Form W-4. */
export interface UsW4 {
  /** Step 1(c): single or married filing separately, married filing jointly, head of household. */
  status: UsFilingStatus;
  /** Step 2(c): two jobs, or a spouse who works. */
  step2?: boolean;
  /** Step 3: credits for dependents and others, a year. */
  dependents?: Cents;
  /** Step 4(a): other income, a year. */
  otherIncome?: Cents;
  /** Step 4(b): deductions, a year. */
  deductions?: Cents;
  /** Step 4(c): extra withholding each paycheck. */
  extra?: Cents;
  /** A W-4 from before 2020: its allowances. The 2020 steps are then not used. */
  allowances?: number;
  /** Claimed exemption from withholding: no federal income tax withheld. */
  exempt?: boolean;
}

/** California's DE 4 (or the federal W-4's allowances used for California). */
export interface CaDe4 {
  status: UsFilingStatus;
  /** Regular withholding allowances. */
  allowances: number;
  /** Additional allowances for estimated deductions. */
  estimated?: number;
  /** Extra California withholding each paycheck. */
  extra?: Cents;
  exempt?: boolean;
}

/** New York's IT-2104. Head of household withholds as single. */
export interface NyIt2104 {
  status: "single" | "married";
  /** New York State allowances. */
  allowances: number;
  /** Extra New York State withholding each paycheck. */
  extra?: Cents;
  /** Lives in New York City: city tax is withheld too. */
  nyc?: boolean;
  /** New York City allowances, where they differ from the state's. */
  nycAllowances?: number;
  /** Extra New York City withholding each paycheck. */
  nycExtra?: Cents;
  exempt?: boolean;
}

export interface UsEmployee {
  id: string;
  name: string;
  payFrequency: UsPayFrequency;
  /** Usual gross pay a paycheck, to start each pay run with. */
  usualGross?: Cents;
  w4: UsW4;
  /** The state the employee works in, two letters. The employer's when not given. */
  state?: string;
  /** California's DE 4, where the employee works in California. */
  de4?: CaDe4;
  /** New York's IT-2104, where the employee works in New York. */
  it2104?: NyIt2104;
  /** Bank routing and account numbers, for the direct deposit file. */
  routing?: string;
  account?: string;
  accountType?: "checking" | "savings";
  /** Last day worked; left off new pay runs after it. */
  ended?: IsoDate;
}

/** The employer's settings: its state and its unemployment rate there. */
export interface UsEmployer {
  /** Two letters. */
  state: string;
  /** The state unemployment (SUI/SUTA) rate the state gave this employer, in percent. */
  suiRate?: number;
  /** The state's unemployment wage base, where it is not one known here. */
  suiWageBase?: Cents;
  /** California's Employment Training Tax, in percent (0.1 unless EDD says otherwise). */
  ettRate?: number;
  /** FUTA in percent: 0.6, more in a credit reduction state. */
  futaRate?: number;
}

/** One employee's paycheck on a pay run. */
export interface UsPayLine {
  employeeId: string;
  gross: Cents;
  federal: Cents;
  socialSecurity: Cents;
  medicare: Cents;
  stateIncome: Cents;
  /** California SDI, and other employee state taxes. */
  stateOther: Cents;
  /** Local income tax withheld: New York City, or one given by hand. Absent on runs saved before it was kept. */
  localIncome?: Cents;
  net: Cents;
  employerSocialSecurity: Cents;
  employerMedicare: Cents;
  futa: Cents;
  stateUnemployment: Cents;
  /** California ETT, and other employer state taxes. */
  stateOtherEmployer: Cents;
  /** The state the paycheck was worked for. */
  state: string;
  /** Federal or state withholding changed by hand, rather than worked out. */
  entered?: ("federal" | "stateIncome" | "localIncome")[];
}

export interface UsPayRun {
  id: string;
  payDate: IsoDate;
  periodStart: IsoDate;
  periodEnd: IsoDate;
  lines: UsPayLine[];
}

export interface UsPayroll {
  employer: UsEmployer;
  employees: UsEmployee[];
  payRuns: UsPayRun[];
  /** Where each part of a pay run posts, as a journal line writes the account (`Wages - 6180`). */
  accounts?: Partial<Record<PayAccount, string>>;
}

/** The year the tables here are for. */
export const US_PAYROLL_TABLE_YEAR = 2026;

// --- federal: Publication 15-T (2026), Worksheet 1A ------------------------------

/** [at least, tentative amount, rate]: annual dollars. */
type Bracket = readonly [number, number, number];

/** 2026 annual percentage method tables, STANDARD withholding rate schedules. */
const FEDERAL_STANDARD: Record<UsFilingStatus, readonly Bracket[]> = {
  married: [
    [0, 0, 0],
    [19_300, 0, 0.1],
    [44_100, 2_480, 0.12],
    [120_100, 11_600, 0.22],
    [230_700, 35_932, 0.24],
    [422_850, 82_048, 0.32],
    [531_750, 116_896, 0.35],
    [788_000, 206_583.5, 0.37],
  ],
  single: [
    [0, 0, 0],
    [7_500, 0, 0.1],
    [19_900, 1_240, 0.12],
    [57_900, 5_800, 0.22],
    [113_200, 17_966, 0.24],
    [209_275, 41_024, 0.32],
    [263_725, 58_448, 0.35],
    [648_100, 192_979.25, 0.37],
  ],
  head: [
    [0, 0, 0],
    [15_550, 0, 0.1],
    [33_250, 1_770, 0.12],
    [83_000, 7_740, 0.22],
    [121_250, 16_155, 0.24],
    [217_300, 39_207, 0.32],
    [271_750, 56_631, 0.35],
    [656_150, 191_171, 0.37],
  ],
};

/** 2026 annual tables, Form W-4 Step 2 checkbox withholding rate schedules. */
const FEDERAL_STEP2: Record<UsFilingStatus, readonly Bracket[]> = {
  married: [
    [0, 0, 0],
    [16_100, 0, 0.1],
    [28_500, 1_240, 0.12],
    [66_500, 5_800, 0.22],
    [121_800, 17_966, 0.24],
    [217_875, 41_024, 0.32],
    [272_325, 58_448, 0.35],
    [400_450, 103_291.75, 0.37],
  ],
  single: [
    [0, 0, 0],
    [8_050, 0, 0.1],
    [14_250, 620, 0.12],
    [33_250, 2_900, 0.22],
    [60_900, 8_983, 0.24],
    [108_938, 20_512, 0.32],
    [136_163, 29_224, 0.35],
    [328_350, 96_489.63, 0.37],
  ],
  head: [
    [0, 0, 0],
    [12_075, 0, 0.1],
    [20_925, 885, 0.12],
    [45_800, 3_870, 0.22],
    [64_925, 8_077.5, 0.24],
    [112_950, 19_603.5, 0.32],
    [140_175, 28_315.5, 0.35],
    [332_375, 95_585.5, 0.37],
  ],
};

/** Tax on an annual amount in dollars, from a table of brackets. */
function onTable(table: readonly Bracket[], amount: number): number {
  let row: Bracket = table[0] ?? [0, 0, 0];
  for (const b of table) if (amount >= b[0]) row = b;
  return row[1] + (amount - row[0]) * row[2];
}

/**
 * Federal income tax to withhold from one paycheck: Publication 15-T (2026),
 * Worksheet 1A. `gross` is the paycheck's taxable wages.
 */
export function federalWithholding(gross: Cents, frequency: UsPayFrequency, w4: UsW4): Cents {
  if (w4.exempt === true) return 0;
  const periods = US_PERIODS[frequency];
  const annual = (gross * periods) / 100;
  let adjusted: number;
  let table: readonly Bracket[];
  if (w4.allowances !== undefined) {
    // An older W-4: $4,300 an allowance, the standard schedules, married or single.
    adjusted = Math.max(0, annual - w4.allowances * 4_300);
    table = FEDERAL_STANDARD[w4.status === "married" ? "married" : "single"];
  } else {
    const step2 = w4.step2 === true;
    const allowance = step2 ? 0 : w4.status === "married" ? 12_900 : 8_600;
    adjusted = Math.max(0, annual + (w4.otherIncome ?? 0) / 100 - ((w4.deductions ?? 0) / 100 + allowance));
    table = (step2 ? FEDERAL_STEP2 : FEDERAL_STANDARD)[w4.status];
  }
  const tentative = Math.round((onTable(table, adjusted) / periods) * 100);
  const credits = w4.allowances !== undefined ? 0 : Math.round((w4.dependents ?? 0) / periods);
  return Math.max(0, tentative - credits) + (w4.extra ?? 0);
}

/** The Social Security wage base for a calendar year. */
export function socialSecurityWageBase(year: number): Cents {
  const bases: Record<number, Cents> = { 2024: 16_860_000, 2025: 17_610_000, 2026: 18_450_000 };
  return bases[year] ?? bases[2026] ?? 18_450_000;
}

const pct = (amount: Cents, percent: number): Cents => Math.round((amount * percent) / 100);

/** Wages in this paycheck under a yearly limit, given what was paid before it this year. */
function underLimit(gross: Cents, before: Cents, limit: Cents): Cents {
  return Math.max(0, Math.min(gross, limit - before));
}

// --- states ---------------------------------------------------------------------

/** What is worked out here for a state; others take entered withholding. */
export interface UsStateRules {
  name: string;
  /** "none": no income tax on wages. "ca": California's Method B. Undefined: entered on each pay run. */
  income?: "none" | "ca" | "ny";
  /** The unemployment wage base, per employee per year. */
  suiWageBase?: Cents;
  /** Employee state disability insurance, percent, by year; no wage limit. */
  sdi?: Readonly<Record<number, number>>;
  /** The new employer's unemployment rate, percent, as a starting point. */
  newEmployerRate?: number;
  /** California's ETT, on the same wage base as UI. */
  ett?: boolean;
}

export const US_STATE_PAYROLL: Readonly<Record<string, UsStateRules>> = {
  // EDD 2026: UI and ETT on the first $7,000, 3.4% for a new employer; SDI 1.3% on all wages (1.2% in 2025).
  CA: { name: "California", income: "ca", suiWageBase: 700_000, sdi: { 2025: 1.2, 2026: 1.3 }, newEmployerRate: 3.4, ett: true },
  // TWC: the first $9,000 (set by statute); 2.7% for a new employer.
  TX: { name: "Texas", income: "none", suiWageBase: 900_000, newEmployerRate: 2.7 },
  // Florida DOR reemployment tax: the first $7,000; 2.7% for a new employer.
  FL: { name: "Florida", income: "none", suiWageBase: 700_000, newEmployerRate: 2.7 },
  // NYS-50 (12/25): the 2026 UI wage base is $17,600; a new employer's rate is 4.1% with the
  // Re-employment Service Fund. Disability (DBL) and Paid Family Leave are withheld: nyEmployeeInsurance.
  NY: { name: "New York", income: "ny", suiWageBase: 1_760_000, newEmployerRate: 4.1 },
};

// California, EDD 2026 Method B, annual payroll period (Tables 1-7).
const CA_LOW_INCOME = { low: 1_889_600, high: 3_779_100 };
const CA_STANDARD = { low: 570_600, high: 1_141_200 };
const CA_ESTIMATED_DEDUCTION = 100_000;
const CA_ALLOWANCE_CREDIT = 16_830;
const CA_TABLES: Record<UsFilingStatus, readonly Bracket[]> = {
  single: [
    [0, 0, 0.011],
    [11_079, 121.87, 0.022],
    [26_264, 455.94, 0.044],
    [41_452, 1_124.21, 0.066],
    [57_542, 2_186.15, 0.088],
    [72_724, 3_522.17, 0.1023],
    [371_479, 34_084.81, 0.1133],
    [445_771, 42_502.09, 0.1243],
    [742_953, 79_441.81, 0.1353],
    [1_000_000, 114_220.27, 0.1463],
  ],
  married: [
    [0, 0, 0.011],
    [22_158, 243.74, 0.022],
    [52_528, 911.88, 0.044],
    [82_904, 2_248.42, 0.066],
    [115_084, 4_372.3, 0.088],
    [145_448, 7_044.33, 0.1023],
    [742_958, 68_169.6, 0.1133],
    [891_542, 85_004.17, 0.1243],
    [1_000_000, 98_485.5, 0.1353],
    [1_485_906, 164_228.58, 0.1463],
  ],
  head: [
    [0, 0, 0.011],
    [22_173, 243.9, 0.022],
    [52_530, 911.75, 0.044],
    [67_716, 1_579.93, 0.066],
    [83_805, 2_641.8, 0.088],
    [98_990, 3_978.08, 0.1023],
    [505_208, 45_534.18, 0.1133],
    [606_251, 56_982.35, 0.1243],
    [1_000_000, 105_925.35, 0.1353],
    [1_010_417, 107_334.77, 0.1463],
  ],
};

/**
 * California income tax to withhold from one paycheck: EDD's 2026 Method B,
 * worked on the year's wages and divided back to the paycheck.
 */
export function californiaWithholding(gross: Cents, frequency: UsPayFrequency, de4: CaDe4): Cents {
  if (de4.exempt === true) return 0;
  const periods = US_PERIODS[frequency];
  const annual = gross * periods;
  // Married with two or more allowances, or head of household, takes the higher amounts.
  const high = de4.status === "head" || (de4.status === "married" && de4.allowances >= 2);
  if (annual <= (high ? CA_LOW_INCOME.high : CA_LOW_INCOME.low)) return de4.extra ?? 0;
  const wages = annual - (de4.estimated ?? 0) * CA_ESTIMATED_DEDUCTION;
  const taxable = Math.max(0, wages - (high ? CA_STANDARD.high : CA_STANDARD.low)) / 100;
  const tax = Math.round(onTable(CA_TABLES[de4.status], taxable) * 100);
  const yearly = Math.max(0, tax - de4.allowances * CA_ALLOWANCE_CREDIT);
  return Math.round(yearly / periods) + (de4.extra ?? 0);
}

// New York, NYS-50-T-NYS and NYS-50-T-NYC (1/26), Method II, exact calculation:
// the deduction and exemption allowances (tables B and C) come off the
// paycheck's wages, then the payroll period's table. [at least, rate, plus].
type PeriodRow = readonly [number, number, number];

const NY_DEDUCTION: Record<"single" | "married", Record<UsPayFrequency, number>> = {
  single: { weekly: 142.3, biweekly: 284.6, semimonthly: 308.35, monthly: 616.7 },
  married: { weekly: 152.9, biweekly: 305.8, semimonthly: 331.25, monthly: 662.5 },
};
const NYC_DEDUCTION: Record<"single" | "married", Record<UsPayFrequency, number>> = {
  single: { weekly: 96.15, biweekly: 192.3, semimonthly: 208.35, monthly: 416.7 },
  married: { weekly: 105.75, biweekly: 211.5, semimonthly: 229.15, monthly: 458.3 },
};
const NY_EXEMPTION: Record<UsPayFrequency, number> = { weekly: 19.25, biweekly: 38.5, semimonthly: 41.65, monthly: 83.3 };

const NY_TABLES: Record<"single" | "married", Record<UsPayFrequency, readonly PeriodRow[]>> = {
  single: {
    weekly: [[0, 0.039, 0], [163, 0.044, 6.38], [225, 0.0515, 9.08], [267, 0.054, 11.27], [1_551, 0.059, 80.58], [1_862, 0.0703, 98.9], [2_070, 0.0753, 113.58], [3_032, 0.064, 186.02], [4_142, 0.1144, 257.1], [5_104, 0.0735, 367.13]],
    biweekly: [[0, 0.039, 0], [327, 0.044, 12.77], [450, 0.0515, 18.15], [535, 0.054, 22.54], [3_102, 0.059, 161.15], [3_723, 0.0703, 197.81], [4_140, 0.0753, 227.15], [6_063, 0.064, 372.04], [8_285, 0.1144, 514.19], [10_208, 0.0735, 734.27]],
    semimonthly: [[0, 0.039, 0], [354, 0.044, 13.83], [488, 0.0515, 19.67], [579, 0.054, 24.42], [3_360, 0.059, 174.58], [4_033, 0.0703, 214.29], [4_485, 0.0753, 246.08], [6_569, 0.064, 403.04], [8_975, 0.1144, 557.04], [11_058, 0.0735, 795.46]],
    monthly: [[0, 0.039, 0], [708, 0.044, 27.67], [975, 0.0515, 39.33], [1_158, 0.054, 48.83], [6_721, 0.059, 349.17], [8_067, 0.0703, 428.58], [8_971, 0.0753, 492.17], [13_138, 0.064, 806.08], [17_950, 0.1144, 1_114.08], [22_117, 0.0735, 1_590.92]],
  },
  married: {
    weekly: [[0, 0.039, 0], [163, 0.044, 6.38], [225, 0.0515, 9.08], [267, 0.054, 11.27], [1_551, 0.059, 80.58], [1_862, 0.0657, 98.9], [2_070, 0.0707, 112.6], [3_032, 0.0801, 180.54], [4_068, 0.064, 263.62], [6_215, 0.1349, 401.04], [7_177, 0.0735, 530.77], [20_722, 0.0765, 1_526.33]],
    biweekly: [[0, 0.039, 0], [327, 0.044, 12.77], [450, 0.0515, 18.15], [535, 0.054, 22.54], [3_102, 0.059, 161.15], [3_723, 0.0657, 197.81], [4_140, 0.0707, 225.19], [6_063, 0.0801, 361.08], [8_137, 0.064, 527.23], [12_431, 0.1349, 802.08], [14_354, 0.0735, 1_061.54], [41_444, 0.0765, 3_052.65]],
    semimonthly: [[0, 0.039, 0], [354, 0.044, 13.83], [488, 0.0515, 19.67], [579, 0.054, 24.42], [3_360, 0.059, 174.58], [4_033, 0.0657, 214.29], [4_485, 0.0707, 243.96], [6_569, 0.0801, 391.17], [8_815, 0.064, 571.17], [13_467, 0.1349, 868.92], [15_550, 0.0735, 1_150], [44_898, 0.0765, 3_307.04]],
    monthly: [[0, 0.039, 0], [708, 0.044, 27.67], [975, 0.0515, 39.33], [1_158, 0.054, 48.83], [6_721, 0.059, 349.17], [8_067, 0.0657, 428.58], [8_971, 0.0707, 487.92], [13_138, 0.0801, 782.33], [17_629, 0.064, 1_142.33], [26_933, 0.1349, 1_737.83], [31_100, 0.0735, 2_300], [89_796, 0.0765, 6_614.08]],
  },
};

const NYC_TABLES: Record<UsPayFrequency, readonly PeriodRow[]> = {
  weekly: [[0, 0.0205, 0], [154, 0.028, 3.15], [167, 0.0325, 3.54], [288, 0.0395, 7.46], [481, 0.0415, 15.06], [1_154, 0.0425, 43]],
  biweekly: [[0, 0.0205, 0], [308, 0.028, 6.31], [334, 0.0325, 7.08], [577, 0.0395, 14.92], [962, 0.0415, 30.12], [2_308, 0.0425, 86]],
  semimonthly: [[0, 0.0205, 0], [333, 0.028, 6.83], [362, 0.0325, 7.67], [625, 0.0395, 16.17], [1_042, 0.0415, 32.63], [2_500, 0.0425, 93.17]],
  monthly: [[0, 0.0205, 0], [667, 0.028, 13.67], [725, 0.0325, 15.33], [1_250, 0.0395, 32.33], [2_083, 0.0415, 65.25], [5_000, 0.0425, 186.33]],
};

/** Tax on a paycheck's net wages from one of New York's period tables, in cents, rounded as its examples are. */
function onPeriodTable(table: readonly PeriodRow[], net: number): Cents {
  if (net <= 0) return 0;
  let row: PeriodRow = table[0] ?? [0, 0, 0];
  for (const r of table) if (net >= r[0]) row = r;
  return Math.round((net - row[0]) * row[1] * 100) + Math.round(row[2] * 100);
}

/**
 * New York State income tax to withhold from one paycheck: NYS-50-T-NYS
 * (1/26), Method II. Above the tables' top line (a year's net wages of
 * $1,077,550 and more) Method III applies, which is not worked here: the
 * top line is used and the figure should be checked.
 */
export function newYorkWithholding(gross: Cents, frequency: UsPayFrequency, it2104: NyIt2104): Cents {
  if (it2104.exempt === true) return 0;
  const net = gross / 100 - NY_DEDUCTION[it2104.status][frequency] - it2104.allowances * NY_EXEMPTION[frequency];
  return onPeriodTable(NY_TABLES[it2104.status][frequency], Math.round(net * 100) / 100) + (it2104.extra ?? 0);
}

/** New York City income tax to withhold from a city resident's paycheck: NYS-50-T-NYC (1/26), Method II. */
export function newYorkCityWithholding(gross: Cents, frequency: UsPayFrequency, it2104: NyIt2104): Cents {
  if (it2104.nyc !== true || it2104.exempt === true) return 0;
  const allowances = it2104.nycAllowances ?? it2104.allowances;
  const net = gross / 100 - NYC_DEDUCTION[it2104.status][frequency] - allowances * NY_EXEMPTION[frequency];
  return onPeriodTable(NYC_TABLES[frequency], Math.round(net * 100) / 100) + (it2104.nycExtra ?? 0);
}

/** New York's 2026 Paid Family Leave: 0.432% of wages, at most $411.91 in the year (WCB). */
const NY_PFL = { rate: 0.432, most: 41_191 };

/**
 * What New York's employee insurance takes from a paycheck: disability (DBL),
 * 0.5% of wages up to $0.60 a week, and Paid Family Leave up to the year's most.
 */
export function nyEmployeeInsurance(gross: Cents, frequency: UsPayFrequency, before: Cents): Cents {
  const weeks = 52 / US_PERIODS[frequency];
  const dbl = Math.min(pct(gross, 0.5), Math.round(60 * weeks));
  const pflBefore = Math.min(NY_PFL.most, pct(before, NY_PFL.rate));
  const pfl = Math.max(0, Math.min(pct(gross, NY_PFL.rate), NY_PFL.most - pflBefore));
  return dbl + pfl;
}

/** The state an employee's pay is worked for. */
export function employeeState(employee: UsEmployee, employer: UsEmployer): string {
  return (employee.state ?? employer.state).toUpperCase();
}

/** The unemployment wage base used for a state: the employer's figure where given. */
export function suiWageBase(state: string, employer: UsEmployer): Cents | undefined {
  return employer.suiWageBase ?? US_STATE_PAYROLL[state]?.suiWageBase;
}

/** Whether a state's income tax withholding is worked out here. */
export function stateWithholdingWorked(state: string): boolean {
  return US_STATE_PAYROLL[state]?.income !== undefined;
}

/** Gross paid to an employee this calendar year before a pay date, from the runs. */
export function grossBefore(runs: readonly UsPayRun[], employeeId: string, payDate: IsoDate, exceptRun?: string): Cents {
  const year = payDate.slice(0, 4);
  let sum = 0;
  for (const run of runs) {
    if (run.id === exceptRun || !run.payDate.startsWith(year) || run.payDate >= payDate) continue;
    for (const line of run.lines) if (line.employeeId === employeeId) sum += line.gross;
  }
  return sum;
}

/** What may be given by hand on a paycheck instead of worked out. */
export interface UsPayEntered {
  federal?: Cents;
  stateIncome?: Cents;
  localIncome?: Cents;
}

/**
 * One employee's paycheck: every tax on `gross`, given what the employee was
 * paid earlier in the year (`before`), for the wage bases.
 */
export function usPayLine(
  employee: UsEmployee,
  gross: Cents,
  payDate: IsoDate,
  before: Cents,
  employer: UsEmployer,
  entered: UsPayEntered = {},
): UsPayLine {
  const year = Number(payDate.slice(0, 4));
  const state = employeeState(employee, employer);
  const rules = US_STATE_PAYROLL[state];
  const ssWages = underLimit(gross, before, socialSecurityWageBase(year));
  const socialSecurity = pct(ssWages, 6.2);
  const medicare = pct(gross, 1.45);
  // Additional Medicare Tax: 0.9% of the wages in this paycheck above $200,000 for the year.
  const overThreshold = Math.max(0, before + gross - Math.max(before, 20_000_000));
  const extraMedicare = pct(Math.min(gross, overThreshold), 0.9);
  const worked = federalWithholding(gross, employee.payFrequency, employee.w4);
  const federal = entered.federal ?? worked;
  let stateWorked = 0;
  let localWorked = 0;
  if (rules?.income === "ny") {
    const form: NyIt2104 = employee.it2104 ?? { status: employee.w4.status === "married" ? "married" : "single", allowances: 0 };
    stateWorked = newYorkWithholding(gross, employee.payFrequency, form);
    localWorked = newYorkCityWithholding(gross, employee.payFrequency, form);
  }
  if (rules?.income === "ca") {
    stateWorked = californiaWithholding(gross, employee.payFrequency, employee.de4 ?? { status: employee.w4.status, allowances: 1 });
  }
  const stateIncome = entered.stateIncome ?? stateWorked;
  const sdiRate = rules?.sdi?.[year] ?? (rules?.sdi !== undefined ? rules.sdi[US_PAYROLL_TABLE_YEAR] ?? 0 : 0);
  const stateOther = pct(gross, sdiRate) + (rules?.income === "ny" ? nyEmployeeInsurance(gross, employee.payFrequency, before) : 0);
  const localIncome = entered.localIncome ?? localWorked;
  const base = suiWageBase(state, employer);
  const suiWages = base === undefined ? 0 : underLimit(gross, before, base);
  const stateUnemployment = pct(suiWages, employer.state.toUpperCase() === state ? (employer.suiRate ?? rules?.newEmployerRate ?? 0) : (rules?.newEmployerRate ?? 0));
  const stateOtherEmployer = rules?.ett === true ? pct(suiWages, employer.ettRate ?? 0.1) : 0;
  const futa = pct(underLimit(gross, before, 700_000), employer.futaRate ?? 0.6);
  const employeeMedicare = medicare + extraMedicare;
  const net = gross - federal - socialSecurity - employeeMedicare - stateIncome - stateOther - localIncome;
  const enteredList = (["federal", "stateIncome", "localIncome"] as const).filter((k) => entered[k] !== undefined);
  return {
    employeeId: employee.id,
    gross,
    federal,
    socialSecurity,
    medicare: employeeMedicare,
    stateIncome,
    stateOther,
    ...(localIncome !== 0 ? { localIncome } : {}),
    net,
    employerSocialSecurity: socialSecurity,
    employerMedicare: medicare,
    futa,
    stateUnemployment,
    stateOtherEmployer,
    state,
    ...(enteredList.length > 0 ? { entered: [...enteredList] } : {}),
  };
}

/** Whether a pay date's year has its own tables here; another year is worked with 2026's. */
export function usTablesCurrent(payDate: IsoDate): boolean {
  return Number(payDate.slice(0, 4)) === US_PAYROLL_TABLE_YEAR;
}

/** The next pay period after the last run's, for a pay frequency. */
export function usNextPeriod(last: { periodStart: IsoDate; periodEnd: IsoDate; payDate: IsoDate }, frequency: UsPayFrequency): {
  periodStart: IsoDate;
  periodEnd: IsoDate;
  payDate: IsoDate;
} {
  const add = (iso: IsoDate, days: number): IsoDate => {
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  };
  const monthEnd = (y: number, m: number): IsoDate => new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const lag = Math.round((Date.parse(last.payDate) - Date.parse(last.periodEnd)) / 86_400_000);
  const start = add(last.periodEnd, 1);
  let end: IsoDate;
  if (frequency === "weekly") end = add(start, 6);
  else if (frequency === "biweekly") end = add(start, 13);
  else {
    const y = Number(start.slice(0, 4));
    const m = Number(start.slice(5, 7));
    const day = Number(start.slice(8, 10));
    if (frequency === "monthly") end = monthEnd(y, m);
    else end = day <= 15 ? `${start.slice(0, 8)}15` : monthEnd(y, m);
  }
  return { periodStart: start, periodEnd: end, payDate: add(end, lag) };
}

/** A pay run as the payday a register would give, to post and to read back for the W-2s. */
export function usPayRunAsPayday(run: UsPayRun, nameOf: (employeeId: string) => string): RegisterPayday {
  const zero = (): Record<PayAmount, Cents> =>
    ({
      gross: 0, reimbursement: 0, federal: 0, socialEmployee: 0, medicareEmployee: 0, stateIncome: 0, otherEmployee: 0,
      deduction: 0, net: 0, socialEmployer: 0, medicareEmployer: 0, futa: 0, stateUnemployment: 0, otherEmployer: 0, contribution: 0,
    }) as Record<PayAmount, Cents>;
  const totals = zero();
  const pays = run.lines.map((l) => {
    const amounts = zero();
    amounts.gross = l.gross;
    amounts.federal = l.federal;
    amounts.socialEmployee = l.socialSecurity;
    amounts.medicareEmployee = l.medicare;
    amounts.stateIncome = l.stateIncome;
    amounts.otherEmployee = l.stateOther + (l.localIncome ?? 0);
    amounts.net = l.net;
    amounts.socialEmployer = l.employerSocialSecurity;
    amounts.medicareEmployer = l.employerMedicare;
    amounts.futa = l.futa;
    amounts.stateUnemployment = l.stateUnemployment;
    amounts.otherEmployer = l.stateOtherEmployer;
    for (const [k, v] of Object.entries(amounts) as [PayAmount, Cents][]) totals[k] += v;
    return { employee: nameOf(l.employeeId), amounts };
  });
  return { date: run.payDate, pays, totals, outBy: payOutBy(totals), problems: [] };
}

/** The year's figures for one employee, from the pay runs: for the W-2 and the 941. */
export function usYearToDate(runs: readonly UsPayRun[], employeeId: string, year: number, upTo?: IsoDate): {
  gross: Cents;
  federal: Cents;
  socialSecurity: Cents;
  medicare: Cents;
  stateIncome: Cents;
  stateOther: Cents;
  localIncome: Cents;
  net: Cents;
} {
  const out = { gross: 0, federal: 0, socialSecurity: 0, medicare: 0, stateIncome: 0, stateOther: 0, localIncome: 0, net: 0 };
  for (const run of runs) {
    if (!run.payDate.startsWith(`${year}-`) || (upTo !== undefined && run.payDate > upTo)) continue;
    for (const l of run.lines) {
      if (l.employeeId !== employeeId) continue;
      out.gross += l.gross;
      out.federal += l.federal;
      out.socialSecurity += l.socialSecurity;
      out.medicare += l.medicare;
      out.stateIncome += l.stateIncome;
      out.stateOther += l.stateOther;
      out.localIncome += l.localIncome ?? 0;
      out.net += l.net;
    }
  }
  return out;
}
