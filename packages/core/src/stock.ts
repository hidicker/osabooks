import { spreadsheetCell } from "./csv.js";
import { isTrackedItem } from "./items.js";
import type { Cents } from "./money.js";

/**
 * Stock, counted: the periodic method. What is on hand is counted at a date
 * and valued at each product's weighted-average (or unit) cost; the inventory
 * account is then put to that value, the difference going to cost of goods
 * sold. Between counts, purchases are coded to inventory (perpetual) or cost
 * of sales (periodic).
 */
export interface StockCount {
  id: string;
  date: string;
  lines: { itemId: string; quantity: number; unitCost: Cents }[];
  /** The journal that put the inventory account to the count's value, once posted. */
  journalId?: string;
}

export type StockAdjustmentReason =
  | "opening"
  | "damage"
  | "shrinkage"
  | "write_off"
  | "internal_use"
  | "other";

/** Single-item stock adjustment (opening stock, damage, shrinkage, write-off, samples). */
export interface StockAdjustment {
  id: string;
  date: string;
  itemId: string;
  /** Positive adds stock (opening/found); negative removes stock (damage/shrinkage/write-off). */
  quantityDelta: number;
  /** Unit cost in cents. Defaults to current weighted-average cost (or item.unitCost) when omitted. */
  unitCost?: Cents;
  reason: StockAdjustmentReason;
  note?: string;
  /** Optional offset account code (defaults to item's COGS / global COGS). */
  accountCode?: string;
}

/** What a count is worth, to the cent. */
export function stockValue(count: Pick<StockCount, "lines">): Cents {
  return count.lines.reduce((sum, line) => sum + Math.round(line.quantity * line.unitCost), 0);
}

/** Current weighted-average unit cost for a stocked item, falling back to its default unitCost. */
export function averageUnitCost(onHand: StockOnHand | undefined, fallback?: Cents): Cents {
  if (onHand !== undefined && onHand.quantity > 0) {
    return Math.round(onHand.value / onHand.quantity) as Cents;
  }
  return (fallback ?? 0) as Cents;
}

/**
 * The journal lines that bring the inventory account from what the books hold
 * to what was counted: more stock than the books say lowers cost of goods
 * sold, less raises it. None when they agree.
 */
export function stockAdjustment(
  counted: Cents,
  booked: Cents,
  inventory: string,
  costOfSales: string,
): { code: string; amount: Cents; description: string }[] {
  const change = counted - booked;
  if (change === 0) return [];
  return [
    { code: inventory, amount: change, description: "Stock on hand, as counted" },
    { code: costOfSales, amount: -change, description: change > 0 ? "Stock not yet sold" : "Stock sold or used" },
  ];
}

/** What is on hand of each product as at a date: after the last movement on or before it. */
export function stockAsAt(history: ReadonlyMap<string, readonly StockMove[]>, date: string): Map<string, StockOnHand> {
  const out = new Map<string, StockOnHand>();
  for (const [id, moves] of history) {
    const last = [...moves].reverse().find((m) => m.date <= date);
    if (last !== undefined) out.set(id, { quantity: last.onHand, value: last.worth });
  }
  return out;
}

/** Stocked products at or below their reorder point, the furthest below first. */
export function lowStock<T extends StockItemLike & { reorderAt?: number; active?: boolean }>(
  items: readonly T[],
  onHand: ReadonlyMap<string, StockOnHand>,
): { item: T; onHand: number; reorderAt: number }[] {
  return items
    .filter((i) => isTrackedItem(i) && i.active !== false && i.reorderAt !== undefined)
    .map((item) => ({ item, onHand: onHand.get(item.id)?.quantity ?? 0, reorderAt: item.reorderAt ?? 0 }))
    .filter((x) => x.onHand <= x.reorderAt)
    .sort((a, b) => a.onHand - a.reorderAt - (b.onHand - b.reorderAt));
}

/**
 * Stock tracked line by line: the perpetual method, alongside counts and single-item adjustments.
 *
 * A bill line for a stocked product (its `itemCode` the product's id, SKU code, or name)
 * adds what it says to what is on hand, at what it cost; the line is coded to
 * the inventory account, so the books hold it there. An invoice line takes it
 * out again at the average cost of what is on hand, and that cost is posted
 * from inventory to cost of goods sold on the invoice's date. Single-item
 * adjustments record opening stock, damage, shrinkage, or write-offs. A count
 * puts the quantity to what was counted, as its own journal puts the account.
 */
export interface StockItemLike {
  id: string;
  code?: string;
  name: string;
  kind: "service" | "product";
  tracked?: boolean;
  unitCost?: Cents;
  inventoryAccountCode?: string;
  cogsAccountCode?: string;
}

export interface StockDocumentLike {
  number: string;
  kind: "sales" | "purchase";
  issued: string;
  /** Credit notes put stock back (a customer's return) or take it out (one sent back). */
  credit: boolean;
  lines: { itemCode?: string; quantity?: number; net: Cents; description: string }[];
}

export interface StockOnHand {
  quantity: number;
  value: Cents;
}

