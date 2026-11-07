import { redraw } from "../app.js";
import { record } from "../books.js";
import { booksLocale, booksMoney, booksCurrency } from "../country.js";
import { reminderEmail, remindersToday } from "../reminders-run.js";
import { state } from "../state.js";
import { backendKind, readRemindersPart, save as saveLedger } from "../store.js";
import type { BookSettings } from "../store.js";
import { askOnPage, note } from "../ui.js";
import { parseAmount } from "@nzosa/core";
import { sendStatement } from "./contacts-page.js";

/**
 * Reminders on the Settings page: when they go, above what amount, and who
 * is due one today. Books on the server send them by themselves each morning;
 * books in this browser or a folder have nothing to send them, so each is
 * opened in your own mail program from the list, as the Reminder button does.
 */

interface ServerRecord {
  sent?: Record<string, number>;
  log?: { at: string; to: string; customer: string; invoices: string[]; failed?: string }[];
  ran?: { at: string; sent: number; skipped: { customer: string; why: string }[] };
}

let server: { book: string; record: ServerRecord } | null = null;
let loading = false;

/** Books on the server, where reminders can go by themselves. */
export function remindersCanSend(): boolean {
  return backendKind() === "cloud";
}

function serverRecord(): ServerRecord | null {
  if (!remindersCanSend()) return null;
  if (server === null && !loading) {
    loading = true;
    void readRemindersPart()
      .then((data) => {
        server = { book: "", record: (data ?? {}) as ServerRecord };
      })
      .finally(() => {
        loading = false;
        redraw("settings");
      });
  }
  return server?.record ?? null;
}

/** What each invoice has been reminded at: the server's record, or these books' own. */
export function sentRecord(): Record<string, number> {
  return remindersCanSend() ? (serverRecord()?.sent ?? {}) : (state.ledger.remindersSent ?? {});
}

/** How many customers are due a reminder today, for the Actions page. */
export function remindersDueCount(): number {
  const settings = state.ledger.settings?.reminders;
  if (settings?.on !== true) return 0;
  return remindersToday(state.ledger, sentRecord()).due.length;
}

async function saveReminders(next: BookSettings["reminders"] | undefined, what: string): Promise<void> {
  const before = state.ledger.settings ?? {};
  const settings: BookSettings = { ...before };
  if (next === undefined) delete settings.reminders;
  else settings.reminders = next;
  state.ledger = { ...state.ledger, settings };
  state.persistent = await saveLedger(state.ledger);
  await record("settings", what, before, settings);
  redraw("settings");
}

const daysSaid = (days: readonly number[]): string => days.join(", ");

