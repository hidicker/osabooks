import { redraw } from "../app.js";
import { postedJournals, reclassify, record, saveManualJournals, stockAccounts, stockTracked } from "../books.js";
import { booksCountry, booksCurrency, booksMoney, noSalesTax } from "../country.js";
import { $, state } from "../state.js";
import { savePart } from "../store.js";
import { askOnPage, download, note, tellOnPage } from "../ui.js";
import {
  averageUnitCost,
  formatItems,
  formatStockMovementsCsv,
  formatStockValuationCsv,
  isTrackedItem,
  itemKey,
  localToday,
  lowStock,
  parseAmount,
  parseProductList,
  splitAccountLabel,
  stockAdjustment,
  stockAsAt,
  stockValue,
} from "@nzosa/core";
import type { Item, StockAdjustment, StockAdjustmentReason, StockCount, StockMove } from "@nzosa/core";

/** Products and services: a price list and tracked stock ledger. */

let editing: string | null = null;
/** The day stock is shown as at, or null for now. */
let stockDate: string | null = null;
let counting = false;

const round = (n: number): number => Math.round(n * 100) / 100;

/** A chart code for what a spreadsheet says an item uses: a code, a coding label, or a name. */
function chartCodeFor(said: string | undefined): string | undefined {
  const text = (said ?? "").trim();
  if (text === "") return undefined;
  if (state.chart.some((a) => a.code.trim() === text)) return text;
  const { code, name } = splitAccountLabel(text);
  if (code !== "" && state.chart.some((a) => a.code.trim() === code)) return code;
  const byName = state.chart.find((a) => a.name.trim().toLowerCase() === (name || text).trim().toLowerCase() && a.code.trim() !== "");
  return byName?.code.trim();
}

/**
 * Products and services from a spreadsheet: new ones added, and ones already
 * here (by name or SKU) updated with the file's price, cost, accounts, and
 * optional opening stock on hand. Asked first.
 */
async function loadItems(fileName: string, text: string): Promise<void> {
  const read = parseProductList(text, booksCurrency());
  if (read.length === 0) {
    await tellOnPage(`${fileName}: no products or services could be read. It needs a name, a type and a price or cost.`);
    return;
  }
  const byKey = new Map(held().map((i) => [itemKey(i.name), i]));
  let added = 0;
  let changed = 0;
  const next = [...held()];
  const openingToAdd: StockAdjustment[] = [];
  const today = localToday();

  for (const one of read) {
    const accountCode = chartCodeFor(one.incomeAccount);
    const expenseCode = chartCodeFor(one.expenseAccount);
    const invCode = chartCodeFor(one.inventoryAccount);
    const found = byKey.get(itemKey(one.item.name));
    const tracked = isTrackedItem(one.item);
    const merged: Item = {
      ...(found ?? { id: `item${Date.now().toString(36)}${added}` }),
      ...one.item,
      ...(accountCode !== undefined ? { accountCode } : found?.accountCode !== undefined ? { accountCode: found.accountCode } : {}),
      ...(expenseCode !== undefined
        ? tracked
          ? { cogsAccountCode: expenseCode }
          : { purchaseAccountCode: expenseCode }
        : {}),
      ...(invCode !== undefined && tracked ? { inventoryAccountCode: invCode } : {}),
    } as Item;
    if (found === undefined) {
      next.push(merged);
      added += 1;
      if (tracked && one.onHand !== undefined && one.onHand > 0) {
        openingToAdd.push({
          id: `open-${Date.now().toString(36)}-${openingToAdd.length}`,
          date: today,
          itemId: merged.id,
          quantityDelta: one.onHand,
          ...(merged.unitCost !== undefined ? { unitCost: merged.unitCost } : {}),
          reason: "opening",
          note: `Imported from ${fileName}`,
        });
      }
    } else if (JSON.stringify(merged) !== JSON.stringify(found)) {
      next[next.indexOf(found)] = merged;
      changed += 1;
    }
  }
  if (added + changed === 0) {
    await tellOnPage(`${fileName}: every product and service in it is here already, as it is.`);
    return;
  }
  const openingNote = openingToAdd.length > 0 ? `, plus opening stock for ${openingToAdd.length} tracked product${openingToAdd.length === 1 ? "" : "s"}` : "";
  if (!(await askOnPage(`${fileName}: ${added} new, and ${changed} already here would take the file's price, cost and details${openingNote}. Go ahead?`))) {
    return;
  }
  if (openingToAdd.length > 0) {
    state.ledger = {
      ...state.ledger,
      stockAdjustments: [...(state.ledger.stockAdjustments ?? []), ...openingToAdd],
    };
  }
  await keep(next, `${fileName}: ${added} products and services added, ${changed} updated`);
}

