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
The tag gives the program its version: `v2026.11.14` is 2026.1114.0, and a
second release that day, `v2026.11.14-2`, is 2026.1114.2.

## Updates

An installed copy keeps itself up to date from the releases named under
`updates` in `edition.json` (`updates.cjs`). It asks GitHub for the newest
published release a little after starting and every six hours, downloads a
newer one in the background, and offers to restart; otherwise it installs when
the program closes. Help, **Check for updates** asks straight away. The
request to GitHub is all that leaves the computer, and the books are never
part of it. Each release carries `latest.yml` (what installed copies read) and
the installer's `.blockmap` (so they download only what changed); a draft or a
pre-release is never offered. An edition with no `updates` is updated by hand.

To try an update end to end without publishing anything, build two installers
pointed at a folder on this computer, install the older and let it find the
newer:

```
$env:OSABOOKS_UPDATE_URL = "http://127.0.0.1:8765/"
$env:OSABOOKS_RELEASE_TAG = "v2026.11.14-3"; npm run installer
Copy-Item release\OsaBooks-Setup.exe $env:TEMP\OsaBooks-old.exe  # the older one, to install
$env:OSABOOKS_RELEASE_TAG = "v2026.11.14-4"; npm run installer
python -m http.server 8765 --bind 127.0.0.1 --directory release  # serves the newer one
```

Install `OsaBooks-old.exe` as below and start it: within a minute it downloads the
newer and asks to restart. Clear `OSABOOKS_UPDATE_URL` afterwards, or the next
installer looks on this computer for its updates.

## Testing an installer

Test it installed, outside this repository: run from inside the checkout, the
program can find packages in the repository's own `node_modules` that an
installed copy does not have, and seem to work when it would not. In
PowerShell:

```
Start-Process release\OsaBooks-Setup.exe -ArgumentList '/S', "/D=$env:TEMP\osabooks-test" -Wait
Start-Process "$env:TEMP\osabooks-test\OsaBooks.exe"   # it should open and show your books
# then, after closing it:
Start-Process "$env:TEMP\osabooks-test\Uninstall OsaBooks.exe" -ArgumentList '/S' -Wait
```

Uninstalling leaves the books in `OsaBooks` in the user folder, as it should.