/** One movement of a stocked product, and where it left what is on hand. */
export interface StockMove {
  date: string;
  /** What moved it, in words. */
  what: "Opening" | "Bought" | "Sent back" | "Sold" | "Returned" | "Adjusted" | "Counted";
  /** The invoice, bill, or adjustment note where one moved it. */
  number: string;
  /** The change: in positive, out negative. For a count, what it changed by. */
  quantity: number;
  /** What it moved, at cost. */
  value: Cents;
  /** On hand after it. */
  onHand: number;
  /** What that is worth after it. */
  worth: Cents;
}

export interface StockCostJournal {
  /** `<invoice number>:cost` (or `<invoice number>:cost:<inv>:<cogs>` when per-item accounts differ, or `stock-adj:<id>`). */
  transactionId: string;
  date: string;
  /** Invoice number for sales COGS, empty string for single-item stock adjustments. */
  number: string;
  /** Positive = Dr COGS/Adjustment, Cr Inventory. Negative = Dr Inventory, Cr COGS/Adjustment. */
  cost: Cents;
  /** Optional per-item Inventory Asset account override. */
  inventoryAccountCode?: string;
  /** Optional per-item COGS / adjustment offset account override. */
  cogsAccountCode?: string;
  /** Optional custom narration (used for single-item adjustments). */
  narration?: string;
}

function itemFor(items: readonly StockItemLike[], code: string | undefined): StockItemLike | undefined {
  if (code === undefined || code.trim() === "") return undefined;
  const key = code.trim().toLowerCase();
  return items.find(
    (i) =>
      i.id === code ||
      (i.code !== undefined && i.code.trim().toLowerCase() === key) ||
      i.name.trim().toLowerCase() === key,
  );
}

const REASON_LABELS: Record<StockAdjustmentReason, string> = {
  opening: "Opening stock",
  damage: "Damaged stock",
  shrinkage: "Stock shrinkage",
  write_off: "Stock write-off",
  internal_use: "Internal use / samples",
  other: "Stock adjustment",
};

export function trackStock(
  items: readonly StockItemLike[],
  documents: readonly StockDocumentLike[],
  counts: readonly StockCount[],
  adjustments: readonly StockAdjustment[] = [],
): { onHand: Map<string, StockOnHand>; costs: StockCostJournal[]; history: Map<string, StockMove[]> } {
  const stocked = items.filter((i) => isTrackedItem(i));
  type Move =
    | { date: string; order: number; kind: "in" | "out"; item: StockItemLike; quantity: number; net: Cents; number: string; document: string }
    | { date: string; order: number; kind: "adjust"; item: StockItemLike; adjustment: StockAdjustment }
    | { date: string; order: number; kind: "count"; item: StockItemLike; quantity: number; unitCost: Cents };
  const moves: Move[] = [];
  for (const doc of documents) {
    for (const line of doc.lines) {
      const item = itemFor(stocked, line.itemCode);
      if (item === undefined) continue;
      const quantity = Math.abs(line.quantity ?? 1);
      if (quantity === 0) continue;
      // A purchase brings stock in, a sale takes it out; a credit note the other way.
      const incoming = (doc.kind === "purchase") !== doc.credit;
      moves.push({
        date: doc.issued,
        order: incoming ? 0 : 1,
        kind: incoming ? "in" : "out",
        item,
        quantity,
        net: Math.abs(line.net),
        number: doc.kind === "sales" ? doc.number : "",
        document: doc.number,
      });
    }
  }
  for (const adj of adjustments) {
    const item = stocked.find((i) => i.id === adj.itemId);
    if (item === undefined || adj.quantityDelta === 0) continue;
    moves.push({
      date: adj.date,
      order: adj.reason === "opening" ? -1 : 1.5,
      kind: "adjust",
      item,
      adjustment: adj,
    });
  }
  for (const count of counts) {
    for (const line of count.lines) {
      const item = stocked.find((i) => i.id === line.itemId);
      if (item !== undefined) moves.push({ date: count.date, order: 2, kind: "count", item, quantity: line.quantity, unitCost: line.unitCost });
    }
  }
  moves.sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order);

  const onHand = new Map<string, StockOnHand>();
  const costs = new Map<string, StockCostJournal>();
  const history = new Map<string, StockMove[]>();
  for (const move of moves) {
    const held = onHand.get(move.item.id) ?? { quantity: 0, value: 0 };
    const before = { ...held };
    let what: StockMove["what"];
    let moveNumber = "";

    if (move.kind === "count") {
      held.quantity = move.quantity;
      held.value = Math.round(move.quantity * move.unitCost);
      what = "Counted";
    } else if (move.kind === "adjust") {
      const adj = move.adjustment;
      const average = held.quantity > 0 ? held.value / held.quantity : (move.item.unitCost ?? 0);
      const unitCost = adj.unitCost !== undefined ? adj.unitCost : average;
      const valueDelta = Math.round(adj.quantityDelta * unitCost);
      held.quantity += adj.quantityDelta;
      held.value += valueDelta;
      what = adj.reason === "opening" ? "Opening" : "Adjusted";
      moveNumber = adj.note?.trim() ? `${REASON_LABELS[adj.reason]}: ${adj.note.trim()}` : REASON_LABELS[adj.reason];
      // Emit a balanced adjustment journal unless valueDelta is 0.
      // Positive stock addition => negative cost (Dr Inventory / Cr Offset);
      // Negative stock removal => positive cost (Dr Offset / Cr Inventory).
      if (valueDelta !== 0) {
        const id = `stock-adj:${adj.id}`;
        costs.set(id, {
          transactionId: id,
          date: adj.date,
          number: "",
          cost: -valueDelta as Cents,
          ...(move.item.inventoryAccountCode ? { inventoryAccountCode: move.item.inventoryAccountCode } : {}),
          ...(adj.accountCode || move.item.cogsAccountCode
            ? { cogsAccountCode: adj.accountCode ?? move.item.cogsAccountCode }
            : {}),
          narration: `${REASON_LABELS[adj.reason]} — ${move.item.name}${adj.note?.trim() ? ` (${adj.note.trim()})` : ""}`,
        });
      }
    } else {
      // What is on hand is worth its average; with none, the product's cost.
      const average = held.quantity > 0 ? held.value / held.quantity : (move.item.unitCost ?? 0);
      if (move.number === "") {
        // Bought, or sent back to the supplier: at what the bill says.
        const sign = move.kind === "in" ? 1 : -1;
        held.quantity += sign * move.quantity;
        held.value += sign * move.net;
        what = move.kind === "in" ? "Bought" : "Sent back";
      } else {
        // Sold, or returned by the customer: at the average.
        const cost = Math.round(move.quantity * average);
        const sign = move.kind === "out" ? 1 : -1;
        held.quantity -= sign * move.quantity;
        held.value -= sign * cost;
        what = move.kind === "out" ? "Sold" : "Returned";
        const invAcc = move.item.inventoryAccountCode?.trim() || undefined;
        const cogsAcc = move.item.cogsAccountCode?.trim() || undefined;
        const suffix = invAcc || cogsAcc ? `:${invAcc ?? ""}:${cogsAcc ?? ""}` : "";
        const id = `${move.number}:cost${suffix}`;
        const journal = costs.get(id) ?? {
          transactionId: id,
          date: move.date,
          number: move.number,
          cost: 0,
          ...(invAcc ? { inventoryAccountCode: invAcc } : {}),
          ...(cogsAcc ? { cogsAccountCode: cogsAcc } : {}),
        };
        journal.cost += sign * cost;
        costs.set(id, journal);
      }
      moveNumber = move.document;
    }

    onHand.set(move.item.id, held);
    const list = history.get(move.item.id) ?? [];
    list.push({
      date: move.date,
      what,
      number: moveNumber,
      quantity: held.quantity - before.quantity,
      value: held.value - before.value,
      onHand: held.quantity,
      worth: held.value,
    });
    history.set(move.item.id, list);
  }
  return { onHand, costs: [...costs.values()].filter((j) => j.cost !== 0), history };
}

