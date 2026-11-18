import { redraw, showPage } from "../app.js";
import { noSalesTax } from "../country.js";
import { record, saveEntities } from "../books.js";
import { $, state } from "../state.js";
import { save } from "../store.js";
import { note, pageSection, tellOnPage } from "../ui.js";
import type { SectionTone } from "../ui.js";
import { AI_OWN_BATCH, aiSuggestionCount, askAboutLines, waitingForAnswers, whatWouldBeAsked } from "../ai.js";
import { carrySection } from "../ai-carry.js";
import { aiRoute, aiStatus } from "../ai-backend.js";
import { sayAiTrouble } from "./actions.js";
import { aiAllowed } from "../ai-consent.js";
import { aiKeyPanel, refreshAiStatus } from "../ai-key-panel.js";
import { morningChoice } from "../nightly-ui.js";
import { emptyEntityModel } from "@nzosa/core";
import { ANALYSES, analysisPrompt } from "./reports.js";
import type { Entity } from "@nzosa/core";

/**
 * Asking a model about the lines nothing in these books recognises.
 *
 * The rules go first and always. What reaches this page is what no rule, no
 * default and no override had anything to say about -- so the model is never
 * asked a question these books had already answered, and every suggestion
 * accepted here can become a rule, which means it is never asked again either.
 *
 * Three things this page is careful about, in order of how much they matter.
 *
 * It is off until somebody turns it on, per set of books, and it says exactly
 * what would leave this machine before it leaves it. Payee names and amounts
 * are client data; whether they may be sent to a model provider is a decision
 * for the person whose data it is, and for their clients, not for a default.
 *
 * It costs money, so it runs when asked and not before. There is no coding
 * that quietly calls a model. And there is a cap per day, because the way a
 * bill surprises somebody is a loop nobody watched.
 *
 * And what comes back is a suggestion. It arrives beside the payee it is
 * about, with the model's own reason and its own confidence, and it does
 * nothing until somebody agrees with it.
 */


/**
 * AI set-up: whether AI is used for these books at all, what each part of the
 * books does (sent with every question), and the key. Everything the AI pages
 * share, set once here, so each of those pages is only about what it does.
 */
export function renderAiSetup(): void {
  const body = $("ai-setup-body");
  body.textContent = "";

  // The consent, with exactly what would be sent, before anything else.
  if (!aiAllowed()) {
    body.append(section("AI for these books: off", "account", offerIt()));
    return;
  }

  body.append(
    section(
      "AI for these books: on",
      "account",
      note(
        "AI reconcile, the AI accounts check and the key below can now be used for these books. " +
          "Nothing is sent until you ask, on those pages or with the automatic choices below.",
      ),
    ),
    section("About these books", "books", briefingPanel()),
  );

  if (aiRoute() === "none") {
    body.append(
      section(
        "Your AI key",
        "keep",
        note(
          "Asking automatically with a key needs the app running on your own computer, or " +
            "books on the server. Here, copy and paste on AI reconcile and the AI accounts check work without one.",
        ),
      ),
    );
    return;
  }

  body.append(
    section(
      "Your AI key",
      "keep",
      aiKeyPanel({
        page: "aiSetup",
        title: "",
        countedIn: "transactions",
        whenSet: automaticChoices,
      }),
    ),
  );
  void refreshAiStatus("aiSetup");
}

/**
 * A part of an AI page, as every page's parts now are: its heading inside a
 * panel on a faint background of its own (`pageSection`), so where one part
 * ends and the next begins shows at a glance.
 */
function section(title: string, tone: SectionTone, ...parts: HTMLElement[]): HTMLElement {
  const box = pageSection(title, tone);
  box.append(...parts);
  return box;
}

/**
 * AI reconcile: suggestions for the lines nothing in these books recognises,
 * by copying a prompt to any assistant, or with the key set on AI set-up. The
 * suggestions land on Reconcile, beside the lines they are about.
 */
