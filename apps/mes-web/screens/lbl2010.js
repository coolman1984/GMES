// LBL2010 Print labels — scan or type a serial / pallet, see the label with the values it will carry, print it. A
// thing that already has its label can only be REPRINTED: that needs its own permission and a reason, and the screen
// shows every earlier print of it first. Below: today's print log (who, what, which printer, whether it arrived).
import * as ui from "/eco-ui/eco-ui.js";
import { api, ApiError, can, commandId, name, showError, stamp, t, today } from "../common.js";
import { zplPreview } from "../views.js";

const { h } = ui;

export default function create({ shell }) {
  let templates = [], rendered = null;
  const tplSel = ui.select({ options: [] }), prnSel = ui.select({ options: [] });
  const target = ui.input({ dir: "ltr", placeholder: t("lbl.scan_ph") });
  const copies = ui.input({ type: "number", value: 1, width: "80px", dir: "ltr" });
  const reason = ui.input({ placeholder: t("lbl.reason_ph") });
  const reasonField = ui.field(t("lbl.reason"), reason, { required: true });
  const info = h("div", { class: "mes-label-info" }), preview = h("div", { class: "mes-label-host" }), log = h("div", {});
  const printBtn = ui.button({ label: t("lbl.print"), icon: "printer", kind: "primary", onClick: () => print() });
  const sc = ui.screen({ code: "LBL2010", title: t("scr.LBL2010"), path: [t("g.reports"), t("m.labels")], shell, standard: { inquiry: () => loadLog(), inquiryLabel: t("refresh") },
    body: h("div", {}, h("div", { class: "mes-cols2" },
      h("section", { class: "mes-card" }, h("div", { class: "mes-form" }, ui.field(t("lbl.template"), tplSel), ui.field(t("lbl.target"), target), ui.field(t("lbl.printer"), prnSel), ui.field(t("lbl.copies"), copies), reasonField),
        info, h("div", { class: "mes-actions" }, ui.button({ label: t("lbl.preview"), icon: "eye", onClick: () => render() }), printBtn)),
      h("section", { class: "mes-card" }, h("h3", { text: t("lbl.preview") }), preview)),
      h("section", { class: "mes-card" }, h("h3", { text: t("lbl.log") }), log)) });
  reasonField.hidden = true;
  target.addEventListener("keydown", (e) => { if (e.key === "Enter") render(); });
  tplSel.addEventListener("change", () => { const k = (templates.find((x) => x.code === tplSel.value) || {}).kind; target.disabled = k === "free"; render(); });
  async function render() {
    rendered = null; ui.clear(info); ui.clear(preview);
    const tpl = templates.find((x) => x.code === tplSel.value);
    if (!tpl || (tpl.kind !== "free" && !target.value.trim())) return;
    try { rendered = await api("POST", "/api/labels/render", { template: tpl.code, target: tpl.kind === "free" ? null : target.value.trim() }); }
    catch (e) { ui.clear(info, ui.banner("bad", e.message)); return; }
    reasonField.hidden = !rendered.reprint;
    printBtn.disabled = rendered.reprint && !can("lbl.reprint");
    ui.clear(preview, zplPreview(rendered.zpl, { scale: 0.6 }));
    ui.clear(info, rendered.reprint ? ui.banner("warn", t("lbl.already", { n: rendered.printed.length }) + (can("lbl.reprint") ? "" : " " + t("lbl.no_reprint")),
      { title: t("lbl.reprint") }) : ui.banner("ok", t("lbl.first")),
      rendered.printed.length ? h("ul", { class: "mes-list" }, rendered.printed.map((p) => h("li", {}, ui.ltr(stamp(p.at)), " · ", p.by_user, p.reason ? " · " + p.reason : ""))) : null);
  }
  async function print() {
    if (!rendered) await render();
    if (!rendered) return;
    if (rendered.reprint && reason.value.trim().length < 3) { ui.toast({ kind: "warn", title: t("lbl.reason"), text: t("lbl.reason_ph") }); reason.focus(); return; }
    try {
      const r = await api("POST", "/api/labels/print", { commandId: commandId(), template: rendered.template, target: rendered.target, printer: prnSel.value, copies: Number(copies.value) || 1,
        ...(rendered.reprint ? { reason: reason.value.trim() } : {}) });
      ui.toast({ kind: r.sent ? "ok" : "warn", title: r.sent ? t("lbl.sent") : t("lbl.not_sent"), text: (r.target || rendered.template) + (r.error ? " · " + r.error : "") });
      reason.value = ""; target.value = ""; target.focus(); rendered = null; ui.clear(preview); ui.clear(info); reasonField.hidden = true;
      loadLog();
    } catch (e) { showError(e); }
  }
  async function loadLog() {
    let rows;
    try { rows = await api("GET", "/api/labels/prints?date=" + today()); } catch (e) { showError(e); return; }
    ui.clear(log, rows.length ? h("table", { class: "mes-table" }, h("thead", {}, h("tr", {}, ["#", t("c.time"), t("lbl.template"), t("lbl.target"), t("lbl.printer"), t("lbl.copies"), t("lbl.kind_print"), t("c.user"), t("c.status")].map((x) => h("th", { text: x })))),
      h("tbody", {}, rows.map((p) => h("tr", {}, h("td", {}, ui.ltr(String(p.seq))), h("td", {}, ui.ltr(stamp(p.at))), h("td", {}, ui.ltr(p.template_code + " v" + p.template_version)), h("td", {}, ui.ltr(p.target || "")),
        h("td", {}, ui.ltr(p.printer_code)), h("td", {}, ui.ltr(String(p.copies))), h("td", {}, p.reprint ? h("span", { class: "eco-badge eco-badge-warn", title: p.reason, text: t("lbl.reprint") }) : t("lbl.first_short")),
        h("td", { text: p.by_user }), h("td", {}, p.ok === null ? "…" : p.ok ? ui.statusChip("done", t("lbl.sent")) : ui.statusChip("down", p.error || t("lbl.not_sent")))))))
      : ui.empty({ icon: "printer", title: t("lbl.no_prints") }));
  }
  Promise.all([api("GET", "/api/label-templates"), api("GET", "/api/printers")]).then(([tp, pr]) => {
    templates = tp.filter((x) => x.active);
    ui.clear(tplSel, templates.map((x) => h("option", { value: x.code, text: x.code + " · " + name(x) })));
    ui.clear(prnSel, pr.filter((p) => p.active).map((p) => h("option", { value: p.code, text: p.code + " · " + p.name })));
    if (!pr.length) ui.clear(info, ui.banner("warn", t("lbl.no_printers")));
  }).catch(showError);
  loadLog();
  return { el: sc.el };
}
