/**
 * Employee Self-Service Payroll Portal (/portal/).
 *
 * Employees sign in with their own account (and optional TOTP 2FA), accept an
 * employer's invitation, and view ONLY their own payslips, YTD totals, leave
 * balances, and leave requests via strictly scoped Supabase RPCs.
 */
import {
  formatAmount,
  lastDigits,
  leaveBalance,
  localToday,
  nzPayslip,
  ordinaryWeeklyPayOf,
  payslipsHtml,
  workingDaysBetween,
} from "@nzosa/core";
import type { Cents, Employee, IsoDate, LeaveSettings, LeaveTaken, PayRun, Payslip, PayslipLeave } from "@nzosa/core";
import {
  currentSession,
  rpc,
  sessionFromUrl,
  signIn,
  signOut,
  signUp,
  signedInWithCode,
} from "../cloud.js";
import { cloudConfigured } from "../cloud-config.js";
import { codeAskedFor, twoFactorSettings } from "../daily/two-factor-ui.js";
import { download, note, tellOnPage } from "../ui.js";

interface EmployerAccess {
  access_id: string;
  book_id: string;
  book_name: string;
  employee_id: string;
  state: "invited" | "active";
  invited_at: string;
  accepted_at: string | null;
  require_two_factor: boolean;
  two_factor_ok: boolean;
}

interface LeaveRequestRow {
  id: string;
  kind: string;
  from_date: IsoDate;
  to_date: IsoDate;
  days: number;
  note: string;
  status: "pending" | "approved" | "declined" | "cancelled";
  decision_note: string;
  decided_at: string | null;
  created_at: string;
}

interface PortalPayload {
  bookId: string;
  bookName: string;
  employerName: string;
  employerIrd: string;
  employeeId: string;
  employee: Employee | null;
  payRuns: PayRun[];
  leave: LeaveTaken[];
  leaveSettings: LeaveSettings | null;
  leaveRequests: LeaveRequestRow[];
}

type PortalTab = "payslips" | "leave" | "details" | "security";

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const money = (cents: Cents): string => formatAmount(cents, "NZD");

let activeTab: PortalTab = "payslips";
let selectedBookId: string | null = null;
let employers: EmployerAccess[] = [];
let payload: PortalPayload | null = null;

function setStatus(msg: string, bad = false): void {
  const el = $("portal-said");
  el.textContent = msg;
  el.className = bad ? "cloud-said bad" : "page-hint";
}

function computeLeave(data: PortalPayload, asAt: IsoDate): ReturnType<typeof leaveBalance> | null {
  const emp = data.employee;
  if (!emp || !emp.startDate) return null;
  const pays: { date: IsoDate; gross: Cents }[] = [];
  for (const run of data.payRuns) {
    for (const line of run.lines) {
      if (line.employeeId === data.employeeId && line.withholding !== true && run.payDate <= asAt) {
        pays.push({ date: run.payDate, gross: line.gross });
      }
    }
  }
  return leaveBalance({
    employeeId: data.employeeId,
    startDate: emp.startDate,
    asAt,
    ...(data.leaveSettings !== null ? { settings: data.leaveSettings } : {}),
    pays,
    taken: data.leave,
    ordinaryWeeklyPay: ordinaryWeeklyPayOf(emp),
  });
}

function openPayslipModal(slip: Payslip): void {
  const html = payslipsHtml([slip], money);
  const box = document.createElement("dialog");
  box.className = "ask-on-page payslip-view";
  const frame = document.createElement("iframe");
  frame.className = "payslip-frame";
  frame.setAttribute("sandbox", "allow-same-origin allow-modals");
  frame.title = `Payslip for ${slip.payDate}`;
  frame.srcdoc = html;

  const actions = document.createElement("div");
  actions.className = "ask-on-page-actions";
  const close = document.createElement("button");
  close.type = "button";
  close.textContent = "Close";
  const save = document.createElement("button");
  save.type = "button";
  save.textContent = "Save as file";
  const print = document.createElement("button");
  print.type = "button";
  print.className = "primary";
  print.textContent = "Print / Save PDF";
  actions.append(close, save, print);
  box.append(frame, actions);

  const finish = (): void => {
    box.close();
    box.remove();
  };
  close.addEventListener("click", finish);
  box.addEventListener("cancel", (e) => {
    e.preventDefault();
    finish();
  });
  save.addEventListener("click", () => download(html, `payslip-${slip.payDate}.html`, "text/html"));
  print.addEventListener("click", () => {
    try {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
    } catch {
      void tellOnPage("This browser would not print from here. Save as file, open it, and print that.");
    }
  });
  document.body.append(box);
  box.showModal();
  print.focus();
}

