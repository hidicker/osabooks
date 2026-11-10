import {
  authenticators,
  currentSession,
  giveCode,
  removeAuthenticator,
  rpc,
  signedInWithCode,
  startAuthenticator,
  type Authenticator,
} from "../cloud.js";
import { usingOwnProject } from "../cloud-config.js";
import { askOnPage, note } from "../ui.js";

/**
 * Two-factor sign-in on the screen: the code asked for after signing in, the
 * account's authenticators, and an owner requiring it for a set of books.
 *
 * Only asked and shown here. The database decides what may be opened without a
 * code (is_member and has_role, migration 20261110090000_two_factor): somebody
 * with an authenticator gives the code on each new sign-in, and books whose
 * owner requires it open only after a code. A browser that has given it stays
 * signed in, so it is asked again only on a new computer or browser, or after
 * signing out.
 *
 * Not offered on a project of somebody's own, whose database is set up without
 * that migration: an authenticator there would be asked for and enforce nothing.
 */

function said(box: HTMLElement, message: string, bad = false): void {
  box.textContent = message;
  box.className = bad ? "cloud-said bad" : "cloud-said";
}

/** A six-digit code box, with what to press. */
function codeInput(): HTMLInputElement {
  const code = document.createElement("input");
  code.type = "text";
  code.inputMode = "numeric";
  code.autocomplete = "one-time-code";
  code.pattern = "[0-9 ]{6,7}";
  code.maxLength = 7;
  code.placeholder = "123 456";
  code.required = true;
  code.className = "two-factor-code";
  return code;
}

/** Whether these books' server keeps two-factor at all. */
export function twoFactorOffered(): boolean {
  return !usingOwnProject();
}

/**
 * Asked once after signing in, when this account has an authenticator and this
 * sign-in has not given its code. Null when nothing is asked. On a right code
 * the page reloads, as signing in does, with everything now open.
 */
export async function codeAskedFor(): Promise<HTMLElement | null> {
  if (!twoFactorOffered() || signedInWithCode()) return null;
  const mine = (await authenticators())?.filter((a) => a.verified) ?? [];
  if (mine.length === 0) return null;

  const form = document.createElement("form");
  form.className = "cloud-form two-factor-ask";
  const heading = document.createElement("h3");
  heading.textContent = "The code from your authenticator app";
  form.append(
    heading,
    note("Your books open once you give it. This browser then stays signed in, so you are asked again only on a new computer or browser, or after signing out."),
  );

  let which: Authenticator = mine[0] as Authenticator;
  if (mine.length > 1) {
    const choose = document.createElement("select");
    for (const one of mine) {
      const option = document.createElement("option");
      option.value = one.id;
      option.textContent = one.name;
      choose.append(option);
    }
    choose.addEventListener("change", () => {
      which = mine.find((a) => a.id === choose.value) ?? which;
    });
    const label = document.createElement("label");
    label.append("Authenticator", choose);
    form.append(label);
  }

  const code = codeInput();
  const label = document.createElement("label");
  label.append("Code", code);
  const go = document.createElement("button");
  go.type = "submit";
  go.className = "primary";
  go.textContent = "Open my books";
  const answer = document.createElement("p");
  answer.className = "cloud-said";
  form.append(label, go, answer);

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    go.disabled = true;
    said(answer, "Checking…");
    void giveCode(which.id, code.value).then((result) => {
      if (result.ok) {
        location.reload();
        return;
      }
      go.disabled = false;
      said(answer, result.why, true);
      code.select();
    });
  });
  setTimeout(() => code.focus(), 0);
  return form;
}

/**
 * Books this person belongs to that are not opening for want of a code, named
 * so they do not simply vanish from the list. Null when there are none.
 */
export async function booksWaitingForCode(): Promise<HTMLElement | null> {
  if (!twoFactorOffered()) return null;
  const waiting = await rpc<{ id: string; name: string; required: boolean }[]>("books_waiting_for_two_factor", {});
  if (waiting === null || waiting.length === 0) return null;
  const hasOne = ((await authenticators()) ?? []).some((a) => a.verified);
  const names = waiting.map((w) => w.name).join(", ");
  return note(
    hasOne
      ? `Waiting for your code: ${names}.`
      : `${names} ${waiting.length === 1 ? "needs" : "need"} two-factor sign-in, which ` +
          `${waiting.length === 1 ? "its owner has" : "their owners have"} turned on. Set up an authenticator below, ` +
          "then sign in with its code to open them.",
  );
}

