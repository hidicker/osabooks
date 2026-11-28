"use strict";
// Keeping the installed program up to date, from the GitHub releases named in
// edition.json. It asks GitHub whether there is a newer release, a little after
// starting and every few hours while open; that request is all that leaves the
// computer, and the books are never part of it. Nothing happens offline, or in
// an edition with no releases named, or run from a checkout.
//
// An update is installed by itself only when it is proved to be the
// publisher's (deep audit H1: never silently run an installer anyone with the
// GitHub account could have put there):
//
// - a code-signed build (publisherName in app-update.yml): the updater checks
//   the installer's Authenticode signature itself;
// - otherwise, an edition with our own update key ("updateKey" in
//   edition.json): it downloads, and installs only once the release's own
//   signature (`<installer>.sig`, update-signature.cjs) checks out against
//   that key. One that does not is never installed.
//
// Any other build is told about a newer version -- once per version, without
// being asked -- with a link to download it, and installs nothing itself.

const { app, dialog, shell } = require("electron");
const { existsSync, readFileSync, writeFileSync } = require("node:fs");
const { basename, join } = require("node:path");
const { verifyUpdate } = require("./update-signature.cjs");

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

/** The newest version this computer has already been told about, so it is said once. */
function noticeFile() {
  return join(app.getPath("userData"), "update-notice.json");
}
function lastNoticed() {
  try {
    return String(JSON.parse(readFileSync(noticeFile(), "utf8")).version ?? "");
  } catch {
    return "";
  }
}
function rememberNoticed(version) {
  try {
    writeFileSync(noticeFile(), JSON.stringify({ version }));
  } catch {
    // Only a convenience: at worst the notice is shown again.
  }
}

function startUpdates(edition, mainWindow) {
  if (!app.isPackaged || !edition.updates) return { checkNow: null };
  const { autoUpdater } = require("electron-updater");
  const signed = isSignedBuild();
  const key = typeof edition.updateKey === "string" && edition.updateKey.trim() !== "" ? edition.updateKey.trim() : null;
  const releases = `https://github.com/${edition.updates.owner}/${edition.updates.repo}/releases/latest`;
  // Code-signed: as electron-updater does it. Our own key: download, but
  // install only after the signature checks out (turned on below). Neither:
  // nothing downloads.
  autoUpdater.autoDownload = signed || key !== null;
  autoUpdater.autoInstallOnAppQuit = signed;
  // A pre-release is for trying out, not for everyone's books.
  autoUpdater.allowPrerelease = false;

  let asked = false; // someone chose "Check for updates", so say what was found
  let ready = null; // the version downloaded and proved, once there is one

  const say = (message, detail) =>
    void dialog.showMessageBox(mainWindow() ?? undefined, { type: "info", title: `${edition.name} update`, message, ...(detail ? { detail } : {}) });

  /** A newer version this program will not install itself: said once per version, with where to get it. */
  const notice = (version, why) => {
    if (!asked && lastNoticed() === version) return;
    asked = false;
    rememberNoticed(version);
    void dialog
      .showMessageBox(mainWindow() ?? undefined, {
        type: "info",
        title: `${edition.name} update`,
        message: `${edition.name} ${version} is available.`,
        detail: `${why} Download it from the releases page and run it; your books are not changed by updating.`,
        buttons: ["Open releases page", "Later"],
        defaultId: 0,
        cancelId: 1,
      })
      .then(({ response }) => {
        if (response === 0) void shell.openExternal(releases);
      });
  };

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

  /** The release's own signature, from the newest release, or null. */
  const fetchSignature = async (fileName) => {
    try {
      const url = `https://github.com/${edition.updates.owner}/${edition.updates.repo}/releases/latest/download/${encodeURIComponent(fileName)}.sig`;
      const response = await fetch(url, { redirect: "follow" });
      if (!response.ok) return null;
      const text = (await response.text()).trim();
      return text.length > 0 && text.length < 1000 ? text : null;
    } catch {
      return null;
    }
  };

  autoUpdater.on("update-downloaded", async (info) => {
    if (!signed) {
      // Our own key: nothing installs until the signature checks out.
      const fileName = String(info.path ?? info.files?.[0]?.url ?? basename(String(info.downloadedFile ?? "")));
      const signature = await fetchSignature(fileName);
      const proved =
        signature !== null && typeof info.downloadedFile === "string" && (await verifyUpdate(info.downloadedFile, fileName, String(info.version), signature, key));
      if (!proved) {
        autoUpdater.autoInstallOnAppQuit = false;
        notice(String(info.version), "It could not be proved to come from the publisher, so it was not installed.");
        return;
      }
      autoUpdater.autoInstallOnAppQuit = true;
    }
    const first = ready === null;
    ready = info;
    asked = false;
    if (first) void offerRestart(info);
  });

  autoUpdater.on("update-not-available", () => {
    if (!asked) return;
    asked = false;
    say(`${edition.name} ${app.getVersion()} is the newest.`);
  });

  autoUpdater.on("update-available", (info) => {
    if (!signed && key === null) {
      notice(String(info.version), "This edition does not install updates by itself.");
      return;
    }
    if (!asked) return;
    asked = false;
    say(`${edition.name} ${info.version} is downloading.`, "You are asked to restart when it is ready.");
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
