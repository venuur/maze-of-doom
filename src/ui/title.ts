/** Title screen: save slots (continue, new game, delete, export, import). */
import "./title.css";
import {
  SaveError,
  deleteSlot,
  exportSlot,
  importSlot,
  loadSlot,
  newSeed,
  slotSummaries,
  type KeyValueStore,
} from "../game/save";
import { createSession, type Session } from "../game/session";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&${{ "&": "amp", "<": "lt", ">": "gt", '"': "quot" }[c]};`);

export class TitleScreen {
  private readonly el: HTMLElement;
  private note = "";
  private confirmDelete: number | null = null;

  constructor(
    host: HTMLElement,
    private readonly store: KeyValueStore,
    private readonly onStart: (session: Session, slot: number, isNew: boolean) => void,
  ) {
    this.el = document.createElement("div");
    this.el.className = "title";
    host.appendChild(this.el);
    this.el.addEventListener("click", (ev) => this.onClick(ev));
    this.el.addEventListener("change", (ev) => this.onFile(ev.target as HTMLInputElement));
    this.render();
  }

  destroy(): void {
    this.el.remove();
  }

  private onClick(ev: Event) {
    const b = (ev.target as HTMLElement).closest<HTMLElement>("[data-act]");
    if (!b) return;
    const slot = Number(b.dataset.slot);
    const act = b.dataset.act!;
    this.note = "";
    if (act !== "delete") this.confirmDelete = null;
    try {
      switch (act) {
        case "continue": {
          const s = loadSlot(this.store, slot);
          if (s) return this.onStart(s, slot, false);
          break;
        }
        case "new":
          return this.onStart(createSession("antechamber", newSeed()), slot, true);
        case "delete":
          if (this.confirmDelete === slot) {
            deleteSlot(this.store, slot);
            this.confirmDelete = null;
            this.note = `Slot ${slot} deleted.`;
          } else {
            this.confirmDelete = slot;
          }
          break;
        case "export": {
          const json = exportSlot(this.store, slot);
          if (!json) break;
          const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
          const a = document.createElement("a");
          a.href = url;
          a.download = `maze-of-doom-slot-${slot}.json`;
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
          break;
        }
        case "import":
          this.el.querySelector<HTMLInputElement>(`input[data-slot="${slot}"]`)?.click();
          return;
      }
    } catch (err) {
      this.note = err instanceof SaveError ? err.message : `Couldn't load: ${(err as Error).message}`;
    }
    this.render();
  }

  private async onFile(input: HTMLInputElement) {
    const file = input.files?.[0];
    if (!file) return;
    const slot = Number(input.dataset.slot);
    try {
      importSlot(this.store, slot, await file.text());
      this.note = `Imported into slot ${slot}.`;
    } catch (err) {
      this.note = err instanceof SaveError ? err.message : `Import failed: ${(err as Error).message}`;
    }
    this.render();
  }

  render(): void {
    const cards = slotSummaries(this.store)
      .map((sum, i) => {
        const slot = i + 1;
        const file = `<input type="file" accept="application/json,.json" data-slot="${slot}" hidden>`;
        if (!sum) {
          return `<section class="slot empty"><h2>Slot ${slot}</h2><p class="hint">Empty</p>
            <div class="row"><button class="primary" data-act="new" data-slot="${slot}">New game</button>
            <button data-act="import" data-slot="${slot}">Import…</button></div>${file}</section>`;
        }
        const party = sum.party.map((m) => `${esc(m.name)} <span class="hint">${esc(m.job)} ${m.level}</span>`).join(" · ");
        const confirming = this.confirmDelete === slot;
        return `<section class="slot"><h2>Slot ${slot}</h2>
          <div>${esc(sum.zoneName)}</div>
          <div class="hint">${sum.zonesVisited} zone${sum.zonesVisited === 1 ? "" : "s"} explored · saved ${new Date(sum.savedAt).toLocaleString()}</div>
          <div class="party">${party}</div>
          <div class="row">
            <button class="primary" data-act="continue" data-slot="${slot}">Continue</button>
            <button data-act="export" data-slot="${slot}">Export</button>
            <button data-act="import" data-slot="${slot}" title="Replace this slot with a save file">Import…</button>
            <button class="${confirming ? "danger" : ""}" data-act="delete" data-slot="${slot}">${confirming ? "Really delete?" : "Delete"}</button>
          </div>${file}</section>`;
      })
      .join("");
    this.el.innerHTML = `
      <h1>Maze of Doom</h1>
      <p class="hint">A living Maze that remembers you. Progress saves automatically to this browser. Export a slot to keep a copy or move it to another device.</p>
      ${this.note ? `<p class="note">${esc(this.note)}</p>` : ""}
      <div class="slots">${cards}</div>
      <p class="hint"><a href="battle.html">Battle sandbox →</a></p>`;
  }
}
