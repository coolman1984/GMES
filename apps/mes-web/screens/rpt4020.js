// RPT4020 Scrap and rework — what was lost (scrap by reason, product and line, from the ledger) and what was repaired
// (test failures by defect, repairs by cause and by action, units still waiting in repair, from the unit history).
import * as ui from "/eco-ui/eco-ui.js";
import { api, dayShift, name, showError, t, today } from "../common.js";
import { lineOptions } from "../views.js";

const { h } = ui;

export default function create({ shell }) {
  const from = ui.input({ type: "date", value: dayShift(-6), width: "150px" }), to = ui.input({ type: "date", value: today(), width: "150px" });
  const lineSel = ui.select({ options: [["", t("all")]], width: "220px" });
  const host = h("div", { class: "mes-report" });
  const sc = ui.screen({ code: "RPT4020", title: t("scr.RPT4020"), path: [t("g.reports"), t("m.reports")], shell,
    toolbar: [from, h("span", { text: "–" }), to, lineSel], standard: { inquiry: () => load(), inquiryLabel: t("inquiry"), print: () => window.print(), printLabel: t("print") }, body: host });
  const ranking = (title, rows, cls) => h("section", { class: "mes-card" }, h("h3", { text: title }),
    rows.length ? [ui.barChart({ labels: rows.slice(0, 10).map((r) => r.code), series: [{ label: t("oee.count"), values: rows.slice(0, 10).map((r) => r.n), cls }], height: 200, width: 600 }),
      h("table", { class: "mes-table" }, h("tbody", {}, rows.slice(0, 10).map((r) => h("tr", {}, h("td", {}, ui.ltr(r.code)), h("td", { text: r.name_en ? name(r) : "" }), h("td", {}, ui.ltr(String(r.n)))))))]
      : ui.empty({ icon: "check-circle", title: t("rpt.none") }));
  async function load() {
    let r;
    try { r = await api("GET", "/api/reports/scrap?" + new URLSearchParams({ from: from.value, to: to.value, ...(lineSel.value ? { line: lineSel.value } : {}) })); } catch (e) { showError(e); return; }
    ui.clear(host,
      ui.kpiStrip([{ label: t("rpt.good"), value: ui.fmtNumber(r.good), status: "ok" }, { label: t("rpt.scrap"), value: ui.fmtNumber(r.scrap), hint: r.scrapPct === null ? "" : r.scrapPct + "%", status: r.scrapPct > 2 ? "bad" : null },
        { label: t("rpt.fails"), value: ui.fmtNumber(r.fails) }, { label: t("rpt.repairs"), value: ui.fmtNumber(r.repairs) }, { label: t("wip.in_repair"), value: ui.fmtNumber(r.inRepair), status: r.inRepair ? "warn" : null }]),
      h("section", { class: "mes-card" }, h("h3", { text: t("rpt.scrap_by_reason") }),
        r.scrapByReason.length ? h("table", { class: "mes-table" }, h("thead", {}, h("tr", {}, [t("oee.reason"), t("c.item"), t("c.line"), t("c.qty"), t("rpt.bookings")].map((x) => h("th", { text: x })))),
          h("tbody", {}, r.scrapByReason.map((x) => h("tr", {}, h("td", { text: x.reason ? t("scrap." + x.reason) : "—" }), h("td", {}, ui.ltr(x.item)), h("td", {}, ui.ltr(x.line || "")),
            h("td", {}, ui.ltr(ui.fmtNumber(x.qty))), h("td", {}, ui.ltr(String(x.bookings)))))))
          : ui.empty({ icon: "check-circle", title: t("rpt.none") })),
      h("div", { class: "mes-cols3" }, ranking(t("rpt.by_defect"), r.byDefect, "eco-chart-bad"), ranking(t("rpt.by_cause"), r.byCause, "eco-chart-plan"), ranking(t("rpt.by_action"), r.byAction, "eco-chart-good")));
  }
  lineOptions().then((opts) => { for (const [a, b] of opts) lineSel.append(h("option", { value: a, text: b })); });
  for (const x of [from, to, lineSel]) x.addEventListener("change", load);
  load();
  return { el: sc.el };
}
