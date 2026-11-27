import { parseCsvRecords, spreadsheetCell } from "./csv.js";
import type { ReadonlyCsvRecord } from "./csv.js";
import { parseAmount } from "./money.js";
import { isTrackedItem } from "./items.js";
import type { Item } from "./items.js";

/**
 * A list of products and services exported from another system -- QuickBooks
 * Online's Products and services, SlowBooks' items -- read by its headings,
 * as the customer and vendor lists are. Each becomes an item with its price,
 * its cost and the accounts it sells to and is bought from, and a product
 * with a quantity on hand says how many there are.
 */

const NAME = ["product/service name", "product/service", "item name", "name", "item"];
const CODE = ["sku", "item code", "code", "product code"];
const TYPE = ["type", "item type", "product type"];
const DESCRIPTION = ["sales description", "description", "sales desc"];
const PRICE = ["sales price/rate", "sales price", "price", "rate", "unit price", "sales rate"];
const COST = ["purchase cost", "cost", "unit cost"];
const INCOME = ["income account", "sales account"];
const EXPENSE = ["expense account", "purchase account", "cogs account"];
const INVENTORY = ["inventory account", "asset account", "inventory asset account"];
const QUANTITY = ["qty on hand", "quantity on hand", "on hand", "qty", "quantity"];
const ACTIVE = ["active", "status"];
const REORDER = ["reorder at", "reorder point", "reorder level"];
const TAXABLE = ["taxable", "sales tax"];

const norm = (text: string): string => text.trim().toLowerCase().replace(/\s*\/\s*/g, "/").replace(/\s+/g, " ");
const indexOf = (headers: readonly string[], names: readonly string[]): number => {
  for (const name of names) {
    const at = headers.indexOf(name);
    if (at >= 0) return at;
  }
  return -1;
};

function headerRow(records: readonly ReadonlyCsvRecord[]): { at: number; headers: string[] } | null {
  for (let at = 0; at < Math.min(records.length, 12); at += 1) {
    const headers = (records[at]?.fields ?? []).map(norm);
    const named = indexOf(headers, NAME) >= 0;
    const priced = indexOf(headers, PRICE) >= 0 || indexOf(headers, COST) >= 0;
    // A product list says what something costs or sells for, and has no dates
    // or contact details: that is what tells it from a customer list.
    const notPeople = !headers.some((h) => /e-?mail|phone|address|date/.test(h));
    if (named && priced && notPeople && indexOf(headers, TYPE) >= 0) return { at, headers };
  }
  return null;
}

export function isProductList(text: string): boolean {
  return headerRow(parseCsvRecords(text.slice(0, 20000))) !== null;
}

export interface ProductRead {
  item: Omit<Item, "id" | "accountCode">;
  /** The accounts as the file names them, to be found in the chart. */
  incomeAccount?: string;
  expenseAccount?: string;
  inventoryAccount?: string;
  /** How many are on hand, for a product kept in stock. */
  onHand?: number;
}

export function parseProductList(text: string, currency = "USD"): ProductRead[] {
  const records = parseCsvRecords(text);
  const found = headerRow(records);
  if (found === null) return [];
  const { at, headers } = found;
  const column = {
    name: indexOf(headers, NAME),
    code: indexOf(headers, CODE),
    type: indexOf(headers, TYPE),
    description: indexOf(headers, DESCRIPTION),
    price: indexOf(headers, PRICE),
    cost: indexOf(headers, COST),
    income: indexOf(headers, INCOME),
    expense: indexOf(headers, EXPENSE),
    inventory: indexOf(headers, INVENTORY),
    quantity: indexOf(headers, QUANTITY),
    active: indexOf(headers, ACTIVE),
    reorder: indexOf(headers, REORDER),
    taxable: indexOf(headers, TAXABLE),
  };
  const out: ProductRead[] = [];
  for (const record of records.slice(at + 1)) {
    const cell = (index: number): string => (index >= 0 ? (record.fields[index] ?? "").trim() : "");
    const name = cell(column.name);
    if (name === "" || /^total\b/i.test(name)) continue;
    const sku = cell(column.code);
    const type = cell(column.type).toLowerCase();
    const stocked = /inventory|stock|part/.test(type) && !/non-?inventory/.test(type);
    const product = stocked || /product|good|non-?inventory/.test(type);
    const money = (index: number): number | undefined => {
      const said = cell(index).replace(/[$,]/g, "");
      if (said === "") return undefined;
      const value = parseAmount(said, currency);
      return value === null || value === 0 ? undefined : value;
    };
    const price = money(column.price);
    const cost = money(column.cost);
    const quantity = Number(cell(column.quantity).replace(/,/g, ""));
    const description = cell(column.description);
    const active = cell(column.active).toLowerCase();
    const reorder = Number(cell(column.reorder).replace(/,/g, ""));
    const taxable = cell(column.taxable).toLowerCase();
    out.push({
      item: {
        name,
        ...(sku !== "" ? { code: sku } : {}),
        kind: product ? "product" : "service",
        ...(stocked && cost === undefined ? { tracked: true } : {}),
        ...(description !== "" && description !== name ? { description } : {}),
        ...(price !== undefined ? { price } : {}),
        // A cost a unit for stocked items (keeps non-inventory exports clean & backwards-compatible).
        ...(stocked && cost !== undefined ? { unitCost: cost } : {}),
        ...(active === "false" || active === "inactive" || active === "no" ? { active: false } : {}),
        ...(stocked && cell(column.reorder) !== "" && Number.isFinite(reorder) ? { reorderAt: reorder } : {}),
        ...(taxable === "no" || taxable === "false" || taxable === "n" ? { taxable: false } : {}),
      },
      ...(cell(column.income) !== "" ? { incomeAccount: cell(column.income) } : {}),
      ...(cell(column.expense) !== "" ? { expenseAccount: cell(column.expense) } : {}),
      ...(cell(column.inventory) !== "" ? { inventoryAccount: cell(column.inventory) } : {}),
      ...(stocked && cell(column.quantity) !== "" && Number.isFinite(quantity) ? { onHand: quantity } : {}),
    });
  }
  return out;
}

/**
 * Products and services as a spreadsheet, in the headings the reading above
 * takes: a file written here comes back in as it went out. A product kept in
 * stock is "Inventory", with its unit cost and reorder point.
 */
export function formatItems(items: readonly Item[]): string {
  const cell = spreadsheetCell;
  const money = (cents: number | undefined): string => (cents === undefined ? "" : (cents / 100).toFixed(2));
  const rows = [
    ["SKU", "Name", "Type", "Description", "Sales price", "Unit cost", "Income account", "Expense account", "Inventory account", "Reorder at", "Taxable", "Active"],
  ];
  for (const i of items) {
    const tracked = isTrackedItem(i);
    rows.push([
      i.code ?? "",
      i.name,
      i.kind === "service" ? "Service" : tracked ? "Inventory" : "Product",
      i.description ?? "",
      money(i.price),
      money(i.unitCost),
      i.accountCode ?? "",
      tracked ? (i.cogsAccountCode ?? "") : (i.purchaseAccountCode ?? ""),
      tracked ? (i.inventoryAccountCode ?? "") : "",
      i.reorderAt === undefined ? "" : String(i.reorderAt),
      i.taxable === false ? "No" : "",
      i.active === false ? "No" : "Yes",
    ]);
  }
  return rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}
