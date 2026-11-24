import {
  answerConnectRequest,
  connectRequest,
  currentSession,
  noteConnectorConsent,
  signIn,
  signInWithGoogle,
  signedIn,
  signedInWithCode,
  takeAuthError,
} from "./cloud.js";
import { codeAskedFor } from "./daily/two-factor-ui.js";
import { knownApp, returnHost } from "@nzosa/core";

/**
 * An outside AI app asking to connect: the screen Supabase's OAuth server
 * sends the person to, with `authorization_id` in the address.
 *
 * Shown instead of the app, because it is a question to answer and go back:
 * allow it, and the browser returns to Claude (or whichever app asked) signed
 * in; refuse, and it returns without. Somebody not yet signed in to OsaBooks is
 * asked to first, here, and the question is asked after.
 */

function param(): string | null {
  return new URLSearchParams(location.search).get("authorization_id");
}

/** True when the screen took over: the app is not to start. */
export async function connectInterrupts(): Promise<boolean> {
  const id = param();
  if (id === null || id === "") return false;
  const screen = document.createElement("main");
  screen.className = "connect-screen";
  document.body.textContent = "";
  document.body.append(screen);
  await draw(screen, id);
  return true;
}

/**
 * Where the browser is sent back to: an http(s) address and nothing else. The
 * address comes from the app that asked to connect, and a javascript: one
 * would run on this site.
 */
function goBack(card: HTMLElement, address: string): void {
  let url: URL | null = null;
  try {
    url = new URL(address);
  } catch {
    url = null;
  }
  if (url === null || (url.protocol !== "https:" && url.protocol !== "http:")) {
    card.append(el("p", "The app gave an address to return to that OsaBooks will not open. Go back to your AI app and connect again."));
    return;
  }
  location.assign(url.toString());
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text = "", className = ""): HTMLElementTagNameMap[K] {
  const made = document.createElement(tag);
  if (text !== "") made.textContent = text;
  if (className !== "") made.className = className;
  return made;
}

async function draw(screen: HTMLElement, id: string): Promise<void> {
  screen.textContent = "";
  const card = el("section", "", "connect-card");
  screen.append(card);
  card.append(el("h1", "Connect an AI app to OsaBooks"));

  if (!signedIn()) {
    signInHere(card, () => void draw(screen, id));
    return;
  }
  // Somebody with an authenticator gives its code before connecting: the
  // connection carries the sign-in it was made with, and books that need the
  // code refuse a connection made without it.
  const askCode = await codeAskedFor({
    onVerified: () => void draw(screen, id),
    buttonLabel: "Continue",
    intro: "Give the code from your authenticator app before connecting this app.",
  });
  if (askCode !== null) {
    card.append(askCode);
    return;
  }

  const asked = await connectRequest(id);
  if (asked === null) {
    card.append(
      el("p", "This request to connect has expired or was already answered. Go back to your AI app and connect again."),
    );
    return;
  }
  // Allowed before: straight back (recording this aal2 sign-in so an app
  // approved before 2FA was turned on is not deadlocked in the connector).
  if (asked.authorization_id === undefined && asked.redirect_url !== undefined) {
    if (asked.client?.id !== undefined && asked.client.id !== "" && signedInWithCode()) {
      await noteConnectorConsent(asked.client.id);
    }
    goBack(card, asked.redirect_url);
    return;
  }

  // The name is whatever the app registered with, so it proves nothing: any
  // app can call itself Claude. Where it sends the browser back to is what
  // tells them apart, so that is said, and an app OsaBooks does not know by
  // it is marked as such (code review of 20 November, 4.1).
  const selfName = (asked.client?.client_name ?? asked.client?.name ?? "").trim().slice(0, 60);
  const known = knownApp(asked.redirect_uri);
  const host = returnHost(asked.redirect_uri);
  const who = currentSession()?.email ?? "you";
  if (known !== null) {
    card.append(
      el("p", `${known} is asking to connect to OsaBooks as ${who}.`, "connect-who"),
      el("p", `Once you answer, you go back to ${host}.`, "connect-where"),
    );
  } else {
    card.append(
      el(
        "p",
        `An app ${selfName === "" ? "with no name" : `calling itself “${selfName}”`} is asking to connect to OsaBooks as ${who}.`,
        "connect-who",
      ),
      el(
        "p",
        `OsaBooks does not know this app: once you answer, it sends you to ${host ?? "an address it cannot show"}. ` +
          "Allow it only if you set it up yourself. Claude and ChatGPT send you back to their own sites.",
        "connect-unverified",
      ),
    );
  }
  card.append(el("p", "Allowed, it can, for any set of books you give it the connector address of:"));
  const can = el("ul");
  for (const line of [
    "read the books: transactions, accounts, coding and entities;",
    "suggest codes, splits and journals, which wait in OsaBooks until you use or decline each one.",
  ]) {
    can.append(el("li", line));
  }
  card.append(can);
  card.append(
    el(
      "p",
      "It cannot change the books, invite anybody, change settings, or see the bank feed's keys. " +
        "What it reads is sent to the company that runs it. A read-only member's app only reads.",
    ),
  );
  const said = el("p", "", "connect-said");
  const allow = el("button", "Allow", "primary");
  const deny = el("button", "Deny");
  allow.type = "button";
  deny.type = "button";
  const decide = async (action: "approve" | "deny"): Promise<void> => {
    allow.disabled = true;
    deny.disabled = true;
    said.textContent = action === "approve" ? "Connecting…" : "Refusing…";
    const back = await answerConnectRequest(id, action, asked.client?.id);
    if (back === null) {
      said.textContent = "That did not go through. Go back to your AI app and connect again.";
      return;
    }
    goBack(card, back);
  };
  allow.addEventListener("click", () => void decide("approve"));
  deny.addEventListener("click", () => void decide("deny"));
  const buttons = el("div", "", "connect-buttons");
  buttons.append(allow, deny);
  card.append(buttons, said);
}

function signInHere(card: HTMLElement, then: () => void): void {
  card.append(el("p", "Sign in to OsaBooks first, with the account your books are kept under."));
  const form = el("form", "", "connect-signin");
  const email = el("input");
  email.type = "email";
  email.autocomplete = "username";
  email.placeholder = "Email";
  email.required = true;
  const password = el("input");
  password.type = "password";
  password.autocomplete = "current-password";
  password.placeholder = "Password";
  password.required = true;
  const go = el("button", "Sign in", "primary");
  go.type = "submit";
  const said = el("p", "", "connect-said");
  const priorError = takeAuthError();
  if (priorError !== null) said.textContent = priorError;
  form.append(email, password, go, said);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    go.disabled = true;
    void signIn(email.value.trim(), password.value).then((result) => {
      go.disabled = false;
      if (result.ok) then();
      else said.textContent = result.why;
    });
  });
  const google = el("button", "Sign in with Google");
  google.type = "button";
  google.addEventListener("click", () => void signInWithGoogle());
  card.append(form, google);
}
