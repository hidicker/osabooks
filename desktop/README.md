# OsaBooks for Windows

OsaBooks as a program: one installer, no Node.js to install, the app in a
window of its own. Everything runs on your own computer, and your books are
plain files in `C:\Users\<you>\OsaBooks\books` (the home folder, not
Documents, which Windows often keeps in step with OneDrive). Upgrading and
uninstalling never touch them.

## Building it

From the top of the repository, once:

```
npm install
```

Then, in this folder:

```
cd desktop
npm install
node node_modules/electron/install.js   # npm 11 holds back Electron's own download
npm start                               # run it from the checkout
npm run installer                       # release/OsaBooks-Setup.exe
```

`stage.mjs` gathers the built app, its local server and the core into
`stage/server`, which the installer carries. `edition.json` says who the
program is (name, port, where its books go); `main.cjs` is the program itself.

## Signing

Unsigned, Windows says the publisher is unknown: **More info**, then **Run
anyway**. To sign, set `OSABOOKS_SIGN_COMMAND` to a command that signs `{file}`
in place, such as your certificate seller's signing tool, before building.
Nothing set, nothing signed. `sign.cjs` says how it is used.

## A release

The **Windows installer** workflow builds it from source on GitHub and attaches
it to a draft release as `OsaBooks-Setup.exe`, so the address
`.../releases/latest/download/OsaBooks-Setup.exe` always gives the newest.
