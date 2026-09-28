// DSH5010 Line Board — the TEMPLATE of every TV board: readable across the hall, status first, numbers huge.
import * as ui from "/eco-ui/eco-ui.js";
import { hourly, stoppages, workOrders } from "../data.js";
import { t, sampleNote } from "../common.js";

const { h } = ui;

export default function create() {
  const line = "ASM-02";
  const wo = workOrders.find((w) => w.status === "run" && w.line === line) || workOrders.find((w) => w.status === "run");
  const hr = hourly(line);
  const plan = hr.plan.slice(0, 7).reduce((a, b) => a + b, 0), actual = hr.actual.reduce((a, b) => a + b, 0), gap = actual - plan;
  const clock = h("span", { class: "bd-clock" });
  const kpi = (label, value, unit, cls, sub) => h("div", { class: "bd-kpi " + (cls || "") }, h("span", { class: "bd-kpi-label", text: label }),
    h("b", {}, ui.ltr(value), unit ? h("small", { text: unit }) : null), sub ? h("span", { class: "bd-kpi-sub", text: sub }) : null);
  const open = stoppages.find((s) => s.open);
  const el = h("div", { class: "bd" },
    h("header", { class: "bd-head" }, h("div", { class: "bd-title" }, h("span", { class: "bd-line" }, ui.ltr(line)), h("span", { text: t("bd.title") })),
      h("span", { class: "eco-grow" }), sampleNote(), h("span", { class: "bd-shift", text: t("f.shift") + " A · 07:00–15:00" }), clock),
    h("div", { class: "bd-kpis" },
      kpi(t("bd.plan"), ui.fmtNumber(plan), t("unit.pcs")), kpi(t("bd.actual"), ui.fmtNumber(actual), t("unit.pcs"), "is-accent"),
      kpi(t("bd.gap"), (gap > 0 ? "+" : "") + ui.fmtNumber(gap), t("unit.pcs"), gap < 0 ? "is-bad" : "is-ok"),
      kpi(t("bd.oee"), "71.4", "%", "is-warn", "A 88 · P 84 · Q 96.6"), kpi(t("bd.scrap"), "2.1", "%", "is-ok")),
    h("div", { class: "bd-main" },
      h("section", { class: "bd-chart" }, h("h3", { text: t("bd.hourly") }),
        ui.barChart({ labels: hr.hours.map((x) => x + ":00"), series: [{ label: t("bd.plan"), values: hr.plan, cls: "eco-chart-plan" }, { label: t("bd.actual"), values: hr.actual, cls: "eco-chart-good" }], height: 330, width: 900 })),
      h("aside", { class: "bd-side" },
        h("div", { class: "bd-state " + (open ? "is-down" : "is-run") }, ui.icon(open ? "pause" : "play", 34), h("div", {}, h("b", { text: open ? t("bd.stopped") : t("bd.running") }),
          h("span", { text: open ? t("stop." + open.reason) + " · " + open.minutes + " " + t("bd.min") : "" }))),
        h("div", { class: "bd-wo" }, h("small", { text: t("c.wo") }), h("b", {}, ui.ltr(wo.code)), h("span", { text: wo.itemName }), ui.progress(wo.good, wo.planned, { label: ui.fmtNumber(wo.good) + " / " + ui.fmtNumber(wo.planned) })),
        h("div", { class: "bd-stops" }, h("h3", { text: t("bd.stops") }), stoppages.map((s) => h("div", { class: "bd-stop" + (s.open ? " is-open" : "") },
          h("span", {}, ui.ltr(s.at)), h("b", { text: t("stop." + s.reason) }), h("span", {}, ui.ltr(s.station)), h("span", { class: "bd-stop-min" }, ui.ltr(s.minutes + " " + t("bd.min")))))))));
  const timer = setInterval(() => { clock.textContent = ui.fmtTime(); }, 1000);
  clock.textContent = ui.fmtTime();
  return { el, onClose: () => clearInterval(timer) };
}
