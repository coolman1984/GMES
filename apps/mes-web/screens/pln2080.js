// PLN2080 Planning exceptions — what the last run could not do as asked, most serious first.
import { api, t } from "../common.js";
import { inquiryScreen } from "../views.js";

const RANK = { error: 0, warn: 1, info: 2 };

export default function create({ shell }) {
  const v = inquiryScreen({ shell, code: "PLN2080", path: [t("g.planning"), t("m.mrp")], auto: true, rowKey: "k", totals: false,
    columns: [
      { key: "severity", label: t("pln.severity"), width: 90, value: (r) => t("pln.sev." + r.severity) },
      { key: "kind", label: t("pln.kind"), width: 200, value: (r) => t("pln.ex." + r.kind) },
      { key: "item", label: t("c.item"), width: 130, value: (r) => (r.item ? r.item.code : "") },
      { key: "line", label: t("c.line"), width: 80, value: (r) => r.line || "" },
      { key: "date", label: t("pln.date"), width: 100, value: (r) => r.date || "" },
      { key: "data", label: t("pln.details"), width: 380, value: (r) => JSON.stringify(r.data) },
    ],
    load: async () => (await api("GET", "/api/pln/exceptions"))
      .map((e, i) => ({ ...e, k: String(i) }))
      .sort((a, b) => RANK[a.severity] - RANK[b.severity]),
  });
  return { el: v.el };
}
