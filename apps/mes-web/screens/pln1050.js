// PLN1050 Open purchase orders — what accounting has ordered and is still to arrive, by the date it is expected, and the
// planning requisition each line answers. Planning counts these as supply on their expected date.
import * as ui from "/eco-ui/eco-ui.js";
import { api, t } from "../common.js";
import { inquiryScreen } from "../views.js";

const { h } = ui;

export default function create({ shell }) {
  const v = inquiryScreen({ shell, code: "PLN1050", path: [t("g.planning"), t("m.supply")], auto: true, rowKey: (r) => r.po_id + ":" + r.line_no,
    note: h("div", { class: "mes-pad" }, ui.banner("info", t("po.owned_by_mizan"))),
    columns: [
      { key: "po_code", label: t("po.order"), type: "code", width: 110, frozen: true, total: "count" },
      { key: "supplier_code", label: t("po.supplier"), width: 130 },
      { key: "line_no", label: "#", type: "number", width: 50 },
      { key: "item_code", label: t("c.item"), type: "code", width: 130 },
      { key: "qty", label: t("so.qty"), type: "number", width: 100 },
      { key: "received_qty", label: t("po.received"), type: "number", width: 100 },
      { key: "open_qty", label: t("po.open_qty"), type: "number", width: 100 },
      { key: "expected_date", label: t("po.expected"), type: "date", width: 110 },
      { key: "warehouse_code", label: t("c.warehouse"), width: 90 },
      { key: "requisition_code", label: t("po.requisition"), type: "code", width: 120 },
    ],
    load: async () => api("GET", "/api/purchase-orders?open=1"),
  });
  return { el: v.el };
}
