// PLN1040 Stock — the balances accounting reports per item and warehouse (on hand, reserved for customers, available).
// This is the starting point planning nets requirements against; what open purchase orders bring is PLN1050.
import * as ui from "/eco-ui/eco-ui.js";
import { api, stamp, t } from "../common.js";
import { inquiryScreen } from "../views.js";

const { h } = ui;

export default function create({ shell }) {
  const v = inquiryScreen({ shell, code: "PLN1040", path: [t("g.planning"), t("m.supply")], auto: true, rowKey: "id", totals: false,
    note: h("div", { class: "mes-pad" }, ui.banner("info", t("stock.owned_by_mizan"))),
    columns: [
      { key: "item_code", label: t("c.item"), type: "code", width: 140, frozen: true },
      { key: "warehouse_code", label: t("c.warehouse"), width: 100 },
      { key: "on_hand", label: t("stock.on_hand"), type: "number", width: 110 },
      { key: "reserved", label: t("stock.reserved"), type: "number", width: 110 },
      { key: "available", label: t("stock.available"), type: "number", width: 110 },
      { key: "uom", label: t("c.uom"), width: 70 },
      { key: "as_of", label: t("stock.as_of"), width: 150, value: (r) => stamp(r.as_of) },
    ],
    load: async () => api("GET", "/api/stock"),
  });
  return { el: v.el };
}
