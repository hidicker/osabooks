// Gather what the desktop program serves into desktop/stage/server: the built
// app, and the local server bundled with the core into one file.
// Run by `npm start` and `npm run installer`, from the desktop folder, after
// `npm install` at the top of the repository.
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const web = join(root, "apps", "web");
const out = join(here, "stage", "server");

// The core first, which the app and the server both use; then the app.
execFileSync(process.execPath, [join(root, "node_modules", "typescript", "bin", "tsc"), "--build", join(root, "packages", "core")], {
  cwd: root,
  stdio: "inherit",
});
execFileSync(process.execPath, [join(web, "build.js")], { cwd: web, stdio: "inherit" });

rmSync(join(here, "stage"), { recursive: true, force: true });
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "package.json"), JSON.stringify({ private: true, type: "module" }, null, 2) + "\n");
cpSync(join(web, "dist"), join(out, "dist"), { recursive: true });

// The server, with the core inside it, as one file each: an installed program
// has no node_modules to look things up in (and the installer would leave a
// node_modules folder out). esbuild is only used by the server's developer
// mode, which rebuilds the app as it is edited, so it is swapped for a stand-in
// that refuses if anything ever calls it.
const stub = join(here, "stage", "esbuild-stand-in.mjs");
writeFileSync(
  stub,
  [
    'const refuse = () => { throw new Error("Rebuilding the app is for development, not the installed program."); };',
    "export const context = refuse;",
    "export const build = refuse;",
    "",
  ].join("\n"),
);
const { build } = await import(pathToFileURL(join(root, "node_modules", "esbuild", "lib", "main.js")).href);
for (const file of ["server.js", "nightly.js"]) {
  await build({
    entryPoints: [join(web, file)],
    outfile: join(out, file),
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    alias: { esbuild: stub },
    logLevel: "warning",
  });
}
rmSync(stub);

// Maps and type files are for developers, not the people who install this.
const prune = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) prune(path);
    else if (/\.(map|d\.ts|tsbuildinfo)$/.test(entry.name)) rmSync(path);
  }
};
prune(out);
console.log(`Staged the desktop server in ${out}`);
