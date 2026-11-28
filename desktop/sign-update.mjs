// Our own update signature (update-signature.cjs), made and used here.
//
//   node desktop/sign-update.mjs keygen <private key file>
//       Makes a key pair. The private key is written to the file given, which
//       must not exist yet (keep it off GitHub and backed up: lose it and
//       installed copies cannot be updated by themselves any more). The public
//       key is printed, for "updateKey" in edition.json.
//
//   node desktop/sign-update.mjs sign <release folder> <private key file>
//       Signs the installer latest.yml names, at the version it names, and
//       writes <installer>.sig beside it. Upload the .sig with the release.
//
// Neither prints the private key.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const { makeKeyPair, signUpdate, verifyUpdate } = require("./update-signature.cjs");

const [command, first, second] = process.argv.slice(2);

if (command === "keygen" && first) {
  if (existsSync(first)) throw new Error(`${first} exists already: not overwritten.`);
  const { privatePem, publicKey } = makeKeyPair();
  writeFileSync(first, privatePem, { mode: 0o600, flag: "wx" });
  console.log(`Private key written to ${first}. Back it up somewhere safe, off GitHub.`);
  console.log(`Public key, for "updateKey" in edition.json:\n${publicKey}`);
} else if (command === "sign" && first && second) {
  const yml = readFileSync(join(first, "latest.yml"), "utf8");
  const version = /^version:\s*(\S+)\s*$/m.exec(yml)?.[1];
  const fileName = /^path:\s*(\S+)\s*$/m.exec(yml)?.[1];
  if (!version || !fileName) throw new Error("latest.yml names no version or path.");
  const installer = join(first, fileName);
  const privatePem = readFileSync(second, "utf8");
  const signature = await signUpdate(installer, fileName, version, privatePem);
  // Checked against its own public key before it is written: a wrong key
  // file fails here, not on everyone's computer.
  const { createPublicKey } = await import("node:crypto");
  const publicKey = createPublicKey(privatePem).export({ type: "spki", format: "der" }).toString("base64");
  if (!(await verifyUpdate(installer, fileName, version, signature, publicKey))) throw new Error("The signature did not check out.");
  writeFileSync(`${installer}.sig`, `${signature}\n`);
  console.log(`Signed ${fileName} ${version}: ${installer}.sig`);
  console.log(`Its public key: ${publicKey}`);
} else {
  console.error("Usage: sign-update.mjs keygen <private key file> | sign <release folder> <private key file>");
  process.exit(2);
}