/** A product's every movement in and out, with what was on hand after each. */
function openMovements(item: Item, moves: readonly StockMove[]): void {
  const box = document.createElement("dialog");
  box.className = "ask-on-page payment-file-view";
  const heading = document.createElement("h3");
  heading.textContent = `${item.name}: movements`;
  const table = document.createElement("table");
  table.className = "report-table payment-file-table";
  table.innerHTML =
    '<thead><tr><th>Date</th><th>What</th><th>Document / Note</th><th style="text-align:right">In</th><th style="text-align:right">Out</th><th style="text-align:right">Cost</th><th style="text-align:right">On hand</th><th style="text-align:right">Worth</th></tr></thead>';
  const tbody = document.createElement("tbody");
  for (const m of [...moves].reverse()) {
    const tr = document.createElement("tr");
    for (const [text, right] of [
      [m.date, false],
      [m.what, false],
      [m.number, false],
      [m.quantity > 0 ? String(round(m.quantity)) : "", true],
      [m.quantity < 0 ? String(round(-m.quantity)) : "", true],
      [booksMoney(Math.abs(m.value)), true],
      [String(round(m.onHand)), true],
      [booksMoney(m.worth), true],
    ] as const) {
      const td = document.createElement("td");
      td.textContent = text;
      if (right) td.className = "report-amount";
      tr.append(td);
    }
    tbody.append(tr);
  }
  table.append(tbody);
  const scroll = document.createElement("div");
  scroll.className = "move-lines-scroll";
  scroll.append(table);
  const actions = document.createElement("div");
  actions.className = "ask-on-page-actions";
  const close = document.createElement("button");
  close.type = "button";
  close.className = "primary";
  close.textContent = "Close";
  actions.append(close);
  box.append(heading, scroll, actions);
  const finish = (): void => {
    box.close();
    box.remove();
  };
  close.addEventListener("click", finish);
  box.addEventListener("cancel", (event) => {
    event.preventDefault();
    finish();
  });
  document.body.append(box);
  box.showModal();
}