function renderAuth(): void {
  const root = $("portal-root");
  root.textContent = "";
  $("portal-who").textContent = "Sign in to view your payslips and leave balances.";
  $("portal-signout").hidden = true;
  setStatus("");

  const grid = document.createElement("div");
  grid.className = "portal-auth-grid";

  // Sign in card
  const inCard = document.createElement("section");
  inCard.className = "portal-card";
  inCard.innerHTML = "<h2>Sign in</h2>";
  const inForm = document.createElement("form");
  inForm.className = "portal-form";
  const inEmail = document.createElement("input");
  inEmail.type = "email";
  inEmail.required = true;
  inEmail.autocomplete = "email";
  inEmail.placeholder = "you@example.com";
  const inPass = document.createElement("input");
  inPass.type = "password";
  inPass.required = true;
  inPass.autocomplete = "current-password";
  const inBtn = document.createElement("button");
  inBtn.type = "submit";
  inBtn.className = "primary";
  inBtn.textContent = "Sign in";
  const inMsg = document.createElement("p");
  inMsg.className = "cloud-said";
  const l1 = document.createElement("label");
  l1.append("Email", inEmail);
  const l2 = document.createElement("label");
  l2.append("Password", inPass);
  inForm.append(l1, l2, inBtn, inMsg);
  inForm.addEventListener("submit", (e) => {
    e.preventDefault();
    inBtn.disabled = true;
    inMsg.textContent = "Signing in…";
    void signIn(inEmail.value.trim(), inPass.value).then((res) => {
      if (!res.ok) {
        inBtn.disabled = false;
        inMsg.textContent = res.why;
        inMsg.className = "cloud-said bad";
        return;
      }
      void loadPortal();
    });
  });
  inCard.append(inForm);

  // Create account card
  const upCard = document.createElement("section");
  upCard.className = "portal-card";
  upCard.innerHTML = "<h2>First time here? Create your account</h2>";
  upCard.append(note("Use the same email address your employer invited you with."));
  const upForm = document.createElement("form");
  upForm.className = "portal-form";
  const upEmail = document.createElement("input");
  upEmail.type = "email";
  upEmail.required = true;
  upEmail.autocomplete = "email";
  upEmail.placeholder = "you@example.com";
  const upPass = document.createElement("input");
  upPass.type = "password";
  upPass.required = true;
  upPass.minLength = 8;
  upPass.autocomplete = "new-password";
  upPass.placeholder = "At least 8 characters";
  const upBtn = document.createElement("button");
  upBtn.type = "submit";
  upBtn.textContent = "Create account";
  const upMsg = document.createElement("p");
  upMsg.className = "cloud-said";
  const l3 = document.createElement("label");
  l3.append("Email", upEmail);
  const l4 = document.createElement("label");
  l4.append("Password", upPass);
  upForm.append(l3, l4, upBtn, upMsg);
  upForm.addEventListener("submit", (e) => {
    e.preventDefault();
    upBtn.disabled = true;
    upMsg.textContent = "Creating account…";
    void signUp(upEmail.value.trim(), upPass.value).then((res) => {
      upBtn.disabled = false;
      if (!res.ok) {
        upMsg.textContent = res.why;
        upMsg.className = "cloud-said bad";
        return;
      }
      if (res.confirm) {
        upMsg.textContent = "Check your email to confirm your address, then sign in on the left.";
        upMsg.className = "cloud-said";
        return;
      }
      void loadPortal();
    });
  });
  upCard.append(upForm);

  grid.append(inCard, upCard);
  root.append(grid);
}

