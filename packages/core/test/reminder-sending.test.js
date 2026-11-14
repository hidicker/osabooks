import assert from "node:assert/strict";
import test from "node:test";
import { sendReminders } from "../dist/index.js";

const email = (customer, stages) => ({ customer, to: `${customer.toLowerCase()}@example.com`, stages });
const at = () => "2026-11-15T08:00:00.000Z";

test("each reminder is recorded as soon as it is sent, not all at the end", async () => {
  const records = [];
  const result = await sendReminders(
    [email("Kea", { "INV-1": 7 }), email("Tui", { "INV-2": 14 })],
    { sent: { "INV-0": 30 }, log: [] },
    async () => undefined,
    async (held) => records.push(structuredClone(held)),
    at,
  );
  assert.equal(result.count, 2);
  assert.equal(records.length, 2, "a record after each email");
  assert.deepEqual(records[0].sent, { "INV-0": 30, "INV-1": 7 }, "the first is recorded before the second goes");
  assert.deepEqual(records[1].sent, { "INV-0": 30, "INV-1": 7, "INV-2": 14 });
  assert.deepEqual(result.log.map((l) => l.customer), ["Tui", "Kea"], "newest first");
});

test("a recording that fails stops the sending, so nothing goes out unrecorded", async () => {
  const sent = [];
  await assert.rejects(
    sendReminders(
      [email("Kea", { "INV-1": 7 }), email("Tui", { "INV-2": 14 })],
      { sent: {}, log: [] },
      async (e) => sent.push(e.customer),
      async () => {
        throw new Error("database said 500");
      },
      at,
    ),
    /database said 500/,
  );
  assert.deepEqual(sent, ["Kea"], "Tui is not sent after Kea could not be recorded");
});

test("an email that fails to send is logged, not marked sent, and the rest go", async () => {
  const records = [];
  const result = await sendReminders(
    [email("Kea", { "INV-1": 7 }), email("Tui", { "INV-2": 14 })],
    { sent: {}, log: [] },
    async (e) => {
      if (e.customer === "Kea") throw new Error("mailbox full");
    },
    async (held) => records.push(structuredClone(held)),
    at,
  );
  assert.equal(result.count, 1);
  assert.deepEqual(result.sent, { "INV-2": 14 }, "Kea's invoice is not marked: it is tried again tomorrow");
  assert.equal(result.log.find((l) => l.customer === "Kea").failed, "mailbox full");
  assert.equal(records.length, 1, "recorded after the one that went");
});
