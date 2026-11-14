import assert from "node:assert/strict";
import test from "node:test";
import { deflateRawSync } from "node:zlib";
import { readXls, readXlsx, readZipFiles, sheetToCsv } from "../dist/index.js";

/**
 * Files made to hurt the reader rather than to be read: a zip that unpacks to
 * gigabytes, a cell in a column millions wide, an .xls whose sizes lie. Each
 * should be refused or read for what it really holds, quickly, without the
 * page running out of memory.
 */

const put = (view, at, value, width) => {
  for (let i = 0; i < width; i += 1) view[at + i] = (value >>> (8 * i)) & 0xff;
};

/** A zip of the given entries, each deflated, with no checksum (the reader does not check one). */
function zipOf(files) {
  const encoder = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;
  for (const [name, raw] of Object.entries(files)) {
    const nameBytes = encoder.encode(name);
    const plain = typeof raw === "string" ? encoder.encode(raw) : raw;
    const data = new Uint8Array(deflateRawSync(plain));
    const local = new Uint8Array(30 + nameBytes.length + data.length);
    put(local, 0, 0x04034b50, 4);
    put(local, 4, 20, 2);
    put(local, 8, 8, 2); // deflated
    put(local, 18, data.length, 4);
    put(local, 22, plain.length, 4);
    put(local, 26, nameBytes.length, 2);
    local.set(nameBytes, 30);
    local.set(data, 30 + nameBytes.length);
    parts.push(local);
    const entry = new Uint8Array(46 + nameBytes.length);
    put(entry, 0, 0x02014b50, 4);
    put(entry, 10, 8, 2);
    put(entry, 20, data.length, 4);
    put(entry, 24, plain.length, 4);
    put(entry, 28, nameBytes.length, 2);
    put(entry, 42, offset, 4);
    entry.set(nameBytes, 46);
    central.push(entry);
    offset += local.length;
  }
  const directory = central.reduce((n, e) => n + e.length, 0);
  const end = new Uint8Array(22);
  put(end, 0, 0x06054b50, 4);
  put(end, 8, central.length, 2);
  put(end, 10, central.length, 2);
  put(end, 12, directory, 4);
  put(end, 16, offset, 4);
  const all = [...parts, ...central, end];
  const bytes = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of all) {
    bytes.set(p, at);
    at += p.length;
  }
  return bytes;
}

test("a zip that unpacks to more than 200 MB is refused, not unpacked", async () => {
  const bomb = zipOf({ "exports/huge.csv": new Uint8Array(210 * 1024 * 1024) });
  assert.ok(bomb.length < 1024 * 1024, `the bomb itself is small (${bomb.length} bytes)`);
  await assert.rejects(readZipFiles(bomb), /too big to be an export/);
});

test("a cell in a column past Excel's last is ignored, so the sheet stays its real width", async () => {
  const workbook = zipOf({
    "xl/workbook.xml": `<workbook><sheets><sheet name="Sheet1" r:id="rId1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>`,
    "xl/worksheets/sheet1.xml": `<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Date</t></is></c><c r="B1" t="inlineStr"><is><t>Amount</t></is></c><c r="ZZZZZ1" t="inlineStr"><is><t>x</t></is></c></row></sheetData></worksheet>`,
  });
  const started = Date.now();
  const read = await readXlsx(workbook);
  const csv = sheetToCsv(read.sheets[0]);
  assert.ok(Date.now() - started < 2000);
  assert.equal(csv, "Date,Amount");
});

test("an .xls whose header gives an impossible sector size is refused", () => {
  const bytes = new Uint8Array(4096);
  bytes.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], 0);
  put(bytes, 30, 30, 2); // 2^30-byte sectors
  put(bytes, 32, 6, 2);
  assert.deepEqual(readXls(bytes).problems, [{ message: "No workbook inside this .xls file." }]);
});

test("an .xls whose directory claims a 4 GB stream is read within the file, not allocated", () => {
  // Header: 512-byte sectors, one allocation-table sector (1), the directory at sector 0.
  const bytes = new Uint8Array(512 * 3);
  bytes.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], 0);
  put(bytes, 30, 9, 2);
  put(bytes, 32, 6, 2);
  put(bytes, 48, 0, 4); // directory starts at sector 0
  put(bytes, 56, 4096, 4); // mini cutoff
  put(bytes, 60, 0xfffffffe, 4);
  put(bytes, 68, 0xfffffffe, 4);
  for (let i = 0; i < 109; i += 1) put(bytes, 76 + i * 4, i === 0 ? 1 : 0xffffffff, 4);
  // Allocation table (sector 1, at 1024): sector 0 ends its chain.
  for (let i = 0; i < 128; i += 1) put(bytes, 1024 + i * 4, i === 0 ? 0xfffffffe : 0xffffffff, 4);
  // Directory entry 0 (sector 0, at 512): "Workbook", a stream, starting at 0, 4 GB long.
  const name = "Workbook";
  for (let i = 0; i < name.length; i += 1) put(bytes, 512 + i * 2, name.charCodeAt(i), 2);
  put(bytes, 512 + 64, (name.length + 1) * 2, 2);
  bytes[512 + 66] = 2;
  put(bytes, 512 + 116, 0, 4);
  put(bytes, 512 + 120, 0xffffffff, 4);
  const started = Date.now();
  const read = readXls(bytes);
  assert.ok(Date.now() - started < 2000, "no four-billion-byte array, no four-billion-step loop");
  assert.ok(Array.isArray(read.sheets));
});
