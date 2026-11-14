"use strict";
// What electron-builder makes: the Windows installer. Who the program is comes
// from edition.json; whether it is signed from the environment (see sign.cjs).
const edition = require("./edition.json");

const signing = (process.env["OSABOOKS_SIGN_COMMAND"] ?? "").trim() !== "";

// The program's version, from the release tag: v2026.11.14 is 2026.1114.0 and
// v2026.11.14-2 is 2026.1114.2, so each release counts higher than the one
// before (a tag's "-2" would read as an earlier pre-release to the updater).
function versionFromTag(tag) {
  const found = /^v?(\d{4})\.(\d{1,2})\.(\d{1,2})(?:-(\d+))?$/.exec(tag.trim());
  if (found === null) throw new Error(`A release tag looks like v2026.11.14 or v2026.11.14-2, not "${tag}".`);
  const [, year, month, day, again] = found;
  return `${Number(year)}.${Number(month) * 100 + Number(day)}.${Number(again ?? 0)}`;
}
const tag = (process.env["OSABOOKS_RELEASE_TAG"] ?? "").trim();

module.exports = {
  appId: edition.appId,
  productName: edition.name,
  ...(tag !== "" ? { extraMetadata: { version: versionFromTag(tag) } } : {}),
  // Where an installed program looks for a newer one: the GitHub releases named
  // in edition.json. An edition without them is updated by hand.
  // OSABOOKS_UPDATE_URL points a test build at a folder served on this
  // computer instead, to try an update end to end (see README.md).
  publish: process.env["OSABOOKS_UPDATE_URL"]
    ? [{ provider: "generic", url: process.env["OSABOOKS_UPDATE_URL"] }]
    : edition.updates
      ? [{ provider: "github", owner: edition.updates.owner, repo: edition.updates.repo }]
      : null,
  copyright: "Copyright (C) 2026 hidicker",
  directories: { output: "release" },
  files: ["main.cjs", "updates.cjs", "edition.json", "package.json"],
  // The server, bundled into single files by stage.mjs, and the built app.
  extraResources: [{ from: "stage/server", to: "server" }],
  win: {
    icon: "build/icon.png",
    target: [{ target: "nsis", arch: ["x64"] }],
    // The program's own icon and details are always written; signing only when
    // a signing command has been given.
    signAndEditExecutable: true,
    signExecutable: signing,
    ...(signing ? { sign: require.resolve("./sign.cjs") } : {}),
    // The name on the signing certificate. Written into the installed copy, so
    // its updater refuses an update not signed by the same publisher; without
    // it an update is checked only against the checksum beside it. Set
    // OSABOOKS_PUBLISHER_NAME with OSABOOKS_SIGN_COMMAND once there is a certificate.
    ...(signing && (process.env["OSABOOKS_PUBLISHER_NAME"] ?? "").trim() !== ""
      ? { publisherName: [process.env["OSABOOKS_PUBLISHER_NAME"].trim()] }
      : {}),
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    artifactName: `${edition.installerName}.\${ext}`,
  },
};