/** Single-item stock adjustment modal (opening stock, damage, shrinkage, write-off, internal use). */
function openAdjustModal(stocked: readonly Item[], tracked: ReturnType<typeof stockTracked>, preselectId?: string): void {
  const box = document.createElement("dialog");
  box.className = "ask-on-page";
  const h = document.createElement("h3");
  h.textContent = "Adjust stock / Opening stock";

  const field = (labelText: string, control: HTMLElement): HTMLElement => {
    const wrap = document.createElement("label");
    wrap.className = "contact-field";
    const span = document.createElement("span");
    span.textContent = labelText;
    wrap.append(span, control);
    return wrap;
  };

  const itemSel = document.createElement("select");
  for (const item of stocked) {
    const opt = document.createElement("option");
    opt.value = item.id;
    opt.textContent = item.code ? `${item.code} — ${item.name}` : item.name;
    opt.selected = item.id === preselectId;
    itemSel.append(opt);
  }

  const dateIn = document.createElement("input");
  dateIn.type = "date";
  dateIn.value = localToday();

  const reasonSel = document.createElement("select");
  for (const [val, labelText] of [
    ["opening", "Opening stock (add initial units on hand)"],
    ["damage", "Damaged stock (remove)"],
    ["shrinkage", "Shrinkage / lost (remove)"],
    ["write_off", "Write-off / expired (remove)"],
    ["internal_use", "Internal use / samples (remove)"],
    ["other", "Other adjustment (+ or -)"],
  ] as const) {
    const opt = document.createElement("option");
    opt.value = val;
    opt.textContent = labelText;
    reasonSel.append(opt);
  }

  const qtyIn = document.createElement("input");
  qtyIn.type = "number";
  qtyIn.step = "any";
  qtyIn.placeholder = "e.g. 10 or -2";

  const costIn = document.createElement("input");
  costIn.type = "text";
  costIn.inputMode = "decimal";
  costIn.placeholder = "Default: weighted average cost";

  const syncCostHint = (): void => {
    const chosen = stocked.find((i) => i.id === itemSel.value);
    if (!chosen) return;
    const avg = averageUnitCost(tracked?.onHand.get(chosen.id), chosen.unitCost);
    costIn.placeholder = avg > 0 ? `Average: ${(avg / 100).toFixed(2)}` : "0.00";
  };
  itemSel.addEventListener("change", syncCostHint);
  syncCostHint();

  const noteIn = document.createElement("input");
  noteIn.type = "text";
  noteIn.placeholder = "Optional note";

  const err = document.createElement("p");
  err.className = "cloud-said bad";

  const actions = document.createElement("div");
  actions.className = "ask-on-page-actions";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = "Cancel";
  const save = document.createElement("button");
  save.type = "button";
  save.className = "primary";
  save.textContent = "Save adjustment";
  actions.append(cancel, save);

  const finish = (): void => {
    box.close();
    box.remove();
  };
  cancel.addEventListener("click", finish);
  box.addEventListener("cancel", (e) => {
    e.preventDefault();
    finish();
  });

  save.addEventListener("click", () => {
    const rawQty = Number(qtyIn.value);
    if (!Number.isFinite(rawQty) || rawQty === 0) {
      err.textContent = "Enter a non-zero quantity (positive to add, negative to remove).";
      return;
    }
    const reason = reasonSel.value as StockAdjustmentReason;
    // Automatically negate positive entries when a removal reason is picked, so users can just type "2" for 2 damaged units.
    const removalReasons: StockAdjustmentReason[] = ["damage", "shrinkage", "write_off", "internal_use"];
    const quantityDelta = removalReasons.includes(reason) && rawQty > 0 ? -rawQty : rawQty;
    const parsedCost = costIn.value.trim() === "" ? undefined : (parseAmount(costIn.value, booksCurrency()) ?? undefined);
    if (costIn.value.trim() !== "" && parsedCost === undefined) {
      err.textContent = "Enter unit cost as a number, e.g. 12.50.";
      return;
    }
    const adj: StockAdjustment = {
      id: `adj-${Date.now().toString(36)}`,
      date: dateIn.value || localToday(),
      itemId: itemSel.value,
      quantityDelta,
      ...(parsedCost !== undefined ? { unitCost: parsedCost } : {}),
      reason,
      ...(noteIn.value.trim() !== "" ? { note: noteIn.value.trim() } : {}),
    };
    const before = state.ledger.stockAdjustments ?? [];
    const next = [...before, adj];
    state.ledger = { ...state.ledger, stockAdjustments: next };
    void savePart(state.ledger).then(async (persistent) => {
      state.persistent = persistent;
      const itemName = stocked.find((i) => i.id === adj.itemId)?.name ?? adj.itemId;
      await record("stock", `Stock adjustment (${reason}): ${itemName} (${quantityDelta > 0 ? "+" : ""}${quantityDelta})`, before, next);
      reclassify();
      finish();
      redraw("items");
    });
  });

  const formWrap = document.createElement("div");
  formWrap.className = "contact-form";
  formWrap.append(
    field("Product", itemSel),
    field("Date", dateIn),
    field("Reason", reasonSel),
    field("Quantity", qtyIn),
    field("Unit cost (before GST)", costIn),
    field("Note", noteIn),
    err,
  );
  box.append(h, formWrap, actions);
  document.body.append(box);
  box.showModal();
  qtyIn.focus();
}

const held = (): Item[] => state.ledger.items ?? [];

async function keep(next: Item[], what: string): Promise<void> {
  const before = held();
  state.ledger = { ...state.ledger, items: next };
  state.persistent = await savePart(state.ledger);
  await record("items", what, before, next);
  reclassify();
  redraw("items");
}

function incomeAccounts(): { code: string; name: string }[] {
  return state.chart
    .filter((a) => /revenue|income|sales/i.test(a.type))
    .map((a) => ({ code: a.code.trim(), name: a.name }));
}

function expenseAccounts(): { code: string; name: string }[] {
  return state.chart
    .filter((a) => /expense|direct cost|cost of (goods|sales)|overhead/i.test(a.type))
    .map((a) => ({ code: a.code.trim(), name: a.name }));
}

function inventoryAssetAccounts(): { code: string; name: string }[] {
  return state.chart
    .filter((a) => /asset|inventory/i.test(a.type))
    .map((a) => ({ code: a.code.trim(), name: a.name }));
}

function accountSelect(accounts: readonly { code: string; name: string }[], selected: string | undefined, emptyLabel: string): HTMLSelectElement {
  const sel = document.createElement("select");
  const none = document.createElement("option");
  none.value = "";
  none.textContent = emptyLabel;
  sel.append(none);
  for (const a of accounts) {
    const option = document.createElement("option");
    option.value = a.code;
    option.textContent = `${a.code} ${a.name}`;
    option.selected = selected === a.code;
    sel.append(option);
  }
  return sel;
}

