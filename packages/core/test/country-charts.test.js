import test from "node:test";
import assert from "node:assert/strict";
import { SCHEDULE_C, SCHEDULE_E, accountTreatment, bestAccountMatch, findPayAccounts, formLineFor, starterChart, starterChartFor } from "../dist/index.js";

test("New Zealand's starter chart is the one it always was", () => {
  assert.deepEqual(starterChartFor("nz"), starterChart());
  assert.deepEqual(starterChartFor("generic"), starterChart());
});

test("Australia's tax codes are read for what they mean", () => {
  const chart = starterChartFor("au");
  const treatment = (code) => accountTreatment(chart.find((a) => a.code === code)).treatment;
  assert.equal(treatment("200"), "standard"); // GST on Income
  assert.equal(treatment("404"), "zero-rated"); // GST Free Expenses
  assert.equal(treatment("270"), "exempt"); // Input Taxed
  assert.equal(treatment("416"), "out-of-scope"); // BAS Excluded
});

test("Korea's: 10% VAT standard, No VAT outside, Exempt exempt", () => {
  const chart = starterChartFor("kr");
  const treatment = (code) => accountTreatment(chart.find((a) => a.code === code)).treatment;
  assert.equal(treatment("401"), "standard");
  assert.equal(treatment("451"), "standard");
  assert.equal(treatment("813"), "out-of-scope");
  assert.equal(treatment("821"), "exempt");
});

test("New Zealand's own codes read exactly as before", () => {
  const nz = starterChart();
  for (const account of nz) {
    const code = account.taxCode.toLowerCase();
    assert.ok(!/input taxed|bas excluded|no vat|no sales tax|gst free|vat free/.test(code), account.taxCode);
  }
});

test("the US chart's names fall on the Schedule C and E lines they are meant for", () => {
  const chart = starterChartFor("us");
  const name = (code) => chart.find((a) => a.code === code).name;
  assert.equal(formLineFor(SCHEDULE_C, name("6030"), "expense"), "11");
  assert.equal(formLineFor(SCHEDULE_C, name("6160"), "expense"), "24b");
  assert.equal(formLineFor(SCHEDULE_C, name("6100"), "expense"), "20a");
  assert.equal(formLineFor(SCHEDULE_C, name("6110"), "expense"), "20b");
  assert.equal(formLineFor(SCHEDULE_C, name("5000"), "expense"), "4");
  assert.equal(formLineFor(SCHEDULE_E, name("6190"), "expense"), "11");
  assert.equal(formLineFor(SCHEDULE_E, name("6200"), "expense"), "7");
  assert.equal(formLineFor(SCHEDULE_E, name("4100"), "income"), "3");
  assert.equal(formLineFor(SCHEDULE_C, name("4200"), "income"), "6");
  assert.equal(formLineFor(SCHEDULE_C, name("6165"), "expense"), "entertainment");
  assert.equal(formLineFor(SCHEDULE_C, name("6210"), "expense"), "27a");
  assert.equal(formLineFor(SCHEDULE_C, name("6220"), "expense"), "10");
  assert.equal(formLineFor(SCHEDULE_C, name("6230"), "expense"), "18");
});

test("the US chart has a balance sheet to post to, and leaves payroll's accounts to payroll", () => {
  const chart = starterChartFor("us");
  assert.equal(new Set(chart.map((a) => a.code)).size, chart.length, "no code twice");
  const typeOf = (code) => chart.find((a) => a.code === code)?.type;
  assert.equal(typeOf("1300"), "Inventory");
  assert.equal(typeOf("1400"), "Current Asset");
  assert.equal(typeOf("2700"), "Non-current Liability");
  assert.equal(typeOf("2900"), "Current Liability");
  // Every fixed asset has its accumulated depreciation, found by name as the asset's journal finds it.
  const fixed = chart.filter((a) => a.type === "Fixed Asset");
  const assets = fixed.filter((a) => !/accumulated/i.test(a.name));
  assert.deepEqual(assets.map((a) => a.name), ["Equipment", "Vehicles", "Furniture and fixtures"]);
  for (const asset of assets) {
    const contra = bestAccountMatch(fixed.filter((a) => /accumulated depreciation/i.test(a.name)), asset.name);
    assert.equal(contra?.name, `Accumulated depreciation - ${asset.name.toLowerCase()}`);
  }
  assert.ok(chart.some((a) => a.name === "Depreciation"));
  // A payday adds its own accounts from 2100 and 6300; nothing here is taken for one, or sits in the way.
  assert.deepEqual(findPayAccounts(chart), { wages: chart.find((a) => a.code === "6180") });
  assert.ok(chart.every((a) => !/^(21|63)\d\d$/.test(a.code)));
});
