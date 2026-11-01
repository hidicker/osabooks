# Plan: testing that keeps up with the app

Status: plan only, 1 November 2026. Nothing below is built yet.

## Why change

The parity check is no longer required before shipping. It compares two
builds by walking every page of three sets of books, which is thorough but
takes about 25 minutes, needs a second checkout, and only says "something
differs", not what broke or why. It also only runs on books in a folder, so
it never touches the online save path.

What actually went wrong recently, and what would have caught it:

| What happened | What would have caught it |
|---|---|
| Starting online books again in another country did nothing: brand-new books held no parts when the page opened, so none were blanked. Found only by hand, on the live site. | A browser test against a stand-in for the online server. |
| Importing the Xero files froze the page for about four minutes. | A time limit on a scripted import. |
| A correction made in Claude did not replace the earlier suggestion in the app. | A test that runs the MCP server and the app together. |
| The rename could have broken detecting a copy already running (it matched the page title). | The same browser tests, run on every change. |

The core accounting tests (about 1,550 of them, many against official
worked examples) are good and stay as they are. The gaps are in the app
around them: what happens in the browser, the online path, and speed.

## The layers

### 1. Unit tests and type checks (have them, keep them)

`npm test`: the type check, then core, web, MCP and CLI tests. Under a
minute. Runs before every commit and in the deploy workflow, which already
refuses to upload if they fail.

One change: add tests for each fix as it is made. A bug that reaches the
live site gets a test that fails without the fix.

### 2. Figure snapshots of the demo books (new)

Instead of comparing two builds, compare one build with a saved record.

- Open each demo set of books (the invented ones, safe to commit) in headless
  Chrome and capture every figure: each report for each year and basis, the
  GST periods, the year ends. `tools/golden-master.js` already does the
  capturing.
- Save the result in the repo as `golden/<book>.json`.
- The test fails if any figure differs from the saved one, and prints which
  report, which line, what it was and what it is now.
- When a figure is *meant* to change, the snapshot is updated in the same
  commit, so the change in figures shows in the diff and can be reviewed.

Expected time: one to two minutes for all the demo books, against 25 for
parity. No second checkout.

Your real books (my-books, personal-and-rentals, xero-example) can't be
committed. The same script can keep their snapshots in a local folder outside
the repo, run by hand before a change to posting, GST or reports:
`npm run snapshot:local`.

### 3. Scripted journeys in the browser (new)

About ten short scripts, each a real person's path through the app, on
throwaway books in headless Chrome. They reuse the browser driver the parity
tool already has (it talks to Chrome directly, with no extra packages).

1. New books: Start here, pick a country, empty books, import a sample bank
   file, code a line, see it in the profit and loss.
2. Country: books with lines in them started again in another country come
   back empty, with the new starter chart, and a dated copy is kept.
3. Import Xero's exports (the sample set) within a time limit, with the
   expected number of lines, invoices and accounts.
4. Backup, clear, restore: everything comes back.
5. Undo: a coding undone returns the line exactly as it was.
6. Suggestions: the MCP server suggests a code, a split and a journal; each
   appears in the app, and a correction replaces the earlier code.
7. Invoices: raise one, match a receipt to it, see it paid.
8. GST: a period's return matches its boxes, and a filed return shows
   differences when a line changes.
9. Two tabs on the same books: the second is told, and nothing is lost.
10. A copy already running is found again when the app is restarted.

Each runs against books in a folder **and** against online books (see 4).
Expected time: three to five minutes in all.

### 4. A stand-in for the online server (new)

The online path (saving each part with its version, conflicts, members,
emptying books) has no automatic test today. A small local server that
answers the same few requests the app makes to Supabase would let the
journeys in 3 run online too, with no account and nothing sent anywhere:

- load the parts of a set of books;
- save a part, refusing a stale version the way the real one does;
- list members and roles;
- sign-in as a fixed test person.

It is a stand-in, not the real thing, so it is checked against the real
server now and then (see 5). The alternative is the full Supabase stack run
locally in Docker: closer to the real thing, but heavier to set up and slower
to start.

### 5. Checks after each deploy (new, small)

A short script run at the end of the deploy workflow, against the live site:

- each page and file answers, and `app.js` is the one just built;
- the connector refuses a request with no sign-in, the way Claude expects;
- the consent page loads.

Later, with a dedicated test account (not yours), it could also sign in,
open a test set of books, save one change and read it back. That is the one
check the stand-in in 4 can't give.

### 6. Xero's Australian demo company, end to end (have it)

Xero's demo company (AU) exported, imported into empty books, reconciled,
and every account compared with Xero's own: the scripts and what to expect
are in `New2/XeroDemoAU/test` (outside the repo, the data being Xero's).
On 1 November 2026 it found seven import faults, all fixed the same day,
and every account now agrees with Xero except where noted there. The first
candidate for journey 3, once the browser driver is shared.

## What runs when

| When | What | Time |
|---|---|---|
| Every commit | 1: unit tests and type check | under 1 min |
| Before deploy (in the workflow) | 1, 2 and 3 | about 5 min |
| After deploy | 5 | under 1 min |
| By hand, before changing posting, GST or reports | 2 on your real books (local snapshots) | a few min |
| Rarely, for big restructures | parity | about 25 min |

## Order to build it

1. **Figure snapshots of the demo books** (2). The biggest saving, and mostly
   built already in `golden-master.js`. About half a day.
2. **The browser driver as a shared tool**, taken out of `parity.mjs`, and
   journeys 1, 2 and 3 on folder books. About a day.
3. **Post-deploy checks** (5, without the test account). An hour or two.
4. **The online stand-in** (4), then the same journeys online. A day or two.
5. **The remaining journeys**, one at a time, starting with whichever area
   is being changed next.

## Decisions for you

1. **Commit snapshots of the demo books' figures?** They are invented, so
   nothing private; the files would be large-ish JSON. (Recommended: yes.)
2. **Online stand-in, or local Supabase in Docker?** (Recommended: the
   stand-in first. It's quicker to build and runs anywhere, including in the
   deploy workflow.)
3. **A dedicated test account for live checks?** It would need its own
   sign-in kept as a GitHub secret, and would use one of the free online
   places. (Recommended: later, once 1 to 4 are in.)
4. **How long may the deploy workflow take?** About five minutes of tests
   before upload is the plan above.

## Related

- `docs/testing-plan.md`: the older step-by-step manual walkthrough, from
  an empty browser to the signed accounts. Still useful as a once-a-year
  full check by hand; some of its numbers are out of date.
- `docs/tested-against-official-examples.md`: what the core tests check
  against.
- `tools/parity.mjs`, `tools/golden-master.js`: the tools this builds on.
