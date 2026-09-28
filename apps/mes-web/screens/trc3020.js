// TRC3020 Trace forward — where a material lot or a part went: every unit that contains it, up to the finished
// products, with their status and where they are now (warehouse, container, shipped). The recall list, exportable.
import * as ui from "/eco-ui/eco-ui.js";
import { api, name, stamp, t } from "../common.js";
import { inquiryScreen, unitChip } from "../views.js";

export default function create({ shell }) {
  const v = inquiryScreen({ shell, code: "TRC3020", path: [t("g.trace"), t("m.genealogy")], rowKey: "serial",
    fields: [{ key: "by", label: t("trc.trace_by"), type: "toggle", options: [["lot", t("c.lot")], ["serial", t("c.serial")]], default: "lot" },
      { key: "item", label: t("trc.item_code"), dir: "ltr", placeholder: "RM-…" }, { key: "value", label: t("trc.lot_or_serial"), dir: "ltr", required: true }],
    columns: [
      { key: "top", label: t("trc.level"), width: 100, render: (r) => ui.badge(r.top ? t("trc.finished") : t("trc.inside"), r.top ? "accent" : "neutral"), frozen: true },
      { key: "serial", label: t("c.serial"), type: "code", width: 150, frozen: true, total: "count" },
      { key: "item_code", label: t("c.item"), type: "code", width: 110, value: (r) => r.item.code },
      { key: "iname", label: t("c.item_name"), width: 180, value: (r) => name(r.item) },
      { key: "status", label: t("c.status"), width: 110, render: (r) => unitChip(r.status), value: (r) => t("ust." + r.status) },
      { key: "work_order", label: t("c.wo"), type: "code", width: 150 },
      { key: "line", label: t("c.line"), type: "code", width: 80 },
      { key: "done", label: t("unit.completed_at"), width: 140, value: (r) => stamp(r.completed_at) },
      { key: "box", label: t("shp.pallet"), type: "code", width: 130, value: (r) => (r.where && (r.where.pallet || r.where.box)) || "" },
      { key: "container", label: t("shp.container"), type: "code", width: 130, value: (r) => (r.where && r.where.container) || "" },
      { key: "held", label: t("wip.held"), width: 70, render: (r) => (r.held ? ui.icon("lock", 14) : "") },
    ],
    presets: [{ id: "top", label: t("trc.finished"), test: (r) => r.top }, { id: "shipped", label: t("ust.shipped"), test: (r) => r.status === "shipped" }],
    load: async (c) => {
      const q = c.by === "serial" ? { serial: c.value } : { lot: c.value, ...(c.item ? { item: c.item } : {}) };
      const d = await api("GET", "/api/trace/forward?" + new URLSearchParams(q));
      ui.toast({ kind: d.count ? "warn" : "info", title: t("trc.found", { n: d.count, top: d.topLevel, shipped: d.shipped }) });
      return d.units;
    },
  });
  return { el: v.el };
}
