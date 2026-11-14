"use strict";
// What electron-builder makes: the Windows installer. Who the program is comes
// from edition.json; whether it is signed from the environment (see sign.cjs).
const edition = require("./edition.json");

const signing = (process.env["OSABOOKS_SIGN_COMMAND"] ?? "").trim() !== "";

module.exports = {
  appId: edition.appId,
  productName: edition.name,
  copyright: "Copyright (C) 2026 hidicker",
  directories: { output: "release" },
  files: ["main.cjs", "edition.json", "package.json"],
  extraResources: [{ from: "stage/server", to: "server" }],
  win: {
    icon: "build/icon.png",
    target: [{ target: "nsis", arch: ["x64"] }],
    // The program's own icon and details are always written; signing only when
    // a signing command has been given.
    signAndEditExecutable: true,
    signExecutable: signing,
    ...(signing ? { sign: require.resolve("./sign.cjs") } : {}),
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    artifactName: `${edition.installerName}.\${ext}`,
  },
};
