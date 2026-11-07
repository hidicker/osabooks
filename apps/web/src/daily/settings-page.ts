import { redraw, showPage } from "../app.js";
import { record } from "../books.js";
import { applyCountryRules, booksCountry, countryTimeZone, countryTimeZones } from "../country.js";
import { moduleOn } from "../modules.js";
import type { ModuleId } from "../modules.js";
import { $, state } from "../state.js";
import { save as saveLedger } from "../store.js";
import type { BookSettings } from "../store.js";
import { note } from "../ui.js";

/**
 * Settings: every setting these books have, in one place, grouped as an
 * accountant would look for them. Most live on the page they belong to; this
 * opens that page. The few with no other home are set here.
 */

type Where = { page: string; label: string; module?: ModuleId };
type Row = { name: string; what: string; where?: Where[]; status?: "here" | "missing" | "elsewhere" };

export { bookSettings } from "../book-settings.js";
import { bookSettings } from "../book-settings.js";

async function saveSettings(next: BookSettings, what: string): Promise<void> {
  const before = bookSettings();
  state.ledger = { ...state.ledger, settings: next };
  state.persistent = await saveLedger(state.ledger);
  await record("settings", what, before, next);
  // The time zone is taken up at once: today is where the books are kept.
  applyCountryRules();
  redraw("settings");
}

/** Set the reports' basis to the one chosen here, as the books open. */
export function applyReportDefaults(): void {
  const basis = bookSettings().reportBasis;
  const select = document.getElementById("report-basis");
  if (basis !== undefined && select instanceof HTMLSelectElement) select.value = basis;
}

