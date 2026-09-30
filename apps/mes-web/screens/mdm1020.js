// MDM1020 Items and warehouses. Their owner is accounting (Mizan) when it is connected: then this screen only shows the
// mirror and says where to create them; when manufacturing runs alone it is the owner and creates them here.
import * as ui from "/eco-ui/eco-ui.js";
import { api, can, name, session, showError, t, product } from "../common.js";

const { h } = ui;

export default function create({ shell }) {
  const owner = session().plant.itemOwner;
  const canCreate = owner === "gmes" && can("mdm.items.write");
  let tab = "items";

  const itemGrid = ui.grid([
    { key: "code", label: t("c.code"), type: "code", width: 130, frozen: true, total: "count" },
    { key: "name", label: t("c.name"), width: 240, value: (r) => name(r) },
    { key: "kind", label: t("c.type"), width: 100, value: (r) => t("kind." + r.kind) },
    { key: "tracking", label: t("c.tracking"), width: 110, value: (r) => t("trk." + r.tracking) },
    { key: "base_uom", label: t("c.unit"), type: "code", width: 70 },
    { key: "active", label: t("c.record_status"), width: 100, render: (r) => ui.badge(t(r.active ? "rs.active" : "rs.inactive"), r.active ? "ok" : "neutral") },
    { key: "owner", label: t("u.source"), width: 110, render: (r) => ui.badge(r.owner === "mizan" ? "Mizan" : product(), r.owner === "mizan" ? "accent" : "neutral") },
  ], { rowKey: "id", selection: "single", totals: true, layoutKey: "MDM1020-items" });
  const whGrid = ui.grid([
    { key: "code", label: t("c.code"), type: "code", width: 130, frozen: true, total: "count" },
    { key: "name", label: t("c.name"), width: 240, value: (r) => name(r) },
    { key: "is_default", label: t("mdm.default_wh"), width: 100, align: "center", render: (r) => r.is_default ? ui.icon("check", 14, "mes-ok") : "" },
    { key: "active", label: t("c.record_status"), width: 100, render: (r) => ui.badge(t(r.active ? "rs.active" : "rs.inactive"), r.active ? "ok" : "neutral") },
    { key: "owner", label: t("u.source"), width: 110, render: (r) => ui.badge(r.owner === "mizan" ? "Mizan" : product(), r.owner === "mizan" ? "accent" : "neutral") },
  ], { rowKey: "id", selection: "single", totals: true, layoutKey: "MDM1020-wh" });

  const note = owner === "mizan" ? ui.banner("info", t("mdm.owned_by_mizan")) : null;
  const host = h("div", { class: "mes-fill" });
  const tabsEl = ui.tabs([
    { id: "items", label: t("mdm.items"), icon: "box", render: () => itemGrid.el },
    { id: "wh", label: t("mdm.warehouses"), icon: "building", render: () => whGrid.el },
  ], { onChange: (id) => { tab = id; } });
  host.append(tabsEl);

  const sc = ui.screen({ code: "MDM1020", title: t("scr.MDM1020"), path: [t("m.master"), t("m.products")], shell,
    toolbar: [ui.button({ label: t("mdm.new_item"), icon: "plus", disabled: !canCreate, onClick: () => newItem() }),
      ui.button({ label: t("mdm.new_wh"), icon: "building", disabled: !canCreate, onClick: () => newWarehouse() })],
    standard: { inquiry: () => load(), inquiryLabel: t("refresh"), export: () => (tab === "items" ? itemGrid : whGrid).exportCSV("MDM1020-" + tab), exportLabel: t("export") },
    body: h("div", { class: "mes-col" }, note ? h("div", { class: "mes-pad" }, note) : null, host) });

  async function load() {
    try {
      const [items, whs] = await Promise.all([api("GET", "/api/items"), api("GET", "/api/warehouses")]);
      itemGrid.setEmptyText(owner === "gmes" ? t("mdm.no_items_local") : t("mdm.no_items_mizan"));
      whGrid.setEmptyText(owner === "gmes" ? t("mdm.no_wh_local") : t("mdm.no_items_mizan"));
      itemGrid.setRows(items); whGrid.setRows(whs);
    } catch (e) { showError(e); }
  }
  function newItem() {
    const code = ui.input({ dir: "ltr" }), en = ui.input({}), ar = ui.input({ dir: "rtl" }), uom = ui.input({ dir: "ltr", value: "PCS" });
    const kind = ui.select({ options: [["product", t("kind.product")], ["service", t("kind.service")]], value: "product" });
    const trk = ui.select({ options: ["none", "lot", "serial"].map((x) => [x, t("trk." + x)]), value: "none" });
    const err = h("div", { class: "eco-span-2" });
    ui.dialog({ title: t("mdm.new_item"), icon: "box", width: 560, body: h("div", { class: "eco-form" },
      ui.field(t("c.code"), code, { required: true, hint: t("mdm.code_fixed") }), ui.field(t("c.unit"), uom, { required: true }),
      ui.field(t("c.name") + " (EN)", en, { required: true }), ui.field(t("c.name") + " (AR)", ar, { required: true }),
      ui.field(t("c.type"), kind), ui.field(t("c.tracking"), trk, { hint: t("mdm.tracking_hint") }), err),
    actions: [{ label: t("cancel"), kind: "ghost", value: false }, { label: t("save"), kind: "primary", icon: "save", onClick: async () => {
      try { await api("POST", "/api/items", { code: code.value, nameEn: en.value, nameAr: ar.value, kind: kind.value, tracking: trk.value, baseUom: uom.value }); }
      catch (e) { showError(e, err); return false; }
      ui.toast({ kind: "ok", title: t("saved"), text: code.value }); load();
    } }] });
  }
  function newWarehouse() {
    const code = ui.input({ dir: "ltr" }), en = ui.input({}), ar = ui.input({ dir: "rtl" });
    const err = h("div", { class: "eco-span-2" });
    ui.dialog({ title: t("mdm.new_wh"), icon: "building", width: 520, body: h("div", { class: "eco-form" },
      h("div", { class: "eco-span-2" }, ui.field(t("c.code"), code, { required: true })), ui.field(t("c.name") + " (EN)", en, { required: true }), ui.field(t("c.name") + " (AR)", ar, { required: true }), err),
    actions: [{ label: t("cancel"), kind: "ghost", value: false }, { label: t("save"), kind: "primary", icon: "save", onClick: async () => {
      try { await api("POST", "/api/warehouses", { code: code.value, nameEn: en.value, nameAr: ar.value }); }
      catch (e) { showError(e, err); return false; }
      ui.toast({ kind: "ok", title: t("saved"), text: code.value }); load();
    } }] });
  }
  load();
  return { el: sc.el };
}
