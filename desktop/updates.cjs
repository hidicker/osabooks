"use strict";
// Keeping the installed program up to date, from the GitHub releases named in
// edition.json. It asks GitHub whether there is a newer release, a little after
// starting and every few hours while open; that request is all that leaves the
// computer, and the books are never part of it. A newer one downloads in the
// background and is installed when the program closes, or straight away if the
// person chooses to restart. Nothing happens offline, or in an edition with no
// releases named, or run from a checkout.

const { app, dialog, shell } = require("electron");
const { existsSync, readFileSync } = require("node:fs");
const { join } = require("node:path");

const FIRST_LOOK_MS = 15 * 1000;
const EVERY_MS = 6 * 60 * 60 * 1000;

/** True when this packaged build carries a Authenticode publisherName to verify updates against. */
function isSignedBuild() {
  try {
    const cfg = join(process.resourcesPath, "app-update.yml");
    if (!existsSync(cfg)) return false;
    return /^\s*publisherName\s*:/m.test(readFileSync(cfg, "utf8"));
  } catch {
    return false;
  }
}

function startUpdates(edition, mainWindow) {
  if (!app.isPackaged || !edition.updates) return { checkNow: null };
  const { autoUpdater } = require("electron-updater");
  const signed = isSignedBuild();
  // Never silently download and execute unsigned installers (deep audit H1).
  // Once OSABOOKS_PUBLISHER_NAME is configured at build time, app-update.yml
  // includes publisherName and signed auto-updates turn back on automatically.
  autoUpdater.autoDownload = signed;
  autoUpdater.autoInstallOnAppQuit = signed;
  // A pre-release is for trying out, not for everyone's books.
  autoUpdater.allowPrerelease = false;

  let asked = false; // someone chose "Check for updates", so say what was found
  let ready = null; // the version downloaded and waiting, once there is one

  const offerRestart = async (info) => {
    const { response } = await dialog.showMessageBox(mainWindow() ?? undefined, {
      type: "info",
      title: `${edition.name} update`,
      message: `${edition.name} ${info.version} is ready.`,
      detail: "Restart now to use it, or it is installed when you next close the program. Your books are not changed by updating.",
      buttons: ["Restart now", "When I close it"],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 0) autoUpdater.quitAndInstall();
  };

  autoUpdater.on("update-downloaded", (info) => {
    const first = ready === null;
    ready = info;
    asked = false;
    if (first) void offerRestart(info);
  });

  autoUpdater.on("update-not-available", () => {
    if (!asked) return;
    asked = false;
    void dialog.showMessageBox(mainWindow() ?? undefined, {
      type: "info",
      title: `${edition.name} update`,
      message: `${edition.name} ${app.getVersion()} is the newest.`,
    });
  });

  autoUpdater.on("update-available", (info) => {
    if (!signed) {
      if (!asked) return;
      asked = false;
      const releases = `https://github.com/${edition.updates.owner}/${edition.updates.repo}/releases/latest`;
      void dialog
        .showMessageBox(mainWindow() ?? undefined, {
          type: "info",
          title: `${edition.name} update`,
          message: `${edition.name} ${info.version} is available.`,
          detail: "Automatic download is off until this edition is code-signed. Open the releases page to download it manually.",
          buttons: ["Open releases page", "Later"],
          defaultId: 0,
          cancelId: 1,
        })
        .then(({ response }) => {
          if (response === 0) void shell.openExternal(releases);
        });
      return;
    }
    if (!asked) return;
    asked = false;
    void dialog.showMessageBox(mainWindow() ?? undefined, {
      type: "info",
      title: `${edition.name} update`,
      message: `${edition.name} ${info.version} is downloading.`,
      detail: "You are asked to restart when it is ready.",
    });
  });

  autoUpdater.on("error", (error) => {
    // Offline, or GitHub not answering: the next look tries again. Only said
    // when someone asked.
    if (!asked) return;
    asked = false;
    dialog.showErrorBox(`${edition.name} update`, `Could not check for a newer version: ${error?.message ?? error}`);
  });

  const look = () => autoUpdater.checkForUpdates().catch(() => undefined);
  setTimeout(look, FIRST_LOOK_MS);
  setInterval(look, EVERY_MS).unref?.();

  return {
    checkNow: () => {
      if (ready !== null) {
        void offerRestart(ready);
        return;
      }
      asked = true;
      void look();
    },
  };
}

module.exports = { startUpdates };
