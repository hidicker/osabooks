import { redraw } from "../app.js";
import { bankLabel, reconcileRows, record, settledAlready } from "../books.js";
import { rpc } from "../cloud.js";
import { state } from "../state.js";
import { backendKind, openCloudBookId, save } from "../store.js";
import { addTransactions } from "./bank-import.js";
import { askOnPage, nameCell, note, tellOnPage } from "../ui.js";
import { booksLocale, moneyPlaces, noSalesTax, sayTax } from "../country.js";
import { firstOpenDay, furthestLocks, localToday } from "@nzosa/core";
import { numberPadSettings } from "../number-pad.js";
import { stripeSettings } from "./stripe-ui.js";
import type { IsoDate, LockDates, LockedChange, Transaction } from "@nzosa/core";

/**
 * Setting the lock dates, and the bank lines that arrive for a locked period.
 *
 * The locks themselves are kept by the save guard in lock.ts; this is where a
 * person sets them. Locking needs every line up to the date confirmed: a line
 * still on a suggestion would move with the next rule or AI answer, and a
 * finished period cannot have figures that move on their own.
 */

function today(): string {
  return localToday();
}

/** For books online, an owner or the accountant moves a lock. Elsewhere there is one person. */
async function mayMoveLocks(): Promise<boolean> {
  if (backendKind() !== "cloud") return true;
  const book = openCloudBookId();
  if (book === "") return true;
  return (await rpc<boolean>("has_role", { book, roles: ["owner", "accountant"] })) === true;
}

interface Noticed {
  noticed_at: string;
  part: string;
  by_email: string | null;
  what: { locks?: { year?: string | null; gst?: string | null }; changed?: { kind: string; key: string; date: string }[] };
}

let watched: { book: string; rows: Noticed[] | null; denied?: boolean } | null = null;

/**
 * What the server noticed: each save that changed something dated in a locked
 * period, whoever made it and from wherever. For now it only notices; it
 * refuses nothing. Shown to the owner and the accountant.
 */
function serverWatch(): HTMLElement {
  const box = document.createElement("div");
  box.className = "locked-changes";
  const heading = document.createElement("h4");
  heading.textContent = "Noticed by the server";
  box.append(heading);
  const book = openCloudBookId();
  if (watched === null || watched.book !== book) {
    watched = { book, rows: null };
    void rpc<Noticed[]>("lock_watch_list", { p_book: book })
      .then((rows) => {
        if (watched?.book === book) watched.rows = Array.isArray(rows) ? rows : [];
      })
      .catch(() => {
        // Not the owner or the accountant: the list is theirs.
        if (watched?.book === book) watched = { book, rows: [], denied: true };
      })
      .finally(() => redraw("settings"));
    box.append(note("Asking the server…"));
    return box;
  }
  if (watched.denied === true) return document.createElement("div");
  const rows = watched.rows ?? [];
  box.append(
    note(
      "The server notes every save that changes a record dated in a locked period: a bank line, its coding, an invoice or a manual journal. " +
        "For now it only notices; the page refuses such changes as before. " +
        (rows.length === 0 ? "Nothing noticed." : `${rows.length} noticed, newest first:`),
    ),
  );
  for (const row of rows.slice(0, 20)) {
    const changed = row.what.changed ?? [];
    const kinds = [...new Set(changed.map((c) => c.kind))].join(", ");
    const dates = changed.map((c) => c.date).sort();
    box.append(
      note(
        `${new Date(row.noticed_at).toLocaleString(booksLocale())}${row.by_email ? `, ${row.by_email}` : ""}: ` +
          `${changed.length} ${kinds || "change"}${changed.length === 1 ? "" : "s"} dated ${dates[0] ?? ""}${dates.length > 1 ? ` to ${dates[dates.length - 1]}` : ""}` +
          ` (locked to ${row.what.locks?.year ?? row.what.locks?.gst ?? "?"}).`,
      ),
    );
  }
  return box;
}

/** Lines dated up to `day` still waiting to be confirmed on Reconcile. */
function unconfirmedThrough(day: string): number {
  return reconcileRows().all.filter((one) => one.transaction.date <= day && !settledAlready(one)).length;
}

/**
 * Offered once a GST return is marked as filed: lock GST up to the end of its
 * period, so nothing can change a return already with the tax office. Asked,
 * not done, and only where the lock is not already that far.
 */
export async function offerGstLock(periodEnd: string): Promise<void> {
  const locks = state.ledger.lockDates ?? {};
  if (locks.gst !== undefined && locks.gst >= periodEnd) return;
  if (!(await mayMoveLocks())) return;
  const open = unconfirmedThrough(periodEnd);
  if (open > 0) {
    await tellOnPage(
      `Marked as filed. To lock GST up to ${periodEnd} as well, confirm the ${open} line${open === 1 ? "" : "s"} ` +
        "still waiting on Reconcile up to that date, then set the GST lock under Lock dates.",
    );
    return;
  }
  if (
    !(await askOnPage(
      `Lock GST up to ${periodEnd} as well? A change that would alter a return up to then is refused. ` +
        "The lock can be moved back later, and that is recorded.",
    ))
  ) {
    return;
  }
  await setLocks({ ...locks, gst: periodEnd as IsoDate });
}

