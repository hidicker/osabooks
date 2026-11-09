import { test } from "node:test";
import assert from "node:assert/strict";
import {
  californiaWithholding,
  federalWithholding,
  grossBefore,
  payrollRegisterJournal,
  usNextPeriod,
  usPayLine,
  usPayRunAsPayday,
  w2Figures,
} from "../dist/index.js";

// Publication 15-T (2026), Worksheet 1A, worked by hand from the annual tables.
test("federal withholding, 2020 and later W-4", () => {
  // Single, biweekly $2,000: 52,000 - 8,600 = 43,400; 1,240 + 12% of 23,500 = 4,060; / 26.
  assert.equal(federalWithholding(200_000, "biweekly", { status: "single" }), 15_615);
  // Married, semimonthly $3,000, $4,000 of Step 3 credits: 72,000 - 12,900 = 59,100;
  // 2,480 + 12% of 15,000 = 4,280 / 24 = 178.33, less 4,000 / 24 = 166.67.
  assert.equal(federalWithholding(300_000, "semimonthly", { status: "married", dependents: 400_000 }), 1_166);
  // Single with the Step 2 box, monthly $5,000: 60,000 on the checkbox table:
  // 2,900 + 22% of 26,750 = 8,785 / 12.
  assert.equal(federalWithholding(500_000, "monthly", { status: "single", step2: true }), 73_208);
  // Head of household, weekly $1,000, $25 extra: 52,000 - 8,600 = 43,400; 1,770 + 12% of 10,150 = 2,988 / 52 = 57.46.
  assert.equal(federalWithholding(100_000, "weekly", { status: "head", extra: 2_500 }), 5_746 + 2_500);
  // Step 4(a) and 4(b): single monthly $4,000, $6,000 other income, $10,000 deductions:
  // 48,000 + 6,000 - (10,000 + 8,600) = 35,400; 1,240 + 12% of 15,500 = 3,100 / 12.
  assert.equal(federalWithholding(400_000, "monthly", { status: "single", otherIncome: 600_000, deductions: 1_000_000 }), 25_833);
  // Under the allowance: nothing.
  assert.equal(federalWithholding(30_000, "monthly", { status: "single" }), 0);
  assert.equal(federalWithholding(500_000, "monthly", { status: "single", exempt: true }), 0);
});

test("federal withholding, a W-4 from before 2020", () => {
  // Married, 2 allowances, biweekly $2,500: 65,000 - 8,600 = 56,400 on the married standard
  // table: 2,480 + 12% of 12,300 = 3,956 / 26 = 152.15.
  assert.equal(federalWithholding(250_000, "biweekly", { status: "married", allowances: 2 }), 15_215);
});

// EDD, California Withholding Schedules for 2026, Method B, its own examples.
test("California withholding matches EDD's worked examples", () => {
  // Example A: weekly $210, single, one allowance: under the low income exemption.
  assert.equal(californiaWithholding(21_000, "weekly", { status: "single", allowances: 1 }), 0);
  // Example B: biweekly $1,600, married, three allowances, one for estimated deductions: $2.38.
  assert.equal(californiaWithholding(160_000, "biweekly", { status: "married", allowances: 2, estimated: 1 }), 238);
  // Example E: semi-monthly $2,400, married, four allowances: $4.13.
  assert.equal(californiaWithholding(240_000, "semimonthly", { status: "married", allowances: 4 }), 413);
  // Example F: monthly $4,750, married, four allowances: $7.17.
  assert.equal(californiaWithholding(475_000, "monthly", { status: "married", allowances: 4 }), 717);
  // Example D: weekly $950, head of household, three allowances: EDD's per-week figure is
  // $1.69; worked on the year and divided back, as EDD allows, it is within a cent or two.
  const d = californiaWithholding(95_000, "weekly", { status: "head", allowances: 3 });
  assert.ok(Math.abs(d - 169) <= 3, `got ${d}`);
});

const employer = { state: "CA", suiRate: 3.4 };
const dana = {
  id: "e1",
  name: "Dana Brooks",
  payFrequency: "semimonthly",
  w4: { status: "single" },
  de4: { status: "single", allowances: 1 },
};

