// PLN2040 Planned orders — what planning proposes to make; the planner firms, releases (a work order is created) or cancels.
import * as ui from "/eco-ui/eco-ui.js";
import { api, can, commandId, showError, t } from "../common.js";
import { inquiryScreen } from "../views.js";

const { h } = ui;

export default function create({ shell }) {
  const act = (label, icon, path, ok) => ui.button({ label: t(label), icon, disabled: true, onClick: async () => {
    const sel = v.grid.selected().filter(ok);
    let done = 0;
    for (const r of sel) {
      try { await api("POST", `/api/pln/planned-orders/${r.id}/${path}`, { commandId: commandId() }); done++; }
      catch (e) { showError(e); }
    }
    if (done) ui.toast({ kind: "ok", title: t("act.done", { n: done }) });
    await v.run();
  } });
  const firm = act("pln.firm", "lock", "firm", (r) => r.status === "planned");
  const release = act("pln.release", "play", "release", (r) => r.status === "planned" || r.status === "firmed");
  const cancel = act("cancel", "x", "cancel", (r) => r.status === "planned" || r.status === "firmed");

  const v = inquiryScreen({ shell, code: "PLN2040", path: [t("g.planning"), t("m.mrp")], auto: true, rowKey: "id", totals: false, selection: "multi",
    fields: [{ key: "status", label: t("c.status"), type: "select", options: ["planned", "firmed", "released", "cancelled"].map((s) => [s, t("pln.st." + s)]), placeholder: t("all") }],
    toolbar: () => [firm, release, cancel],
    columns: [
      { key: "item", label: t("c.item"), type: "code", width: 140, frozen: true, value: (r) => r.item.code },
      { key: "qty", label: t("c.qty"), type: "number", width: 100 },
      { key: "start_date", label: t("pln.start"), width: 100 },
      { key: "due_date", label: t("pln.due"), width: 100 },
      { key: "line", label: t("c.line"), width: 90 },
      { key: "status", label: t("c.status"), width: 100, value: (r) => t("pln.st." + r.status) },
      { key: "pegging", label: t("pln.pegging"), width: 320, value: (r) => r.pegging.map((p) => `${p.reference} ${p.qty}`).join(" · ") },
    ],
    detail: (r, host) => ui.clear(host, h("div", { class: "mes-pad" }, h("h3", {}, `${r.item.code} · ${r.qty}`),
      ...r.pegging.map((p) => h("div", {}, `${t("pln.peg." + p.kind)} ${p.reference}: ${p.qty}`)))),
    load: async (c) => api("GET", `/api/pln/planned-orders${c.status ? "?status=" + c.status : ""}`),
  });
  v.onSelect((sel) => {
    const w = can("pln.plan");
    firm.disabled = !w || !sel.some((r) => r.status === "planned");
    release.disabled = !w || !sel.some((r) => r.status === "planned" || r.status === "firmed");
    cancel.disabled = !w || !sel.some((r) => r.status === "planned" || r.status === "firmed");
  });
  return { el: v.el };
}
