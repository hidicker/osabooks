import { backendKind, folderPaths, ledgerName, openCloudBookId } from "../store.js";
import { connectorUrl } from "../cloud.js";
import { note } from "../ui.js";
import { state } from "../state.js";

/**
 * Use your own AI app: Claude, Cursor, VS Code, LM Studio and the rest.
 *
 * OsaBooks's MCP server lets the AI app somebody already uses read these books
 * and suggest codes, splits and journals, which wait here until they are
 * saved. This panel is how they connect it: the Claude Desktop extension to
 * download, or the settings for any other app, with this computer's paths
 * already in.
 */

/** The extension, built with each release of the site. */
export const EXTENSION_URL = "https://nbparagliding.nz/osabooks/osabooks.mcpb";

function copyButton(label: string, text: () => string, said: HTMLElement): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "small";
  button.textContent = label;
  button.addEventListener("click", () => {
    void navigator.clipboard
      .writeText(text())
      .then(() => (said.textContent = "Copied."))
      .catch(() => (said.textContent = "Could not copy: select the text and copy it."));
  });
  return button;
}

function steps(lines: readonly (string | Node)[][]): HTMLOListElement {
  const list = document.createElement("ol");
  list.className = "own-ai-steps";
  for (const parts of lines) {
    const li = document.createElement("li");
    li.append(...parts);
    list.append(li);
  }
  return list;
}

function code(text: string): HTMLElement {
  const c = document.createElement("code");
  c.textContent = text;
  return c;
}

function heading(text: string): HTMLElement {
  const h = document.createElement("h4");
  h.textContent = text;
  return h;
}

/** What happens to what the AI suggests, said the same way for every route. */
function whereItLands(): HTMLElement {
  return note(
    "What it suggests waits here until you decide: codes show on Reconcile as suggestions to tick, and " +
      "splits and journals under Actions required, to open, check and save, or decline. " +
      "Nothing goes into the books until you do. Your AI app sends what it reads to the company that runs it.",
  );
}

/** For books in a folder on this computer: the extension, or another app's settings. */
function forFolder(inner: HTMLElement): void {
  const said = document.createElement("p");
  said.className = "own-ai-said";
  const where = document.createElement("p");
  where.textContent = "Finding where these books are…";
  inner.append(
    heading("Claude Desktop"),
    steps([
      ["Download the ", Object.assign(document.createElement("a"), { href: EXTENSION_URL, textContent: "OsaBooks extension", download: "osabooks.mcpb" }), "."],
      ["In Claude Desktop, open Settings, Extensions, and open the file you downloaded."],
      ["When it asks for the books folder, choose this one: ", where],
      ["Turn on Let Claude suggest for codes, splits and journals. Left off, Claude only reads."],
      ["In a new chat, ask: “Suggest codes for this month's uncoded lines.”"],
    ]),
    heading("Other AI apps"),
    note(
      "Cursor, VS Code, Gemini CLI, LM Studio and other apps that take MCP servers can use the same one. " +
        "Copy the settings below into the app's MCP settings (often a file called mcp.json). " +
        "LM Studio can run the model on this computer, so nothing leaves it.",
    ),
  );
  const settings = document.createElement("pre");
  settings.className = "own-ai-settings";
  const copy = copyButton("Copy settings", () => settings.textContent ?? "", said);
  copy.disabled = true;
  inner.append(settings, copy, said, whereItLands());

  void folderPaths().then((paths) => {
    if (paths === null) {
      where.textContent = "the folder OsaBooks keeps these books in.";
      settings.hidden = true;
      copy.hidden = true;
      return;
    }
    where.textContent = "";
    where.append(code(paths.books), " ", copyButton("Copy", () => paths.books, said));
    if (paths.mcpServer === null) {
      settings.textContent = "This copy of OsaBooks has no MCP server built. Start OsaBooks with OsaBooks.cmd (or OsaBooks.command) to build it.";
      return;
    }
    settings.textContent = JSON.stringify(
      { mcpServers: { osabooks: { command: "node", args: [paths.mcpServer, "--books", paths.books, "--suggest"] } } },
      null,
      2,
    );
    copy.disabled = false;
  });
}

/** For books kept online: the connector address, for Claude, ChatGPT and others. */
function forOnline(inner: HTMLElement, book: string): void {
  const said = document.createElement("p");
  said.className = "own-ai-said";
  const address = connectorUrl(book);
  // Named after the books: with a connector for each set, the name is how the
  // AI, and the person, tell them apart.
  const name = ledgerName().trim() === "" ? "OsaBooks" : `OsaBooks: ${ledgerName().trim()}`;
  const shown = document.createElement("p");
  shown.append(code(address), " ", copyButton("Copy", () => address, said));
  inner.append(
    heading("The connector address for these books"),
    shown,
    said,
    heading("Claude (on the web, the desktop app or a phone)"),
    steps([
      ["Open Settings, Connectors, and choose Add custom connector."],
      [`Name it “${name}”, paste the address above, and add it.`],
      ["Choose Connect. Sign in to OsaBooks when asked, and allow it."],
      [`In a chat, turn “${name}” on and ask: “Suggest codes for this month's uncoded lines.”`],
    ]),
    heading("ChatGPT and other apps"),
    note(
      "Any app that takes a remote MCP connector with sign-in can use the same address. In ChatGPT, adding your own " +
        "connector needs developer mode, in its settings under connectors. The app asks you to sign in to OsaBooks and allow it, as above.",
    ),
    note(
      "Each set of books has its own address, and only people who are members of these books can connect to them. " +
        "Somebody who may only read them gets an app that only reads. With several sets, add one connector for each, " +
        "named after its books, and turn on only the ones a chat needs: every answer says which books it came from, " +
        "and a suggestion meant for other books is refused.",
    ),
    whereItLands(),
  );
}

/** The AI connector page: the panel, and what it means for books with AI suggestions off. */
export function renderConnector(): void {
  const body = document.getElementById("connector-body");
  if (body === null) return;
  body.textContent = "";
  if (state.ledger.aiEnabled !== true) {
    body.append(
      note(
        "AI suggestions are off for these books, which keeps OsaBooks itself from sending anything to an AI. A connector " +
          "is separate: your own AI app reads the books only " +
          (backendKind() === "cloud" ? "after you sign in to OsaBooks and allow it there." : "once you install the extension and point it at them."),
      ),
    );
  }
  body.append(ownAiPanel());
}

export function ownAiPanel(): HTMLElement {
  const box = document.createElement("div");
  box.className = "ai-panel own-ai";
  const inner = document.createElement("div");
  box.append(inner);
  inner.append(note("It uses your own AI subscription, not a key in OsaBooks."));
  const kind = backendKind();
  if (kind === "folder") {
    forFolder(inner);
  } else if (kind === "cloud" && openCloudBookId() !== "") {
    forOnline(inner, openCloudBookId());
  } else {
    inner.append(
      note("This needs OsaBooks running on your own computer, with the books in a folder there, or books kept online."),
    );
  }
  return box;
}