function form(existing: Item | null): HTMLElement {
  const box = document.createElement("div");
  box.className = "contact-form";
  const label = (text: string, control: HTMLElement): HTMLElement => {
    const wrap = document.createElement("label");
    wrap.className = "contact-field";
    const span = document.createElement("span");
    span.textContent = text;
    wrap.append(span, control);
    return wrap;
  };
  const sku = document.createElement("input");
  sku.type = "text";
  sku.placeholder = "Optional SKU / code";
  sku.value = existing?.code ?? "";
  const name = document.createElement("input");
  name.type = "text";
  name.value = existing?.name ?? "";
  const kind = document.createElement("select");
  for (const [value, text] of [
    ["service", "Service"],
    ["product", "Product"],
  ] as const) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = text;
    option.selected = (existing?.kind ?? "service") === value;
    kind.append(option);
  }
  const trackedBox = document.createElement("input");
  trackedBox.type = "checkbox";
  trackedBox.checked = existing !== null ? isTrackedItem(existing) : false;

  const description = document.createElement("input");
  description.type = "text";
  description.value = existing?.description ?? "";
  const price = document.createElement("input");
  price.type = "text";
  price.inputMode = "decimal";
  price.value = existing?.price === undefined ? "" : (existing.price / 100).toFixed(2);
  const cost = document.createElement("input");
  cost.type = "text";
  cost.inputMode = "decimal";
  cost.placeholder = "Optional default purchase cost";
  cost.value = existing?.unitCost === undefined ? "" : (existing.unitCost / 100).toFixed(2);
  const reorder = document.createElement("input");
  reorder.type = "text";
  reorder.inputMode = "decimal";
  reorder.placeholder = "None";
  reorder.value = existing?.reorderAt === undefined ? "" : String(existing.reorderAt);

  const account = accountSelect(incomeAccounts(), existing?.accountCode, "Not set");
  const purchaseAccount = accountSelect(expenseAccounts(), existing?.purchaseAccountCode, "Not set");
  const invAccount = accountSelect(inventoryAssetAccounts(), existing?.inventoryAccountCode, "Default Inventory account");
  const cogsAccount = accountSelect(expenseAccounts(), existing?.cogsAccountCode, "Default COGS account");

  const trackedWrap = label("Track stock on hand (perpetual inventory & auto COGS)", trackedBox);
  const reorderWrap = label("Reorder when this many or fewer are on hand", reorder);
  const purchaseWrap = label("Purchase coded to (for untracked items on bills)", purchaseAccount);
  const invWrap = label("Inventory asset account (optional override)", invAccount);
  const cogsWrap = label("Cost of Goods Sold account (optional override)", cogsAccount);

  const syncVisibility = (): void => {
    const isProd = kind.value === "product";
    const isTracked = isProd && trackedBox.checked;
    trackedWrap.hidden = !isProd;
    reorderWrap.hidden = !isTracked;
    invWrap.hidden = !isTracked;
    cogsWrap.hidden = !isTracked;
    purchaseWrap.hidden = isTracked;
  };
  kind.addEventListener("change", syncVisibility);
  trackedBox.addEventListener("change", syncVisibility);
  syncVisibility();

  // United States sales tax is charged on a line only where it is taxable.
  const taxable = document.createElement("input");
  taxable.type = "checkbox";
  taxable.checked = existing?.taxable !== false;
  const problem = document.createElement("p");
  problem.className = "cloud-said";
  const save = document.createElement("button");
  save.type = "button";
  save.className = "primary";
  save.textContent = existing === null ? "Add" : "Save";
  save.addEventListener("click", () => {
    const said = name.value.trim();
    if (said === "") {
      problem.textContent = "A name, as it will be written on an invoice line.";
      return;
    }
    if (held().some((i) => itemKey(i.name) === itemKey(said) && i.id !== existing?.id)) {
      problem.textContent = `${said} is already here.`;
      return;
    }
    const cleanSku = sku.value.trim();
    if (cleanSku !== "" && held().some((i) => i.code !== undefined && itemKey(i.code) === itemKey(cleanSku) && i.id !== existing?.id)) {
      problem.textContent = `SKU ${cleanSku} is already used by another item.`;
      return;
    }
    const cents = price.value.trim() === "" ? null : parseAmount(price.value, booksCurrency());
    if (cents === null && price.value.trim() !== "") {
      problem.textContent = "A price as a number, such as 49.50.";
      return;
    }
    const unit = cost.value.trim() === "" ? null : parseAmount(cost.value, booksCurrency());
    if (unit === null && cost.value.trim() !== "") {
      problem.textContent = "A cost as a number, such as 4.50.";
      return;
    }
    const reorderAt = reorder.value.trim() === "" ? null : Number(reorder.value.trim());
    if (reorderAt !== null && (!Number.isFinite(reorderAt) || reorderAt < 0)) {
      problem.textContent = "A reorder point as a number of units, such as 10.";
      return;
    }
    const isProd = kind.value === "product";
    const tracked = isProd && trackedBox.checked;
    const fields: Omit<Item, "id"> = {
      ...(cleanSku !== "" ? { code: cleanSku } : {}),
      name: said,
      kind: kind.value as Item["kind"],
      ...(isProd ? { tracked } : {}),
      ...(unit !== null ? { unitCost: unit } : {}),
      ...(reorderAt !== null && tracked ? { reorderAt } : {}),
      ...(description.value.trim() !== "" ? { description: description.value.trim() } : {}),
      ...(cents !== null ? { price: cents } : {}),
      ...(account.value !== "" ? { accountCode: account.value } : {}),
      ...(!tracked && purchaseAccount.value !== "" ? { purchaseAccountCode: purchaseAccount.value } : {}),
      ...(tracked && invAccount.value !== "" ? { inventoryAccountCode: invAccount.value } : {}),
      ...(tracked && cogsAccount.value !== "" ? { cogsAccountCode: cogsAccount.value } : {}),
      ...(booksCountry().id === "us" && !taxable.checked ? { taxable: false } : {}),
    };
    editing = null;
    if (existing === null) {
      const id = `item-${Date.now().toString(36)}`;
      void keep([...held(), { id, ...fields }], `Added ${said}`);
    } else {
      void keep(
        held().map((i) =>
          i.id === existing.id ? { id: i.id, ...(i.active === false ? { active: false } : {}), ...fields } : i,
        ),
        `Changed ${said}`,
      );
    }
  });
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", () => {
    editing = null;
    redraw("items");
  });
  const row = document.createElement("div");
  row.className = "migration-actions";
  row.append(save, cancel);
  box.append(
    label("SKU / Code", sku),
    label("Name", name),
    label("Product or service", kind),
    trackedWrap,
    label("Line description", description),
    label(noSalesTax() ? "Usual price" : "Usual price, including GST", price),
    label("Sale coded to", account),
    ...(booksCountry().id === "us" ? [label("Charged sales tax", taxable)] : []),
    label(noSalesTax() ? "Default purchase / unit cost" : "Default purchase / unit cost (before GST)", cost),
    purchaseWrap,
    invWrap,
    cogsWrap,
    reorderWrap,
    problem,
    row,
  );
  return box;
}