export function renderAi(): void {
  const body = $("ai-body");
  body.textContent = "";

  if (!aiAllowed()) {
    body.append(
      section(
        "AI for these books: off",
        "account",
        note(
          "AI is off for these books. Turn it on on AI set-up, which shows exactly what would be " +
            "sent; then suggestions can be asked for here.",
        ),
        actionsRow(primaryButton("Go to AI set-up", () => showPage("aisetup"))),
      ),
    );
    return;
  }

  body.append(
    note("Both ways ask the same question and check the answers the same way."),
    section("Copy and paste", "books", carryPanel()),
    section("Ask with your key", "keep", askWithKeyPanel()),
    section("Other ways to use AI with these books", "open", checkPointer(), connectorPointer()),
  );
}

/**
 * Asking with the key: on Reconcile, where the suggestions are read. What is
 * waiting, what would be sent, and the way there; the key itself, and the
 * choices to ask by itself, are on AI set-up.
 */
function askWithKeyPanel(): HTMLElement {
  const [box, inner] = panel("");
  if (aiRoute() === "none") {
    inner.append(
      note(
        "Asking automatically with a key needs the app running on your own computer, or " +
          "books on the server, so only the way above is available here.",
      ),
    );
    return box;
  }
  const waiting = waitingForAnswers().length;
  const ready = aiSuggestionCount();
  if (ready > 0) {
    inner.append(note(`${ready} suggestion${ready === 1 ? "" : "s"} waiting to be read on Reconcile.`));
  }
  if (waiting > 0) {
    const details = document.createElement("details");
    details.className = "setup-migration-details";
    const summary = document.createElement("summary");
    summary.className = "setup-migration-summary";
    summary.textContent = "Show exactly what would be sent";
    const pre = document.createElement("pre");
    pre.className = "ai-prompt";
    pre.textContent = whatWouldBeAsked(waitingForAnswers()).prompt;
    details.append(summary, pre);
    inner.append(details);
  }
  inner.append(
    note(
      "On Reconcile, press AI suggestions beside the filter and choose “Ask with my key”. " +
        "Suggestions appear on the lines. The key, and asking by itself when the books open " +
        "or each morning, are set on AI set-up.",
    ),
    actionsRow(
      primaryButton("Go to Reconcile", () => showPage("reconcile")),
      button("AI set-up", () => showPage("aisetup")),
    ),
  );
  return box;
}

function primaryButton(label: string, onClick: () => void): HTMLButtonElement {
  const b = button(label, onClick);
  b.className = "primary";
  return b;
}

function actionsRow(...buttons: HTMLButtonElement[]): HTMLElement {
  const row = document.createElement("div");
  row.className = "migration-actions";
  row.append(...buttons);
  return row;
}

/**
 * Questions about the figures, ready for any AI assistant: one press copies
 * the question and the figures it needs. Nothing is sent from here; the
 * person pastes it where they choose, beside their own conversation. Shown on
 * the AI accounts check, for the year chosen there.
 */
export function analysesPanel(year: () => number): HTMLElement {
  const [box, inner] = panel("");
  inner.append(
    note(
      "Each copies a question with the figures it needs, from the year chosen above, to paste into " +
        "ChatGPT, Claude, Gemini or any assistant. Nothing is sent from here.",
    ),
  );
  const row = document.createElement("div");
  row.className = "migration-actions ai-analyses";
  const shown = document.createElement("textarea");
  shown.className = "ai-prompt";
  shown.readOnly = true;
  shown.rows = 10;
  shown.hidden = true;
  const said = document.createElement("p");
  said.className = "cloud-said";
  for (const [kind, label] of ANALYSES) {
    row.append(
      button(label, () => {
        const text = analysisPrompt(kind, year());
        if (text === "") {
          said.textContent = "There is nothing in the books yet to ask about.";
          shown.hidden = true;
          return;
        }
        shown.value = text;
        shown.hidden = false;
        void navigator.clipboard
          .writeText(text)
          .then(() => {
            said.textContent = `Copied "${label}". Paste it into your AI assistant.`;
          })
          .catch(() => {
            shown.select();
            said.textContent = "Select the text below and copy it.";
          });
      }),
    );
  }
  inner.append(row, said, shown);
  return box;
}

/**
 * Where the year-end check went.
 *
 * It was a section at the foot of this page, which made it the last thing
 * under a page about coding -- and it is not about coding. It has its own
 * entry under AI now, and this is a signpost rather than a copy: two places
 * to run the same review is two places for it to drift.
 */
