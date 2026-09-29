// PLN1020 Sales orders — the customers' orders as accounting holds them (read-only): what was asked, when, what was
// promised and what has left. Planning turns the open quantity into production and purchases.
import * as ui from "/eco-ui/eco-ui.js";
import { api, t } from "../common.js";
import { inquiryScreen } from "../views.js";

const { h } = ui;

export default function create({ shell }) {
  const v = inquiryScreen({ shell, code: "PLN1020", path: [t("g.planning"), t("m.demand")], auto: true, rowKey: "id",
    note: h("div", { class: "mes-pad" }, ui.banner("info", t("so.owned_by_mizan"))),
    fields: [{ key: "status", label: t("f.status"), type: "toggle", options: [["open", t("so.open")], ["closed", t("so.closed")], ["cancelled", t("so.cancelled")], ["", t("all")]], default: "open" }],
    columns: [
      { key: "code", label: t("so.order"), type: "code", width: 110, frozen: true, total: "count" },
      { key: "customer_code", label: t("shp.customer"), width: 140 },
      { key: "order_date", label: t("so.order_date"), type: "date", width: 110 },
      { key: "priority", label: t("so.priority"), type: "number", width: 80 },
      { key: "lines", label: t("so.lines"), type: "number", width: 70 },
      { key: "open_qty", label: t("so.open_qty"), type: "number", width: 110 },
      { key: "next_due", label: t("so.next_due"), type: "date", width: 110 },
      { key: "customer_reference", label: t("so.customer_ref"), width: 140 },
      { key: "status", label: t("c.status"), width: 100, render: (r) => ui.badge(t("so." + r.status), r.status === "open" ? "run" : "neutral") },
    ],
    load: async (c) => api("GET", "/api/sales-orders" + (c.status ? "?status=" + c.status : "")),
    detail: async (r, host) => {
      const o = await api("GET", "/api/sales-orders/" + r.id);
      const g = ui.grid([
        { key: "line_no", label: "#", type: "number", width: 50 },
        { key: "item_code", label: t("c.item"), type: "code", width: 130 },
        { key: "qty", label: t("so.qty"), type: "number", width: 100, total: "sum" },
        { key: "delivered_qty", label: t("so.delivered"), type: "number", width: 100, total: "sum" },
        { key: "open_qty", label: t("so.open_qty"), type: "number", width: 100, total: "sum" },
        { key: "requested_date", label: t("so.requested"), type: "date", width: 110 },
        { key: "promised_date", label: t("so.promised"), type: "date", width: 110 },
      ], { rows: o.lines, rowKey: "line_no", totals: true, layoutKey: "PLN1020-lines" });
      ui.clear(host, h("div", { class: "mes-detail-head" }, h("div", { class: "mes-detail-title" }, h("span", { class: "mes-detail-code" }, ui.ltr(o.code)), ui.badge(t("so." + o.status), "neutral")),
        h("div", { class: "mes-detail-sub", text: o.customer_code + (o.ship_to ? " → " + o.ship_to : "") })), h("div", { class: "mes-fill-grid" }, g.el));
    },
  });
  return { el: v.el };
}