test("a California paycheck: SDI on all wages, UI and ETT on the first $7,000", () => {
  const line = usPayLine(dana, 350_000, "2026-01-15", 0, employer);
  assert.equal(line.socialSecurity, 21_700);
  assert.equal(line.medicare, 5_075);
  assert.equal(line.stateOther, 4_550, "SDI 1.3%");
  assert.equal(line.futa, 2_100);
  assert.equal(line.stateUnemployment, 11_900, "3.4% of 3,500");
  assert.equal(line.stateOtherEmployer, 350, "ETT 0.1%");
  assert.equal(line.net, 350_000 - line.federal - 21_700 - 5_075 - line.stateIncome - 4_550);
  // The third paycheck crosses $7,000: only $0 of it is under the limit after two of $3,500.
  const third = usPayLine(dana, 350_000, "2026-02-15", 700_000, employer);
  assert.equal(third.futa, 0);
  assert.equal(third.stateUnemployment, 0);
  assert.equal(third.stateOther, 4_550, "SDI has no limit");
});

test("Texas: no income tax, unemployment on the first $9,000", () => {
  const texan = { ...dana, state: "TX", de4: undefined };
  const line = usPayLine(texan, 500_000, "2026-03-31", 600_000, { state: "TX", suiRate: 2.7 });
  assert.equal(line.stateIncome, 0);
  assert.equal(line.stateOther, 0);
  assert.equal(line.stateUnemployment, 8_100, "2.7% of the $3,000 left under $9,000");
  assert.equal(line.futa, 600, "0.6% of the $1,000 left under $7,000");
});

test("Social Security stops at the wage base; Additional Medicare starts at $200,000", () => {
  const big = { ...dana, w4: { status: "single" } };
  const line = usPayLine(big, 1_000_000, "2026-11-30", 18_000_000, { state: "TX" });
  assert.equal(line.socialSecurity, 27_900, "6.2% of the $4,500 left under $184,500");
  assert.equal(line.medicare, 14_500, "1.45%, nothing over $200,000 yet");
  const over = usPayLine(big, 1_000_000, "2026-12-15", 19_500_000, { state: "TX" });
  assert.equal(over.socialSecurity, 0);
  assert.equal(over.medicare, 14_500 + 4_500, "0.9% on the $5,000 over $200,000");
  assert.equal(over.employerMedicare, 14_500, "no employer share of the extra 0.9%");
});

test("another state's withholding is entered", () => {
  const ny = { ...dana, state: "NY", de4: undefined };
  const line = usPayLine(ny, 300_000, "2026-04-15", 0, { state: "NY", suiRate: 4.1, suiWageBase: 1_330_000 }, { stateIncome: 14_000 });
  assert.equal(line.stateIncome, 14_000);
  assert.deepEqual(line.entered, ["stateIncome"]);
  assert.equal(line.stateUnemployment, 12_300);
});

test("pay runs post as balanced journals and give the W-2 figures", () => {
  const run = (id, payDate, before) => ({
    id,
    payDate,
    periodStart: payDate,
    periodEnd: payDate,
    lines: [usPayLine(dana, 350_000, payDate, before, employer)],
  });
  const runs = [run("r1", "2026-01-15", 0), run("r2", "2026-01-31", 350_000)];
  assert.equal(grossBefore(runs, "e1", "2026-01-31"), 350_000);
  const accounts = {
    wages: "Wages - 6180", employerTaxes: "Payroll taxes - 6185", netPay: "Wages payable - 2100", federal: "Federal - 2110",
    socialSecurity: "SS - 2120", medicare: "Medicare - 2130", futa: "FUTA - 2140", stateIncome: "CA PIT - 2150",
    stateUnemployment: "CA UI - 2160", otherTaxes: "CA SDI and ETT - 2170",
  };
  const journals = runs.map((r) => payrollRegisterJournal(usPayRunAsPayday(r, () => "Dana Brooks"), accounts, "OsaBooks"));
  for (const j of journals) {
    assert.ok(j);
    assert.equal(j.lines.reduce((s, l) => s + l.amount, 0), 0);
  }
  const [w2] = w2Figures(journals, 2026);
  assert.equal(w2.gross, 700_000);
  assert.equal(w2.socialSecurity, 43_400);
});

