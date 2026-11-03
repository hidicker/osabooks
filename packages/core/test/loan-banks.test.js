import assert from "node:assert/strict";
import test from "node:test";
import { isLoanBank, looksLikeLoan } from "../dist/index.js";

test("a bank account called a loan is a loan, by its name", () => {
  for (const name of ["home-loan-1001", "housing-loan-0007", "BNZ Home Loan", "Business Loans", "TotalMoney term", "Mortgage", "Line of credit"]) {
    assert.equal(looksLikeLoan(name), true, name);
  }
  for (const name of ["02-0100-9000000-000", "Business Cheque", "Savings", "Visa Platinum", "Loaned tools"]) {
    assert.equal(looksLikeLoan(name), false, name);
  }
});

test("a tick on the account wins over its name, either way", () => {
  const model = { entities: [], accounts: {}, banks: {}, loans: { "home-loan-1001": false, "ASB 4417": true } };
  assert.equal(isLoanBank(model, "home-loan-1001", "Home loan"), false);
  assert.equal(isLoanBank(model, "ASB 4417", "ASB 4417"), true);
  assert.equal(isLoanBank(model, "housing-loan-0007", "housing-loan-0007"), true);
  assert.equal(isLoanBank(undefined, "02-0100-9000000-000", "Cheque"), false);
});
