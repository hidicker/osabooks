import { state } from "../state.js";
import { PAY_ACCOUNTS, findPayAccounts } from "@nzosa/core";
import type { Account, PayAccount } from "@nzosa/core";

/**
 * The accounts a US payday posts to: the one chosen for each part, else the
 * chart's by name (as the Form 941 worksheet finds them), else added to the
 * chart under the name the import gives it. Shared by the payroll register
 * import and the pay runs, so both post to the same accounts.
 */

const label = (a: Account): string => `${a.name} - ${a.code}`;

/** A free code near `start`, for an account the books lack. */
function freeCode(start: number, taken: Set<string>): string {
  let n = start;
  while (taken.has(String(n))) n += 1;
  taken.add(String(n));
  return String(n);
}

/** The accounts the paydays post to, adding to the chart any the books lack. */
export function settleAccounts(used: readonly PayAccount[], chosen: Map<PayAccount, string> = new Map()): Partial<Record<PayAccount, string>> {
  // Codes in the chart, and any a journal already posts to, so an account added
  // here never takes a code something else is using.
  const taken = new Set(state.chart.map((a) => a.code.trim()));
  const codeIn = (label: string): string | undefined => /\s-\s*([A-Za-z0-9.]+)\s*$/.exec(label)?.[1];
  for (const j of state.ledger.manualJournals ?? []) for (const l of j.lines) {
    const code = codeIn(l.code);
    if (code !== undefined) taken.add(code);
  }
  for (const label of Object.values(state.ledger.usPayroll?.accounts ?? {})) {
    const code = label === undefined ? undefined : codeIn(label);
    if (code !== undefined) taken.add(code);
  }
  const found = findPayAccounts(state.chart);
  const added: Account[] = [];
  const out: Partial<Record<PayAccount, string>> = {};
  for (const id of used) {
    const code = chosen.get(id) ?? found[id]?.code ?? "";
    const account = state.chart.find((a) => a.code.trim() === code);
    if (account !== undefined) {
      out[id] = label(account);
      continue;
    }
    const spec = PAY_ACCOUNTS.find((a) => a.id === id);
    if (spec === undefined) continue;
    const fresh = {
      code: freeCode(spec.type === "Expense" ? 6300 : 2100, taken),
      name: spec.name,
      type: spec.type,
      taxCode: "Tax Exempt",
      description: "",
    } as Account;
    added.push(fresh);
    chosen.set(id, fresh.code);
    out[id] = label(fresh);
  }
  if (added.length > 0) {
    state.chart = [...state.chart, ...added];
    const model = state.ledger.entities;
    const owner = model?.entities.find((e) => e.kind !== "personal" && e.kind !== "residential")?.id ?? model?.entities[0]?.id;
    state.ledger = {
      ...state.ledger,
      chart: state.chart,
      ...(model !== undefined && owner !== undefined
        ? { entities: { ...model, accounts: { ...model.accounts, ...Object.fromEntries(added.map((a) => [a.code, owner])) } } }
        : {}),
    };
  }
  return out;
}

