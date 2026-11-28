"use strict";
// Our own signature on each release, so an installed copy installs an update
// only if it was signed with the publisher's key -- without a code-signing
// certificate.
//
// The update and its checksum (latest.yml) come from the same GitHub release,
// so the checksum alone proves only that the file arrived whole: whoever could
// publish a release could publish a matching checksum. The signature is made
// with a private key kept off GitHub; the program carries only the public key
// (edition.json, "updateKey"). A release without a signature, or with one
// that does not match, is not installed.
//
// What is signed names the file and the version as well as its SHA-512, so a
// signature cannot be moved onto another file or an older version.

const { createHash, createPublicKey, generateKeyPairSync, sign, verify } = require("node:crypto");
const { createReadStream } = require("node:fs");

/** The text that is signed: what the file is, and its contents' SHA-512. */
function signedText(fileName, version, sha512) {
  return `osabooks-update\n${fileName}\n${version}\n${sha512}\n`;
}

/** A file's SHA-512, base64, read in pieces (installers are over 100 MB). */
function sha512Of(path) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha512");
    createReadStream(path)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", () => resolve(hash.digest("base64")));
  });
}

/** A new key pair: the private key as PEM (keep it secret), the public key as base64 for edition.json. */
function makeKeyPair() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    privatePem: privateKey.export({ type: "pkcs8", format: "pem" }),
    publicKey: publicKey.export({ type: "spki", format: "der" }).toString("base64"),
  };
}

/** The signature for one release file, base64. */
async function signUpdate(path, fileName, version, privatePem) {
  const text = signedText(fileName, version, await sha512Of(path));
  return sign(null, Buffer.from(text, "utf8"), privatePem).toString("base64");
}

/**
 * Whether a downloaded file is the release the publisher signed. False for
 * anything that does not check out -- a missing or malformed key or signature
 * included -- never an exception.
 */
async function verifyUpdate(path, fileName, version, signature, publicKey) {
  try {
    if (typeof signature !== "string" || typeof publicKey !== "string" || signature.trim() === "" || publicKey.trim() === "") {
      return false;
    }
    const key = createPublicKey({ key: Buffer.from(publicKey.trim(), "base64"), format: "der", type: "spki" });
    if (key.asymmetricKeyType !== "ed25519") return false;
    const text = signedText(fileName, version, await sha512Of(path));
    return verify(null, Buffer.from(text, "utf8"), key, Buffer.from(signature.trim(), "base64"));
  } catch {
    return false;
  }
}

module.exports = { makeKeyPair, sha512Of, signUpdate, signedText, verifyUpdate };