export function renderLockDates(): void {
  // On Settings, under its own row's name: lock dates are kept up as the
  // books go, not set once.
  const body = document.getElementById("settings-locks");
  if (body === null) return;
  body.textContent = "";
  const locks = state.ledger.lockDates ?? {};

  body.append(
    note(
      "Finished periods stay as they were finished. " +
        (noSalesTax()
          ? "The year lock keeps everything up to a signed-off year end from changing. "
          : sayTax("The GST lock keeps filed GST returns from changing; the year lock keeps everything " +
            "up to a signed-off year end from changing. ")) +
        "A change that would alter a locked figure is refused, whichever page it comes from.",
    ),
  );

  const lastFiled = state.filed.map((f) => f.periodEnd).sort().pop();
  const fields = document.createElement("div");
  fields.className = "agent-fields";
  const field = (label: string, value: string | undefined, hint: string): HTMLInputElement => {
    const wrap = document.createElement("label");
    wrap.append(label);
    const input = document.createElement("input");
    input.type = "date";
    input.value = value ?? "";
    input.max = today();
    wrap.append(input);
    if (hint !== "") {
      const small = document.createElement("small");
      small.textContent = hint;
      wrap.append(small);
    }
    fields.append(wrap);
    return input;
  };
  const gst = field(
    "GST locked up to",
    locks.gst,
    lastFiled === undefined ? "" : `Last GST return marked as filed: period to ${lastFiled}.`,
  );
  // No sales tax, no returns to lock.
  if (noSalesTax()) gst.closest("label")!.hidden = true;
  const year = field("Year locked up to", locks.year, "The last day of the last year signed off.");
  body.append(fields);

  const said = document.createElement("p");
  said.className = "feed-said";
  const saveIt = document.createElement("button");
  saveIt.type = "button";
  saveIt.className = "primary";
  saveIt.textContent = "Save lock dates";
  saveIt.disabled = true;
  void mayMoveLocks().then((may) => {
    saveIt.disabled = !may;
    if (!may) said.textContent = "Only an owner or the accountant of these books can move a lock.";
  });
  saveIt.addEventListener("click", () => {
    const next: LockDates = {
      ...(gst.value !== "" ? { gst: gst.value as IsoDate } : {}),
      ...(year.value !== "" ? { year: year.value as IsoDate } : {}),
    };
    // Moving a lock later takes in more of the books: they have to be finished.
    for (const [was, now] of [
      [locks.gst, next.gst],
      [locks.year, next.year],
    ] as const) {
      if (now === undefined || (was !== undefined && now <= was)) continue;
      const open = unconfirmedThrough(now);
      if (open > 0) {
        said.textContent =
          `${open} line${open === 1 ? " is" : "s are"} dated up to ${now} and not yet confirmed on ` +
          "Reconcile. Confirm them first: a locked period cannot hold figures that may still change.";
        return;
      }
    }
    void setLocks(next);
  });
  body.append(saveIt, said);
  body.append(lockedChangesList());
  // Books online: what the server noticed changing in a locked period.
  if (backendKind() === "cloud" && openCloudBookId() !== "") body.append(serverWatch());
  body.append(numberPadSettings());
  body.append(stripeSettings());
}

/**
 * Every change made in a period after it had been locked: the lock moved
 * back, and each change made while it was, with what it moved. An accountant
 * reviewing a signed-off year reads this first.
 */
function lockedChangesList(): HTMLElement {
  const box = document.createElement("div");
  box.className = "locked-changes";
  const list = state.ledger.lockedChanges ?? [];
  const heading = document.createElement("h4");
  heading.textContent = `Changes in locked periods (${list.length})`;
  box.append(heading);
  if (list.length === 0) {
    box.append(note("None. Nothing has been changed in a period after it was locked."));
    return box;
  }
  box.append(
    note(
      "A locked period can only be changed by moving its lock back. Each time that happened is listed, " +
        "with every change made in the period while it was open and the figures it moved.",
    ),
  );
  const table = document.createElement("table");
  table.className = "report-table owner-table";
  const head = document.createElement("thead");
  head.innerHTML = "<tr><th>When</th><th>Who</th><th>What</th><th>Figures moved</th></tr>";
  const tbody = document.createElement("tbody");
  for (const one of [...list].reverse()) {
    const tr = document.createElement("tr");
    tr.append(
      nameCell(new Date(one.at).toLocaleString(booksLocale(), { dateStyle: "medium", timeStyle: "short" })),
      nameCell(one.who),
      nameCell(one.summary),
    );
    const moved = document.createElement("td");
    moved.className = "report-name";
    for (const line of one.moved.slice(0, 12)) {
      const div = document.createElement("div");
      div.textContent = line;
      moved.append(div);
    }
    if (one.moved.length > 12) {
      const more = document.createElement("div");
      more.textContent = `and ${one.moved.length - 12} more`;
      moved.append(more);
    }
    tr.append(moved);
    tbody.append(tr);
  }
  table.append(head, tbody);
  box.append(table);
  return box;
}