function checkPointer(): HTMLElement {
  const [box, inner] = panel("");
  inner.append(
    note(
      "The AI accounts check reviews the finished year: whether each account holds what " +
        `belongs in it, ${noSalesTax() ? "" : "whether GST treatments match the registration, "}and what is missing. ` +
        "It uses OpenAccountants' tax guides, so answers cite their sources, and has quick questions about the figures.",
    ),
  );
  const go = button("Go to the AI accounts check", () => showPage("aicheck"));
  go.className = "primary";
  const row = document.createElement("div");
  row.className = "migration-actions";
  row.append(go);
  inner.append(row);
  return box;
}

/**
 * What the key may do by itself, said under the key once one is set: ask
 * about waiting lines as the books open, and get ready each morning. Asking
 * by hand, and what would be sent, are on AI reconcile, beside the asking.
 */
function automaticChoices(): HTMLElement[] {
  const heading = document.createElement("h3");
  heading.textContent = "Automatic";
  return [
    heading,
    autoSuggestChoice(),
    morningChoice(),
    note("To ask now, or to see exactly what would be sent, go to AI reconcile."),
    actionsRow(button("Go to AI reconcile", () => showPage("ai"))),
  ];
}

// --- turning it on ---------------------------------------------------------

/**
 * What would be sent, said before anything is.
 *
 * Not a tick box with a link to a policy. The four lines below are the whole
 * of what leaves this machine, and somebody who reads them knows as much about
 * it as the person who wrote the code.
 */
/** The connector has a page of its own: said here, with the way there. */
function connectorPointer(): HTMLElement {
  const wrap = document.createElement("div");
  wrap.append(
    note(
      "Claude, ChatGPT or another AI app you already use can read these books and suggest codes, splits and journals, " +
        "using your own subscription. Its address and the steps to add it are on Add these books to your AI app (MCP).",
    ),
  );
  const go = document.createElement("button");
  go.type = "button";
  go.textContent = "Add these books to your AI app";
  go.addEventListener("click", () => showPage("connector"));
  wrap.append(go);
  return wrap;
}

function offerIt(): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "ai-offer";

  // Named by the panel it is drawn in: "AI for these books: off".
  const what = document.createElement("p");
  what.textContent =
    "Rules code most lines. For the rest, such as a new payee, AI can suggest an account " +
    "with its reasons, for you to accept or reject.";
  wrap.append(what);

  const careful = document.createElement("p");
  careful.className = "ai-careful";
  // Not a provider's name: which one it goes to depends on the key, and this
  // said Google to somebody whose key was Anthropic's.
  careful.textContent =
    "This sends some of what is in these books to an AI provider: the one your own key is " +
    "for, or Google's on the OsaBooks demo key. Exactly this:";
  wrap.append(careful);

  const list = document.createElement("ul");
  for (const line of [
    "The payee, date, amount and reference of each unrecognised transaction, and only " +
      "those, with whose bank account it came from and that account's last few digits. " +
      "Never a whole bank account number, and never a transaction a rule already coded.",
    "Your chart of accounts: the codes and names, so it has something to choose from.",
    "How you coded similar payees before, as examples.",
    "What you write below about what these books are for.",
  ]) {
    const item = document.createElement("li");
    item.textContent = line;
    list.append(item);
  }
  wrap.append(list);

  const whose = document.createElement("p");
  whose.className = "ai-careful";
  whose.textContent =
    "With your own key, data goes to the AI provider under your account. Without one, it " +
    "uses the OsaBooks demo key, through that account. For a client's books, get their consent " +
    "first. It is off until you turn it on, separately for each set of books.";
  wrap.append(whose);

  const on = document.createElement("button");
  on.type = "button";
  on.className = "primary";
  on.textContent = "Turn on for these books";
  on.addEventListener("click", () => {
    state.ledger.aiEnabled = true;
    void save(state.ledger).then(() => {
      redraw("aiSetup");
      redraw("ai");
      redraw("aiCheck");
    });
  });
  const row = document.createElement("div");
  row.className = "migration-actions";
  row.append(on);
  wrap.append(row);
  return wrap;
}