function groups(): { title: string; rows: Row[] }[] {
  const country = booksCountry();
  const nz = country.id === "nz";
  const tax = country.salesTax?.name ?? "sales tax";
  return [
    {
      title: "General",
      rows: [
        {
          name: "Organisation details",
          what: `Each entity's name and legal name, ${nz ? "GST number, NZBN" : "tax number"}, address, phone, email, website, bank account for payments, and logo, as invoices show them.`,
          where: [{ page: "entities", label: "Entities & accounts" }],
        },
        {
          name: "Country and year end",
          what: `Kept in ${country.id === "us" ? "the " : ""}${country.name}: year to ${country.yearEnd.endDay}/${country.yearEnd.endMonth}, ${country.currency}. The country decides the tax year and the returns.`,
          where: [{ page: "setup", label: "Setup" }],
        },
        {
          name: "Users",
          what: "Online books can be shared: invite an accountant to them. Books kept in this browser are yours alone.",
          where: [{ page: "books", label: "Books" }],
        },
        {
          name: "Connected apps",
          what: "Bank feeds, and the AI connector for Claude and others.",
          where: [{ page: "import", label: "Bank import" }, { page: "connector", label: "AI connector" }],
        },
        {
          name: "Email settings",
          what: "What the invoice, statement and reminder emails say. They are sent from your own email program, so its name and reply address are yours.",
          where: [{ page: "contacts", label: "Customers & vendors", module: "contacts" }],
        },
        { name: "Modules", what: "Which parts of the app these books use.", where: [{ page: "apps", label: "Modules" }] },
      ],
    },
    {
      title: "Sales and purchases",
      rows: [
        { name: "Default due dates", what: "When a new invoice or bill falls due, and how long a quote stays open, unless you change it.", status: "here" },
        {
          name: "Numbering",
          what: "Each new invoice or bill takes the next number of its series. Left as they are, invoices run INV-0001 on and bills BILL-0001 on. Quotes and credit notes follow the invoices.",
          status: "here",
        },
        {
          name: "Invoice look",
          what: "The entity's logo and details head every invoice, statement and reminder, in the colour chosen here. Templates of your own design are not offered.",
          status: "here",
          where: [{ page: "entities", label: "Entities & accounts" }],
        },
        {
          name: "Reminders and late fees",
          what: "Statements and reminders to overdue customers, and late fees, made when you choose. Sending them on a schedule by itself is not offered: nothing here sends email.",
          where: [{ page: "contacts", label: "Customers & vendors", module: "contacts" }],
        },
        {
          name: "Online payments",
          what: "Online books connected to Stripe give each invoice a card payment link, and find the payments when they arrive. Books kept in this browser show the bank account to pay into. PayPal is not offered.",
          where: [{ page: "invoices", label: "Invoices", module: "business" }],
        },
        {
          name: "Paying bills",
          what: "A bank payment file for the bills due, to load into internet banking.",
          where: [{ page: "bills", label: "Bills", module: "business" }],
        },
      ],
    },
    {
      title: "Reporting",
      rows: [
        { name: "Reports' basis", what: "Which basis the reports open on.", status: "here" },
        {
          name: "Display",
          what: "How the profit and loss, the balance sheet and the trial balance are set out.",
          status: "here",
        },
      ],
    },
    {
      title: "Accounting",
      rows: [
        {
          name: "Chart of accounts",
          what: "The accounts, each with its type, its tax treatment and its entity.",
          where: [{ page: "entities", label: "Entities & accounts" }],
        },
        {
          name: "Lock dates",
          what: "Lock the books up to a date, so filed periods stay as they were filed.",
          where: [{ page: "setup", label: "Setup" }],
        },
        {
          name: "Opening balances",
          what: "The position on the day these books start.",
          where: [{ page: "opening", label: "Opening balances" }],
        },
        {
          name: "Currencies",
          what: "Other currencies, their rates, and the gains and losses accounts.",
          where: [{ page: "currencies", label: "Currencies", module: "currencies" }],
        },
        {
          name: "Tracking",
          what: "Classes and jobs, to cut the profit and loss another way.",
          where: [{ page: "classes", label: "Classes", module: "classes" }, { page: "jobs", label: "Jobs", module: "jobs" }],
        },
        {
          name: "Fixed asset types",
          what: "An asset's type is its fixed asset account. Each type's depreciation goes to the account chosen here; left as it is, to the Depreciation account of the asset's own entity. The rate and method are set on each asset.",
          status: "here",
          where: [{ page: "assets", label: "Fixed assets", module: "assets" }],
        },
        {
          name: "Rules",
          what: "How bank lines are coded, and how money between entities is recorded.",
          where: [{ page: "rules", label: "Rules" }],
        },
        {
          name: "Time zone",
          what: "Where today is for these books: the date new invoices, pay runs and entries start on, and the year in progress.",
          status: "here",
        },
        {
          name: "Exporting",
          what: "A backup of everything, and the reports as CSV or Excel.",
          where: [{ page: "books", label: "Books" }, { page: "reports", label: "Reports" }],
        },
      ],
    },
    {
      title: "Tax",
      rows: [
        {
          name: `${tax === "VAT" ? "VAT" : tax === "GST" ? "GST" : "Sales tax"} registration`,
          what: country.salesTax === null
            ? "Sales tax rates are set for each place you collect it, on the sales tax report."
            : `Each entity's registration, how often it files, and${country.id === "au" ? " cash or accruals" : nz ? " the payments or invoice basis, and a provisional tax ratio where paid with the GST return (GST103)" : " its basis"}. The rate is the country's: ${Math.round(country.salesTax.rate * 100)}%.`,
          where: country.salesTax === null
            ? [{ page: "reports", label: "Reports" }]
            : [{ page: "entities", label: "Entities & accounts" }],
        },
        ...(country.id === "au"
          ? [{
              name: "PAYG instalments and other taxes",
              what: "PAYG withholding comes from payroll, and PAYG instalments are on the BAS. Fuel tax credits, FBT and wine or luxury car tax are not.",
              status: "missing" as const,
            }]
          : []),
      ],
    },
    {
      title: "Payroll",
      rows: [
        {
          name: "Payroll settings",
          what: nz
            ? "The employer's IRD number and size (how soon each payday is filed), the accounts pay runs post to, each employee's pay frequency, pay items, leave and public holidays."
            : "The accounts pay runs post to, each employee's pay frequency, pay items and leave.",
          where: country.id === "au"
            ? [{ page: "aupayroll", label: "Payroll", module: "aupayroll" }]
            : [{ page: "payroll", label: "Payroll", module: "payroll" }],
        },
      ],
    },
    {
      title: "Other",
      rows: [
        { name: "Expense claims", what: "Claims brought in from another system are kept; making new ones, with their own users and mileage rates, is not offered.", status: "missing" },
        { name: "Link to another system", what: "A web address for each contact in another system, such as a CRM, with {name} where the contact's name goes. Each contact then has an Open elsewhere link.", status: "here" },
        { name: "Staff cost rates", what: "Time is kept and invoiced at a rate; what an hour costs is not kept.", status: "missing" },
      ],
    },
  ];
}