/**
 * The account's authenticators: set one up, add a spare, or remove one. Folded
 * away under "Two-factor sign-in" once there is one, open while there is none.
 */
export function twoFactorSettings(): HTMLElement | null {
  if (!twoFactorOffered()) return null;
  const fold = document.createElement("details");
  fold.className = "two-factor";
  const summary = document.createElement("summary");
  summary.textContent = "Two-factor sign-in";
  fold.append(summary);
  const inside = document.createElement("div");
  fold.append(inside);

  const draw = async (): Promise<void> => {
    inside.textContent = "";
    const all = await authenticators();
    if (all === null) {
      inside.append(note("Could not read this account's authenticators."));
      return;
    }
    const mine = all.filter((a) => a.verified);
    summary.textContent = mine.length > 0 ? "Two-factor sign-in: on" : "Two-factor sign-in: off";

    if (mine.length === 0) {
      inside.append(
        note(
          "A six-digit code from an app on your phone, asked when you sign in on a new computer or browser. " +
            "Somebody who learns your password still cannot open your books. Google Authenticator, Microsoft " +
            "Authenticator, 1Password and most password managers can all give the code.",
        ),
      );
    } else {
      const list = document.createElement("ul");
      list.className = "two-factor-list";
      for (const one of mine) {
        const item = document.createElement("li");
        item.append(one.name, " ");
        const remove = document.createElement("button");
        remove.type = "button";
        remove.textContent = "Remove";
        remove.addEventListener("click", () => {
          const last = mine.length === 1;
          void askOnPage(
            last
              ? `Remove ${one.name}? Two-factor sign-in is then off for your account, and books whose owner requires it will not open.`
              : `Remove ${one.name}? Your other authenticator keeps working.`,
            "Remove",
          ).then((yes) => {
            if (!yes) return;
            remove.disabled = true;
            void removeAuthenticator(one.id).then((result) => {
              if (!result.ok) {
                remove.disabled = false;
                inside.append(note(signedInWithCode() ? result.why : "Sign in with a code first, then it can be removed."));
                return;
              }
              void draw();
            });
          });
        });
        item.append(remove);
        list.append(item);
      }
      inside.append(
        note("Asked for when you sign in on a new computer or browser. Each of these gives a code that works."),
        list,
      );
      if (mine.length === 1) {
        inside.append(
          note(
            "Worth adding a spare, such as your password manager, in case the phone is lost or replaced. Without " +
              "one, getting back in means asking for your two-factor to be reset.",
          ),
        );
      }
    }
    if (mine.length === 0 || signedInWithCode()) inside.append(setUp(mine.length === 0, draw));
  };

  void draw();
  return fold;
}

/**
 * Supabase's QR code as an image the browser will show.
 *
 * It comes as `data:image/svg+xml;utf-8,<svg …>` with the SVG unencoded, and
 * its colours (`fill="#000000"`) put a `#` in the address, which ends it there:
 * the image broke. Handed over as a file of its own instead (the page's
 * security rules allow blob images). Anything else is used as it comes.
 */
export function qrSource(qr: string): string {
  const parts = /^data:image\/svg\+xml(;[^,]*)?,([\s\S]*)$/.exec(qr);
  if (parts === null || /;base64/i.test(parts[1] ?? "")) return qr;
  let svg = parts[2] ?? "";
  if (/^%3C/i.test(svg)) {
    try {
      svg = decodeURIComponent(svg);
    } catch {
      // Left as it came: the image breaks, and the key below still works.
    }
  }
  return URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
}

