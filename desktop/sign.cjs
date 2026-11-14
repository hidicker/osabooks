"use strict";
// Signing a file, when this build has been told how.
//
// Windows only trusts a program's publisher if the program is signed with a
// certificate whose key lives on hardware or in a signing service, so how to
// sign differs by who sold the certificate and cannot be built in. Whoever
// builds the installer says how, in the environment:
//
//   OSABOOKS_SIGN_COMMAND   a command that signs the file named {file} in place,
//                           for example the signing service's own tool.
//
// Nothing set, nothing signed: the build still makes an installer, and Windows
// will say the publisher is unknown. Called by electron-builder for each
// program it makes (the app, the uninstaller and the installer).
const { execSync } = require("node:child_process");

exports.default = async function sign(configuration) {
  const template = process.env["OSABOOKS_SIGN_COMMAND"];
  if (template === undefined || template.trim() === "") {
    console.log(`  not signing ${configuration.path}: OSABOOKS_SIGN_COMMAND is not set`);
    return;
  }
  const command = template.split("{file}").join(`"${configuration.path}"`);
  console.log(`  signing ${configuration.path}`);
  execSync(command, { stdio: "inherit" });
};
