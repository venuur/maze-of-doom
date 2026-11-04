/**
 * Party menu: change jobs and fill ability slots. DOM over the pure job
 * system in core/jobs.ts; every change goes through its mutators.
 */
import "./party-menu.css";
import {
  JobError,
  PASSIVE_SLOTS,
  availableJobs,
  battleSkills,
  changeJob,
  equip,
  hybridRequirement,
  learnedPassives,
  learnedSkills,
  levelIn,
  maxLevel,
  secondaryOptions,
  setSecondary,
  xpToNext,
  type Character,
  type PassiveSlot,
} from "../core/jobs";
import { JOBS, JOB_CONTENT, PASSIVES, SKILLS } from "../data/battle";
import type { Session } from "../game/session";

const C = JOB_CONTENT;
const SLOT_LABEL: Record<PassiveSlot, string> = { reaction: "Reaction", support: "Support", movement: "Movement" };
const abilityName = (id: string) => SKILLS[id]?.name ?? PASSIVES[id]?.name ?? id;
const abilityDesc = (id: string) => SKILLS[id]?.desc ?? PASSIVES[id]?.desc ?? "";
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&${{ "&": "amp", "<": "lt", ">": "gt", '"': "quot" }[c]};`);

export class PartyMenu {
  private readonly el: HTMLElement;
  private note = "";

  constructor(host: HTMLElement, private readonly session: Session, private readonly onChange: () => void, onClose: () => void) {
    this.el = document.createElement("div");
    this.el.className = "pm";
    host.appendChild(this.el);
    this.el.addEventListener("change", (ev) => this.onSelect(ev.target as HTMLSelectElement));
    this.el.addEventListener("click", (ev) => {
      if ((ev.target as HTMLElement).closest("[data-close]")) onClose();
    });
    this.render();
  }

  destroy(): void {
    this.el.remove();
  }

  private onSelect(sel: HTMLSelectElement) {
    const ch = this.session.party.find((c) => c.id === sel.dataset.char);
    if (!ch) return;
    const v = sel.value || null;
    try {
      const slot = sel.dataset.slot!;
      if (slot === "primary") changeJob(C, ch, v!, this.session.discovered);
      else if (slot === "secondary") setSecondary(C, ch, v);
      else equip(C, ch, slot as PassiveSlot, v);
      this.note = "";
    } catch (err) {
      if (!(err instanceof JobError)) throw err;
      this.note = err.message;
    }
    this.onChange();
    this.render();
  }

  render(): void {
    const s = this.session;
    const base = Object.keys(JOBS).filter((j) => !hybridRequirement(JOBS[j]!));
    const hybrids = Object.keys(JOBS).filter((j) => hybridRequirement(JOBS[j]!));
    const found = base.map((j) => (s.discovered.has(j) ? `<b style="color:${JOBS[j]!.color}">${JOBS[j]!.name}</b>` : `<span class="locked">???</span>`)).join(" · ");
    const recipes = hybrids
      .map((h) => {
        const req = Object.entries(hybridRequirement(JOBS[h]!)!).map(([j, lv]) => `${s.discovered.has(j) ? JOBS[j]!.name : "???"} Lv${lv}`).join(" + ");
        return `<div><b style="color:${JOBS[h]!.color}">${JOBS[h]!.name}</b> <span class="hint">hybrid: ${req}, on the same character</span></div>`;
      })
      .join("");

    this.el.innerHTML = `
      <div class="pm-head">
        <h1>Party</h1>
        <button data-close class="primary">Close (P)</button>
      </div>
      <div class="hint">Jobs level up from victories (XP goes to each survivor's current job). Learned abilities stay learned after you switch jobs: use another job's commands as your Secondary, and equip passives from any job.</div>
      <div class="pm-jobs">Jobs found: ${found}</div>
      ${recipes}
      ${this.note ? `<div class="pm-note">${esc(this.note)}</div>` : ""}
      <div class="pm-cards">${s.party.map((c) => this.card(c)).join("")}</div>`;
  }

  private card(ch: Character): string {
    const job = JOBS[ch.primary]!;
    const xp = ch.jobXp[ch.primary] ?? 0;
    const lv = levelIn(C, ch, ch.primary);
    const toNext = xpToNext(C, xp);
    const opt = (value: string, label: string, current: string | null) =>
      `<option value="${value}" ${value === (current ?? "") ? "selected" : ""}>${esc(label)}</option>`;

    const jobs = availableJobs(C, ch, this.session.discovered)
      .map((j) => opt(j, `${JOBS[j]!.name} (Lv${Math.max(1, levelIn(C, ch, j))})`, ch.primary))
      .join("");
    const sec = [opt("", "— none —", ch.secondary), ...secondaryOptions(C, ch).map((j) => opt(j, `${JOBS[j]!.name} (${learnedSkills(C, ch, j).length} skills)`, ch.secondary))].join("");
    const slots = PASSIVE_SLOTS.map((slot) => {
      const options = learnedPassives(C, ch, slot);
      const sel = [opt("", options.length ? "— none —" : "— none learned —", ch[slot]), ...options.map((id) => opt(id, PASSIVES[id]!.name, ch[slot]))].join("");
      const desc = ch[slot] ? PASSIVES[ch[slot]!]!.desc : "";
      return row(SLOT_LABEL[slot], `<select data-char="${ch.id}" data-slot="${slot}" ${options.length ? "" : "disabled"}>${sel}</select>`, desc);
    }).join("");

    const primarySkills = new Set(learnedSkills(C, ch, ch.primary));
    const skills = battleSkills(C, ch)
      .map((id) => `<span class="chip ${primarySkills.has(id) ? "" : "sec"}" title="${esc(abilityDesc(id))}">${esc(abilityName(id))}</span>`)
      .join("");

    const progress = Object.keys(ch.jobXp)
      .map((j) => {
        const jl = levelIn(C, ch, j);
        const abil = JOBS[j]!.abilities
          .map((a) => {
            const got = a.level <= jl;
            const kind = SKILLS[a.id] ? "skill" : PASSIVES[a.id]!.slot;
            return `<li class="${got ? "got" : ""}" title="${esc(abilityDesc(a.id))}">${got ? "✓" : `Lv${a.level}`} ${esc(abilityName(a.id))} <span class="hint">${kind}</span></li>`;
          })
          .join("");
        const jxp = ch.jobXp[j]!;
        const nxt = xpToNext(C, jxp);
        return `<details ${j === ch.primary ? "open" : ""}><summary><b style="color:${JOBS[j]!.color}">${JOBS[j]!.name}</b> Lv${jl}${jl >= maxLevel(C) ? " (max)" : ` · ${jxp} XP, ${nxt} to next`}</summary><ul>${abil}</ul></details>`;
      })
      .join("");

    return `<section class="pm-card">
      <div class="pm-title">
        <span class="token" style="background:${job.color}">${job.glyph}</span>
        <div><b>${esc(ch.name)}</b> <span class="hint">${ch.kind}</span><br>
        ${job.name} Lv${lv} · ${toNext === null ? "max level" : `${toNext} XP to Lv${lv + 1}`} · HP ${ch.hp}/${ch.maxHp}</div>
      </div>
      <div class="pm-slots">
        ${row("Job", `<select data-char="${ch.id}" data-slot="primary">${jobs}</select>`, job.desc)}
        ${row("Secondary", `<select data-char="${ch.id}" data-slot="secondary" ${secondaryOptions(C, ch).length ? "" : "disabled"}>${sec}</select>`, ch.secondary ? `${JOBS[ch.secondary]!.name} commands` : "Learn a second job to use its commands here.")}
        ${slots}
      </div>
      <div class="pm-skills"><span class="hint">In battle:</span> ${skills}</div>
      <div class="pm-progress">${progress}</div>
    </section>`;
  }
}

function row(label: string, control: string, desc: string): string {
  return `<label><span>${label}</span>${control}<small>${esc(desc)}</small></label>`;
}