function renderPayslipsTab(container: HTMLElement, data: PortalPayload): void {
  const runs = [...data.payRuns].sort((a, b) => (b.payDate > a.payDate ? 1 : -1));
  const latestRun = runs[0];
  const latestLine = latestRun?.lines.find((l) => l.employeeId === data.employeeId);
  const today = localToday();
  const leaveNow = computeLeave(data, today);

  // Summary cards
  const stats = document.createElement("div");
  stats.className = "portal-stats";
  const addStat = (label: string, value: string): void => {
    const card = document.createElement("div");
    card.className = "portal-stat";
    const l = document.createElement("div");
    l.className = "portal-stat-label";
    l.textContent = label;
    const v = document.createElement("div");
    v.className = "portal-stat-value";
    v.textContent = value;
    card.append(l, v);
    stats.append(card);
  };

  addStat("Latest net pay", latestLine ? money(latestLine.netPay) : "--");
  if (latestRun) {
    const slip = nzPayslip({
      run: latestRun,
      employeeId: data.employeeId,
      employer: data.employerName,
      ...(data.employee !== null ? { employee: data.employee } : {}),
      runs: data.payRuns,
      money,
    });
    const ytdGross = slip?.yearToDate.find((r) => r.label === "Gross pay")?.amount ?? (0 as Cents);
    const ytdPaye = slip?.yearToDate.find((r) => r.label === "PAYE")?.amount ?? (0 as Cents);
    addStat("YTD gross pay", money(ytdGross));
    addStat("YTD PAYE", money(ytdPaye));
  }
  if (leaveNow !== null) {
    addStat(
      "Annual leave balance",
      leaveNow.payAsYouGo ? "8% pay as you go" : `${leaveNow.annualWeeks.toFixed(2)} wks`,
    );
  }
  container.append(stats);

  const card = document.createElement("section");
  card.className = "portal-card";
  const h = document.createElement("h2");
  h.textContent = "Payslips";
  card.append(h);

  if (runs.length === 0) {
    card.append(note("No payslips recorded yet."));
    container.append(card);
    return;
  }

  const wrap = document.createElement("div");
  wrap.className = "portal-table-wrap";
  const table = document.createElement("table");
  table.className = "portal-table";
  table.innerHTML = `
    <thead>
      <tr>
        <th>Pay date</th>
        <th>Period</th>
        <th class="num">Gross</th>
        <th class="num">PAYE</th>
        <th class="num">KiwiSaver</th>
        <th class="num">Net pay</th>
        <th></th>
      </tr>
    </thead>
  `;
  const tbody = document.createElement("tbody");

  for (const run of runs) {
    const lines = run.lines.filter((l) => l.employeeId === data.employeeId);
    const gross = lines.reduce((s, l) => s + l.gross, 0) as Cents;
    const paye = lines.reduce((s, l) => s + l.paye, 0) as Cents;
    const ks = lines.reduce((s, l) => s + l.kiwiSaverEmployee, 0) as Cents;
    const net = lines.reduce((s, l) => s + l.netPay, 0) as Cents;

    const tr = document.createElement("tr");
    const td = (text: string, cls = ""): HTMLTableCellElement => {
      const cell = document.createElement("td");
      cell.textContent = text;
      if (cls) cell.className = cls;
      tr.append(cell);
      return cell;
    };
    td(run.payDate);
    td(`${run.periodStart} to ${run.periodEnd}`);
    td(money(gross), "num");
    td(money(paye), "num");
    td(money(ks), "num");
    td(money(net), "num");
    const actionCell = td("", "num");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "small primary";
    btn.textContent = "View / Print";
    btn.addEventListener("click", () => {
      const lb = computeLeave(data, run.payDate);
      const leave: PayslipLeave | undefined = lb
        ? {
            asAt: run.payDate,
            annualWeeks: lb.annualWeeks,
            annualHours: lb.annualWeeks * lb.hoursPerWeek,
            sickDays: lb.sickDays,
            alternativeDays: lb.alternativeDays,
            payAsYouGo: lb.payAsYouGo,
          }
        : undefined;
      const slip = nzPayslip({
        run,
        employeeId: data.employeeId,
        employer: data.employerName,
        ...(data.employee !== null ? { employee: data.employee } : {}),
        runs: data.payRuns,
        ...(leave !== undefined ? { leave } : {}),
        money,
      });
      if (slip) openPayslipModal(slip);
    });
    actionCell.append(btn);
    tbody.append(tr);
  }
  table.append(tbody);
  wrap.append(table);
  card.append(wrap);
  container.append(card);
}

