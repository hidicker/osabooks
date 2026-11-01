import assert from "node:assert/strict";
import test from "node:test";
import { parseXeroJournalReport } from "../dist/index.js";

test("a journal report says which dates it covers", () => {
  const csv = [
    "Journal Report",
    "Demo Company (AU)",
    "For the period 1 November 2026 to 30 November 2026",
    "",
    "Date,Journal ID,Account Code,Account,Narration,Description,Debit,Credit",
    "24/11/2026,755,610,Accounts Receivable,DIISR,,1155.00,0",
    "24/11/2026,755,877,Tracking Transfers,DIISR,,0,1155.00",
  ].join("\n");
  const parsed = parseXeroJournalReport(csv);
  assert.deepEqual(parsed.period, { from: "2026-11-01", to: "2026-11-30" });
  assert.equal(parsed.journals.length, 1);
});
