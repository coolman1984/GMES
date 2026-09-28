// SHP3010 Shipments — the containers and trucks that were loaded and sealed: order, customer, destination, seal, pallets
// and units; the detail is the packing list (every pallet and every serial in it), exportable for the customer.
import * as ui from "/eco-ui/eco-ui.js";
import { api, datePresets, dayShift, stamp, t, today } from "../common.js";
import { inquiryScreen } from "../views.js";

const { h } = ui;

export default function create({ shell }) {
  const v = inquiryScreen({ shell, code: "SHP3010", path: [t("g.shipping"), t("m.shipping")], auto: true,
    fields: [{ key: "days", label: t("shp.dispatch_day"), type: "daterange", required: true, default: [dayShift(-13), today()], span: 2, presets: datePresets(), presetsLabel: t("presets") },
      { key: "status", label: t("f.status"), type: "toggle", options: [["dispatched", t("cst.dispatched")], ["loading", t("cst.loading")], ["", t("all")]], default: "dispatched" }],
    columns: [
      { key: "status", label: t("c.status"), type: "status", width: 110, status: (r) => (r.status === "dispatched" ? "done" : "run"), label_of: (_s, r) => t("cst." + r.status), frozen: true },
      { key: "number", label: t("shp.container"), type: "code", width: 130, frozen: true, total: "count" },
      { key: "type", label: t("c.type"), width: 70 },
      { key: "order_code", label: t("shp.order"), type: "code", width: 110 },
      { key: "customer", label: t("shp.customer"), width: 180 },
      { key: "destination", label: t("shp.destination"), width: 150 },
      { key: "pallets", label: t("shp.pallets"), type: "number", width: 80, total: "sum" },
      { key: "units", label: t("hold.units"), type: "number", width: 80, total: "sum" },
      { key: "seal", label: t("shp.seal"), type: "code", width: 120 },
      { key: "truck", label: t("shp.truck"), width: 110 },
      { key: "when", label: t("shp.dispatched_at"), width: 140, value: (r) => stamp(r.dispatched_at || r.opened_at) },
    ],
    load: async (c) => api("GET", "/api/containers?" + new URLSearchParams({ from: c.days[0], to: c.days[1], status: c.status || "" })),
    detail: async (r, host) => {
      const c = await api("GET", "/api/containers/" + r.id);
      const lists = await Promise.all(c.pallets.map((p) => api("GET", "/api/pallets/" + encodeURIComponent(p.code))));
      const rows = lists.flatMap((p) => p.list.map((u) => ({ pallet: p.code, item: p.item_code, serial: u.serial, wo: u.wo_code })));
      const g = ui.grid([{ key: "pallet", label: t("shp.pallet"), type: "code", width: 140 }, { key: "item", label: t("c.item"), type: "code", width: 100 },
        { key: "serial", label: t("c.serial"), type: "code", width: 150, total: "count" }, { key: "wo", label: t("c.wo"), type: "code", width: 150 }], { rows, rowKey: "serial", totals: true, layoutKey: "SHP3010-list" });
      ui.clear(host, h("div", { class: "mes-detail-head" }, h("div", { class: "mes-detail-title" }, h("span", { class: "mes-detail-code" }, ui.ltr(c.number)), ui.badge(c.type, "neutral")),
        h("div", { class: "mes-detail-sub", text: c.order_code + " · " + c.customer + (c.destination ? " → " + c.destination : "") })),
        ui.props([[t("shp.seal"), c.seal ? ui.ltr(c.seal) : null], [t("shp.truck"), c.truck], [t("shp.driver"), c.driver], [t("shp.dispatched_at"), c.dispatched_at ? ui.ltr(stamp(c.dispatched_at)) : null]], { cols: 2 }),
        h("div", { class: "mes-subhead" }, h("strong", { text: t("shp.packing_list") }), h("span", { class: "eco-grow" }), ui.button({ label: t("export"), icon: "download", size: "sm", onClick: () => g.exportCSV("packing-list-" + c.number) })),
        h("div", { class: "mes-fill-grid" }, g.el));
    },
  });
  return { el: v.el };
}
