// PLN1030 Demand plans — the monthly plans the sales & operations meeting approved, quantities per product and month
// (accounting's consensus, read-only). Planning uses the latest approved plan for the months firm orders do not cover.
import * as ui from "/eco-ui/eco-ui.js";
import { api, stamp, t } from "../common.js";
import { inquiryScreen } from "../views.js";

const { h } = ui;

export default function create({ shell }) {
  const v = inquiryScreen({ shell, code: "PLN1030", path: [t("g.planning"), t("m.demand")], auto: true, rowKey: "id", totals: false,
    note: h("div", { class: "mes-pad" }, ui.banner("info", t("dp.owned_by_mizan"))),
    columns: [
      { key: "cycle", label: t("dp.cycle"), width: 100, frozen: true },
      { key: "code", label: t("c.code"), type: "code", width: 130 },
      { key: "status", label: t("c.status"), width: 120, render: (r) => ui.badge(t("dp." + r.status), r.status === "approved" ? "ok" : "neutral") },
      { key: "approved_at", label: t("dp.approved_at"), width: 150, value: (r) => stamp(r.approved_at) },
      { key: "lines", label: t("so.lines"), type: "number", width: 80 },
    ],
    load: async () => api("GET", "/api/demand-plans"),
    detail: async (r, host) => {
      const d = await api("GET", "/api/demand-plans/" + r.id);
      const g = ui.grid([
        { key: "item_code", label: t("c.item"), type: "code", width: 140 },
        { key: "period", label: t("dp.period"), width: 100 },
        { key: "qty", label: t("so.qty"), type: "number", width: 110, total: "sum" },
      ], { rows: d.lines, rowKey: (l) => l.item_id + l.period, totals: true, layoutKey: "PLN1030-lines" });
      ui.clear(host, h("div", { class: "mes-detail-head" }, h("div", { class: "mes-detail-title" }, h("span", { class: "mes-detail-code" }, ui.ltr(d.code)), ui.badge(t("dp." + d.status), "neutral"))),
        h("div", { class: "mes-fill-grid" }, g.el));
    },
  });
  return { el: v.el };
}