/** Setting one up: scan, then confirm with the code it shows. */
function setUp(first: boolean, done: () => Promise<void>): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "two-factor-setup";
  const start = document.createElement("button");
  start.type = "button";
  start.className = first ? "primary" : "";
  start.textContent = first ? "Set up two-factor sign-in" : "Add a spare authenticator";
  const answer = document.createElement("p");
  answer.className = "cloud-said";
  wrap.append(start, answer);

  start.addEventListener("click", () => {
    start.disabled = true;
    said(answer, "Starting…");
    const name = first ? "Authenticator" : `Spare ${new Date().toLocaleDateString()}`;
    void startAuthenticator(name).then((made) => {
      if (!made.ok) {
        start.disabled = false;
        said(answer, made.why, true);
        return;
      }
      wrap.textContent = "";
      const steps = document.createElement("ol");
      steps.className = "two-factor-steps";
      const scan = document.createElement("li");
      scan.append("In your authenticator app, add an account and scan this code.");
      const qr = document.createElement("img");
      qr.src = qrSource(made.qr);
      qr.alt = "QR code to scan with an authenticator app";
      qr.width = 180;
      qr.height = 180;
      qr.className = "two-factor-qr";
      const key = document.createElement("p");
      key.className = "two-factor-key";
      key.append("Or type this key into it instead: ");
      const secret = document.createElement("code");
      secret.textContent = made.secret.replace(/(.{4})/g, "$1 ").trim();
      key.append(secret);
      scan.append(qr, key);
      const confirm = document.createElement("li");
      confirm.append("Type the six-digit code the app now shows, to confirm it works.");
      steps.append(scan, confirm);

      const form = document.createElement("form");
      form.className = "cloud-form";
      const code = codeInput();
      const label = document.createElement("label");
      label.append("Code", code);
      const go = document.createElement("button");
      go.type = "submit";
      go.className = "primary";
      go.textContent = "Turn it on";
      const reply = document.createElement("p");
      reply.className = "cloud-said";
      form.append(label, go, reply);
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        go.disabled = true;
        said(reply, "Checking…");
        void giveCode(made.id, code.value).then((result) => {
          if (!result.ok) {
            go.disabled = false;
            said(reply, result.why, true);
            code.select();
            return;
          }
          void done();
        });
      });
      wrap.append(steps, form);
      setTimeout(() => code.focus(), 0);
    });
  });
  return wrap;
}

/**
 * An owner requiring two-factor sign-in for a set of books, and who in them
 * has set it up. Shown to everybody in the books; changed only by an owner.
 */
export function twoFactorForBooks(book: { id: string; name: string }): HTMLElement | null {
  if (!twoFactorOffered()) return null;
  const wrap = document.createElement("div");
  wrap.className = "two-factor-books";
  const heading = document.createElement("h3");
  heading.textContent = "Two-factor sign-in";
  wrap.append(heading);
  const inside = document.createElement("div");
  wrap.append(inside);

  const draw = async (): Promise<void> => {
    const [rows, members] = await Promise.all([
      rpc<{ required: boolean; user_id: string; has_two_factor: boolean }[]>("book_two_factor", { p_book: book.id }),
      rpc<{ user_id: string; email: string; role: string }[]>("book_member_list", { book: book.id }),
    ]);
    inside.textContent = "";
    if (rows === null || rows.length === 0 || members === null) {
      wrap.hidden = true;
      return;
    }
    wrap.hidden = false;
    const required = rows[0]?.required === true;
    const me = currentSession()?.userId ?? "";
    const iAmOwner = members.some((m) => m.user_id === me && m.role === "owner");
    const without = members.filter((m) => !rows.find((r) => r.user_id === m.user_id)?.has_two_factor);

    inside.append(
      note(
        required
          ? "Required: everybody in these books signs in with a code from their authenticator app."
          : "Not required. Anybody who has set it up for their own account is asked for their code anyway.",
      ),
    );
    if (without.length > 0) {
      inside.append(
        note(
          `Not set up yet: ${without.map((m) => m.email + (m.user_id === me ? " (you)" : "")).join(", ")}.` +
            (required ? " They cannot open these books until they do." : ""),
        ),
      );
    }
    if (!iAmOwner) return;

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.textContent = required ? "Stop requiring it" : "Require it for everybody";
    const answer = document.createElement("p");
    answer.className = "cloud-said";
    toggle.addEventListener("click", () => {
      const turningOn = !required;
      if (turningOn && !signedInWithCode()) {
        said(answer, "Set up two-factor sign-in for your own account first (Books page), and sign in with it.", true);
        return;
      }
      void askOnPage(
        turningOn
          ? `Require two-factor sign-in for ${book.name}?` +
              (without.length > 0 ? ` ${without.length} ${without.length === 1 ? "person has" : "people have"} not set it up, and cannot open these books until they do.` : "")
          : `Stop requiring two-factor sign-in for ${book.name}? People who set it up for themselves are still asked for their code.`,
        turningOn ? "Require it" : "Stop requiring it",
      ).then((yes) => {
        if (!yes) return;
        toggle.disabled = true;
        void rpc<null>("set_two_factor_required", { p_book: book.id, p_on: turningOn }).then(async () => {
          // The function says nothing back either way: read the setting again.
          const after = await rpc<{ required: boolean }[]>("book_two_factor", { p_book: book.id });
          if (after?.[0]?.required !== turningOn) {
            toggle.disabled = false;
            said(answer, "It was not changed. Only an owner who has signed in with their code can change it.", true);
            return;
          }
          await draw();
        });
      });
    });
    inside.append(toggle, answer);
  };
  void draw();
  return wrap;
}