export function renderItems(): void {
  const body = $("items-body");
  body.textContent = "";
  const add = document.createElement("button");
  add.type = "button";
  add.className = "primary";
  add.textContent = "New product or service";
  add.addEventListener("click", () => {
    editing = "new";
    redraw("items");
  });
  // The whole list as a spreadsheet, and one brought back in.
  const save = document.createElement("button");
  save.type = "button";
  save.textContent = "Download (CSV)";
  save.disabled = held().length === 0;
  save.addEventListener("click", () => download(formatItems(held()), "products-and-services.csv", "text/csv"));
  const load = document.createElement("button");
  load.type = "button";
  load.textContent = "Load from a spreadsheet…";
  load.title = "A list with a name, a type and a price: this app's download, or QuickBooks' or SlowBooks' products and services";
  const picker = document.createElement("input");
  picker.type = "file";
  picker.accept = ".csv,text/csv";
  picker.hidden = true;
  load.addEventListener("click", () => picker.click());
  picker.addEventListener("change", () => {
    const file = picker.files?.[0];
    picker.value = "";
    if (file !== undefined) void file.text().then((text) => loadItems(file.name, text));
  });
  body.append(add, " ", save, " ", load, picker);
  if (editing === "new") body.append(form(null));
  if (held().length === 0 && editing !== "new") {
    body.append(note("No products or services yet."));
    return;
  }
  const table = document.createElement("table");
  table.className = "report-table owner-table";
  table.innerHTML = "<thead><tr><th>SKU</th><th>Name</th><th>Type</th><th>Price</th><th>Sale account</th><th></th></tr></thead>";
  const tbody = document.createElement("tbody");
  const names = new Map(incomeAccounts().map((a) => [a.code, a.name]));
  for (const item of [...held()].sort((a, b) => a.name.localeCompare(b.name))) {
    const tr = document.createElement("tr");
    if (item.active === false) tr.className = "event-reverted";
    const kindLabel = item.kind === "service" ? "Service" : isTrackedItem(item) ? "Product (tracked)" : "Product";
    for (const [text, cls] of [
      [item.code ?? "", "report-name"],
      [item.name, "report-name"],
      [kindLabel, "report-name"],
      [item.price === undefined ? "" : booksMoney(item.price), "report-amount"],
      [
        item.accountCode === undefined ? "" : `${item.accountCode} ${names.get(item.accountCode) ?? ""}`.trim(),
        "report-name",
      ],
    ] as const) {
      const td = document.createElement("td");
      td.className = cls;
      td.textContent = text;
      tr.append(td);
    }
    const actions = document.createElement("td");
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "small";
    edit.textContent = "Edit";
    edit.addEventListener("click", () => {
      editing = item.id;
      redraw("items");
    });
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "small";
    toggle.textContent = item.active === false ? "Make active" : "Make inactive";
    toggle.addEventListener("click", () => {
      void keep(
        held().map((i) => (i.id === item.id ? { ...i, active: i.active === false } : i)),
        `${item.name} made ${item.active === false ? "active" : "inactive"}`,
      );
    });
    actions.append(edit, toggle);
    tr.append(actions);
    tbody.append(tr);
    if (editing === item.id) {
      const editor = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = 6;
      cell.append(form(item));
      editor.append(cell);
      tbody.append(editor);
    }
  }
  table.append(tbody);
  const scroller = document.createElement("div");
  scroller.className = "table-scroll";
  scroller.append(table);
  body.append(scroller);
  stockSection(body);
}

