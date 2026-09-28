// RPT4030 Shift handover — what the outgoing shift leaves: output per line, stoppages (still open ones first), open
// quality holds, units waiting in repair, and the notes people wrote. Notes are never edited: a correction is a new
// note that points to the one it corrects. The incoming lead confirms receipt once; that is kept as a fact.
import * as ui from "/eco-ui/eco-ui.js";
import { api, can, commandId, hhmm, showError, stamp, stopName, t, today } from "../common.js";
import { lineOptions } from "../views.js";

const { h } = ui;
const KINDS = ["production", "quality", "safety", "maintenance", "material", "people", "other"];

export default function create({ shell }) {
  const day = ui.input({ type: "date", value: today(), width: "150px" });
  const shiftSel = ui.select({ options: [], width: "160px" });
  const lineSel = ui.select({ options: [["", t("all")]], width: "220px" });
  const host = h("div", { class: "mes-report mes-handover" });
  const sc = ui.screen({ code: "RPT4030", title: t("scr.RPT4030"), path: [t("g.reports"), t("m.reports")], shell,
    toolbar: [day, shiftSel, lineSel], standard: { inquiry: () => load(), inquiryLabel: t("inquiry"), print: () => window.print(), printLabel: t("print") }, body: host });
  const q = () => ({ date: day.value, shift: shiftSel.value, ...(lineSel.value ? { line: lineSel.value } : {}) });
  async function load() {
    if (!shiftSel.value) return;
    let r;
    try { r = await api("GET", "/api/handover?" + new URLSearchParams(q())); } catch (e) { showError(e); return; }
    const kind = h("select", { class: "eco-input" }, KINDS.map((k) => h("option", { value: k, text: t("note." + k) })));
    const text = h("textarea", { class: "eco-input mes-note-input", rows: 3, maxlength: 2000, placeholder: t("ho.note_ph") });
    const corrected = new Set(r.notes.filter((n) => n.corrects_seq).map((n) => n.corrects_seq));
    ui.clear(host,
      h("h2", { class: "mes-print-title" }, t("scr.RPT4030") + " · ", ui.ltr(r.date + " · " + r.shift + (r.line ? " · " + r.line : ""))),
      r.received ? ui.banner("ok", t("ho.received", { by: r.received.by_user, at: stamp(r.received.at) }))
        : can("rpt.notes.write") ? ui.banner("info", t("ho.not_received"), { action: ui.button({ label: t("ho.receive"), icon: "check", kind: "primary", onClick: () => receive() }) }) : null,
      ui.kpiStrip([{ label: t("rpt.good"), value: ui.fmtNumber(r.output.reduce((a, o) => a + o.good, 0)), status: "ok" }, { label: t("rpt.scrap"), value: ui.fmtNumber(r.output.reduce((a, o) => a + o.scrap, 0)) },
        { label: t("ho.open_stops"), value: String(r.openStoppages), status: r.openStoppages ? "bad" : null }, { label: t("ho.open_holds"), value: String(r.openHolds.length), status: r.openHolds.length ? "warn" : null },
        { label: t("wip.in_repair"), value: String(r.inRepair), status: r.inRepair ? "warn" : null }]),
      h("div", { class: "mes-cols2" },
        h("section", { class: "mes-card" }, h("h3", { text: t("ho.output") }), r.output.length ? h("table", { class: "mes-table" },
          h("thead", {}, h("tr", {}, [t("c.line"), t("rpt.good"), t("rpt.scrap"), t("ho.orders")].map((x) => h("th", { text: x })))),
          h("tbody", {}, r.output.map((o) => h("tr", {}, h("td", {}, ui.ltr(o.line)), h("td", {}, ui.ltr(ui.fmtNumber(o.good))), h("td", {}, ui.ltr(ui.fmtNumber(o.scrap))), h("td", {}, ui.ltr(o.orders.join(" · "))))))) : ui.empty({ icon: "clipboard", title: t("ho.no_output") })),
        h("section", { class: "mes-card" }, h("h3", { text: t("bd.stops") }), r.stoppages.length ? h("ul", { class: "mes-list" }, [...r.stoppages].sort((a, b) => (a.endedAt ? 1 : 0) - (b.endedAt ? 1 : 0)).map((s) =>
          h("li", { class: s.endedAt ? "" : "is-bad" }, ui.ltr(hhmm(s.startedAt) + "–" + (s.endedAt ? hhmm(s.endedAt) : "…")), " ", h("b", { text: stopName(s.reason) }), " · ", ui.ltr(s.station || s.line), " · ", ui.ltr(s.minutes + " " + t("bd.min")))))
          : ui.empty({ icon: "check-circle", title: t("bd.no_stops") }))),
      r.openHolds.length ? h("section", { class: "mes-card" }, h("h3", { text: t("ho.open_holds") }), h("ul", { class: "mes-list" }, r.openHolds.map((x) => h("li", {}, h("b", {}, ui.ltr(x.code)), " · ", t("ht." + x.target_type), " ", ui.ltr(x.target), " · ", x.reason, " · ", ui.ltr(x.units + " " + t("unit.pcs")))))) : null,
      h("section", { class: "mes-card" }, h("h3", { text: t("ho.notes") + " · " + r.notes.length }),
        r.notes.length ? h("ol", { class: "mes-notes" }, r.notes.map((n) => h("li", { class: corrected.has(n.seq) ? "is-corrected" : "" },
          h("div", {}, h("span", { class: "eco-badge eco-badge-neutral", text: t("note." + n.kind) }), n.line ? ui.ltr(" " + n.line) : null, h("span", { class: "eco-muted" }, " · ", n.by_user, " · ", ui.ltr(hhmm(n.at))),
            n.corrects_seq ? h("span", { class: "eco-muted", text: " · " + t("ho.corrects", { n: n.corrects_seq }) }) : null, h("span", { class: "eco-muted" }, ui.ltr(" #" + n.seq))),
          h("p", { text: n.text }),
          can("rpt.notes.write") && !corrected.has(n.seq) ? ui.button({ label: t("ho.correct"), kind: "ghost", size: "sm", onClick: () => { text.value = ""; text.dataset.corrects = n.seq; text.placeholder = t("ho.corrects", { n: n.seq }); text.focus(); } }) : null)))
          : ui.empty({ icon: "edit", title: t("ho.no_notes") }),
        can("rpt.notes.write") ? h("div", { class: "mes-note-add" }, kind, text, ui.button({ label: t("ho.add_note"), icon: "plus", kind: "primary", onClick: () => add(kind.value, text) })) : null));
  }
  async function add(kind, box) {
    if (!box.value.trim()) return;
    try {
      await api("POST", "/api/handover/notes", { commandId: commandId(), date: day.value, shift: shiftSel.value, line: lineSel.value || null, kind, text: box.value.trim(),
        ...(box.dataset.corrects ? { corrects: Number(box.dataset.corrects) } : {}) });
      load();
    } catch (e) { showError(e); }
  }
  async function receive() {
    if (!(await ui.confirm({ title: t("ho.receive"), text: t("ho.receive_help"), okLabel: t("ho.receive") }))) return;
    try { await api("POST", "/api/handover/receive", { commandId: commandId(), date: day.value, shift: shiftSel.value, line: lineSel.value || null }); load(); } catch (e) { showError(e); }
  }
  api("GET", "/api/production-calendar").then((c) => {
    const shifts = c.shifts.filter((x) => x.active);
    ui.clear(shiftSel, (shifts.length ? shifts : [{ code: "A", start_at: "", end_at: "" }]).map((s) => h("option", { value: s.code, text: s.code + (s.start_at ? " · " + s.start_at + "–" + s.end_at : "") })));
    load();
  }).catch(showError);
  lineOptions().then((opts) => { for (const [a, b] of opts) lineSel.append(h("option", { value: a, text: b })); });
  for (const x of [day, shiftSel, lineSel]) x.addEventListener("change", load);
  return { el: sc.el };
}
