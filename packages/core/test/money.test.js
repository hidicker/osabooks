import test from "node:test";
import assert from "node:assert/strict";
import { parseAmount, formatAmount, amountKeyText } from "../dist/index.js";

test("parses plain decimals to minor units", () => {
  assert.equal(parseAmount("25.99"), 2599);
  assert.equal(parseAmount("-1074.44"), -107444);
  assert.equal(parseAmount("0"), 0);
  assert.equal(parseAmount("1250"), 125000);
});

test("strips thousands separators and currency symbols", () => {
  assert.equal(parseAmount("1,250.00"), 125000);
  assert.equal(parseAmount("$1,250.00"), 125000);
  assert.equal(parseAmount("NZD 1,250.00"), 125000);
  assert.equal(parseAmount("1.234.567,89"), 123456789);
});

test("reads a bare grouped thousand as thousands, not decimals", () => {
  // `1,250` is a thousand and change, not one dollar twenty-five.
  assert.equal(parseAmount("1,250"), 125000);
  assert.equal(parseAmount("1.250"), 125000);
  // Two decimal places is unambiguous.
  assert.equal(parseAmount("1,25"), 125);
});

test("handles accounting and CR/DR negatives", () => {
  assert.equal(parseAmount("(123.45)"), -12345);
  assert.equal(parseAmount("123.45 DR"), -12345);
  assert.equal(parseAmount("123.45 CR"), 12345);
  assert.equal(parseAmount("DR 123.45"), -12345);
  // Two negatives cancel: an explicit minus inside accounting brackets.
  assert.equal(parseAmount("(-123.45)"), 12345);
});

test("normalises unicode minus signs", () => {
  assert.equal(parseAmount("−123.45"), -12345);
  assert.equal(parseAmount("–123.45"), -12345);
});

test("snaps float noise from spreadsheet round-trips", () => {
  // These exact values appear in the workbook this project replaces.
  assert.equal(parseAmount(-78.08000000000001), -7808);
  assert.equal(parseAmount(-195.00000000000003), -19500);
  assert.equal(parseAmount(-57.20000000000001), -5720);
  assert.equal(parseAmount(0.1 + 0.2), 30);
});

test("a currency with no minor unit is held in hundredths too, and written without decimals", () => {
  // The books hold hundredths whatever the currency: 3,300,000 won is 330000000.
  assert.equal(parseAmount("1000", "JPY"), 100000);
  assert.equal(parseAmount("12,340", "KRW"), 1234000);
  assert.equal(parseAmount("3,300,000", "KRW"), 330000000);
  assert.equal(formatAmount(100000, "JPY"), "1000");
  assert.equal(formatAmount(330000000, "KRW"), "3300000");
  assert.equal(formatAmount(-1234000, "KRW"), "-12340");
  // What the split editor writes and reads back is the same amount.
  assert.equal(parseAmount((123400000 / 100).toFixed(2), "KRW"), 123400000);
});

test("duplicate keys write amounts as they always have", () => {
  assert.equal(amountKeyText(2599, "NZD"), "25.99");
  assert.equal(amountKeyText(330000000, "KRW"), "330000000");
  assert.equal(amountKeyText(-5, "NZD"), "-0.05");
});

test("rejects values that are not numbers", () => {
  assert.equal(parseAmount(""), null);
  assert.equal(parseAmount("   "), null);
  assert.equal(parseAmount("Total:"), null);
  assert.equal(parseAmount("n/a"), null);
  assert.equal(parseAmount(null), null);
  assert.equal(parseAmount(undefined), null);
  assert.equal(parseAmount(Number.NaN), null);
});

test("formats minor units back to a decimal string", () => {
  assert.equal(formatAmount(2599), "25.99");
  assert.equal(formatAmount(-107444), "-1074.44");
  assert.equal(formatAmount(0), "0.00");
  assert.equal(formatAmount(-5), "-0.05");
  assert.equal(formatAmount(125000), "1250.00");
});

test("round-trips every amount in the sample range", () => {
  for (let cents = -100000; cents <= 100000; cents += 137) {
    assert.equal(parseAmount(formatAmount(cents)), cents);
  }
});

test("a currency written to three places keeps its third decimal", () => {
  // Dinars and rials have three minor units. Reading the third decimal as the
  // start of a thousands group multiplied every one of them by a thousand.
  // Held in hundredths, as every amount is: 12.345 is 12.35.
  assert.equal(parseAmount("12.345", "BHD"), 1235);
  assert.equal(parseAmount("12,345", "BHD"), 1235);
  assert.equal(parseAmount("0.500", "KWD"), 50);
});

test("three digits after a separator are still a thousands group where they can be", () => {
  // Unchanged, and deliberately so: a European-formatted export writes 1234 as
  // "1.234", and Wise exports in whichever locale the account uses.
  assert.equal(parseAmount("1,234", "NZD"), 123400);
  assert.equal(parseAmount("1.234", "NZD"), 123400);
  assert.equal(parseAmount("1.234.567", "NZD"), 123456700);
});

test("but four digits before a separator cannot be a group", () => {
  // Grouping puts a separator every three digits from the right, so a group
  // follows one, two or three digits and never four. "1234.567" is a decimal,
  // and reading it as a group multiplied it by a thousand.
  assert.equal(parseAmount("1234.567", "NZD"), 123457);
  assert.equal(parseAmount("98765.432", "NZD"), 9876543);
});
