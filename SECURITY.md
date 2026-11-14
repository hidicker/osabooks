# Security

## Supported versions

Only the latest version of OsaBooks gets security fixes. Update before
reporting a problem: it may already be fixed. The Windows program updates
itself.

## Reporting a problem

Please report anything that could expose somebody's books, keys or tokens
privately, not in a public issue: use **Report a vulnerability** on this
repository's Security tab
([direct link](https://github.com/hidicker/osabooks/security/advisories/new)),
which only the maintainer sees. Say what you found, how to reproduce it, and
what it could reach. You will hear
back, and a fix is released before anything is said publicly.

## How OsaBooks protects your data

What follows is checked in each security review; the last was on 14 November 2026.

**On your own computer** (the Windows program, or the launcher `OsaBooks.cmd` /
`OsaBooks.command`):

- The local server listens on this computer only (127.0.0.1), and refuses any
  request whose Host is not this computer, so another web page cannot reach it
  by renaming itself.
- Changes are refused from any other web origin, and a POST has to be JSON,
  which a web form elsewhere cannot send. Other changes (PUT, DELETE, such as
  saving an attachment) need a cross-origin request the browser will only send
  after asking, and the server never agrees.
- Reads are refused when the browser says they come from another site, so a web
  page elsewhere cannot read your books or attachments, or set off a bank fetch.
- Ledger and archive names, and attachment ids, are checked before they touch a
  path, and files are served only from the app's own folder. Attachments are
  sent as downloads the browser is told not to treat as anything else.
- Bank feed (Akahu, Wise, SimpleFIN) tokens and AI keys are kept in OsaBooks'
  own folder for this computer (`%LOCALAPPDATA%\OsaBooks\keys` on Windows,
  `~/Library/Application Support/OsaBooks/keys` on a Mac, `~/.config/osabooks/keys`
  elsewhere), not in the books folder, so syncing the books to OneDrive or
  Dropbox, or giving them to an accountant, never carries them. The page is
  told only that one is held and enough of it to recognise (a few characters,
  or the bridge's address), never the token itself.
- The Windows program shows the app in a sandboxed window: the page has no
  access to the computer beyond a browser tab's, and links that leave the app
  open in your own browser. It updates itself from this repository's releases;
  the request to GitHub is all that is sent. The installer is not code-signed
  yet.

**Online** (signed in, books kept on the server):

- Every table has row-level security: you reach only books you are a member
  of, with the role you were given. Changes go through functions that check
  the role and keep history; tables cannot be written directly.
- Two-factor sign-in with an authenticator app. Once you set one up it is
  asked for every sign-in, for all your books, and an owner can require it of
  everybody in a set of books.
- Access can be given until a date, and stops everywhere the day after.
- Invitations to a set of books are matched on the email address in the
  person's sign-in token, so the Supabase project must have **Confirm email**
  turned on (Authentication, Email). With it off, anybody could sign up as an
  address they do not own and accept what was sent to it. Anyone hosting their
  own copy should check this setting, and apply every migration in
  `supabase/migrations`: the protections below are in them.
- A deleted set of books can no longer be read or saved, by members either,
  until an owner restores it. Lock dates can be moved only by an owner or the
  accountant: the server refuses a bookkeeper's save that changes them, and
  notes any save that changes something in a locked period for them to see.
- Attachments are kept in a private storage bucket, behind the same role
  checks as the books.
- Bank feed, Wise and Stripe tokens and AI keys are kept in Supabase Vault,
  encrypted. The functions that read them can be called by the server alone,
  and every server function checks the caller's role on the books first.
- An AI app connected through the OsaBooks connector (Claude, ChatGPT) cannot
  reach the database, storage or settings: its sign-in is refused there. It
  can only read the books and leave suggestions through the connector, which
  wait until somebody in the books accepts them.
- The site sends a strict content security policy (scripts only from the site
  itself; data only to the site, its database, the OpenAccountants guides and
  the exchange-rate service), HSTS, and refuses to be framed. The online demo
  sends the same headers, and keeps its sample books in browser storage of its
  own, apart from the hosted app's.

**In the app:**

- Text from bank files, spreadsheets and names is escaped before it is shown,
  so it cannot run as script.
- CSV files meant for a spreadsheet keep a value that starts like a formula as
  text, so a payee name cannot run as a formula in Excel.
- AI is asked only when you press a button for it, when you choose a
  spreadsheet or PDF for it to read, or each morning if you turn on "Ready
  every morning" with AI on. What is sent, and to whom, is set out on the AI
  page before it is turned on; nothing an AI answers is kept until you accept
  it.
- Dependencies are few: esbuild and TypeScript to build, and Electron for the
  Windows program. `npm audit` is clean for the app and its server. For the
  Windows program, Electron is kept on a supported version with its security
  fixes; the tool that builds the installer (electron-builder) has a moderate
  advisory in a file-matching library it uses while building, which is not
  part of what is installed.
