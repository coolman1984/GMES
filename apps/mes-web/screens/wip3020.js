// WIP3020 WIP ageing — units that have not moved for longer than a limit: forgotten on a rack, waiting for repair, or
// finished but never packed. Oldest first.
import * as ui from "/eco-ui/eco-ui.js";
import { api, name, stamp, t } from "../common.js";
import { inquiryScreen, lineOptions, unitChip } from "../views.js";

export default function create({ shell }) {
  const lineField = { key: "line", label: t("f.line"), type: "select", options: [], placeholder: t("all") };
  const v = inquiryScreen({ shell, code: "WIP3020", path: [t("m.production"), t("m.wip")], rowKey: "serial", auto: true,
    fields: [{ key: "hours", label: t("wip.older_than"), type: "select", options: [["1", "1 h"], ["4", "4 h"], ["8", "8 h"], ["24", "24 h"], ["72", "72 h"]], default: "4" }, lineField],
    columns: [
      { key: "status", label: t("c.status"), width: 110, render: (r) => unitChip(r.status), frozen: true },
      { key: "serial", label: t("c.serial"), type: "code", width: 150, frozen: true, total: "count" },
      { key: "item_code", label: t("c.item"), type: "code", width: 110 },
      { key: "iname", label: t("c.item_name"), width: 180, value: (r) => name(r) },
      { key: "wo_code", label: t("c.wo"), type: "code", width: 150 },
      { key: "line_code", label: t("c.line"), type: "code", width: 80 },
      { key: "op_code", label: t("wip.waiting_at"), type: "code", width: 90 },
      { key: "last_station", label: t("wip.last_station"), type: "code", width: 110 },
      { key: "since", label: t("wip.since"), width: 140, value: (r) => stamp(r.updated_at) },
      { key: "hours", label: t("wip.hours"), type: "number", digits: 1, width: 80, value: (r) => (Date.now() - Date.parse(r.updated_at)) / 3600000 },
      { key: "held", label: t("wip.held"), width: 70, render: (r) => (r.held ? ui.icon("lock", 14) : "") },
    ],
    load: async (c) => api("GET", "/api/wip/ageing?" + new URLSearchParams({ hours: c.hours || "4", ...(c.line ? { line: c.line } : {}) })),
  });
  lineOptions().then((opts) => { lineField.options.push(...opts); for (const [val, lab] of opts) v.cond.control("line").append(ui.h("option", { value: val, text: lab })); });
  return { el: v.el };
}
