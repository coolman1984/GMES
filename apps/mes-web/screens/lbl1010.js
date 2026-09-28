// LBL1010 Label templates and printers — the ZPL of each label with its {variables} (checked against what the label is
// for), a live preview with example values, and the plant's label printers (raw TCP, port 9100). Each save is a new
// version; prints record the version they used.
import * as ui from "/eco-ui/eco-ui.js";
import { api, can, commandId, name, showError, t } from "../common.js";
import { lineOptions, zplPreview } from "../views.js";

const { h } = ui;
const SAMPLE = { date: "2026-09-28", time: "10:30", printed_by: "operator", plant: "PLANT", serial: "NT55Q9A00012345", item_code: "TV-55Q9", item_name: "55\" QLED 4K Smart TV",
  wo: "WO-000123", line: "MA-01", made_on: "2026-09-28", pallet: "PL-000042", units: "24", capacity: "24", closed_on: "2026-09-28" };

export default function create({ shell }) {
  let rows = [], cur = null;
  const list = h("div", { class: "mes-list-pick" });
  const code = ui.input({ dir: "ltr", width: "160px" }), nameEn = ui.input({}), nameAr = ui.input({ dir: "rtl" });
  const kind = ui.select({ options: [["unit", t("lblk.unit")], ["pallet", t("lblk.pallet")], ["free", t("lblk.free")]] });
  const zpl = h("textarea", { class: "eco-input mes-zpl", rows: 14, dir: "ltr", spellcheck: "false" });
  const vars = h("div", { class: "mes-vars" });
  const preview = h("div", { class: "mes-label-host" });
  const printers = h("div", {});
  const editor = h("div", { class: "mes-label-editor" },
    h("div", { class: "mes-form mes-form-3" }, ui.field(t("c.code"), code, { required: true }), ui.field(t("c.name") + " (EN)", nameEn, { required: true }), ui.field(t("c.name") + " (AR)", nameAr, { required: true }), ui.field(t("lbl.kind"), kind)),
    h("div", { class: "mes-cols2" }, h("div", {}, ui.field("ZPL", zpl), vars), h("div", {}, h("h4", { text: t("lbl.preview") }), preview)),
    can("lbl.write") ? h("div", { class: "mes-actions" }, ui.button({ label: t("save"), icon: "check", kind: "primary", onClick: () => save() }), ui.button({ label: t("lbl.new"), icon: "plus", onClick: () => pick(null) })) : null);
  const sc = ui.screen({ code: "LBL1010", title: t("scr.LBL1010"), path: [t("g.reports"), t("m.labels")], shell, standard: { inquiry: () => load(), inquiryLabel: t("refresh") },
    body: h("div", { class: "mes-cols-side" }, list, h("div", {}, editor, h("section", { class: "mes-card" }, h("h3", { text: t("lbl.printers") }), printers))) });
  const draw = () => {
    const known = { unit: ["date", "time", "printed_by", "plant", "serial", "item_code", "item_name", "wo", "line", "made_on"], pallet: ["date", "time", "printed_by", "plant", "pallet", "item_code", "item_name", "units", "capacity", "line", "closed_on"], free: ["date", "time", "printed_by", "plant"] }[kind.value];
    const used = [...new Set([...zpl.value.matchAll(/\{([a-z_]+)\}/g)].map((m) => m[1]))];
    ui.clear(vars, known.map((v) => h("button", { type: "button", class: "mes-var" + (used.includes(v) ? " is-used" : ""), onclick: () => insert("{" + v + "}") }, ui.ltr("{" + v + "}"))),
      used.filter((v) => !known.includes(v)).map((v) => h("span", { class: "mes-var is-bad", title: t("lbl.unknown_var") }, ui.ltr("{" + v + "}"))));
    ui.clear(preview, zplPreview(zpl.value.replace(/\{([a-z_]+)\}/g, (_, k) => SAMPLE[k] ?? "{" + k + "}"), { scale: 0.6 }));
  };
  const insert = (s) => { const p = zpl.selectionStart ?? zpl.value.length; zpl.value = zpl.value.slice(0, p) + s + zpl.value.slice(zpl.selectionEnd ?? p); zpl.focus(); draw(); };
  zpl.addEventListener("input", draw); kind.addEventListener("change", draw);
  function pick(r) {
    cur = r;
    code.value = r ? r.code : ""; code.readOnly = !!r; nameEn.value = r ? r.name_en : ""; nameAr.value = r ? r.name_ar : ""; kind.value = r ? r.kind : "unit";
    zpl.value = r ? r.zpl : "^XA^PW812^LL406\n^FO30,30^A0N,40,40^FD{item_name}^FS\n^FO30,90^BY2^BCN,90,Y,N,N^FD{serial}^FS\n^XZ";
    for (const b of list.children) b.classList.toggle("is-on", r && b.dataset.code === r.code);
    draw();
  }
  async function save() {
    try {
      await api("PUT", "/api/label-templates/" + encodeURIComponent(code.value.trim().toUpperCase()), { commandId: commandId(), name_en: nameEn.value, name_ar: nameAr.value, kind: kind.value, zpl: zpl.value, ...(cur ? { version: cur.version } : {}) });
      ui.toast({ kind: "ok", title: t("saved"), text: code.value });
      await load(code.value.trim().toUpperCase());
    } catch (e) { showError(e); }
  }
  async function load(keep) {
    try { rows = await api("GET", "/api/label-templates"); } catch (e) { showError(e); return; }
    ui.clear(list, rows.map((r) => h("button", { type: "button", class: "mes-pick", "data-code": r.code, onclick: () => pick(r) }, h("b", {}, ui.ltr(r.code)), h("span", { text: name(r) }),
      h("small", { class: "eco-muted" }, t("lblk." + r.kind) + " · v" + r.version))));
    pick(rows.find((r) => r.code === (keep || (cur && cur.code))) || rows[0] || null);
    loadPrinters();
  }
  async function loadPrinters() {
    let ps;
    try { ps = await api("GET", "/api/printers"); } catch (e) { showError(e); return; }
    ui.clear(printers, ps.length ? h("table", { class: "mes-table" }, h("thead", {}, h("tr", {}, [t("c.code"), t("c.name"), t("lbl.address"), "DPI", t("c.line"), ""].map((x) => h("th", { text: x })))),
      h("tbody", {}, ps.map((p) => h("tr", { class: p.active ? "" : "is-off" }, h("td", {}, ui.ltr(p.code)), h("td", { text: p.name }), h("td", {}, ui.ltr(p.host + ":" + p.port)), h("td", {}, ui.ltr(String(p.dpi))), h("td", {}, ui.ltr(p.line_code || "")),
        h("td", {}, can("lbl.write") ? ui.button({ label: t("edit"), kind: "ghost", size: "sm", onClick: () => printerDialog(p) }) : null)))))
      : ui.empty({ icon: "printer", title: t("lbl.no_printers") }), can("lbl.write") ? ui.button({ label: t("lbl.add_printer"), icon: "plus", onClick: () => printerDialog(null) }) : null);
  }
  async function printerDialog(p) {
    const f = { code: ui.input({ value: p ? p.code : "", dir: "ltr", readonly: !!p }), name: ui.input({ value: p ? p.name : "" }), host: ui.input({ value: p ? p.host : "", dir: "ltr", placeholder: "192.168.1.50" }),
      port: ui.input({ value: p ? p.port : 9100, type: "number", dir: "ltr" }), dpi: ui.select({ options: [["203", "203"], ["300", "300"], ["600", "600"]], value: p ? String(p.dpi) : "203" }),
      line: ui.select({ options: [["", "—"]].concat(await lineOptions()), value: p ? p.line_code || "" : "" }), active: ui.checkbox({ label: t("active"), checked: p ? !!p.active : true }) };
    const d = ui.dialog({ title: p ? p.code : t("lbl.add_printer"), icon: "printer", body: h("div", { class: "mes-form" }, ui.field(t("c.code"), f.code, { required: true }), ui.field(t("c.name"), f.name, { required: true }),
      ui.field(t("lbl.address"), f.host, { required: true, hint: t("lbl.address_hint") }), ui.field(t("lbl.port"), f.port), ui.field("DPI", f.dpi), ui.field(t("c.line"), f.line), f.active),
      actions: [ui.button({ label: t("cancel"), onClick: () => d.close() }), ui.button({ label: t("save"), kind: "primary", onClick: async () => {
        try {
          await api("PUT", "/api/printers/" + encodeURIComponent(f.code.value.trim().toUpperCase()), { commandId: commandId(), name: f.name.value, host: f.host.value, port: Number(f.port.value),
            dpi: Number(f.dpi.value), line: f.line.value || null, active: f.active.querySelector("input").checked });
          d.close(); loadPrinters();
        } catch (e) { showError(e); }
      } })] });
  }
  load();
  return { el: sc.el };
}
