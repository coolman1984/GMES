// RPT4010 Daily production — per line: plan, good, attainment, scrap, test failures, downtime and OEE; and every work
// order that was planned for the day or booked output on it. Computed from the ledger when asked; printable.
import * as ui from "/eco-ui/eco-ui.js";
import { api, name, showError, t, today } from "../common.js";

const { h } = ui;
const pct = (x) => (x === null || x === undefined ? "—" : x.toFixed(1) + "%");

export default function create({ shell }) {
  const day = ui.input({ type: "date", value: today(), width: "150px" });
  const host = h("div", { class: "mes-report" });
  const sc = ui.screen({ code: "RPT4010", title: t("scr.RPT4010"), path: [t("g.reports"), t("m.reports")], shell,
    toolbar: [day], standard: { inquiry: () => load(), inquiryLabel: t("inquiry"), print: () => window.print(), printLabel: t("print") }, body: host });
  async function load() {
    let r;
    try { r = await api("GET", "/api/reports/daily?date=" + day.value); } catch (e) { showError(e); return; }
    const att = r.totals.planned ? (r.totals.good / r.totals.planned) * 100 : null;
    const scrapPct = r.totals.good + r.totals.scrap ? (r.totals.scrap / (r.totals.good + r.totals.scrap)) * 100 : null;
    ui.clear(host,
      h("h2", { class: "mes-print-title" }, t("scr.RPT4010") + " · ", ui.ltr(r.date)),
      ui.kpiStrip([{ label: t("rpt.planned"), value: ui.fmtNumber(r.totals.planned) }, { label: t("rpt.good"), value: ui.fmtNumber(r.totals.good), status: "ok" },
        { label: t("rpt.attainment"), value: pct(att), status: att === null ? null : att >= 95 ? "ok" : att >= 80 ? "warn" : "bad" },
        { label: t("rpt.scrap"), value: ui.fmtNumber(r.totals.scrap), hint: pct(scrapPct), status: scrapPct > 2 ? "bad" : null }, { label: t("rpt.fails"), value: ui.fmtNumber(r.totals.fails) }]),
      h("section", { class: "mes-card" }, h("h3", { text: t("rpt.by_line") }),
        h("table", { class: "mes-table" }, h("thead", {}, h("tr", {}, [t("c.line"), t("rpt.planned"), t("rpt.good"), t("rpt.attainment"), t("rpt.scrap"), t("rpt.fails"), t("oee.downtime"), "OEE", "A", "P", "Q"].map((x) => h("th", { text: x })))),
          h("tbody", {}, r.lines.map((l) => h("tr", {}, h("td", {}, ui.ltr(l.line), h("span", { class: "eco-muted", text: " " + name(l) })), h("td", {}, ui.ltr(ui.fmtNumber(l.planned))), h("td", {}, ui.ltr(ui.fmtNumber(l.good))),
            h("td", {}, l.planned ? ui.progress(l.good, l.planned, { label: pct(l.attainment), status: l.attainment >= 95 ? "run" : l.attainment >= 80 ? "hold" : "down" }) : "—"),
            h("td", { class: l.scrapPct > 2 ? "mes-bad" : "" }, ui.ltr(ui.fmtNumber(l.scrap) + (l.scrapPct ? " · " + pct(l.scrapPct) : ""))), h("td", {}, ui.ltr(String(l.fails))),
            h("td", {}, ui.ltr(l.downtimeMin === null ? "—" : ui.fmtNumber(l.downtimeMin) + " " + t("bd.min"))), h("td", { class: "mes-strong" }, ui.ltr(pct(l.oee))),
            h("td", {}, ui.ltr(pct(l.availability))), h("td", {}, ui.ltr(pct(l.performance))), h("td", {}, ui.ltr(pct(l.quality)))))))),
      h("section", { class: "mes-card" }, h("h3", { text: t("rpt.orders") + " · " + r.orders.length }),
        r.orders.length ? h("table", { class: "mes-table" }, h("thead", {}, h("tr", {}, [t("c.wo"), t("c.line"), t("c.shift"), t("c.item"), t("c.status"), t("rpt.planned"), t("rpt.today_good"), t("rpt.today_scrap"), t("rpt.completed")].map((x) => h("th", { text: x })))),
          h("tbody", {}, r.orders.map((o) => h("tr", {}, h("td", {}, ui.ltr(o.code), o.plannedToday ? null : h("span", { class: "eco-badge eco-badge-neutral", text: t("rpt.carried") })), h("td", {}, ui.ltr(o.line || "—")),
            h("td", {}, ui.ltr(o.shift || "")), h("td", {}, ui.ltr(o.item.code), h("span", { class: "eco-muted", text: " " + name(o.item) })), h("td", { text: t("st." + o.status) }),
            h("td", {}, ui.ltr(ui.fmtNumber(o.planned))), h("td", {}, ui.ltr(ui.fmtNumber(o.good))), h("td", {}, ui.ltr(ui.fmtNumber(o.scrap))),
            h("td", {}, ui.progress(o.completed, o.planned, { label: ui.fmtNumber(o.completed) + " / " + ui.fmtNumber(o.planned) }))))))
          : ui.empty({ icon: "clipboard", title: t("rpt.no_orders") })));
  }
  day.addEventListener("change", load);
  load();
  return { el: sc.el };
}
