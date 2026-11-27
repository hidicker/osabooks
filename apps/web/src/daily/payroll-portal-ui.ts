/**
 * Employer-side Employee Payroll Portal controls (cloud books only):
 * - Invite / revoke individual employees' online portal access (/portal/)
 * - Review & approve/decline employee-submitted leave requests
 */
import type { IsoDate, LeaveKind, LeaveTaken } from "@nzosa/core";
import { rpc } from "../cloud.js";
import { openCloudBookId } from "../store.js";
import type { PayrollData } from "../store.js";
import { askOnPage, askTextOnPage, note, tellOnPage } from "../ui.js";

interface PortalAccessRow {
  id: string;
  employee_id: string;
  email: string;
  state: "invited" | "active";
  invited_at: string;
  accepted_at: string | null;
  has_two_factor: boolean;
}

interface BookLeaveRequest {
  id: string;
  employee_id: string;
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

function portalUrl(): string {
  return `${window.location.origin}/portal/`;
}

export function renderPortalAccessSection(container: HTMLElement, payroll: PayrollData): void {
  const bookId = openCloudBookId();
  if (!bookId || payroll.employees.length === 0) return;

  const box = document.createElement("div");
  box.className = "payroll-portal-box";
  box.style.marginTop = "20px";

  const heading = document.createElement("h3");
  heading.textContent = "Employee self-service portal";
  box.append(heading);

  const linkBar = document.createElement("div");
  linkBar.className = "page-actions";
  const linkInfo = note(`Employees sign in at ${portalUrl()} to view their own payslips, leave balances, and request leave (with optional 2FA).`);
  const copyBtn = document.createElement("button");
  copyBtn.type = "button";
  copyBtn.className = "small";
  copyBtn.textContent = "Copy portal link";
  copyBtn.addEventListener("click", () => {
    void navigator.clipboard?.writeText(portalUrl()).then(
      () => {
        copyBtn.textContent = "Copied!";
        setTimeout(() => {
          copyBtn.textContent = "Copy portal link";
        }, 1800);
      },
      () => void tellOnPage(`Employee portal address: ${portalUrl()}`),
    );
  });
  linkBar.append(linkInfo, copyBtn);
  box.append(linkBar);

  const listWrap = document.createElement("div");
  listWrap.append(note("Loading portal status…"));
  box.append(listWrap);
  container.append(box);

  const draw = async (): Promise<void> => {
    const rows = await rpc<PortalAccessRow[]>("employee_portal_list", { p_book: bookId });
    listWrap.textContent = "";
    if (rows === null) {
      listWrap.append(note("Could not load employee portal status."));
      return;
    }
    const byEmp = new Map(rows.map((r) => [r.employee_id, r]));

    const table = document.createElement("table");
    table.className = "payroll-table";
    table.innerHTML = `
      <thead>
        <tr>
          <th>Employee</th>
          <th>Portal email</th>
          <th>Access</th>
          <th style="text-align:right;">Actions</th>
        </tr>
      </thead>
    `;
    const tbody = document.createElement("tbody");

    for (const emp of payroll.employees) {
      const access = byEmp.get(emp.id);
      const tr = document.createElement("tr");
      const tdName = document.createElement("td");
      tdName.textContent = emp.name;
      const tdEmail = document.createElement("td");
      tdEmail.textContent = access?.email ?? emp.details?.email ?? "—";
      const tdState = document.createElement("td");
      if (!access) {
        tdState.textContent = "Not invited";
      } else if (access.state === "invited") {
        tdState.textContent = "Invited (waiting to sign in)";
      } else {
        tdState.textContent = access.has_two_factor ? "Active (2FA on)" : "Active";
      }
      const tdAct = document.createElement("td");
      tdAct.style.textAlign = "right";
      tdAct.style.whiteSpace = "nowrap";

      const inviteBtn = document.createElement("button");
      inviteBtn.type = "button";
      inviteBtn.className = "small";
      inviteBtn.textContent = access ? "Change / Re-invite" : "Invite to portal";
      inviteBtn.addEventListener("click", () => {
        const defaultEmail = access?.email ?? emp.details?.email ?? "";
        void askTextOnPage(
          `Email address for ${emp.name} to sign in at ${portalUrl()}:`,
          defaultEmail,
          "Send invite",
        ).then((email) => {
          if (email === null || email.trim() === "") return;
          inviteBtn.disabled = true;
          void rpc<string>("employee_portal_invite", {
            p_book: bookId,
            p_employee_id: emp.id,
            p_email: email.trim(),
          }).then((id) => {
            if (id === null) {
              inviteBtn.disabled = false;
              void tellOnPage("Could not save portal invitation. Check the email address and your permissions.");
              return;
            }
            void tellOnPage(
              `${emp.name} (${email.trim()}) is now invited. Share ${portalUrl()} with them so they can sign in and accept.`,
            );
            void draw();
          });
        });
      });
      tdAct.append(inviteBtn);

      if (access) {
        const revBtn = document.createElement("button");
        revBtn.type = "button";
        revBtn.className = "small remove";
        revBtn.style.marginLeft = "6px";
        revBtn.textContent = "Revoke";
        revBtn.addEventListener("click", () => {
          void askOnPage(`Revoke online payroll portal access for ${emp.name}?`, "Revoke").then((yes) => {
            if (!yes) return;
            revBtn.disabled = true;
            void rpc<string>("employee_portal_revoke", { p_book: bookId, p_employee_id: emp.id }).then(() => {
              void draw();
            });
          });
        });
        tdAct.append(revBtn);
      }

      tr.append(tdName, tdEmail, tdState, tdAct);
      tbody.append(tr);
    }
    table.append(tbody);
    listWrap.append(table);
  };

  void draw();
}

export function renderLeaveRequestsSection(
  container: HTMLElement,
  payroll: PayrollData,
  commit: (payroll: PayrollData, what: string) => Promise<void>,
): void {
  const bookId = openCloudBookId();
  if (!bookId) return;

  const box = document.createElement("div");
  box.className = "payroll-leave-requests";
  box.style.marginBottom = "16px";
  container.prepend(box);

  const empName = (id: string): string => payroll.employees.find((e) => e.id === id)?.name ?? id;

  const draw = async (): Promise<void> => {
    const reqs = await rpc<BookLeaveRequest[]>("employee_leave_requests_for_book", { p_book: bookId });
    box.textContent = "";
    if (!reqs || reqs.length === 0) return;

    const pendingCount = reqs.filter((r) => r.status === "pending").length;
    const h = document.createElement("h3");
    h.textContent = pendingCount > 0 ? `Employee leave requests (${pendingCount} pending)` : "Employee leave requests";
    box.append(h);

    const table = document.createElement("table");
    table.className = "report-table owner-table";
    table.innerHTML = `
      <thead>
        <tr>
          <th>Employee</th>
          <th>Type</th>
          <th>Dates</th>
          <th>Days</th>
          <th>Note</th>
          <th>Status</th>
          <th></th>
        </tr>
      </thead>
    `;
    const tbody = document.createElement("tbody");

    for (const req of reqs) {
      const tr = document.createElement("tr");
      const add = (text: string): HTMLTableCellElement => {
        const td = document.createElement("td");
        td.textContent = text;
        tr.append(td);
        return td;
      };
      add(empName(req.employee_id));
      add(req.kind);
      add(`${req.from_date} to ${req.to_date}`);
      add(String(req.days));
      add([req.note, req.decision_note ? `Reply: ${req.decision_note}` : ""].filter(Boolean).join(" — "));
      add(req.status);
      const act = add("");
      act.style.whiteSpace = "nowrap";

      if (req.status === "pending") {
        const approve = document.createElement("button");
        approve.type = "button";
        approve.className = "small primary";
        approve.textContent = "Approve";
        approve.addEventListener("click", () => {
          approve.disabled = true;
          void rpc<string>("employee_leave_request_decide", {
            p_request_id: req.id,
            p_status: "approved",
            p_note: "",
          }).then(async (res) => {
            if (res !== "approved") {
              approve.disabled = false;
              void tellOnPage("Could not approve leave request.");
              return;
            }
            const entry: LeaveTaken = {
              employeeId: req.employee_id,
              kind: req.kind as LeaveKind,
              from: req.from_date,
              to: req.to_date,
              days: Number(req.days),
              ...(req.note ? { note: req.note } : {}),
            };
            await commit(
              { ...payroll, leave: [...(payroll.leave ?? []), entry] },
              `Approved ${req.kind} leave for ${empName(req.employee_id)}`,
            );
          });
        });

        const decline = document.createElement("button");
        decline.type = "button";
        decline.className = "small remove";
        decline.style.marginLeft = "6px";
        decline.textContent = "Decline";
        decline.addEventListener("click", () => {
          void askTextOnPage(`Optional reason for declining ${empName(req.employee_id)}'s leave request:`, "", "Decline").then((reason) => {
            if (reason === null) return;
            decline.disabled = true;
            void rpc<string>("employee_leave_request_decide", {
              p_request_id: req.id,
              p_status: "declined",
              p_note: reason.trim(),
            }).then(() => void draw());
          });
        });
        act.append(approve, decline);
      }
      tbody.append(tr);
    }
    table.append(tbody);
    box.append(table);
  };

  void draw();
}
