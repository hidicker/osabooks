import assert from "node:assert/strict";
import test from "node:test";
import {
  changesForYear,
  identifyExport,
  manualJournalHistory,
  manualJournalsIn,
  mergeXeroHistory,
  readXeroHistory,
  xeroHistoryTime,
  xeroHistoryWorthKeeping,
} from "../dist/index.js";

// Invented, in the shape Xero writes its History and notes report.
const REPORT = [
  "Title:,History and notes",
  "Organisation:,Harbour Lane Bakery",
  "Selected date range:,1 January 2024 - 18 November 2026",
  "Date (Time zone NZDT),User,Type,Item,Detail",
  "10 Nov 2026 12:29,Pat Lee,Manual journal,-,Edited",
  "10 Nov 2026 12:19,Pat Lee,Manual journal,-,Posted",
  "2 Sept 2026 09:18,Pat Lee,Financial settings,-,Edited - Lock date (for all users) - changed from '31 Mar 2025' to '31 Mar 2026'",
  "15 Jun 2026 13:17,Pat Lee,History event,-,Recode - Recoded 14 lines",
  "22 Oct 2025 4:42 pm,Sam Cho,Tax Return,-,GST Return was filed with the tax authority",
  "8 Jul 2025 8:33 am,Ana Ruiz,Tax Return,-,Changed 'Box 9' – $782.61 to $521.74",
  "29 Nov 2024 14:51,Sam Cho,Manual journal,-,\"File uploaded - Uploaded file: <a href='javascript:' class='view-attachment-list' id='x'>Payroll 29 Nov &amp; PAYE.pdf</a>\"",
  "29 Nov 2024 15:34,Sam Cho,Manual journal,-,Posted",
  "11 Nov 2026 15:00,Sam Cho,Transaction - receive money,-,Reconciled - Payment from B on 11 October 2026 for 7,630.00.",
  "28 Aug 2026 11:40,Sam Cho,Transaction - receive money,-,Note - Opened the account with a small balance to start it.",
].join("\n");

test("Xero's times, in each way it writes them", () => {
  assert.equal(xeroHistoryTime("10 Nov 2026 12:29"), "2026-11-10T12:29");
  assert.equal(xeroHistoryTime("22 Oct 2025 4:42 pm"), "2025-10-22T16:42");
  assert.equal(xeroHistoryTime("2 Sept 2026 09:18"), "2026-09-02T09:18");
  assert.equal(xeroHistoryTime("1 Jan 2026 12:05 am"), "2026-01-01T00:05");
  assert.equal(xeroHistoryTime("Title:"), null);
});

test("the report is recognised and read, a file's link round its name taken off", () => {
  assert.equal(identifyExport(REPORT).kind, "xero-history");
  const read = readXeroHistory(REPORT);
  assert.equal(read.organisation, "Harbour Lane Bakery");
  assert.equal(read.entries.length, 10);
  assert.equal(read.cutShort, false);
  const upload = read.entries.find((e) => e.detail.startsWith("File uploaded"));
  assert.equal(upload.detail, "File uploaded - Uploaded file: Payroll 29 Nov & PAYE.pdf");
});

test("only what says something about the accounts is kept", () => {
  const kept = readXeroHistory(REPORT).entries.filter(xeroHistoryWorthKeeping);
  assert.equal(kept.length, 9, "the reconciling line goes; the note stays");
  assert.ok(!kept.some((e) => e.detail.startsWith("Reconciled")));
});

test("a second file adds only what the first did not have", () => {
  const first = readXeroHistory(REPORT).entries;
  const { entries, added } = mergeXeroHistory(first.slice(0, 4), first);
  assert.equal(added, 6);
  assert.equal(entries.length, 10);
  assert.ok(entries[0].at >= entries[1].at, "newest first");
});

test("a manual journal's events: that day's, by whoever posted it", () => {
  const entries = readXeroHistory(REPORT).entries;
  const { events } = manualJournalHistory(entries, { date: "2024-11-29", by: "Sam Cho" });
  assert.deepEqual(events.map((e) => e.detail.slice(0, 13)), ["File uploaded", "Posted"]);
  assert.equal(manualJournalHistory(entries, { date: "2024-11-29", by: "Pat Lee" }).events.length, 0);
});

test("a year's changes: made in it, or in the year after while it was finished", () => {
  const changes = changesForYear(readXeroHistory(REPORT).entries, { from: "2025-04-01", to: "2026-03-31" });
  assert.deepEqual(
    changes.map((e) => e.detail.slice(0, 20)),
    ["Changed 'Box 9' – $7", "GST Return was filed", "Recode - Recoded 14 ", "Note - Opened the ac", "Edited - Lock date (", "Edited"],
  );
});

test("a manual journal read from the journal report keeps who posted it and when", () => {
  const [journal] = manualJournalsIn([
    {
      id: "3463",
      date: "2026-03-31",
      narration: "YE26 - Year-end adjustment - Manual",
      postedDate: "2026-07-02",
      postedBy: "Pat Lee",
      lines: [
        { accountCode: "437", accountName: "Interest Expense", description: "", amount: -335478, line: 1 },
        { accountCode: "980", accountName: "Owner Drawings", description: "", amount: 335478, line: 2 },
      ],
    },
  ]);
  assert.deepEqual(journal.posted, { date: "2026-07-02", by: "Pat Lee" });
});