function button(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = label;
  b.addEventListener("click", onClick);
  return b;
}

function panel(title: string): [HTMLElement, HTMLElement] {
  const box = document.createElement("div");
  box.className = "ai-panel";
  const inner = document.createElement("div");
  // A panel the step above has already named does not name itself again.
  if (title !== "") {
    const heading = document.createElement("h3");
    heading.textContent = title;
    box.append(heading);
  }
  box.append(inner);
  return [box, inner];
}

// --- what these books are --------------------------------------------------

function entitiesOf(): Entity[] {
  return [...(state.ledger.entities ?? emptyEntityModel()).entities];
}

/**
 * The briefing, written once and sent with every question.
 *
 * A model is asked and answers and remembers nothing, so there is no setting
 * it up once and no conversation to continue. What there is instead is better:
 * a description that lives on disk, which can be read, corrected and argued
 * with before it is ever sent, rather than something a model was told once in
 * a session nobody kept.
 */
/**
 * An example for each kind of entity, shown greyed in its box.
 *
 * The coffee roastery is the example the page has always had, and it goes on
 * the first business, where it fits. The rest say what a rental or a person's
 * own affairs look like to somebody coding them -- which is the whole of what
 * these boxes are for.
 */
function exampleFor(entity: Entity, firstBusiness: boolean): string {
  if (entity.kind === "residential") {
    return "A house let to long-term tenants. Rent in; rates, insurance, mortgage interest " +
      "and repairs out.";
  }
  if (entity.kind === "commercial") {
    return "A shop unit leased to a business tenant, who pays rent plus GST and repays the " +
      "outgoings.";
  }
  if (entity.kind === "personal") {
    return "Personal spending: household bills, groceries, a car, and money moved to and " +
      "from the business.";
  }
  return firstBusiness
    ? "A coffee roastery in Nelson. Buys green beans by the sack, sells wholesale to cafes " +
        "and retail online. Two vans."
    : "What it does, who it sells to, and what it buys most of.";
}

/**
 * What each entity does, which goes with every question to a model.
 *
 * One box per entity and no box for the books as a whole. The books box asked
 * the same question again one level up, and with the entities listed beneath
 * it, somebody had to decide which of two places a sentence belonged in.
 *
 * Anything written in the old books box is moved into the first business, once,
 * rather than dropped or left sending text nobody can see any more.
 */
function briefingPanel(): HTMLElement {
  const [box, inner] = panel("");
  inner.append(
    note(
      "A sentence or two for each: what it sells or rents, who it buys from, anything " +
        "unusual. Sent with every AI question to improve its suggestions, for example whether " +
        "“supplies” means green beans or gib board.",
    ),
  );

  const entities = entitiesOf();
  const legacy = (state.ledger.booksAbout ?? "").trim();
  if (legacy !== "" && entities.length > 0) {
    const target = entities.find((one) => (one.kind ?? "business") === "business") ?? entities[0];
    if (target !== undefined) {
      const had = (target.about ?? "").trim();
      const merged = had.includes(legacy) ? had : [had, legacy].filter((t) => t !== "").join(" ");
      state.ledger.booksAbout = "";
      void save(state.ledger);
      if (merged !== had) {
        const live = state.ledger.entities ?? emptyEntityModel();
        void saveEntities(
          {
            ...live,
            entities: live.entities.map((one) =>
              one.id === target.id ? { ...one, about: merged } : one,
            ),
          },
          `What ${target.name} does, moved from the books' description`,
        );
        target.about = merged;
      }
    }
  }

  let businessSeen = false;
  for (const entity of entities) {
    const isBusiness = (entity.kind ?? "business") === "business";
    const firstBusiness = isBusiness && !businessSeen;
    if (isBusiness) businessSeen = true;

    const row = document.createElement("div");
    row.className = "ai-entity";
    const name = document.createElement("span");
    name.className = "ai-entity-name";
    name.textContent = entity.name;
    // Room for a sentence or two: one about a business does not fit in a
    // single-line box, and one cut off at the edge reads as one unfinished.
    const what = document.createElement("textarea");
    what.className = "ai-about";
    what.rows = 3;
    what.placeholder = exampleFor(entity, firstBusiness);
    what.value = entity.about ?? "";
    what.addEventListener("change", () => {
      const live = state.ledger.entities ?? emptyEntityModel();
      void saveEntities(
        {
          ...live,
          entities: live.entities.map((one) =>
            one.id === entity.id ? { ...one, about: what.value.trim() } : one,
          ),
        },
        `What ${entity.name} does`,
      );
    });
    row.append(name, what);
    inner.append(row);
  }
  return box;
}

