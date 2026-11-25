"use strict";
// Signing in to a service the edition's pages call (edition.json "connect":
// for OsaBooks Pro, the filing service and, through it, myIR), inside this
// program.
//
// Everything else the page opens goes to the person's own browser. A sign-in
// cannot: the service sends the person back to the app with a one-time code in
// the address (#myir=finish&code=...&state=...), and only the app that started
// it can finish, as it holds the licence key or the sign-in. In the person's
// browser it would land on the website, which has neither, and the connection
// would never be made. So the sign-in runs in a window of this program, the
// return is caught before it loads anywhere, and its fragment is handed to the
// app's own window, which finishes as it does online.
//
// The window keeps nothing: its own session, in memory, gone when it closes.
// OsaBooks itself connects to no such service, so for it none of this runs.

/** Whether the page is opening a sign-in at one of the edition's services. */
function isSignInStart(url, connect) {
  let origin;
  try {
    origin = new URL(url).origin;
  } catch {
    return false;
  }
  return Array.isArray(connect) && connect.includes(origin);
}

/**
 * The fragment the app finishes from, if this address is the service sending
 * the person back ("myir=finish&code=...&state=..." or "myir=failed"); null
 * for any other address.
 */
function appReturn(url) {
  let hash;
  try {
    hash = new URL(url).hash.replace(/^#/, "");
  } catch {
    return null;
  }
  const said = new URLSearchParams(hash).get("myir");
  return said === "finish" || said === "failed" ? hash : null;
}

/** Pages the sign-in window may show: https, or a service on this computer. */
function mayShow(url) {
  try {
    const at = new URL(url);
    return at.protocol === "https:" || (at.protocol === "http:" && (at.hostname === "127.0.0.1" || at.hostname === "localhost"));
  } catch {
    return false;
  }
}

/**
 * Opens the sign-in in a window over the app's, and calls back with the
 * return's fragment when the service sends the person back. Closing the window
 * first just ends it; the app is left as it was.
 */
function openSignInWindow(parent, url, onReturn) {
  const { BrowserWindow, shell } = require("electron");
  const signIn = new BrowserWindow({
    parent,
    width: 520,
    height: 720,
    title: "Sign in",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Not "persist:": kept in memory only. And a new one each time: one
      // name was one session for as long as the program ran, so a second
      // sign-in found the first one's cookies.
      partition: `sign-in-${require("node:crypto").randomUUID()}`,
    },
  });
  signIn.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  signIn.webContents.session.setPermissionCheckHandler(() => false);
  signIn.on("page-title-updated", (event) => event.preventDefault());
  let back = false;
  const watch = (event, to) => {
    const fragment = appReturn(to);
    if (fragment === null) {
      if (!mayShow(to)) event.preventDefault();
      return;
    }
    event.preventDefault();
    if (back) return;
    back = true;
    onReturn(fragment);
    if (!signIn.isDestroyed()) signIn.close();
  };
  // The service answers the sign-in with a redirect, so the return is seen
  // here before anything is fetched from it.
  signIn.webContents.on("will-redirect", watch);
  signIn.webContents.on("will-navigate", watch);
  signIn.webContents.setWindowOpenHandler(({ url: other }) => {
    if (/^https:\/\//.test(other)) void shell.openExternal(other);
    return { action: "deny" };
  });
  // A load stopped on purpose (the return caught above) rejects: not an error.
  if (mayShow(url)) signIn.loadURL(url).catch(() => {});
  else signIn.close();
  return signIn;
}

module.exports = { isSignInStart, appReturn, mayShow, openSignInWindow };
