"use strict";
// OsaBooks as a program for Windows.
//
// The same app as OsaBooks in a browser, in a window of its own. Its server
// runs inside this program, on this computer only (127.0.0.1), and its books
// are plain files in a folder in the home folder: nothing about them is
// uploaded. Not Documents, which on many computers is kept in step with
// OneDrive or iCloud: books would then be copied to a cloud nobody chose.
//
// Who it is, which port it uses and where its books go are in edition.json,
// so a build of OsaBooks that carries more can say so there and run beside
// this one. Run from a checkout (`npm start` in this folder) it serves the
// server staged beside this file; installed, the server is in the program's
// resources.

const { app, BrowserWindow, Menu, dialog, shell } = require("electron");
const { existsSync, mkdirSync } = require("node:fs");
const { join } = require("node:path");
const { pathToFileURL } = require("node:url");
const edition = require("./edition.json");
const { startUpdates } = require("./updates.cjs");

// Fixed, because the browser keeps a few settings per address.
const PORT = edition.port;
const ORIGIN = `http://127.0.0.1:${PORT}`;

let window = null;
let running = null;

function serverFolder() {
  return app.isPackaged ? join(process.resourcesPath, "server") : join(__dirname, "stage", "server");
}

function booksFolder() {
  return join(app.getPath("home"), edition.folder, "books");
}

async function startOwnServer() {
  const folder = serverFolder();
  if (!existsSync(join(folder, "server.js"))) {
    throw new Error(`The program's own files are missing (${folder}). Reinstall ${edition.name}.`);
  }
  const books = booksFolder();
  mkdirSync(books, { recursive: true });
  // The server serves the built app from its own dist folder.
  process.env["OSABOOKS_DIST"] = join(folder, "dist");
  // Tells the server it is inside this program, for what only works outside
  // it (the morning run, which Windows would start as this program).
  process.env["OSABOOKS_DESKTOP"] = "1";
  const { startServer } = await import(pathToFileURL(join(folder, "server.js")).href);
  running = await startServer({ port: PORT, ledgerRoot: books, ledgerId: "my-books" });
}

function openWindow() {
  window = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 760,
    minHeight: 560,
    title: edition.name,
    backgroundColor: "#f4f6fa",
    webPreferences: {
      // The page is a web app and nothing more: no access to this computer
      // beyond what a browser tab has.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  });
  void window.loadURL(ORIGIN);
  // The page names itself "OsaBooks"; this program says which one it is.
  window.on("page-title-updated", (event) => event.preventDefault());

  // Anything that is not the app opens in the person's own browser, not here:
  // links in guides, a bank's sign-in, a donation page.
  const isApp = (url) => url.startsWith(`${ORIGIN}/`) || url === ORIGIN;
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (!isApp(url)) {
      event.preventDefault();
      if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    }
  });
  window.on("closed", () => {
    window = null;
  });
}

// One copy at a time: a second double-click brings the first to the front.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (window !== null) {
      if (window.isMinimized()) window.restore();
      window.focus();
    }
  });

  app.whenReady().then(async () => {
    const updates = startUpdates(edition, () => window);
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        { label: edition.name, submenu: [{ role: "reload" }, { role: "togglefullscreen" }, { type: "separator" }, { role: "quit" }] },
        { label: "Edit", submenu: [{ role: "undo" }, { role: "redo" }, { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }] },
        { label: "View", submenu: [{ role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }] },
        {
          label: "Help",
          submenu: [
            { label: "Open the books folder", click: () => void shell.openPath(booksFolder()) },
            { label: "Guides", click: () => void shell.openExternal(edition.guides) },
            ...(updates.checkNow !== null
              ? [{ type: "separator" }, { label: "Check for updates", click: updates.checkNow }]
              : []),
            { type: "separator" },
            { label: `${edition.name} ${app.getVersion()}`, enabled: false },
          ],
        },
      ]),
    );
    try {
      await startOwnServer();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Books already open in another window, or the port taken: said plainly.
      dialog.showErrorBox(`${edition.name} could not start`, message);
      app.quit();
      return;
    }
    openWindow();
  });

  app.on("window-all-closed", () => app.quit());
  app.on("activate", () => {
    if (window === null && running !== null) openWindow();
  });
  app.on("will-quit", () => {
    // The server lets go of the books as the program ends.
    try {
      if (running && typeof running.close === "function") running.close();
    } catch {
      // Leaving anyway.
    }
  });
}