function rowFor(row: Row): HTMLElement {
  const item = document.createElement("div");
  item.className = "settings-row";
  const text = document.createElement("div");
  const name = document.createElement("strong");
  name.textContent = row.name;
  const what = document.createElement("p");
  what.className = "settings-what";
  what.textContent = row.what;
  text.append(name, what);
  item.append(text);
  const go = document.createElement("div");
  go.className = "settings-go";
  if (row.status === "missing") {
    const chip = document.createElement("span");
    chip.className = "settings-chip";
    chip.textContent = "Not in OsaBooks yet";
    go.append(chip);
  }
  for (const where of row.where ?? []) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "small";
    button.textContent = where.label;
    if (where.module !== undefined && !moduleOn(where.module)) button.title = `Turns on with the ${where.label} module.`;
    button.addEventListener("click", () => showPage(where.page));
    go.append(button);
  }
  item.append(go);
  return item;
}

/** The settings set on this page: due dates, and the reports' basis. */
function hereControls(name: string): HTMLElement | null {
  const settings = bookSettings();
  if (name === "Default due dates") {
    const box = document.createElement("div");
    box.className = "settings-controls";
    for (const [key, label] of [["invoiceDueDays", "Invoices due"], ["billDueDays", "Bills due"]] as const) {
      const wrap = document.createElement("label");
      wrap.textContent = `${label} `;
      const days = document.createElement("input");
      days.type = "number";
      days.min = "0";
      days.max = "365";
      days.className = "payroll-tiny-input";
      days.placeholder = "—";
      days.value = settings[key] === undefined ? "" : String(settings[key]);
      days.addEventListener("change", () => {
        const n = days.value.trim() === "" ? undefined : Math.max(0, Math.min(365, Math.round(Number(days.value))));
        const next: BookSettings = { ...bookSettings() };
        if (n === undefined || Number.isNaN(n)) delete next[key];
        else next[key] = n;
        void saveSettings(next, n === undefined ? `${label}: no default` : `${label} ${n} days after the date`);
      });
      wrap.append(days, " days after the date");
      box.append(wrap);
    }
    const quote = document.createElement("label");
    quote.textContent = "Quotes valid for ";
    const quoteDays = document.createElement("input");
    quoteDays.type = "number";
    quoteDays.min = "0";
    quoteDays.max = "365";
    quoteDays.className = "payroll-tiny-input";
    quoteDays.placeholder = "—";
    quoteDays.value = settings.quoteDays === undefined ? "" : String(settings.quoteDays);
    quoteDays.addEventListener("change", () => {
      const n = quoteDays.value.trim() === "" ? undefined : Math.max(0, Math.min(365, Math.round(Number(quoteDays.value))));
      const next: BookSettings = { ...bookSettings() };
      if (n === undefined || Number.isNaN(n)) delete next.quoteDays;
      else next.quoteDays = n;
      void saveSettings(next, n === undefined ? "Quotes: no valid-until date" : `Quotes valid for ${n} days`);
    });
    quote.append(quoteDays, " days");
    box.append(quote);
    box.append(note("Left empty, a new one has no due date until you give it one."));
    return box;
  }
  if (name === "Numbering") {
    const box = document.createElement("div");
    box.className = "settings-controls";
    for (const [prefixKey, nextKey, label, usual] of [
      ["invoicePrefix", "invoiceNext", "Invoices", "INV-"],
      ["billPrefix", "billNext", "Bills", "BILL-"],
    ] as const) {
      const wrap = document.createElement("label");
      wrap.textContent = `${label} `;
      const prefix = document.createElement("input");
      prefix.type = "text";
      prefix.className = "payroll-tiny-input";
      prefix.placeholder = usual;
      prefix.maxLength = 12;
      prefix.value = settings[prefixKey] ?? "";
      prefix.setAttribute("aria-label", `${label}: prefix`);
      const next = document.createElement("input");
      next.type = "number";
      next.min = "1";
      next.className = "payroll-tiny-input";
      next.placeholder = "next";
      next.value = settings[nextKey] === undefined ? "" : String(settings[nextKey]);
      next.setAttribute("aria-label", `${label}: next number`);
      const keep = (): void => {
        const text = prefix.value.trim();
        if (text !== "" && !/^[A-Za-z-]+$/.test(text)) {
          prefix.setCustomValidity("Letters and dashes only, as in INV-");
          prefix.reportValidity();
          return;
        }
        prefix.setCustomValidity("");
        const n = next.value.trim() === "" ? undefined : Math.max(1, Math.round(Number(next.value)));
        const updated: BookSettings = { ...bookSettings() };
        if (text === "") delete updated[prefixKey];
        else updated[prefixKey] = text;
        if (n === undefined || Number.isNaN(n)) delete updated[nextKey];
        else updated[nextKey] = n;
        void saveSettings(updated, `${label} numbered ${text || usual}${n === undefined ? "" : ` from ${n}`}`);
      };
      prefix.addEventListener("change", keep);
      next.addEventListener("change", keep);
      wrap.append(prefix, " starting at ", next);
      box.append(wrap);
    }
    box.append(note("A number already used is never given again: the next is after the highest of the series, or the number set here if that is higher."));
    return box;
  }
  if (name === "Invoice look") {
    const box = document.createElement("div");
    box.className = "settings-controls";
    const wrap = document.createElement("label");
    wrap.textContent = "Colour of headings and rules ";
    const colour = document.createElement("input");
    colour.type = "color";
    colour.value = settings.documentAccent ?? "#1f4e79";
    colour.addEventListener("change", () => {
      const updated: BookSettings = { ...bookSettings() };
      if (colour.value.toLowerCase() === "#1f4e79") delete updated.documentAccent;
      else updated.documentAccent = colour.value;
      void saveSettings(updated, `Documents in ${colour.value}`);
    });
    const reset = document.createElement("button");
    reset.type = "button";
    reset.className = "small";
    reset.textContent = "The usual blue";
    reset.hidden = settings.documentAccent === undefined;
    reset.addEventListener("click", () => {
      const updated: BookSettings = { ...bookSettings() };
      delete updated.documentAccent;
      void saveSettings(updated, "Documents in the usual blue");
    });
    wrap.append(colour);
    box.append(wrap, reset);
    return box;
  }
  if (name === "Time zone") {
    const box = document.createElement("div");
    box.className = "settings-controls";
    const id = booksCountry().id;
    const usual = countryTimeZone(id);
    const pick = document.createElement("select");
    pick.setAttribute("aria-label", "Time zone");
    const first = document.createElement("option");
    first.value = "";
    first.textContent = usual === undefined ? "This computer's" : `${usual.replace(/_/g, " ")} (the country's)`;
    pick.append(first);
    for (const zone of countryTimeZones(id).filter((z) => z !== usual)) {
      const option = document.createElement("option");
      option.value = zone;
      option.textContent = zone.replace(/_/g, " ");
      pick.append(option);
    }
    pick.value = settings.timeZone ?? "";
    pick.addEventListener("change", () => {
      const updated: BookSettings = { ...bookSettings() };
      if (pick.value === "") delete updated.timeZone;
      else updated.timeZone = pick.value;
      void saveSettings(updated, `Time zone: ${pick.value === "" ? first.textContent : pick.value}`);
    });
    box.append(pick);
    return box;
  }
  if (name === "Fixed asset types") {
    const box = document.createElement("div");
    box.className = "settings-controls settings-stack";
    const types = [
      ...new Set([
        ...(state.ledger.assets ?? []).map((a) => a.type.trim()),
        ...state.chart.filter((a) => /fixed asset/i.test(a.type) && !/accumulated/i.test(a.name)).map((a) => a.name.trim()),
      ]),
    ].filter((t) => t !== "").sort((a, b) => a.localeCompare(b));
    const expenses = state.chart
      .filter((a) => /expense|overhead|depreciation/i.test(a.type) && a.code.trim() !== "")
      .sort((a, b) => Number(/depreciation/i.test(b.name)) - Number(/depreciation/i.test(a.name)) || a.code.localeCompare(b.code));
    if (types.length === 0) {
      box.append(note("No asset types yet: they come from the fixed asset accounts in the chart."));
      return box;
    }
    for (const type of types) {
      const wrap = document.createElement("label");
      wrap.textContent = `${type} `;
      const pick = document.createElement("select");
      const usual = document.createElement("option");
      usual.value = "";
      usual.textContent = "The entity's Depreciation account";
      pick.append(usual);
      for (const a of expenses) {
        const option = document.createElement("option");
        option.value = a.code;
        option.textContent = `${a.code} ${a.name}`;
        pick.append(option);
      }
      pick.value = settings.assetExpense?.[type] ?? "";
      pick.addEventListener("change", () => {
        const chosen = { ...(bookSettings().assetExpense ?? {}) };
        if (pick.value === "") delete chosen[type];
        else chosen[type] = pick.value;
        const updated: BookSettings = { ...bookSettings(), assetExpense: chosen };
        if (Object.keys(chosen).length === 0) delete updated.assetExpense;
        void saveSettings(updated, `${type}: depreciation to ${pick.value === "" ? "the entity's Depreciation account" : pick.value}`);
      });
      wrap.append(pick);
      box.append(wrap);
    }
    return box;
  }
  if (name === "Link to another system") {
    const box = document.createElement("div");
    box.className = "settings-controls";
    const link = document.createElement("input");
    link.type = "url";
    link.placeholder = "https://crm.example.com/search?q={name}";
    link.size = 44;
    link.value = settings.contactLink ?? "";
    link.addEventListener("change", () => {
      const text = link.value.trim();
      if (text !== "" && !/^https:\/\//.test(text)) {
        link.setCustomValidity("A web address starting https://");
        link.reportValidity();
        return;
      }
      link.setCustomValidity("");
      const updated: BookSettings = { ...bookSettings() };
      if (text === "") delete updated.contactLink;
      else updated.contactLink = text;
      void saveSettings(updated, text === "" ? "No link for contacts" : "Contacts link to another system");
    });
    box.append(link);
    return box;
  }
  if (name === "Display") {
    const box = document.createElement("div");
    box.className = "settings-controls";
    for (const [key, label] of [
      ["hideCodes", "Leave account codes off"],
      ["wholeUnits", "Round to whole amounts"],
      ["showEmpty", "List accounts with nothing in them"],
    ] as const) {
      const wrap = document.createElement("label");
      wrap.className = "checkbox";
      const tick = document.createElement("input");
      tick.type = "checkbox";
      tick.checked = settings[key] === true;
      tick.addEventListener("change", () => {
        const updated: BookSettings = { ...bookSettings() };
        if (tick.checked) updated[key] = true;
        else delete updated[key];
        void saveSettings(updated, `${label}: ${tick.checked ? "on" : "off"}`);
      });
      wrap.append(tick, ` ${label}`);
      box.append(wrap);
    }
    return box;
  }
  if (name === "Reports' basis") {
    const box = document.createElement("div");
    box.className = "settings-controls";
    const pick = document.createElement("select");
    for (const [value, label] of [["posted", "Accrual (our postings)"], ["cash", "Cash (bank data)"]] as const) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      option.selected = (settings.reportBasis ?? "posted") === value;
      pick.append(option);
    }
    pick.addEventListener("change", () => {
      const basis = pick.value === "cash" ? "cash" : "posted";
      void saveSettings({ ...bookSettings(), reportBasis: basis }, `Reports open on the ${basis === "cash" ? "cash" : "accrual"} basis`);
      applyReportDefaults();
    });
    box.append(pick);
    return box;
  }
  return null;
}

export function renderSettings(): void {
  const body = $("settings-body");
  body.textContent = "";
  for (const group of groups()) {
    const section = document.createElement("section");
    section.className = "modules-box settings-group";
    const heading = document.createElement("h3");
    heading.textContent = group.title;
    section.append(heading);
    for (const row of group.rows) {
      const item = rowFor(row);
      const controls = row.status === "here" ? hereControls(row.name) : null;
      if (controls !== null) item.querySelector("div")?.append(controls);
      section.append(item);
    }
    body.append(section);
  }
}