/** What the books hold in an account at the end of a day. */
function bookedAt(code: string, date: string): number {
  const opening = state.ledger.openingBalances;
  let sum = opening !== undefined && opening.asAt <= date ? (opening.accounts[code] ?? 0) : 0;
  for (const journal of postedJournals()) {
    if (journal.date > date || (opening !== undefined && journal.date <= opening.asAt)) continue;
    for (const line of journal.lines) if (line.accountCode.trim() === code) sum += line.amount;
  }
  return sum;
}

/**
 * Stock: tracked products on hand, weighted-average valuation, single-item
 * adjustments, GL reconciliation check, CSV exports, and periodic stock counts.
 */
function stockSection(body: HTMLElement): void {
  const stocked = held().filter((i) => isTrackedItem(i) && i.active !== false);
  const title = document.createElement("h3");
  title.textContent = "Stock";
  body.append(title);
  if (stocked.length === 0) {
    body.append(note('Tick "Track stock on hand" on a product to track inventory, movements, and automatic COGS here.'));
    return;
  }
  const tracked = stockTracked();
  const now = localToday();
  const asAtDate = stockDate ?? now;

  if (tracked !== null) {
    const low = lowStock(stocked, tracked.onHand);
    if (low.length > 0) {
      const warn = document.createElement("p");
      warn.className = "variance-note warn";
      warn.textContent =
        `Low on ${low.length === 1 ? "one product" : `${low.length} products`}: ` +
        low.map((x) => `${x.item.name} (${round(x.onHand)} on hand, reorder at ${round(x.reorderAt)})`).join("; ") +
        ".";
      body.append(warn);
    }
    const asAtWrap = document.createElement("label");
    asAtWrap.className = "stock-as-at";
    const asAt = document.createElement("input");
    asAt.type = "date";
    asAt.value = asAtDate;
    asAt.max = now;
    asAt.addEventListener("change", () => {
      stockDate = asAt.value === "" || asAt.value >= now ? null : asAt.value;
      redraw("items");
    });
    asAtWrap.append(Object.assign(document.createElement("span"), { textContent: "Stock on hand as at" }), asAt);
    body.append(asAtWrap);

    const shown = stockDate === null ? tracked.onHand : stockAsAt(tracked.history, stockDate);
    const table = document.createElement("table");
    table.className = "report-table owner-table";
    table.innerHTML = "<thead><tr><th>SKU</th><th>Product</th><th>On hand</th><th>Reorder at</th><th>Average cost</th><th>Value</th><th></th></tr></thead>";
    const tbody = document.createElement("tbody");
    let total = 0;
    for (const item of stocked) {
      const itemHeld = shown.get(item.id) ?? { quantity: 0, value: 0 };
      total += itemHeld.value;
      const tr = document.createElement("tr");
      if (stockDate === null && item.reorderAt !== undefined && itemHeld.quantity <= item.reorderAt) tr.className = "stock-low";
      for (const [text, cls] of [
        [item.code ?? "", "report-name"],
        [item.name, "report-name"],
        [String(round(itemHeld.quantity)), "report-amount"],
        [item.reorderAt === undefined ? "" : String(round(item.reorderAt)), "report-amount"],
        [booksMoney(averageUnitCost(itemHeld, item.unitCost)), "report-amount"],
        [booksMoney(itemHeld.value), "report-amount"],
      ] as const) {
        const td = document.createElement("td");
        td.className = cls;
        td.textContent = text;
        tr.append(td);
      }
      const cell = document.createElement("td");
      cell.style.whiteSpace = "nowrap";
      const moves = document.createElement("button");
      moves.type = "button";
      moves.className = "small";
      moves.textContent = "Movements";
      moves.disabled = (tracked.history.get(item.id) ?? []).length === 0;
      moves.addEventListener("click", () => openMovements(item, tracked.history.get(item.id) ?? []));
      const adjBtn = document.createElement("button");
      adjBtn.type = "button";
      adjBtn.className = "small";
      adjBtn.style.marginLeft = "4px";
      adjBtn.textContent = "Adjust";
      adjBtn.addEventListener("click", () => openAdjustModal(stocked, tracked, item.id));
      cell.append(moves, adjBtn);
      tr.append(cell);
      tbody.append(tr);
    }
    const foot = document.createElement("tr");
    foot.className = "report-total";
    foot.innerHTML = '<td class="report-name" colspan="2">Total</td><td></td><td></td><td></td>';
    const sum = document.createElement("td");
    sum.className = "report-amount";
    sum.textContent = booksMoney(total);
    foot.append(sum, document.createElement("td"));
    tbody.append(foot);
    table.append(tbody);
    body.append(table);

    // GL vs. Stock-on-hand reconciliation check (when all items use the default inventory account).
    const { inventory, cost } = stockAccounts();
    const usesCustomInv = stocked.some((i) => i.inventoryAccountCode);
    if (inventory !== undefined && !usesCustomInv) {
      const glBal = bookedAt(inventory.code, asAtDate);
      const diff = total - glBal;
      if (Math.abs(diff) > 1) {
        const rec = document.createElement("p");
        rec.className = "variance-note warn";
        rec.textContent =
          `Stock reconciliation: tracked stock is ${booksMoney(total)} as at ${asAtDate}, while ` +
          `${inventory.code} ${inventory.name} on the Balance Sheet is ${booksMoney(glBal)} ` +
          `(difference ${booksMoney(diff)}). This usually means an earlier bill/journal was coded directly to Inventory, ` +
          `or a past stock count needs updating.`;
        body.append(rec);
      }
    }

    body.append(
      note(
        inventory === undefined || cost === undefined
          ? "Add an Inventory asset account and a cost of goods sold account to post the cost of what is sold."
          : `Bought on a bill line with the product's name or SKU: into ${inventory.code} ${inventory.name}. ` +
              `Sold on an invoice line: its cost moves to ${cost.code} ${cost.name} on the invoice's date, at the weighted-average cost.`,
      ),
    );
  }

  const counts = state.ledger.stockCounts ?? [];
  const last = [...counts].sort((a, b) => a.date.localeCompare(b.date)).pop();
  if (last !== undefined) {
    body.append(note(`Last counted ${last.date}: ${booksMoney(stockValue(last))} on hand${last.journalId === undefined ? ", not posted" : ""}.`));
  }

  const actionRow = document.createElement("div");
  actionRow.className = "migration-actions";
  const start = document.createElement("button");
  start.type = "button";
  start.className = "primary";
  start.textContent = "Count stock";
  start.hidden = counting;
  start.addEventListener("click", () => {
    counting = true;
    redraw("items");
  });
  const adjustAll = document.createElement("button");
  adjustAll.type = "button";
  adjustAll.textContent = "Adjust stock / Opening stock";
  adjustAll.addEventListener("click", () => openAdjustModal(stocked, tracked));

  actionRow.append(start, adjustAll);
  if (tracked !== null) {
    const shown = stockDate === null ? tracked.onHand : stockAsAt(tracked.history, stockDate);
    const expVal = document.createElement("button");
    expVal.type = "button";
    expVal.textContent = "Export valuation (CSV)";
    expVal.addEventListener("click", () =>
      download(formatStockValuationCsv(stocked, shown, asAtDate), `stock-valuation-${asAtDate}.csv`, "text/csv"),
    );
    const expMov = document.createElement("button");
    expMov.type = "button";
    expMov.textContent = "Export movements (CSV)";
    expMov.addEventListener("click", () =>
      download(formatStockMovementsCsv(stocked, tracked.history), `stock-movements-${asAtDate}.csv`, "text/csv"),
    );
    actionRow.append(expVal, expMov);
  }
  body.append(actionRow);
  if (!counting) return;

  const { inventory, cost } = stockAccounts();
  const box = document.createElement("div");
  box.className = "contact-form";
  const date = document.createElement("input");
  date.type = "date";
  date.value = localToday();
  const dateLabel = document.createElement("label");
  dateLabel.className = "contact-field";
  dateLabel.append(Object.assign(document.createElement("span"), { textContent: "Counted on" }), date);
  box.append(dateLabel);
  const table = document.createElement("table");
  table.className = "report-table owner-table";
  table.innerHTML = "<thead><tr><th>Product</th><th>Avg unit cost</th><th>Counted</th><th>Value</th></tr></thead>";
  const tbody = document.createElement("tbody");
  const boxes: { item: Item; unitCost: number; input: HTMLInputElement; value: HTMLTableCellElement }[] = [];
  const before = new Map((last?.lines ?? []).map((l) => [l.itemId, l.quantity]));
  for (const item of stocked) {
    // Use current weighted-average cost (falling back to item.unitCost) so counts don't unexpectedly revalue stock.
    const avgCost = averageUnitCost(tracked?.onHand.get(item.id), item.unitCost);
    const tr = document.createElement("tr");
    const name = document.createElement("td");
    name.className = "report-name";
    name.textContent = item.name;
    const unit = document.createElement("td");
    unit.className = "report-amount";
    unit.textContent = booksMoney(avgCost);
    const cell = document.createElement("td");
    const input = document.createElement("input");
    input.type = "text";
    input.inputMode = "decimal";
    const currentQty = tracked?.onHand.get(item.id)?.quantity ?? before.get(item.id) ?? 0;
    input.placeholder = String(round(currentQty));
    cell.append(input);
    const value = document.createElement("td");
    value.className = "report-amount";
    tr.append(name, unit, cell, value);
    tbody.append(tr);
    boxes.push({ item, unitCost: avgCost, input, value });
  }
  table.append(tbody);
  box.append(table);
  const said = document.createElement("p");
  said.className = "page-hint";
  box.append(said);
  const problem = document.createElement("p");
  problem.className = "cloud-said";
  box.append(problem);

  const lines = (): StockCount["lines"] | null => {
    const out: StockCount["lines"] = [];
    for (const { item, unitCost, input } of boxes) {
      const text = input.value.trim() === "" ? input.placeholder : input.value.trim();
      const quantity = Number(text.replace(",", "."));
      if (!Number.isFinite(quantity) || quantity < 0) return null;
      out.push({ itemId: item.id, quantity, unitCost });
    }
    return out;
  };
  const refresh = (): void => {
    const read = lines();
    for (const { unitCost, input, value } of boxes) {
      const q = Number((input.value.trim() === "" ? input.placeholder : input.value).replace(",", "."));
      value.textContent = Number.isFinite(q) ? booksMoney(Math.round(q * unitCost)) : "";
    }
    if (read === null) {
      said.textContent = "";
      return;
    }
    const counted = stockValue({ lines: read });
    said.textContent =
      inventory === undefined
        ? `Counted ${booksMoney(counted)}.`
        : `Counted ${booksMoney(counted)}. ${inventory.code} ${inventory.name} holds ${booksMoney(bookedAt(inventory.code, date.value))} on that day.`;
  };
  for (const { input } of boxes) input.addEventListener("input", refresh);
  date.addEventListener("change", refresh);
  refresh();

  const post = document.createElement("button");
  post.type = "button";
  post.className = "primary";
  post.textContent = "Save the count and post it";
  post.title = "Put the inventory account to the counted value, the difference to cost of goods sold.";
  post.addEventListener("click", () => {
    const read = lines();
    if (read === null) {
      problem.textContent = "Each count as a number, such as 12.";
      return;
    }
    if (inventory === undefined || cost === undefined) {
      problem.textContent =
        "Add an Inventory asset account and a cost of goods sold account on Entities & accounts first.";
      return;
    }
    void (async () => {
      const count: StockCount = { id: `count-${Date.now().toString(36)}`, date: date.value, lines: read };
      const counted = stockValue(count);
      const booked = bookedAt(inventory.code, date.value);
      const adjust = stockAdjustment(counted, booked, `${inventory.name} - ${inventory.code}`, `${cost.name} - ${cost.code}`);
      if (adjust.length > 0) {
        const journal = {
          id: `stock-${count.id}`,
          date: count.date,
          narration: `Stock count ${count.date}: ${booksMoney(counted)} on hand`,
          lines: adjust,
          source: "Stock count",
        };
        await saveManualJournals([...(state.ledger.manualJournals ?? []), journal], `Stock count ${count.date}`);
        count.journalId = journal.id;
      }
      const before = state.ledger.stockCounts ?? [];
      const next = [...before, count];
      state.ledger = { ...state.ledger, stockCounts: next };
      state.persistent = await savePart(state.ledger);
      await record("stock", `Stock counted ${count.date}: ${booksMoney(counted)}`, before, next);
      counting = false;
      redraw("items");
    })();
  });
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", () => {
    counting = false;
    redraw("items");
  });
  const row = document.createElement("div");
  row.className = "migration-actions";
  row.append(post, cancel);
  box.append(row);
  body.append(box);
}
