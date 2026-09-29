// MDM1080 Customers and suppliers — accounting's parties, mirrored read-only: production and shipping name the customer,
// planning names the supplier. They are created in Mizan; nothing here can change them.
import * as ui from "/eco-ui/eco-ui.js";
import { api, name, stamp, t } from "../common.js";
import { inquiryScreen } from "../views.js";

const { h } = ui;

export default function create({ shell }) {
  const v = inquiryScreen({ shell, code: "MDM1080", path: [t("m.master"), t("m.products")], auto: true, rowKey: "id", totals: false,
    note: h("div", { class: "mes-pad" }, ui.banner("info", t("party.owned_by_mizan"))),
    fields: [{ key: "role", label: t("party.role"), type: "toggle", options: [["", t("all")], ["customer", t("party.customer")], ["supplier", t("party.supplier")]], default: "" }],
    columns: [
      { key: "code", label: t("c.code"), type: "code", width: 130, frozen: true },
      { key: "name", label: t("c.name"), width: 240, value: (r) => name(r) },
      { key: "roles", label: t("party.role"), width: 170, value: (r) => r.roles.split(",").map((x) => t("party." + x)).join(" + ") },
      { key: "country", label: t("party.country"), width: 80, align: "center" },
      { key: "active", label: t("c.record_status"), width: 100, render: (r) => ui.badge(t(r.active ? "rs.active" : "rs.inactive"), r.active ? "ok" : "neutral") },
      { key: "mirrored_at", label: t("mirror.received"), width: 150, value: (r) => stamp(r.mirrored_at) },
    ],
    load: async (c) => api("GET", "/api/parties" + (c.role ? "?role=" + c.role : "")),
  });
  return { el: v.el };
}
