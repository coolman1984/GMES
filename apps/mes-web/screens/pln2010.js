// PLN2010 MRP runs — run planning now, and see what each run found (orders, requisitions, exceptions, overload).
import * as ui from "/eco-ui/eco-ui.js";
import { api, can, showError, stamp, t } from "../common.js";
import { inquiryScreen } from "../views.js";

export default function create({ shell }) {
  const runNow = ui.button({ label: t("pln.run_now"), icon: "play", kind: "primary", disabled: !can("pln.run"), onClick: async () => {
    runNow.disabled = true;
    try {
      const r = await api("POST", "/api/pln/runs");
      ui.toast({ kind: r.stats.errors ? "warn" : "ok", title: r.code, text: t("pln.run_done", { orders: r.stats.plannedOrders, reqs: r.stats.requisitions, errors: r.stats.errors }), keep: true });
      await v.run();
    } catch (e) { showError(e); } finally { runNow.disabled = !can("pln.run"); }
  } });
  const v = inquiryScreen({ shell, code: "PLN2010", path: [t("g.planning"), t("m.mrp")], auto: true, rowKey: "id", totals: false,
    toolbar: () => [runNow],
    columns: [
      { key: "code", label: t("pln.run"), type: "code", width: 170, frozen: true },
      { key: "started_at", label: t("pln.started"), width: 150, value: (r) => stamp(r.started_at) },
      { key: "today", label: t("pln.today"), width: 100 },
      { key: "horizon_to", label: t("pln.horizon_to"), width: 100 },
      { key: "trigger", label: t("pln.trigger"), width: 90 },
      { key: "orders", label: t("pln.planned_orders"), type: "number", width: 110, value: (r) => r.stats.plannedOrders },
      { key: "reqs", label: t("pln.requisitions"), type: "number", width: 110, value: (r) => r.stats.requisitions },
      { key: "errors", label: t("pln.errors"), type: "number", width: 90, value: (r) => r.stats.errors },
      { key: "proposals", label: t("pln.proposals"), type: "number", width: 100, value: (r) => r.stats.proposals },
      { key: "published", label: t("pln.published"), type: "number", width: 100, value: (r) => r.stats.published },
    ],
    load: async () => api("GET", "/api/pln/runs"),
  });
  return { el: v.el };
}