function renderLeaveTab(container: HTMLElement, data: PortalPayload): void {
  const today = localToday();
  const lb = computeLeave(data, today);

  if (lb !== null) {
    const stats = document.createElement("div");
    stats.className = "portal-stats";
    const addStat = (label: string, value: string): void => {
      const card = document.createElement("div");
      card.className = "portal-stat";
      card.innerHTML = `<div class="portal-stat-label"></div><div class="portal-stat-value"></div>`;
      (card.children[0] as HTMLElement).textContent = label;
      (card.children[1] as HTMLElement).textContent = value;
      stats.append(card);
    };
    addStat(
      "Annual holidays",
      lb.payAsYouGo ? "8% pay as you go" : `${lb.annualWeeks.toFixed(2)} wks (${(lb.annualWeeks * lb.hoursPerWeek).toFixed(1)} h)`,
    );
    addStat("Sick leave", `${lb.sickDays.toFixed(1)} days`);
    addStat("Alternative holidays", `${lb.alternativeDays.toFixed(1)} days`);
    if (lb.nextAnniversary) addStat("Next anniversary", lb.nextAnniversary);
    container.append(stats);
  }

  // Request leave form
  const reqCard = document.createElement("section");
  reqCard.className = "portal-card";
  reqCard.innerHTML = "<h2>Request leave</h2>";
  const form = document.createElement("form");
  form.className = "portal-form";

  const kindSel = document.createElement("select");
  for (const [val, label] of [
    ["annual", "Annual holidays"],
    ["sick", "Sick leave"],
    ["bereavement", "Bereavement leave"],
    ["alternative", "Alternative holiday (day in lieu)"],
    ["other", "Other leave"],
  ] as const) {
    const opt = document.createElement("option");
    opt.value = val;
    opt.textContent = label;
    kindSel.append(opt);
  }
  const fromIn = document.createElement("input");
  fromIn.type = "date";
  fromIn.required = true;
  fromIn.value = today;
  const toIn = document.createElement("input");
  toIn.type = "date";
  toIn.required = true;
  toIn.value = today;
  const daysIn = document.createElement("input");
  daysIn.type = "number";
  daysIn.step = "0.5";
  daysIn.min = "0.5";
  daysIn.max = "366";
  daysIn.required = true;
  daysIn.value = "1";

  const recalcDays = (): void => {
    if (fromIn.value && toIn.value && toIn.value >= fromIn.value) {
      const wd = workingDaysBetween(fromIn.value as IsoDate, toIn.value as IsoDate);
      if (wd > 0) daysIn.value = String(wd);
    }
  };
  fromIn.addEventListener("change", () => {
    if (toIn.value < fromIn.value) toIn.value = fromIn.value;
    recalcDays();
  });
  toIn.addEventListener("change", recalcDays);

  const noteIn = document.createElement("input");
  noteIn.type = "text";
  noteIn.maxLength = 500;
  noteIn.placeholder = "Optional note for your employer";

  const submitBtn = document.createElement("button");
  submitBtn.type = "submit";
  submitBtn.className = "primary";
  submitBtn.textContent = "Submit leave request";
  const msg = document.createElement("p");
  msg.className = "cloud-said";

  const row = document.createElement("div");
  row.className = "portal-form-row";
  const lKind = document.createElement("label");
  lKind.append("Leave type", kindSel);
  const lFrom = document.createElement("label");
  lFrom.append("From", fromIn);
  const lTo = document.createElement("label");
  lTo.append("To", toIn);
  const lDays = document.createElement("label");
  lDays.append("Days", daysIn);
  row.append(lFrom, lTo, lDays);
  const lNote = document.createElement("label");
  lNote.append("Note", noteIn);

  form.append(lKind, row, lNote, submitBtn, msg);
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    submitBtn.disabled = true;
    msg.textContent = "Submitting…";
    msg.className = "cloud-said";
    void rpc<string>("employee_leave_request_submit", {
      p_book: data.bookId,
      p_kind: kindSel.value,
      p_from: fromIn.value,
      p_to: toIn.value,
      p_days: Number(daysIn.value),
      p_note: noteIn.value.trim(),
    }).then((id) => {
      submitBtn.disabled = false;
      if (id === null) {
        msg.textContent = "Could not submit request. Check dates and try again.";
        msg.className = "cloud-said bad";
        return;
      }
      noteIn.value = "";
      msg.textContent = "Leave request sent to your employer.";
      void loadEmployerData(data.bookId);
    });
  });
  reqCard.append(form);
  container.append(reqCard);

  // My leave requests
  const listCard = document.createElement("section");
  listCard.className = "portal-card";
  listCard.innerHTML = "<h2>My leave requests</h2>";
  if (data.leaveRequests.length === 0) {
    listCard.append(note("No leave requests submitted yet."));
  } else {
    const wrap = document.createElement("div");
    wrap.className = "portal-table-wrap";
    const table = document.createElement("table");
    table.className = "portal-table";
    table.innerHTML = `
      <thead><tr><th>Type</th><th>Dates</th><th class="num">Days</th><th>Status</th><th>Note</th><th></th></tr></thead>
    `;
    const tbody = document.createElement("tbody");
    for (const r of data.leaveRequests) {
      const tr = document.createElement("tr");
      const c = (text: string, cls = ""): HTMLTableCellElement => {
        const td = document.createElement("td");
        td.textContent = text;
        if (cls) td.className = cls;
        tr.append(td);
        return td;
      };
      c(r.kind);
      c(`${r.from_date} to ${r.to_date}`);
      c(String(r.days), "num");
      const statusCell = c("");
      const badge = document.createElement("span");
      badge.className = `portal-badge ${r.status}`;
      badge.textContent = r.status;
      statusCell.append(badge);
      c([r.note, r.decision_note ? `Employer: ${r.decision_note}` : ""].filter(Boolean).join(" — "));
      const act = c("", "num");
      if (r.status === "pending") {
        const cancel = document.createElement("button");
        cancel.type = "button";
        cancel.className = "small";
        cancel.textContent = "Cancel";
        cancel.addEventListener("click", () => {
          cancel.disabled = true;
          void rpc<string>("employee_leave_request_cancel", { p_request_id: r.id }).then(() => {
            void loadEmployerData(data.bookId);
          });
        });
        act.append(cancel);
      }
      tbody.append(tr);
    }
    table.append(tbody);
    wrap.append(table);
    listCard.append(wrap);
  }
  container.append(listCard);

  // Leave taken history
  if (data.leave.length > 0) {
    const histCard = document.createElement("section");
    histCard.className = "portal-card";
    histCard.innerHTML = "<h2>Recorded leave taken</h2>";
    const wrap = document.createElement("div");
    wrap.className = "portal-table-wrap";
    const table = document.createElement("table");
    table.className = "portal-table";
    table.innerHTML = `<thead><tr><th>Type</th><th>Dates</th><th class="num">Days</th><th>Note</th></tr></thead>`;
    const tbody = document.createElement("tbody");
    for (const lv of [...data.leave].sort((a, b) => (b.from > a.from ? 1 : -1))) {
      const tr = document.createElement("tr");
      for (const [val, cls] of [
        [lv.kind, ""],
        [`${lv.from} to ${lv.to}`, ""],
        [String(lv.days), "num"],
        [lv.note ?? "", ""],
      ] as const) {
        const td = document.createElement("td");
        td.textContent = val;
        if (cls) td.className = cls;
        tr.append(td);
      }
      tbody.append(tr);
    }
    table.append(tbody);
    wrap.append(table);
    histCard.append(wrap);
    container.append(histCard);
  }
}

