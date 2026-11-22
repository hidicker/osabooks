/**
 * Reloading the app and coming back to the page it was on.
 *
 * Some things only take effect from a fresh start (a sign-in, a two-factor
 * code), so the page reloads; and a reload opens on the usual first page.
 * Somebody who gave their code on the Books page then found themselves on
 * Reconcile, with nothing to say the code had worked. The page to come back
 * to, and what to say there, are kept for this tab only, and read once.
 */
const KEY = "nzosa:reload-onto";

export interface ReloadOnto {
  page: string;
  message?: string;
}

/** Reload, and open on `page` afterwards, saying `message` if given. */
export function reloadOnto(page: string, message?: string): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(message === undefined ? { page } : { page, message }));
  } catch {
    // Not kept: the app opens where it usually does, which is how it was.
  }
  location.reload();
}

/** Where the reload asked to come back to, once; null when it did not. */
export function pageAfterReload(): ReloadOnto | null {
  let raw: string | null;
  try {
    raw = sessionStorage.getItem(KEY);
    if (raw !== null) sessionStorage.removeItem(KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;
  try {
    const held = JSON.parse(raw) as Partial<ReloadOnto>;
    if (typeof held.page !== "string" || held.page === "") return null;
    return typeof held.message === "string" ? { page: held.page, message: held.message } : { page: held.page };
  } catch {
    return null;
  }
}