async function setLocks(next: LockDates): Promise<void> {
  const before = state.ledger.lockDates ?? null;
  const empty = next.gst === undefined && next.year === undefined;
  // How far the books had been finished, kept when a lock is moved back.
  const high = furthestLocks(furthestLocks(state.ledger.lockHighWater, before ?? undefined), next);
  // A lock moved back opens a finished period: that goes on record too.
  const opened: LockedChange[] = [];
  const by = state.who.trim() === "" ? "unattributed" : state.who.trim();
  for (const [name, was, now] of [
    ["GST lock", before?.gst, next.gst],
    ["Year lock", before?.year, next.year],
  ] as const) {
    if (was === undefined || (now !== undefined && now >= was)) continue;
    opened.push({
      at: new Date().toISOString(),
      who: by,
      summary: now === undefined ? `${name} taken off; it was at ${was}` : `${name} moved back from ${was} to ${now}`,
      moved: [],
    });
  }
  const kept = {
    ...state.ledger,
    lockHighWater: high,
    ...(opened.length > 0 ? { lockedChanges: [...(state.ledger.lockedChanges ?? []), ...opened] } : {}),
  };
  if (empty) {
    const { lockDates: _gone, ...rest } = kept;
    state.ledger = rest;
  } else {
    state.ledger = { ...kept, lockDates: next };
  }
  state.persistent = await save(state.ledger);
  const words = (l: LockDates | null): string =>
    l === null || (l.gst === undefined && l.year === undefined)
      ? "none"
      : [l.gst ? `GST to ${l.gst}` : "", l.year ? `year to ${l.year}` : ""].filter((p) => p !== "").join(", ");
  await record("lockDates", `Lock dates: ${words(before)} → ${words(empty ? null : next)}`, before, empty ? null : next);
  redraw("settings");
  redraw("actionsBadge");
}

/**
 * The bank lines that arrived dated in a locked period, each to be brought in
 * dated the first open day, or kept out.
 */
export function renderLockedArrivals(): void {
  const body = document.getElementById("locked-arrivals");
  if (body === null) return;
  body.textContent = "";
  const held = state.ledger.lockedArrivals ?? [];
  if (held.length === 0) return;
  const open = firstOpenDay(state.ledger.lockDates);

  const heading = document.createElement("h4");
  heading.textContent = `Lines dated in a locked period (${held.length})`;
  body.append(heading);
  body.append(
    note(
      "These arrived after their period was locked, so they were kept out of it. Bring one in " +
        `dated ${open ?? "the first open day"}, the first day not locked; leave it out; or move the ` +
        "lock (Settings → Lock dates) to put it in its own period.",
    ),
  );
  const table = document.createElement("table");
  table.className = "report-table owner-table match-table";
  const head = document.createElement("thead");
  head.innerHTML = "<tr><th>Date</th><th>Account</th><th>Payee</th><th>Amount</th><th></th></tr>";
  const tbody = document.createElement("tbody");
  for (const line of held) {
    const tr = document.createElement("tr");
    tr.append(nameCell(line.date), nameCell(bankLabel(line.account)), nameCell(line.otherParty || line.particulars || ""));
    const amount = document.createElement("td");
    amount.className = "report-amount";
    amount.textContent = (line.amount / 100).toLocaleString(booksLocale(), {
      minimumFractionDigits: moneyPlaces(),
      maximumFractionDigits: moneyPlaces(),
    });
    tr.append(amount);
    const actions = document.createElement("td");
    actions.className = "report-amount";
    if (open !== undefined) {
      const bring = document.createElement("button");
      bring.type = "button";
      bring.textContent = `Bring in, dated ${open}`;
      bring.addEventListener("click", () => void decide(line, open));
      actions.append(bring, " ");
    }
    const leave = document.createElement("button");
    leave.type = "button";
    leave.className = "link-button";
    leave.textContent = "Leave out";
    leave.addEventListener("click", () => void decide(line, undefined));
    actions.append(leave);
    tr.append(actions);
    tbody.append(tr);
  }
  table.append(head, tbody);
  body.append(table);
}

async function decide(line: Transaction, dated: IsoDate | undefined): Promise<void> {
  const lockedArrivals = (state.ledger.lockedArrivals ?? []).filter((t) => t.id !== line.id);
  state.ledger = { ...state.ledger, lockedArrivals };
  if (dated === undefined) {
    // Remembered as removed, so the next fetch does not hold it again.
    const removed = new Set(state.ledger.removedDuplicates ?? []);
    removed.add(line.id);
    state.ledger = { ...state.ledger, removedDuplicates: [...removed] };
    state.persistent = await save(state.ledger);
  } else {
    await addTransactions(
      [{ ...line, date: dated, extras: { ...(line.extras ?? {}), bankDate: line.date } }],
      { importer: line.source?.importer ?? "bank", file: "dated after a locked period", problems: [] },
    );
  }
  renderLockedArrivals();
  redraw("actionsBadge");
}