test("the next pay period follows the last", () => {
  assert.deepEqual(usNextPeriod({ periodStart: "2026-01-01", periodEnd: "2026-01-15", payDate: "2026-01-15" }, "semimonthly"), {
    periodStart: "2026-01-16", periodEnd: "2026-01-31", payDate: "2026-01-31",
  });
  assert.deepEqual(usNextPeriod({ periodStart: "2026-01-16", periodEnd: "2026-01-31", payDate: "2026-02-05" }, "semimonthly"), {
    periodStart: "2026-02-01", periodEnd: "2026-02-15", payDate: "2026-02-20",
  });
  assert.deepEqual(usNextPeriod({ periodStart: "2026-01-04", periodEnd: "2026-01-17", payDate: "2026-01-23" }, "biweekly"), {
    periodStart: "2026-01-18", periodEnd: "2026-01-31", payDate: "2026-02-06",
  });
  assert.equal(usNextPeriod({ periodStart: "2026-01-01", periodEnd: "2026-01-31", payDate: "2026-01-31" }, "monthly").periodEnd, "2026-02-28");
});

// NYS-50-T-NYS (1/26), Method II: its own examples, pages 16 and 18.
test("New York State withholding matches its worked examples", async () => {
  const { newYorkWithholding } = await import("../dist/index.js");
  assert.equal(newYorkWithholding(40_000, "weekly", { status: "single", allowances: 3 }), 801);
  // Example 2: 165.00 x 0.0753 is 12.4245, which the booklet writes as 12.43 (its other examples round to the nearest cent).
  const single2 = newYorkWithholding(500_000, "semimonthly", { status: "single", allowances: 1 });
  assert.ok(Math.abs(single2 - 25_851) <= 1, `got ${single2}`);
  assert.equal(newYorkWithholding(5_000_000, "monthly", { status: "single", allowances: 3 }), 357_663);
  assert.equal(newYorkWithholding(40_000, "weekly", { status: "married", allowances: 4 }), 669);
  assert.equal(newYorkWithholding(5_000_000, "monthly", { status: "married", allowances: 3 }), 362_209);
  // Example 2, married: the booklet multiplies by 0.070 where its table says 0.0707; a cent apart.
  const two = newYorkWithholding(500_000, "semimonthly", { status: "married", allowances: 3 });
  assert.ok(Math.abs(two - 24_811) <= 1, `got ${two}`);
});

// NYS-50-T-NYC (1/26), Method II: its examples, page 27.
test("New York City withholding matches its worked examples", async () => {
  const { newYorkCityWithholding } = await import("../dist/index.js");
  assert.equal(newYorkCityWithholding(40_000, "weekly", { status: "married", allowances: 4, nyc: true }), 517);
  assert.equal(newYorkCityWithholding(500_000, "semimonthly", { status: "married", allowances: 3, nyc: true }), 18_437);
  assert.equal(newYorkCityWithholding(5_000_000, "monthly", { status: "married", allowances: 3, nyc: true }), 206_873);
  assert.equal(newYorkCityWithholding(40_000, "weekly", { status: "single", allowances: 3, nyc: true }), 611);
  assert.equal(newYorkCityWithholding(40_000, "weekly", { status: "single", allowances: 3 }), 0, "not a city resident");
});

test("a New York paycheck: DBL up to $0.60 a week, Paid Family Leave to its yearly most, city tax", () => {
  const ny = { ...dana, state: "NY", de4: undefined, it2104: { status: "single", allowances: 1, nyc: true } };
  const line = usPayLine(ny, 300_000, "2026-04-15", 0, { state: "NY", suiRate: 4.1 });
  // DBL: 0.5% of 3,000 is 15.00, held to 0.60 x 52/24 weeks = 1.30. PFL: 0.432% = 12.96.
  assert.equal(line.stateOther, 130 + 1_296);
  assert.ok((line.localIncome ?? 0) > 0);
  assert.equal(line.net, 300_000 - line.federal - line.socialSecurity - line.medicare - line.stateIncome - line.stateOther - line.localIncome);
  assert.equal(line.stateUnemployment, 12_300, "4.1% under the $17,600 base");
  // Near the year's PFL most of $411.91: only what is left of it.
  const late = usPayLine(ny, 300_000, "2026-12-15", 9_500_000, { state: "NY", suiRate: 4.1 });
  assert.equal(late.stateOther - 130, 41_191 - Math.round(9_500_000 * 0.00432));
});

test("Florida: no income tax, reemployment tax on the first $7,000", () => {
  const fl = { ...dana, state: "FL", de4: undefined };
  const line = usPayLine(fl, 500_000, "2026-02-27", 500_000, { state: "FL" });
  assert.equal(line.stateIncome, 0);
  assert.equal(line.stateOther, 0);
  assert.equal(line.stateUnemployment, 5_400, "2.7% of the $2,000 left under $7,000");
});
