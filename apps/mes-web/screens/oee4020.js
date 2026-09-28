// OEE4020 Loss analysis — where the time went: stopped minutes by reason over a range (a Pareto of the unplanned ones
// with the cumulative share, planned stops listed apart), for the whole plant or one line. From the stoppage facts.
import * as ui from "/eco-ui/eco-ui.js";
import { api, dayShift, name, showError, t, today } from "../common.js";
import { lineOptions } from "../views.js";

const { h } = ui;

export default function create({ shell }) {
  const from = ui.input({ type: "date", value: dayShift(-6), width: "150px" }), to = ui.input({ type: "date", value: today(), width: "150px" });
  const lineSel = ui.select({ options: [["", t("all")]], width: "220px" });
  const host = h("div", { class: "mes-analysis" });
  const sc = ui.screen({ code: "OEE4020", title: t("scr.OEE4020"), path: [t("g.efficiency"), t("m.downtime")], shell,
    toolbar: [from, h("span", { text: "–" }), to, lineSel], standard: { inquiry: () => load(), inquiryLabel: t("inquiry") }, body: host });
  async function load() {
    let p;
    try { p = await api("GET", "/api/oee/losses?" + new URLSearchParams({ from: from.value, to: to.value, ...(lineSel.value ? { line: lineSel.value } : {}) })); } catch (e) { showError(e); return; }
    const unplanned = p.reasons.filter((r) => !r.planned), planned = p.reasons.filter((r) => r.planned);
    const byLoss = {};
    for (const r of p.reasons) byLoss[r.loss] = (byLoss[r.loss] || 0) + r.minutes;
    const STATUS = { breakdown: "bad", setup: "warn", material: "info", quality: "hold", planned: "idle", other: "closed" };
    ui.clear(host,
      h("section", { class: "mes-card mes-oee-split" }, h("h3", { text: t("oee.by_loss") }),
        Object.keys(byLoss).length ? ui.donut({ parts: Object.entries(byLoss).map(([k, m]) => ({ label: t("loss." + k), value: m, status: STATUS[k] })), center: ui.fmtNumber(p.unplannedMinutes), centerLabel: t("oee.unplanned_min") })
          : ui.empty({ icon: "check-circle", title: t("oee.no_stops") })),
      h("section", { class: "mes-card" }, h("h3", { text: t("oee.pareto") + " · " + ui.fmtNumber(p.unplannedMinutes) + " " + t("bd.min") }),
        unplanned.length ? [ui.barChart({ labels: unplanned.map((r) => name(r)), series: [{ label: t("oee.minutes"), values: unplanned.map((r) => r.minutes), cls: "eco-chart-bad" }], height: 260, width: 900 }),
          table(unplanned, true)] : ui.empty({ icon: "check-circle", title: t("oee.no_stops") })),
      planned.length ? h("section", { class: "mes-card" }, h("h3", { text: t("oee.planned_stops") }), table(planned, false)) : null);
  }
  const table = (rows, cum) => h("table", { class: "mes-table" },
    h("thead", {}, h("tr", {}, [t("oee.reason"), t("oee.loss"), t("oee.count"), t("oee.minutes"), t("c.line")].concat(cum ? [t("qa.cum")] : []).map((x) => h("th", { text: x })))),
    h("tbody", {}, rows.map((r) => h("tr", {}, h("td", { text: name(r) }), h("td", { text: t("loss." + r.loss) }), h("td", {}, ui.ltr(String(r.count))), h("td", {}, ui.ltr(ui.fmtNumber(r.minutes))),
      h("td", {}, ui.ltr(r.lines.join(" · "))), cum ? h("td", {}, ui.ltr(r.cumulativePct === null ? "" : r.cumulativePct + "%")) : null))));
  lineOptions().then((opts) => { for (const [a, b] of opts) lineSel.append(h("option", { value: a, text: b })); });
  for (const x of [from, to, lineSel]) x.addEventListener("change", load);
  load();
  return { el: sc.el };
}