export function remindersPanel(): HTMLElement {
  const box = document.createElement("div");
  box.className = "settings-controls settings-stack";
  const now = state.ledger.settings?.reminders ?? { on: false, days: [7, 14, 21] };
  const canSend = remindersCanSend();

  const row = document.createElement("div");
  row.className = "settings-controls";
  const onWrap = document.createElement("label");
  onWrap.className = "checkbox";
  const on = document.createElement("input");
  on.type = "checkbox";
  on.checked = now.on;
  onWrap.append(on, canSend ? " Send them by themselves, each morning" : " Remind me who is due one");
  const daysWrap = document.createElement("label");
  daysWrap.textContent = "Days overdue ";
  const days = document.createElement("input");
  days.type = "text";
  days.className = "payroll-tiny-input";
  days.value = daysSaid(now.days);
  days.placeholder = "7, 14, 21";
  days.setAttribute("aria-label", "Days overdue");
  daysWrap.append(days);
  const minWrap = document.createElement("label");
  minWrap.textContent = "Not under ";
  const minimum = document.createElement("input");
  minimum.type = "text";
  minimum.className = "payroll-tiny-input";
  minimum.placeholder = "0.00";
  minimum.value = now.minimum === undefined ? "" : (now.minimum / 100).toFixed(2);
  minimum.setAttribute("aria-label", "Smallest amount to remind about");
  minWrap.append(minimum);
  row.append(onWrap, daysWrap, minWrap);
  box.append(row);

  const keep = (): void => {
    const list = [...new Set(days.value.split(/[^0-9]+/).map(Number).filter((n) => Number.isInteger(n) && n > 0 && n <= 365))].sort((a, b) => a - b);
    if (list.length === 0) {
      days.setCustomValidity("Give at least one number of days, e.g. 7, 14, 21");
      days.reportValidity();
      return;
    }
    days.setCustomValidity("");
    const min = minimum.value.trim() === "" ? undefined : parseAmount(minimum.value, booksCurrency()) ?? undefined;
    const next = { on: on.checked, days: list, ...(min !== undefined && min > 0 ? { minimum: min } : {}) };
    void saveReminders(
      next,
      next.on ? `Reminders at ${daysSaid(list)} days overdue${min !== undefined && min > 0 ? `, not under ${booksMoney(min)}` : ""}` : "Reminders off",
    );
  };
  on.addEventListener("change", async () => {
    if (on.checked && canSend) {
      // Turned on, they go to customers without anybody pressing a button:
      // said plainly, with who would get one this morning.
      const due = remindersToday(state.ledger, sentRecord()).due.length;
      if (!await askOnPage(
        `Reminders will be emailed to customers by themselves each morning at about 9am, from these books' entity, with replies to its email. ` +
          `${due === 0 ? "Nobody is due one today." : `${due} ${due === 1 ? "customer is" : "customers are"} due one now and would get it tomorrow morning.`} Turn them on?`,
        "Turn them on",
        "Not yet",
      )) {
        on.checked = false;
        return;
      }
    }
    keep();
  });
  days.addEventListener("change", keep);
  minimum.addEventListener("change", keep);

  box.append(
    note(
      canSend
        ? "Each customer with invoices past due gets one email at each of these days, covering everything they owe, with the overdue letter attached. " +
            "It comes from OsaBooks's address in the entity's name, and replies go to the entity's own email (Entities & accounts, Invoice details). " +
            "A customer is passed over while money has come in that may be their payment, until it is matched on Reconcile."
        : "Books in this browser or a folder have no server to send email from, so the customers due one are listed here: each opens in your own mail program, " +
            "with the letter saved to attach. Books kept online can send them by themselves.",
    ),
  );

  if (!now.on) return box;

  // Who is due one today, and who is not and why.
  const today = remindersToday(state.ledger, sentRecord());
  const list = document.createElement("div");
  list.className = "settings-stack";
  const heading = document.createElement("strong");
  heading.textContent = today.due.length === 0 ? "Nobody is due a reminder today." : `Due a reminder today (${today.due.length})`;
  list.append(heading);
  for (const one of today.due) {
    const made = reminderEmail(one);
    const line = document.createElement("div");
    line.className = "settings-controls";
    line.append(`${one.customer} · ${one.email} · ${booksMoney(one.pastDue)} past due, ${one.lateDays} days`);
    if (canSend) {
      // Sent by the server: said when it cannot go, and why.
      if ("why" in made) line.append(` · will not be sent: ${made.why}`);
    } else {
      // Opened in your own mail program, which sends it from your address.
      const stages = Object.fromEntries(one.invoices.map((i) => [i.balance.invoice.number, i.stage]));
      const open = document.createElement("button");
      open.type = "button";
      open.className = "small";
      open.textContent = "Open the email";
      open.addEventListener("click", () => {
        if (!sendStatement(one.customer, "reminder", one.email)) return;
        const sent = { ...(state.ledger.remindersSent ?? {}), ...stages };
        state.ledger = { ...state.ledger, remindersSent: sent };
        void saveLedger(state.ledger).then(() => redraw("settings"));
      });
      line.append(" ", open);
    }
    list.append(line);
  }
  for (const one of today.skipped) list.append(note(`${one.customer}: not sent, ${one.why}.`));

  // What the server has sent lately.
  const held = serverRecord();
  if (canSend && held !== null) {
    const ran = held.ran;
    list.append(
      note(
        ran === undefined
          ? "Not run yet: the first reminders go tomorrow morning."
          : `Last run ${new Date(ran.at).toLocaleString(booksLocale())}: ${ran.sent} sent.` +
              (ran.skipped.length > 0 ? ` Not sent: ${ran.skipped.map((s) => `${s.customer} (${s.why})`).join("; ")}.` : ""),
      ),
    );
    for (const entry of (held.log ?? []).slice(0, 10)) {
      list.append(
        note(
          `${new Date(entry.at).toLocaleDateString(booksLocale())} ${entry.customer}, ${entry.to}: ${entry.invoices.join(", ")}` +
            (entry.failed === undefined ? "" : ` — failed: ${entry.failed}`),
        ),
      );
    }
  }
  box.append(list);
  return box;
}
