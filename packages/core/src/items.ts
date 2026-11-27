import type { Cents } from "./money.js";

/**
 * Products and services: what is sold, kept as a list so an invoice line can
 * be filled in from a name. Looked up by name; nothing is posted from them.
 */
export interface Item {
  id: string;
  /** Optional SKU / product code for fast lookup and reporting. */
  code?: string;
  name: string;
  kind: "service" | "product";
  /** What a line says, if not the name. */
  description?: string;
  /** The usual price in cents. */
  price?: Cents;
  /** The chart code a sale of it is coded to. */
  accountCode?: string;
  /** The chart code a purchase of an untracked item is coded to. */
  purchaseAccountCode?: string;
  /** Optional per-item Inventory Asset account code override (for multi-entity or category-specific stock). */
  inventoryAccountCode?: string;
  /** Optional per-item Cost of Goods Sold account code override. */
  cogsAccountCode?: string;
  active?: boolean;
  /** Explicit stock tracking toggle. When omitted, defaults to true for products that have a unitCost. */
  tracked?: boolean;
  /** Default purchase / fallback unit cost in cents. */
  unitCost?: Cents;
  /** A stocked product's reorder point: at or below this many on hand, it is low. */
  reorderAt?: number;
  /** Charged sales tax where the invoice has a rate (United States); taxable unless false. */
  taxable?: boolean;
}

/** Whether an item is kept in perpetual/periodic stock tracking. */
export function isTrackedItem(item: Pick<Item, "kind" | "unitCost" | "tracked">): boolean {
  if (item.kind !== "product") return false;
  if (item.tracked !== undefined) return item.tracked;
  return item.unitCost !== undefined;
}

export function itemKey(name: string): string {
  return name.toLowerCase().replace(/\s+/g, " ").trim();
}

/** The item a line's words name, by SKU code or name, ignoring case and spacing. */
export function findItem(items: readonly Item[], words: string): Item | undefined {
  const key = itemKey(words);
  if (key === "") return undefined;
  return items.find(
    (i) =>
      i.active !== false &&
      (itemKey(i.name) === key || (i.code !== undefined && itemKey(i.code) === key)),
  );
}