/** Export stock valuation on hand as a CSV spreadsheet. */
export function formatStockValuationCsv(
  items: readonly (StockItemLike & { reorderAt?: number })[],
  onHand: ReadonlyMap<string, StockOnHand>,
  asAtDate: string,
): string {
  const money = (cents: number): string => (cents / 100).toFixed(2);
  const rows: string[][] = [["As at", "SKU", "Product", "On hand", "Reorder at", "Average unit cost", "Total value"]];
  for (const item of items.filter((i) => isTrackedItem(i))) {
    const held = onHand.get(item.id);
    const qty = held?.quantity ?? 0;
    const val = held?.value ?? 0;
    const avg = averageUnitCost(held, item.unitCost);
    rows.push([
      asAtDate,
      item.code ?? "",
      item.name,
      String(qty),
      item.reorderAt === undefined ? "" : String(item.reorderAt),
      money(avg),
      money(val),
    ]);
  }
  return rows.map((r) => r.map(spreadsheetCell).join(",")).join("\r\n") + "\r\n";
}

/** Export stock movement history as a CSV spreadsheet. */
export function formatStockMovementsCsv(
  items: readonly StockItemLike[],
  history: ReadonlyMap<string, readonly StockMove[]>,
): string {
  const money = (cents: number): string => (cents / 100).toFixed(2);
  const rows: string[][] = [["Date", "SKU", "Product", "Movement", "Reference", "Qty change", "Cost change", "On hand", "Value after"]];
  const byId = new Map(items.map((i) => [i.id, i]));
  const flat: { item: StockItemLike; move: StockMove }[] = [];
  for (const [id, moves] of history) {
    const item = byId.get(id);
    if (!item) continue;
    for (const move of moves) flat.push({ item, move });
  }
  flat.sort((a, b) => a.move.date.localeCompare(b.move.date) || a.item.name.localeCompare(b.item.name));
  for (const { item, move } of flat) {
    rows.push([
      move.date,
      item.code ?? "",
      item.name,
      move.what,
      move.number,
      String(move.quantity),
      money(move.value),
      String(move.onHand),
      money(move.worth),
    ]);
  }
  return rows.map((r) => r.map(spreadsheetCell).join(",")).join("\r\n") + "\r\n";
}