function renderDetailsTab(container: HTMLElement, data: PortalPayload): void {
  const emp = data.employee;
  const card = document.createElement("section");
  card.className = "portal-card";
  card.innerHTML = "<h2>My payroll details</h2>";
  if (!emp) {
    card.append(note("Your employee profile could not be found in this payroll."));
    container.append(card);
    return;
  }
  card.append(note("Read-only view of the details on file with your employer. Let them know if anything needs updating."));
  const grid = document.createElement("div");
  grid.className = "portal-details-grid";
  const add = (label: string, value: string): void => {
    const item = document.createElement("div");
    item.className = "portal-detail-item";
    const l = document.createElement("div");
    l.className = "portal-detail-label";
    l.textContent = label;
    const v = document.createElement("div");
    v.className = "portal-detail-value";
    v.textContent = value;
    item.append(l, v);
    grid.append(item);
  };
  add("Name", emp.name);
  add("Employer", data.employerName);
  add("IRD number", emp.irdNumber ? lastDigits(emp.irdNumber, 3) : "Not recorded");
  add("Tax code", emp.taxCode);
  add("Pay frequency", emp.payFrequency);
  add("KiwiSaver", emp.kiwiSaverRate > 0 ? `${Math.round(emp.kiwiSaverRate * 1000) / 10}%` : "Not a member");
  add("Bank account", emp.bankAccount ? lastDigits(emp.bankAccount, 4) : "Not recorded");
  add("Start date", emp.startDate ?? "Not recorded");
  card.append(grid);
  container.append(card);
}

