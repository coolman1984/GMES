// PLN2050 Requisitions — materials planning found missing; accounting's purchasing turns them into purchase orders.
import * as ui from "/eco-ui/eco-ui.js";
import { api, t } from "../common.js";
import { inquiryScreen } from "../views.js";

export default function create({ shell }) {
  const v = inquiryScreen({ shell, code: "PLN2050", path: [t("g.planning"), t("m.mrp")], auto: true, rowKey: "id", totals: false,
    note: ui.h("div", { class: "mes-pad" }, ui.banner("info", t("pln.req_note"))),
    columns: [
      { key: "code", label: t("pln.requisition"), type: "code", width: 190, frozen: true },
      { key: "item", label: t("c.item"), width: 130, value: (r) => r.item.code },
      { key: "qty", label: t("c.qty"), type: "number", width: 100 },
      { key: "need_date", label: t("pln.need"), width: 100 },
      { key: "order_by_date", label: t("pln.order_by"), width: 100 },
      { key: "status", label: t("c.status"), width: 90, value: (r) => t("pln.st." + r.status) },
      { key: "late", label: t("pln.late"), width: 150, value: (r) => (r.past_due ? (r.expedite_would_meet_need ? t("pln.expedite") : t("pln.too_late")) : "") },
      { key: "purchase_order", label: t("pln.po"), width: 120, value: (r) => r.purchase_order || "" },
      { key: "version", label: "v", type: "number", width: 50 },
    ],
    load: async () => api("GET", "/api/pln/requisitions"),
  });
  return { el: v.el };
}
