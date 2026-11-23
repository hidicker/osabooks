/**
 * The copy left at an old address once OsaBooks has moved (nbparagliding.nz/osabooks
 * to osabooks.app, 23 November 2026). Built with OSABOOKS_MOVED_TO set.
 *
 * The old address shared its browser storage with the paragliding school's
 * other sites (code review of 20 November, section 5), so books online are
 * not opened there at all. Books kept in this browser belong to the old
 * address and cannot be read from the new one: they are offered as a backup
 * to restore there. Somebody with nothing kept here is sent straight on.
 */
declare const __MOVED_TO__: string;

export const MOVED_TO: string = typeof __MOVED_TO__ === "string" ? __MOVED_TO__ : "";

export function moved(): boolean {
  return MOVED_TO !== "";
}

/** The notice across the top, with the backup and the way on. */
export function movedNotice(backUp: () => Promise<void>): HTMLElement {
  const box = document.createElement("div");
  box.className = "moved-notice variance-note warn";
  const said = document.createElement("p");
  said.textContent =
    `OsaBooks has moved to ${MOVED_TO.replace(/^https:\/\//, "").replace(/\/$/, "")}. The books kept in this browser stay here, ` +
    "at the old address: back them up, then restore the file there (Books, Restore from a backup). " +
    "Books kept online are opened there: sign in there as before.";
  const save = document.createElement("button");
  save.type = "button";
  save.className = "primary";
  save.textContent = "Back up these books";
  save.addEventListener("click", () => {
    save.disabled = true;
    void backUp().finally(() => {
      save.disabled = false;
      save.textContent = "Backed up: back up again";
    });
  });
  const go = document.createElement("a");
  go.href = MOVED_TO;
  go.className = "button";
  go.textContent = `Go to ${MOVED_TO.replace(/^https:\/\//, "").replace(/\/$/, "")}`;
  box.append(said, save, " ", go);
  return box;
}