function renderSecurityTab(container: HTMLElement): void {
  const card = document.createElement("section");
  card.className = "portal-card";
  const settings = twoFactorSettings();
  if (settings) {
    card.append(settings);
  } else {
    card.append(note("Two-factor sign-in is not available on this server."));
  }
  container.append(card);
}

function renderPortalShell(): void {
  const root = $("portal-root");
  root.textContent = "";
  const s = currentSession();
  if (!s) {
    renderAuth();
    return;
  }
  $("portal-who").textContent = `Signed in as ${s.email}${signedInWithCode() ? " (2FA active)" : ""}`;
  $("portal-signout").hidden = false;

  // Pending invitations
  const pending = employers.filter((e) => e.state === "invited");
  if (pending.length > 0) {
    const invCard = document.createElement("section");
    invCard.className = "portal-card";
    invCard.innerHTML = "<h2>Payroll portal invitations</h2>";
    for (const inv of pending) {
      const row = document.createElement("div");
      row.className = "portal-invite-row";
      const label = document.createElement("span");
      label.textContent = `${inv.book_name} invited you to view your payroll online.`;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "primary";
      btn.textContent = "Accept invitation";
      btn.addEventListener("click", () => {
        btn.disabled = true;
        void rpc<string>("employee_portal_accept", { p_access_id: inv.access_id }).then((res) => {
          if (res !== "accepted") {
            btn.disabled = false;
            setStatus("Could not accept invitation. If you have 2FA enabled, enter your code first.", true);
            return;
          }
          selectedBookId = inv.book_id;
          void loadPortal();
        });
      });
      row.append(label, btn);
      invCard.append(row);
    }
    root.append(invCard);
  }

  const active = employers.filter((e) => e.state === "active");
  if (active.length > 1) {
    const bar = document.createElement("div");
    bar.className = "portal-employer-bar";
    const sel = document.createElement("select");
    for (const emp of active) {
      const opt = document.createElement("option");
      opt.value = emp.book_id;
      opt.textContent = emp.book_name;
      opt.selected = emp.book_id === selectedBookId;
      sel.append(opt);
    }
    sel.addEventListener("change", () => {
      selectedBookId = sel.value;
      void loadEmployerData(selectedBookId);
    });
    const lbl = document.createElement("label");
    lbl.append("Employer: ", sel);
    bar.append(lbl);
    root.append(bar);
  }

  // Navigation tabs (Security always available so users can optionally enable 2FA)
  const tabs = document.createElement("nav");
  tabs.className = "portal-tabs";
  const tabDefs: [PortalTab, string][] = [
    ["payslips", "Payslips"],
    ["leave", "Leave"],
    ["details", "My details"],
    ["security", "Two-factor sign-in"],
  ];
  for (const [id, label] of tabDefs) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `portal-tab${activeTab === id ? " active" : ""}`;
    btn.textContent = label;
    btn.addEventListener("click", () => {
      activeTab = id;
      renderPortalShell();
    });
    tabs.append(btn);
  }
  root.append(tabs);

  const body = document.createElement("div");
  root.append(body);

  if (activeTab === "security") {
    renderSecurityTab(body);
    return;
  }

  if (active.length === 0) {
    const empty = document.createElement("section");
    empty.className = "portal-card";
    empty.append(
      note(
        pending.length > 0
          ? "Accept your employer's invitation above to view your payslips and leave."
          : "No employer has linked your email address to a payroll yet. Ask your employer to invite you from their Payroll → Employees tab.",
      ),
    );
    body.append(empty);
    return;
  }

  const currentEmployer = active.find((e) => e.book_id === selectedBookId) ?? active[0];
  if (currentEmployer && !currentEmployer.two_factor_ok) {
    const lockCard = document.createElement("section");
    lockCard.className = "portal-card";
    lockCard.append(
      note(
        currentEmployer.require_two_factor
          ? `${currentEmployer.book_name} requires two-factor sign-in. Set up an authenticator on the Two-factor sign-in tab, then enter your code.`
          : "Enter your authenticator code to view your payroll.",
      ),
    );
    body.append(lockCard);
    return;
  }

  if (!payload) {
    body.append(note("Loading payroll…"));
    return;
  }

  if (activeTab === "payslips") renderPayslipsTab(body, payload);
  else if (activeTab === "leave") renderLeaveTab(body, payload);
  else if (activeTab === "details") renderDetailsTab(body, payload);
}

