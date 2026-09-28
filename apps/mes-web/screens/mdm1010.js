// MDM1010 Factory Structure — the TEMPLATE of every master-data screen: tree on the start side, the record and its
// children on the other, one toolbar, edit in a dialog.
import * as ui from "/eco-ui/eco-ui.js";
import { factory } from "../data.js";
import { t, name, statusLabel, sampleNote } from "../common.js";

const { h } = ui;
const TYPE_ICON = { plant: "factory", area: "layers", line: "activity", station: "cpu", equipment: "wrench" };
const CHILD = { plant: "area", area: "line", line: "station", station: "equipment" };

export default function create({ shell }) {
  const byId = new Map();
  const count = (n) => (n.children || []).reduce((a, c) => a + 1 + count(c), 0);
  const toNode = (n, parent) => { byId.set(n.id, { ...n, parent }); return { id: n.id, label: n.code + "  " + name(n), icon: TYPE_ICON[n.type], badge: n.children && n.children.length ? n.children.length : null, children: (n.children || []).map((c) => toNode(c, n.id)) }; };
  const nodes = factory.map((n) => toNode(n, null));
  let current = byId.get("P1/ASM/P1/ASM/ASM-02") || null;
  const firstLine = [...byId.values()].find((n) => n.type === "line" && n.code === "ASM-02");
  current = firstLine || byId.get("P1");

  const filter = ui.input({ type: "search", placeholder: t("mdm.filter"), onInput: () => drawTree() });
  const treeHost = h("div", { class: "mes-tree-host" });
  let tr;
  function drawTree() {
    const q = filter.value.trim().toLowerCase();
    const keep = (n) => { const kids = (n.children || []).map(keep).filter(Boolean); return !q || n.label.toLowerCase().includes(q) || kids.length ? { ...n, children: kids } : null; };
    tr = ui.tree(q ? nodes.map(keep).filter(Boolean) : nodes, { key: "MDM1010", expanded: ["P1", "P1/ASM", firstLine && firstLine.parent].filter(Boolean), selected: current && current.id,
      onSelect: (n) => { current = byId.get(n.id); drawRecord(); } });
    if (q) tr.expandAll();
    ui.clear(treeHost, tr);
  }
  const side = h("div", { class: "mes-side" },
    h("div", { class: "mes-side-head" }, ui.searchBox({ placeholder: t("mdm.filter"), onInput: (v) => { filter.value = v; drawTree(); } }),
      ui.button({ icon: "expand", kind: "ghost", size: "sm", title: t("mdm.expand"), onClick: () => tr.expandAll() }),
      ui.button({ icon: "minus", kind: "ghost", size: "sm", title: t("mdm.collapse"), onClick: () => tr.collapseAll() })),
    treeHost,
    h("div", { class: "mes-side-foot" }, ["plant", "area", "line", "station", "equipment"].map((ty) => h("span", {}, ui.icon(TYPE_ICON[ty], 12), t("type." + ty)))));

  const record = h("div", { class: "mes-record" });
  const childGrid = ui.grid([
    { key: "state", label: t("c.state"), type: "status", width: 112, label_of: (s) => statusLabel(s) },
    { key: "code", label: t("c.code"), type: "code", width: 150 },
    { key: "name", label: t("c.name"), width: 220 },
    { key: "type", label: t("c.type"), width: 100, value: (r) => t("type." + r.type) },
    { key: "children", label: t("c.children"), type: "number", width: 90 },
    { key: "status", label: t("c.record_status"), width: 120, render: (r) => ui.badge(t("rs." + r.status), r.status === "active" ? "ok" : "neutral") },
  ], { rowKey: "id", selection: "single", layoutKey: "MDM1010-children", onOpen: (r) => { current = byId.get(r.id); tr.select(r.id); drawRecord(); } });

  function drawRecord() {
    const n = current;
    if (!n) { ui.clear(record, ui.empty({ icon: "sitemap", title: t("mdm.none") })); return; }
    const parent = n.parent ? byId.get(n.parent) : null;
    const path = []; for (let p = n; p; p = p.parent ? byId.get(p.parent) : null) path.unshift(p.code);
    const kids = (n.children || []).map((c) => ({ id: c.id, code: c.code, name: name(c), type: c.type, state: c.state || "run", children: count(c), status: c.status }));
    childGrid.setRows(kids);
    childGrid.setEmptyText(t("mdm.no_children"));
    ui.clear(record,
      h("div", { class: "mes-record-head" },
        h("span", { class: "mes-record-icon" }, ui.icon(TYPE_ICON[n.type], 20)),
        h("div", { class: "mes-record-titles" }, h("div", { class: "mes-record-path" }, ui.ltr(path.join(" / "))), h("h2", { text: name(n) })),
        n.state ? ui.statusChip(n.state, statusLabel(n.state)) : null, ui.badge(t("rs." + n.status), n.status === "active" ? "ok" : "neutral")),
      h("div", { class: "mes-record-grid" },
        ui.section(t("mdm.general"), ui.props([
          [t("c.code"), ui.ltr(n.code)], [t("c.name") + " (EN)", n.en], [t("c.name") + " (AR)", h("span", { dir: "rtl", text: n.ar })], [t("c.type"), t("type." + n.type)],
          [t("mdm.parent"), parent ? h("a", { href: "#", text: parent.code + " · " + name(parent), onclick: (ev) => { ev.preventDefault(); current = parent; tr.select(parent.id); drawRecord(); } }) : null],
        ])),
        ui.section(t("mdm.operation"), ui.props(n.type === "line" ? [
          [t("mdm.capacity"), h("span", {}, ui.ltr(ui.fmtNumber(n.capacity)), " ", t("mdm.per_shift"))], [t("mdm.calendar"), "CAL-3S · " + t("mdm.three_shifts")],
          [t("mdm.day_start"), ui.ltr("07:00")], [t("mdm.stations"), ui.ltr(String((n.children || []).length))],
        ] : n.type === "equipment" ? [[t("mdm.serial"), ui.ltr(n.serial)], [t("mdm.vendor"), n.vendor], [t("mdm.installed"), ui.ltr(n.installed)], [t("mdm.maint"), t("planned_screen")]]
          : [[t("c.children"), ui.ltr(String((n.children || []).length))], [t("mdm.all_below"), ui.ltr(String(count(n)))], [t("mdm.day_start"), ui.ltr("07:00")], [t("mdm.tz"), ui.ltr("Africa/Cairo")]]))),
      h("div", { class: "mes-record-children" }, h("div", { class: "mes-subhead" }, h("strong", { text: t("mdm.children_of", { type: CHILD[n.type] ? t("type_pl." + CHILD[n.type]) : "—" }) }), h("span", { class: "eco-count", text: String(kids.length) }), h("span", { class: "eco-grow" }),
        CHILD[n.type] ? ui.button({ label: t("mdm.add", { type: t("type." + CHILD[n.type]) }), icon: "plus", size: "sm", onClick: () => edit(null, CHILD[n.type]) }) : null), childGrid.el));
    act.edit.disabled = false; act.add.disabled = !CHILD[n.type];
  }
  function edit(n, type) {
    const code = ui.input({ value: n ? n.code : "", dir: "ltr", readonly: !!n }), en = ui.input({ value: n ? n.en : "" }), ar = ui.input({ value: n ? n.ar : "", dir: "rtl" });
    const st = ui.select({ options: [["active", t("rs.active")], ["inactive", t("rs.inactive")]], value: n ? n.status : "active" });
    const err = h("div", { class: "eco-span-2" });
    ui.dialog({ title: n ? t("mdm.edit_title", { code: n.code }) : t("mdm.add", { type: t("type." + type) }), subtitle: n ? t("type." + n.type) : t("mdm.under", { code: current.code }), icon: TYPE_ICON[type || n.type],
      body: h("div", { class: "eco-form" }, ui.field(t("c.code"), code, { required: true, hint: n ? t("mdm.code_fixed") : t("mdm.code_hint") }), ui.field(t("c.record_status"), st),
        ui.field(t("c.name") + " (EN)", en, { required: true }), ui.field(t("c.name") + " (AR)", ar), err),
      actions: [{ label: t("cancel"), kind: "ghost", value: false }, { label: t("save"), kind: "primary", icon: "save", onClick: () => {
        if (!code.value.trim() || !en.value.trim()) { ui.clear(err, ui.banner("bad", t("err.required"))); return false; }
        ui.toast({ kind: "ok", title: t("saved"), text: t("sample.nothing_saved") });
      } }] });
  }
  const act = {
    add: ui.button({ label: t("mdm.new_child"), icon: "plus", onClick: () => CHILD[current.type] && edit(null, CHILD[current.type]) }),
    edit: ui.button({ label: t("edit"), icon: "edit", onClick: () => edit(current) }),
  };
  const sc = ui.screen({ code: "MDM1010", title: t("scr.MDM1010"), path: [t("m.master"), t("m.plant_model")], shell, headExtra: sampleNote(),
    toolbar: [act.add, act.edit, ui.button({ label: t("mdm.deactivate"), icon: "lock", onClick: async () => {
      if (await ui.confirm({ title: t("mdm.deactivate"), text: t("mdm.deactivate_text", { code: current.code }), danger: true, okLabel: t("mdm.deactivate") })) ui.toast({ kind: "ok", text: t("sample.nothing_saved") });
    } })],
    standard: { export: () => childGrid.exportCSV("MDM1010-" + current.code), exportLabel: t("export"), print: () => print(), printLabel: t("print") },
    body: ui.split(side, record, { key: "MDM1010:side", initial: 320, min: 220, second: false }) });
  drawTree(); drawRecord();
  return { el: sc.el };
}