// --- a review of the year, which is a different question ------------------

// --- the route that needs nothing set up -----------------------------------

/**
 * The prompt, for a person to carry to whatever model they already have.
 *
 * No key, no proxy and no cost. It is also often the better answer: a
 * frontier model asked once about two hundred lines will beat a cheap one
 * asked ten times about twenty, and somebody pasting into a window they
 * already pay for is not watching a meter.
 *
 * What comes back goes through the same door as everything else -- the chart
 * check, the account translation, the direction look -- because an answer
 * from a chat window has had even less of this app's care than one from the
 * API, not more.
 */
function carryPanel(): HTMLElement {
  const [box, inner] = panel("");
  inner.append(
    carrySection({
      onRead: ({ got }) => {
        showPage("reconcile");
        void Promise.resolve().then(async () => {
          await tellOnPage(
            `${got} suggestion${got === 1 ? "" : "s"} read. They are on the lines they ` +
              "belong to, under AI suggested.",
          );
        });
      },
      alongside: [button("Go to Reconcile", () => showPage("reconcile"))],
    }),
  );
  return box;
}

// --- asking automatically, which happens on the page where the coding is done -

/**
 * Where the suggestions are, which is not here.
 *
 * This page sets the thing up. The asking is on Reconcile, beside the lines
 * it is about, because a suggestion read anywhere else has to be carried back
 * to the row it belongs to before it can be agreed to.
 */

/**
 * Asking when the books open, as a choice made here.
 *
 * Shown only once a key of the owner's own is set -- this is where that panel
 * draws -- because it spends that key: never the shared allowance, which one
 * person opening their books each morning would empty for everybody else.
 */
function autoSuggestChoice(): HTMLElement {
  const label = document.createElement("label");
  label.className = "feed-auto";
  const box = document.createElement("input");
  box.type = "checkbox";
  box.checked = state.ledger.aiAutoSuggest === true;
  box.addEventListener("change", () => {
    const before = state.ledger.aiAutoSuggest === true;
    if (box.checked) state.ledger = { ...state.ledger, aiAutoSuggest: true };
    else {
      const { aiAutoSuggest: _gone, ...rest } = state.ledger;
      state.ledger = rest;
    }
    void save(state.ledger).then(async (persistent) => {
      state.persistent = persistent;
      await record(
        "aiAutoSuggest",
        box.checked ? "AI suggestions when the books open: on" : "AI suggestions when the books open: off",
        before,
        box.checked,
      );
    });
  });
  label.append(
    box,
    ` Suggest codes for waiting lines when OsaBooks opens (up to ${AI_OWN_BATCH} lines each time, on your own key)`,
  );
  return label;
}

/**
 * Ask about what is waiting, once, as the books open.
 *
 * After the feed has brought in whatever it brings, so today's lines are among
 * those asked about. Not waited for by anything: the books are on the screen
 * already. Suggestions are kept for the session only, as they are when asked
 * by hand, so each opening asks again; the cap keeps that to one batch.
 */
export async function autoSuggestOnOpen(): Promise<void> {
  if (!aiAllowed() || state.ledger.aiAutoSuggest !== true) return;
  const status = await aiStatus().catch(() => null);
  // A key of the owner's own, or nothing: never the shared allowance.
  if (status === null || status.configured !== true) return;
  const waiting = waitingForAnswers();
  if (waiting.length === 0) return;
  const { got, said } = await askAboutLines(waiting, AI_OWN_BATCH);
  sayAiTrouble(got === 0 ? said : "");
  redraw("reconcile");
  redraw("actionsBadge");
  if (state.page === "actions") redraw("actions");
}