async function loadEmployerData(bookId: string): Promise<void> {
  setStatus("Loading payroll…");
  const data = await rpc<PortalPayload>("employee_portal_data", { p_book: bookId });
  if (data === null) {
    payload = null;
    setStatus("Could not load payroll. If two-factor sign-in is required, verify your code first.", true);
    renderPortalShell();
    return;
  }
  payload = data;
  setStatus("");
  renderPortalShell();
}

async function loadPortal(): Promise<void> {
  if (!cloudConfigured()) {
    setStatus("Online sign-in is not configured on this build.", true);
    return;
  }
  const s = currentSession();
  if (!s) {
    renderAuth();
    return;
  }
  setStatus("Checking your payroll access…");
  $("portal-who").textContent = `Signed in as ${s.email}`;
  $("portal-signout").hidden = false;

  // If user has 2FA enrolled and hasn't verified this session yet, ask for code first.
  const ask = await codeAskedFor({
    buttonLabel: "Open my payroll",
    intro: "Your payslips and leave open once you give your six-digit code.",
    onVerified: () => void loadPortal(),
  });
  if (ask !== null) {
    setStatus("");
    const root = $("portal-root");
    root.textContent = "";
    const card = document.createElement("section");
    card.className = "portal-card";
    card.append(ask);
    root.append(card);
    return;
  }

  const list = await rpc<EmployerAccess[]>("employee_portal_employers", {});
  if (list === null) {
    setStatus("Could not load your payroll access. Try signing out and back in.", true);
    return;
  }
  employers = list;
  const active = employers.filter((e) => e.state === "active");
  if (active.length > 0) {
    if (!selectedBookId || !active.some((e) => e.book_id === selectedBookId)) {
      selectedBookId = active[0]?.book_id ?? null;
    }
    const chosen = active.find((e) => e.book_id === selectedBookId);
    if (chosen && chosen.two_factor_ok) {
      await loadEmployerData(chosen.book_id);
      return;
    }
  }
  payload = null;
  setStatus("");
  renderPortalShell();
}

$("portal-signout").addEventListener("click", () => {
  void signOut().then(() => {
    employers = [];
    payload = null;
    selectedBookId = null;
    renderAuth();
  });
});

sessionFromUrl();
void loadPortal();
