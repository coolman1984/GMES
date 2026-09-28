// SHP1010 Packing specifications — per product: how many units make a pallet, and how many pallets of it fill each
// container type. Palletizing closes a pallet when it is full; loading refuses a pallet the container has no room for.
import * as ui from "/eco-ui/eco-ui.js";
import { api, can, name, showError, t } from "../common.js";
import { inquiryScreen } from "../views.js";

const { h } = ui;
const TYPES = ["20GP", "40GP", "40HC", "TRUCK"];

export default function create({ shell }) {
  const canWrite = can("shp.orders.write");
  let current = null;
  const editBtn = ui.button({ label: t("edit"), icon: "edit", disabled: true, onClick: () => edit(current) });
  const v = inquiryScreen({ shell, code: "SHP1010", path: [t("g.shipping"), t("m.shipping")], rowKey: "item_id", auto: true,
    columns: [
      { key: "code", label: t("c.item"), type: "code", width: 120, frozen: true, total: "count" },
      { key: "n", label: t("c.item_name"), width: 230, value: (r) => name(r) },
      { key: "per_pallet", label: t("shp.per_pallet"), type: "number", width: 110, render: (r) => (r.per_pallet ? ui.ltr(String(r.per_pallet)) : ui.badge(t("shp.no_spec"), "warn")) },
      ...TYPES.map((ty) => ({ key: "c" + ty, label: ty, type: "number", width: 80, value: (r) => (r.per_container ? r.per_container[ty] ?? null : null) })),
    ],
    load: async () => api("GET", "/api/pack-specs"),
    toolbar: () => [editBtn],
    note: h("div", { class: "mes-pad" }, ui.banner("info", t("shp.spec_help"))),
  });
  v.onSelect((sel) => { current = sel[0] || null; editBtn.disabled = !canWrite || !current; });
  function edit(r) {
    const pp = ui.input({ type: "number", min: "1", value: r.per_pallet ? String(r.per_pallet) : "" });
    const pcs = Object.fromEntries(TYPES.map((ty) => [ty, ui.input({ type: "number", min: "1", value: r.per_container && r.per_container[ty] ? String(r.per_container[ty]) : "" })]));
    const err = h("div", { class: "eco-span-2" });
    ui.dialog({ title: r.code, subtitle: name(r), icon: "box", body: h("div", { class: "eco-form" }, ui.field(t("shp.per_pallet"), pp, { required: true, span: 2 }),
      TYPES.map((ty) => ui.field(t("shp.pallets_in", { type: ty }), pcs[ty])), err),
    actions: [{ label: t("cancel"), kind: "ghost", value: false }, { label: t("save"), kind: "primary", icon: "save", onClick: async () => {
      const per = Object.fromEntries(TYPES.filter((ty) => pcs[ty].value).map((ty) => [ty, Number(pcs[ty].value)]));
      try { await api("PUT", "/api/pack-specs/" + r.item_id, { perPallet: Number(pp.value), perContainer: per, version: r.version ?? undefined }); } catch (e) { showError(e, err); return false; }
      v.run();
    } }] });
  }
  return { el: v.el };
}
