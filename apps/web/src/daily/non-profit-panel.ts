import { saveEntities } from "../books.js";
import { state } from "../state.js";
import { emptyEntityModel, NON_PROFIT_FORMS, nonProfitDefaults, nonProfitNotes, nonProfitReporting } from "@nzosa/core";
import type { Entity, NonProfit, NonProfitForm } from "@nzosa/core";

/**
 * A not-for-profit's settings, in the entity's settings: what sort it is, and
 * the few facts that decide how it is treated -- registered charity, donee
 * organisation, approved for the $1,000 deduction. Under them, in plain words,
 * what it has to file and what follows from the answers given.
 *
 * Shown only for an entity of kind `nonprofit`. The legal form sets the usual
 * answers; each one can be changed on its own, because a club may be a
 * charity and a society may not be (see core's non-profit.ts).
 */

/** The form's usual settings for a new not-for-profit: shown in the add row too. */
export function formSelect(value: NonProfitForm, onChange: (form: NonProfitForm) => void): HTMLSelectElement {
  const select = document.createElement("select");
  select.title = "What sort of organisation it is. Sets the usual answers below; change any of them.";
  for (const [form, caption] of NON_PROFIT_FORMS) {
    const option = document.createElement("option");
    option.value = form;
    option.textContent = caption;
    option.selected = value === form;
    select.append(option);
  }
  select.addEventListener("change", () => onChange(select.value as NonProfitForm));
  return select;
}

/**
 * Save one change to the settings as they are now, not as they were drawn.
 *
 * Each field is saved when it is left, and saving draws the page again. Built
 * from what was drawn, a second field saved before the first had redrawn put
 * the first back as it was; and the redraw took the cursor out of the field
 * just tabbed into. So the change is made to the saved settings, and the
 * cursor is put back in the same field of the new page.
 */
function change(entity: Entity, update: (now: NonProfit) => NonProfit, what: string): void {
  const live = state.ledger.entities ?? emptyEntityModel();
  const now = live.entities.find((e) => e.id === entity.id)?.nonprofit ?? nonProfitDefaults("society");
  const focused = document.activeElement;
  const field =
    focused instanceof HTMLInputElement && focused.closest(".non-profit-settings") !== null ? focused.placeholder : "";
  void saveEntities(
    { ...live, entities: live.entities.map((e) => (e.id === entity.id ? { ...e, nonprofit: update(now) } : e)) },
    `${entity.name}: ${what}`,
  ).then(() => {
    if (field === "") return;
    const again = [...document.querySelectorAll<HTMLElement>(`.non-profit-settings[data-entity="${CSS.escape(entity.id)}"] input`)]
      .find((input) => input instanceof HTMLInputElement && input.placeholder === field);
    again?.focus();
  });
}

function tick(label: string, checked: boolean, onChange: (value: boolean) => void): HTMLLabelElement {
  const wrap = document.createElement("label");
  wrap.className = "entity-gst";
  const box = document.createElement("input");
  box.type = "checkbox";
  box.checked = checked;
  box.addEventListener("change", () => onChange(box.checked));
  wrap.append(box, ` ${label}`);
  return wrap;
}

export function nonProfitSettings(entity: Entity): HTMLElement {
  const box = document.createElement("div");
  box.className = "non-profit-settings";
  box.dataset["entity"] = entity.id;
  box.hidden = entity.kind !== "nonprofit";
  const np: NonProfit = entity.nonprofit ?? nonProfitDefaults("society");

  box.append(
    formSelect(np.form, (form) => {
      // The form's usual answers fill what has not been said; what has is kept.
      const usual = nonProfitDefaults(form);
      change(entity, (now) => ({ ...usual, ...now, form, registeredCharity: now.registeredCharity ?? usual.registeredCharity }), `now a ${form}`);
    }),
    tick("Registered charity", np.registeredCharity === true, (value) =>
      change(entity, (now) => ({ ...now, registeredCharity: value }), value ? "registered charity" : "not a registered charity"),
    ),
  );

  const number = document.createElement("input");
  number.type = "text";
  number.placeholder = "Charity number (CC12345)";
  number.value = np.charityNumber ?? "";
  number.hidden = np.registeredCharity !== true;
  number.addEventListener("change", () => {
    const typed = number.value.trim();
    change(entity, ({ charityNumber: _gone, ...rest }) => (typed === "" ? rest : { ...rest, charityNumber: typed }), "charity number");
  });
  box.append(number);

  box.append(
    tick("Donee organisation (donors can claim a tax credit)", np.donee === true, (value) =>
      change(entity, (now) => ({ ...now, donee: value }), value ? "donee organisation" : "not a donee organisation"),
    ),
  );
  // What a receipt shows, and who signs it: only a donee organisation issues them.
  if (np.donee === true) {
    const parent = document.createElement("input");
    parent.type = "text";
    parent.placeholder = "Part of a larger organisation? Its name, for receipts";
    parent.title = "A branch must say on its receipts which larger organisation it belongs to.";
    parent.value = np.partOf ?? "";
    parent.addEventListener("change", () => {
      const typed = parent.value.trim();
      change(entity, ({ partOf: _gone, ...rest }) => (typed === "" ? rest : { ...rest, partOf: typed }), "part of");
    });
    box.append(parent);
    const ird = document.createElement("input");
    ird.type = "text";
    ird.placeholder = "IRD number";
    ird.value = np.irdNumber ?? "";
    ird.addEventListener("change", () => {
      const typed = ird.value.trim();
      change(entity, ({ irdNumber: _gone, ...rest }) => (typed === "" ? rest : { ...rest, irdNumber: typed }), "IRD number");
    });
    const signer = document.createElement("input");
    signer.type = "text";
    signer.placeholder = "Authorised to sign receipts: full name";
    signer.value = np.signatory?.name ?? "";
    const role = document.createElement("input");
    role.type = "text";
    role.placeholder = "Designation (Treasurer)";
    role.value = np.signatory?.designation ?? "";
    const saveSigner = (): void => {
      const name = signer.value.trim();
      const designation = role.value.trim();
      change(
        entity,
        ({ signatory: _gone, ...rest }) => (name === "" && designation === "" ? rest : { ...rest, signatory: { name, designation } }),
        "who signs receipts",
      );
    };
    signer.addEventListener("change", saveSigner);
    role.addEventListener("change", saveSigner);
    box.append(ird, signer, role);
  }
  if (np.registeredCharity !== true) {
    box.append(
      tick("Approved by Inland Revenue for the $1,000 deduction", np.deduction === true, (value) =>
        change(entity, (now) => ({ ...now, deduction: value }), value ? "approved for the $1,000 deduction" : "not approved for the $1,000 deduction"),
      ),
    );
  }

  const owes = nonProfitReporting(np);
  const notes = nonProfitNotes(np, entity.gstRegistered === true);
  if (owes.length > 0) {
    const heading = document.createElement("h4");
    heading.textContent = "What it files";
    const list = document.createElement("ul");
    for (const line of owes) list.append(Object.assign(document.createElement("li"), { textContent: line }));
    box.append(heading, list);
  }
  const heading = document.createElement("h4");
  heading.textContent = "Worth knowing";
  const list = document.createElement("ul");
  for (const line of notes) list.append(Object.assign(document.createElement("li"), { textContent: line }));
  box.append(heading, list);
  return box;
}
