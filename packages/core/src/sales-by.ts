import type { Cents } from "./money.js";
import type { IsoDate } from "./dates.js";
import type { Invoice } from "./invoices.js";
import { isCreditNote, isPosted } from "./invoices.js";
import { contactKey } from "./contacts.js";
import type { StockItemLike, StockMove } from "./stock.js";

/**
 * Sales, totalled: by customer, or by what was sold.
 *
 * From the sales invoices in the books -- posted, dated in the period -- with
 * credit notes taken off, so a customer's figure is what they were charged
 * less what was given back. Before tax, as income is reported; the tax beside
 * it. A line with no product named is grouped by its description.
 */

export interface SalesRow {
  name: string;
  /** Invoices and credit notes, or lines, it came from. */
  count: number;
  /** Units sold, where the lines say. */
  quantity: number;
  net: Cents;
  tax: Cents;
}

export interface SalesBy {
  rows: SalesRow[];
  net: Cents;
  tax: Cents;
}

export function salesBy(
  invoices: readonly Invoice[],
  period: { from: IsoDate; to: IsoDate },
  by: "customer" | "item",
  itemName: (code: string) => string | undefined = () => undefined,
): SalesBy {
  const groups = new Map<string, SalesRow>();
  const add = (key: string, name: string, quantity: number, net: Cents, tax: Cents): void => {
    const row = groups.get(key) ?? { name, count: 0, quantity: 0, net: 0, tax: 0 };
    row.count += 1;
    row.quantity += quantity;
    row.net += net;
    row.tax += tax;
    groups.set(key, row);
  };
  for (const invoice of invoices) {
    if (invoice.kind !== "sales" || !isPosted(invoice)) continue;
    if (invoice.issued < period.from || invoice.issued > period.to) continue;
    // A credit note gives back: whatever sign its lines were written with.
    const sign = isCreditNote(invoice) ? -1 : 1;
    if (by === "customer") {
      const net = invoice.lines.reduce((s, l) => s + Math.abs(l.net), 0) * sign;
      const tax = invoice.lines.reduce((s, l) => s + Math.abs(l.tax), 0) * sign;
      const name = invoice.contact.trim() || "(no customer)";
      add(contactKey(name), name, 0, net, tax);
      continue;
    }
    for (const line of invoice.lines) {
      if (line.net === 0 && line.tax === 0) continue;
      const named = line.itemCode !== undefined ? (itemName(line.itemCode) ?? line.itemCode) : undefined;
      const name = (named ?? line.description).trim() || "(no description)";
      add(name.toLowerCase(), name, (line.quantity ?? 0) * sign, Math.abs(line.net) * sign, Math.abs(line.tax) * sign);
    }
  }
  const rows = [...groups.values()].filter((r) => r.net !== 0 || r.tax !== 0).sort((a, b) => b.net - a.net || a.name.localeCompare(b.name));
  return { rows, net: rows.reduce((s, r) => s + r.net, 0), tax: rows.reduce((s, r) => s + r.tax, 0) };
}

export interface GrossMarginRow {
  itemId: string;
  code: string;
  name: string;
  quantity: number;
  salesNet: Cents;
  cogs: Cents;
  grossProfit: Cents;
  marginPercent: number | null;
}

export interface GrossMarginReport {
  rows: GrossMarginRow[];
  salesNet: Cents;
  cogs: Cents;
  grossProfit: Cents;
  marginPercent: number | null;
}

/**
 * Gross margin by item for a period: pairs posted sales revenue & qty sold
 * with exact perpetual COGS from stock movements (Sold / Returned) in the same period.
 */
export function grossMarginByItem(
  invoices: readonly Invoice[],
  items: readonly StockItemLike[],
  history: ReadonlyMap<string, readonly StockMove[]>,
  period: { from: IsoDate; to: IsoDate },
): GrossMarginReport {
  const byId = new Map(items.map((i) => [i.id, i]));
  const matchItem = (code: string | undefined): StockItemLike | undefined => {
    if (!code) return undefined;
    const key = code.trim().toLowerCase();
    return items.find(
      (i) => i.id === code || (i.code && i.code.trim().toLowerCase() === key) || i.name.trim().toLowerCase() === key,
    );
  };

  const groups = new Map<string, { itemId: string; code: string; name: string; quantity: number; salesNet: number; cogs: number }>();
  const ensure = (key: string, itemId: string, code: string, name: string) => {
    let row = groups.get(key);
    if (!row) {
      row = { itemId, code, name, quantity: 0, salesNet: 0, cogs: 0 };
      groups.set(key, row);
    }
    return row;
  };

  for (const invoice of invoices) {
    if (invoice.kind !== "sales" || !isPosted(invoice)) continue;
    if (invoice.issued < period.from || invoice.issued > period.to) continue;
    const sign = isCreditNote(invoice) ? -1 : 1;
    for (const line of invoice.lines) {
      if (line.net === 0 && line.tax === 0) continue;
      const item = matchItem(line.itemCode);
      const key = item ? item.id : (line.description.trim().toLowerCase() || "(no description)");
      const row = ensure(key, item?.id ?? "", item?.code ?? "", item?.name ?? (line.description.trim() || "(no description)"));
      row.quantity += (line.quantity ?? 1) * sign;
      row.salesNet += Math.abs(line.net) * sign;
    }
  }

  for (const [id, moves] of history) {
    const item = byId.get(id);
    if (!item) continue;
    for (const move of moves) {
      if (move.date < period.from || move.date > period.to) continue;
      if (move.what !== "Sold" && move.what !== "Returned") continue;
      const row = ensure(item.id, item.id, item.code ?? "", item.name);
      // Sold has negative value change (-cost), Returned has positive value change (+cost).
      row.cogs += -move.value;
    }
  }

  const rows: GrossMarginRow[] = [...groups.values()]
    .filter((r) => r.salesNet !== 0 || r.cogs !== 0)
    .map((r) => {
      const grossProfit = (r.salesNet - r.cogs) as Cents;
      const marginPercent = r.salesNet !== 0 ? Math.round((grossProfit / r.salesNet) * 1000) / 10 : null;
      return {
        itemId: r.itemId,
        code: r.code,
        name: r.name,
        quantity: r.quantity,
        salesNet: r.salesNet as Cents,
        cogs: r.cogs as Cents,
        grossProfit,
        marginPercent,
      };
    })
    .sort((a, b) => b.grossProfit - a.grossProfit || a.name.localeCompare(b.name));

  const salesNet = rows.reduce((s, r) => s + r.salesNet, 0) as Cents;
  const cogs = rows.reduce((s, r) => s + r.cogs, 0) as Cents;
  const grossProfit = (salesNet - cogs) as Cents;
  const marginPercent = salesNet !== 0 ? Math.round((grossProfit / salesNet) * 1000) / 10 : null;
  return { rows, salesNet, cogs, grossProfit, marginPercent };
}
