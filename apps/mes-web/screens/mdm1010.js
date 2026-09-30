// MDM1010 Factory Structure — the TEMPLATE of every master-data screen: tree on the start side, the record and its
// children on the other, one toolbar, edit in a dialog. The plant model is manufacturing's own (docs/ecosystem/02).
import * as ui from "/eco-ui/eco-ui.js";
import { api, can, name, session, showError, t } from "../common.js";

const { h } = ui;
const TYPE_ICON = { plant: "factory", area: "layers", line: "activity", station: "cpu", equipment: "wrench" };
const CHILD = { plant: "area", area: "line", line: "station", station: "equipment" };

export default function create({ shell }) {
  const plant = session().plant;
  const canEdit = can("mdm.plant.write");
  let byId = new Map(), nodes = [], current = null, tr = null, spatial = new Map();
  const kids = (id) => [...byId.values()].filter((n) => n.parent_id === id).sort((a, b) => a.code.localeCompare(b.code));
  const count = (id) => kids(id).reduce((a, c) => a + 1 + count(c.id), 0);
  const toNode = (n) => ({ id: n.id, label: n.code + "  " + name(n) + (n.active ? "" : "  (" + t("rs.inactive") + ")"), icon: TYPE_ICON[n.type],
    badge: kids(n.id).length || null, children: kids(n.id).map(toNode) });

  let q = "";
  const treeHost = h("div", { class: "mes-tree-host" });
  function drawTree() {
    const keep = (n) => { const c = (n.children || []).map(keep).filter(Boolean); return !q || n.label.toLowerCase().includes(q) || c.length ? { ...n, children: c } : null; };
    const shown = q ? nodes.map(keep).filter(Boolean) : nodes;
    if (!shown.length) { ui.clear(treeHost, ui.empty({ icon: "sitemap", title: t("mdm.empty"), text: canEdit ? t("mdm.empty_help") : null })); tr = null; return; }
    const expanded = [];
    for (let p = current; p; p = p.parent_id ? byId.get(p.parent_id) : null) expanded.push(p.id);
    tr = ui.tree(shown, { key: "MDM1010", expanded: expanded.concat(nodes.map((n) => n.id)), selected: current && current.id,
      onSelect: (n) => { current = byId.get(n.id); drawRecord(); } });
    if (q) tr.expandAll();
    ui.clear(treeHost, tr);
  }
  const side = h("div", { class: "mes-side" },
    h("div", { class: "mes-side-head" }, ui.searchBox({ placeholder: t("mdm.filter"), onInput: (v) => { q = v.trim().toLowerCase(); drawTree(); } }),
      ui.button({ icon: "expand", kind: "ghost", size: "sm", title: t("mdm.expand"), onClick: () => tr && tr.expandAll() }),
      ui.button({ icon: "minus", kind: "ghost", size: "sm", title: t("mdm.collapse"), onClick: () => tr && tr.collapseAll() })),
    treeHost,
    h("div", { class: "mes-side-foot" }, ["plant", "area", "line", "station", "equipment"].map((ty) => h("span", {}, ui.icon(TYPE_ICON[ty], 12), t("type." + ty)))));

  const record = h("div", { class: "mes-record" });
  const childGrid = ui.grid([
    { key: "code", label: t("c.code"), type: "code", width: 150 },
    { key: "name", label: t("c.name"), width: 220 },
    { key: "type", label: t("c.type"), width: 100, value: (r) => t("type." + r.type) },
    { key: "children", label: t("c.children"), type: "number", width: 90 },
    { key: "status", label: t("c.record_status"), width: 120, render: (r) => ui.badge(t("rs." + r.status), r.status === "active" ? "ok" : "neutral") },
  ], { rowKey: "id", selection: "single", layoutKey: "MDM1010-children", onOpen: (r) => { current = byId.get(r.id); drawTree(); drawRecord(); } });

  function drawRecord() {
    const n = current;
    act.edit.disabled = !n || !canEdit; act.add.disabled = !canEdit || (n ? !CHILD[n.type] : false); act.toggle.disabled = !n || !canEdit;
    if (n) ui.clear(act.toggle.querySelector(".eco-btn-label"), document.createTextNode(n.active ? t("mdm.deactivate") : t("mdm.activate")));
    if (!n) { ui.clear(record, ui.empty({ icon: "sitemap", title: nodes.length ? t("mdm.none") : t("mdm.empty"), text: canEdit && !nodes.length ? t("mdm.empty_help") : null,
      action: canEdit && !nodes.length ? ui.button({ label: t("mdm.add", { type: t("type.plant") }), icon: "plus", kind: "primary", onClick: () => edit(null, "plant", null) }) : null })); return; }
    const parent = n.parent_id ? byId.get(n.parent_id) : null;
    const path = []; for (let p = n; p; p = p.parent_id ? byId.get(p.parent_id) : null) path.unshift(p.code);
    const rows = kids(n.id).map((c) => ({ id: c.id, code: c.code, name: name(c), type: c.type, children: count(c.id), status: c.active ? "active" : "inactive" }));
    childGrid.setRows(rows);
    childGrid.setEmptyText(t("mdm.no_children"));
    const ops = n.type === "line" ? [[t("mdm.capacity"), n.capacity_per_shift ? h("span", {}, ui.ltr(ui.fmtNumber(n.capacity_per_shift)), " ", t("mdm.per_shift")) : null],
      [t("mdm.day_start"), ui.ltr(plant.productionDayStart)], [t("mdm.stations"), ui.ltr(String(kids(n.id).length))]]
      : n.type === "equipment" ? [[t("mdm.serial"), n.serial ? ui.ltr(n.serial) : null], [t("mdm.vendor"), n.vendor], [t("mdm.installed"), n.installed_on ? ui.ltr(n.installed_on) : null]]
      : [[t("c.children"), ui.ltr(String(kids(n.id).length))], [t("mdm.all_below"), ui.ltr(String(count(n.id)))], [t("mdm.day_start"), ui.ltr(plant.productionDayStart)], [t("mdm.tz"), ui.ltr(plant.timeZone)]];
    ui.clear(record,
      h("div", { class: "mes-record-head" },
        h("span", { class: "mes-record-icon" }, ui.icon(TYPE_ICON[n.type], 20)),
        h("div", { class: "mes-record-titles" }, h("div", { class: "mes-record-path" }, ui.ltr(path.join(" / "))), h("h2", { text: name(n) })),
        ui.badge(t("rs." + (n.active ? "active" : "inactive")), n.active ? "ok" : "neutral")),
      h("div", { class: "mes-record-grid" },
        ui.section(t("mdm.general"), ui.props([
          [t("c.code"), ui.ltr(n.code)], [t("c.name") + " (EN)", n.name_en], [t("c.name") + " (AR)", h("span", { dir: "rtl", text: n.name_ar })], [t("c.type"), t("type." + n.type)],
          [t("mdm.parent"), parent ? h("a", { href: "#", text: parent.code + " · " + name(parent), onclick: (ev) => { ev.preventDefault(); current = parent; drawTree(); drawRecord(); } }) : null],
        ])),
        ui.section(t("mdm.operation"), ui.props(ops)),
        spatial.has(n.code) ? ui.section(t("mdm.on_drawing"), drawingOf(n)) : null),
      h("div", { class: "mes-record-children" }, h("div", { class: "mes-subhead" }, h("strong", { text: t("mdm.children_of", { type: CHILD[n.type] ? t("type_pl." + CHILD[n.type]) : "—" }) }), h("span", { class: "eco-count", text: String(rows.length) }), h("span", { class: "eco-grow" }),
        CHILD[n.type] && canEdit && n.active ? ui.button({ label: t("mdm.add", { type: t("type." + CHILD[n.type]) }), icon: "plus", size: "sm", onClick: () => edit(null, CHILD[n.type], n) }) : null), childGrid.el));
  }

  // where Space Planner drew this node (lengths arrive in 0.1 mm): position, size and a small map of the whole drawing
  function drawingOf(n) {
    const me = spatial.get(n.code), same = [...spatial.values()].filter((s) => s.layout === me.layout);
    const m = (v) => ui.fmtNumber(Math.round(v / 10) / 100);   // 0.1 mm -> metres, two decimals
    const minX = Math.min(...same.map((s) => s.x)), minY = Math.min(...same.map((s) => s.y));
    const maxX = Math.max(...same.map((s) => s.x + s.w)), maxY = Math.max(...same.map((s) => s.y + s.d));
    const W = 260, H = 150, k = Math.min(W / Math.max(1, maxX - minX), H / Math.max(1, maxY - minY));
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`); svg.setAttribute("width", String(W)); svg.setAttribute("height", String(H)); svg.setAttribute("class", "mes-minimap");
    for (const s of same.sort((a, b) => (a.kind === "zone" ? -1 : 1))) {
      const r = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      r.setAttribute("x", String((s.x - minX) * k)); r.setAttribute("y", String((s.y - minY) * k));
      r.setAttribute("width", String(Math.max(2, s.w * k))); r.setAttribute("height", String(Math.max(2, s.d * k)));
      r.setAttribute("fill", s === me ? "#1f5eff" : s.kind === "zone" ? "#eef2f9" : "#c9d3e6"); r.setAttribute("stroke", "#8a97b0");
      svg.appendChild(r);
    }
    return h("div", {}, ui.props([[t("mdm.layout"), me.layout], [t("mdm.position"), ui.ltr(`${m(me.x)} , ${m(me.y)} m`)], [t("mdm.size"), ui.ltr(`${m(me.w)} × ${m(me.d)} m`)],
      [t("mdm.rotation"), ui.ltr(`${Math.round(me.rotation_mdeg / 1000)}°`)], [t("mdm.revision"), ui.ltr(String(me.revision))]]), svg);
  }

  function edit(n, type, parent) {
    const ty = n ? n.type : type;
    const code = ui.input({ value: n ? n.code : "", dir: "ltr", readonly: !!n }), en = ui.input({ value: n ? n.name_en : "" }), ar = ui.input({ value: n ? n.name_ar : "", dir: "rtl" });
    const cap = ui.input({ type: "number", value: n && n.capacity_per_shift ? String(n.capacity_per_shift) : "", min: "1", step: "1" });
    const serial = ui.input({ value: n ? n.serial || "" : "", dir: "ltr" }), vendor = ui.input({ value: n ? n.vendor || "" : "" }), inst = ui.input({ type: "date", value: n ? n.installed_on || "" : "" });
    const err = h("div", { class: "eco-span-2" });
    ui.dialog({ title: n ? t("mdm.edit_title", { code: n.code }) : t("mdm.add", { type: t("type." + ty) }), subtitle: n ? t("type." + ty) : parent ? t("mdm.under", { code: parent.code }) : null, icon: TYPE_ICON[ty],
      body: h("div", { class: "eco-form" }, ui.field(t("c.code"), code, { required: true, hint: n ? t("mdm.code_fixed") : t("mdm.code_hint") }), h("div"),
        ui.field(t("c.name") + " (EN)", en, { required: true }), ui.field(t("c.name") + " (AR)", ar),
        ty === "line" ? ui.field(t("mdm.capacity") + " (" + t("mdm.per_shift") + ")", cap, { hint: t("mdm.capacity_hint") }) : null,
        ty === "equipment" ? [ui.field(t("mdm.serial"), serial), ui.field(t("mdm.vendor"), vendor), ui.field(t("mdm.installed"), inst)] : null, err),
      actions: [{ label: t("cancel"), kind: "ghost", value: false }, { label: t("save"), kind: "primary", icon: "save", onClick: async () => {
        if (!code.value.trim() || !en.value.trim()) { ui.clear(err, ui.banner("bad", t("err.required"))); return false; }
        const details = { nameEn: en.value, nameAr: ar.value, ...(ty === "line" ? { capacityPerShift: cap.value ? Number(cap.value) : null } : {}),
          ...(ty === "equipment" ? { serial: serial.value || null, vendor: vendor.value || null, installedOn: inst.value || null } : {}) };
        try {
          if (n) await api("PATCH", `/api/plant/${n.id}`, { ...details, version: n.version });
          else { const r = await api("POST", "/api/plant", { code: code.value, type: ty, parentId: parent ? parent.id : null, ...details }); await load(r.id); ui.toast({ kind: "ok", title: t("saved"), text: r.code }); return; }
        } catch (e) { showError(e, err); return false; }
        await load(n.id);
        ui.toast({ kind: "ok", title: t("saved"), text: n.code });
      } }] });
  }
  async function toggle() {
    const n = current;
    if (n.active && !(await ui.confirm({ title: t("mdm.deactivate"), text: t("mdm.deactivate_text", { code: n.code }), danger: true, okLabel: t("mdm.deactivate") }))) return;
    try { await api("PATCH", `/api/plant/${n.id}`, { active: !n.active, version: n.version }); } catch (e) { showError(e); return; }
    await load(n.id);
  }
  const act = {
    add: ui.button({ label: t("mdm.new_child"), icon: "plus", disabled: !canEdit, onClick: () => (current ? CHILD[current.type] && edit(null, CHILD[current.type], current) : edit(null, "plant", null)) }),
    edit: ui.button({ label: t("edit"), icon: "edit", disabled: true, onClick: () => edit(current) }),
    toggle: ui.button({ label: t("mdm.deactivate"), icon: "lock", disabled: true, onClick: () => toggle() }),
  };
  const sc = ui.screen({ code: "MDM1010", title: t("scr.MDM1010"), path: [t("m.master"), t("m.plant_model")], shell,
    toolbar: [act.add, act.edit, act.toggle, ui.sep(), ui.button({ label: t("mdm.add", { type: t("type.plant") }), icon: "factory", kind: "ghost", disabled: !canEdit, onClick: () => edit(null, "plant", null) })],
    standard: { inquiry: () => load(current && current.id), inquiryLabel: t("refresh"), export: () => childGrid.exportCSV("MDM1010-" + (current ? current.code : "plant")), exportLabel: t("export"), print: () => print(), printLabel: t("print") },
    body: ui.split(side, record, { key: "MDM1010:side", initial: 320, min: 220, second: false }) });

  async function load(selectId) {
    let list;
    try { list = await api("GET", "/api/plant"); } catch (e) { showError(e); return; }
    try { spatial = new Map((await api("GET", "/api/plant/spatial")).map((s) => [s.code, s])); } catch { spatial = new Map(); }
    byId = new Map(list.map((n) => [n.id, n]));
    nodes = list.filter((n) => !n.parent_id).map(toNode);
    current = (selectId && byId.get(selectId)) || current && byId.get(current.id) || list.find((n) => n.type === "line") || list[0] || null;
    drawTree(); drawRecord();
  }
  drawRecord();
  load();
  return { el: sc.el };
}
