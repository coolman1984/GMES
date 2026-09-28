// OEE4010 OEE by line — Availability × Performance × Quality for a production day (or one shift), per line, with the
// time model behind it (planned → busy → running → ideal) so the number can be checked by hand, and the trend of the
// last 14 days of one line. A part that cannot be known (no cycle time for what ran) is "—", never guessed.
import * as ui from "/eco-ui/eco-ui.js";
import { api, dayShift, showError, t, today } from "../common.js";

const { h } = ui;
const pct = (x) => (x === null || x === undefined ? "—" : x.toFixed(1) + "%");
const tone = (x, good, fair) => (x === null ? null : x >= good ? "ok" : x >= fair ? "warn" : "bad");

export default function create({ shell }) {
  const day = ui.input({ type: "date", value: today(), width: "150px" });
  const shiftSel = ui.select({ options: [["", t("oee.whole_day")]], width: "160px" });
  const host = h("div", { class: "mes-oee" });
  const trend = h("div", { class: "mes-oee-trend" });
  const sc = ui.screen({ code: "OEE4010", title: t("scr.OEE4010"), path: [t("g.efficiency"), t("m.downtime")], shell,
    toolbar: [day, shiftSel], standard: { inquiry: () => load(), inquiryLabel: t("inquiry") }, body: h("div", {}, host, trend) });
  async function load() {
    let rows;
    try { rows = await api("GET", "/api/oee?" + new URLSearchParams({ date: day.value, ...(shiftSel.value ? { shift: shiftSel.value } : {}) })); } catch (e) { showError(e); return; }
    if (!rows.length) { ui.clear(host, ui.empty({ icon: "gauge", title: t("st.no_lines") })); return; }
    ui.clear(host, rows.map((o) => h("section", { class: "mes-card mes-oee-line", onclick: () => showTrend(o.line) },
      h("header", {}, h("b", {}, ui.ltr(o.line)), h("span", { class: "eco-muted" }, ui.ltr(o.shiftsWorked.length ? t("c.shift") + " " + o.shiftsWorked.join(" · ") : t("oee.not_worked")))),
      h("div", { class: "mes-oee-body" },
        ui.ring(o.oee ?? 0, { size: 96, label: pct(o.oee), status: tone(o.oee, 85, 60) === "ok" ? "ok" : tone(o.oee, 85, 60) === "warn" ? "warn" : o.oee === null ? null : "bad" }),
        ui.kpiStrip([
          { label: t("oee.availability"), value: pct(o.availability), status: tone(o.availability, 90, 75) },
          { label: t("oee.performance"), value: pct(o.performance), status: tone(o.performance, 95, 80) },
          { label: t("oee.quality"), value: pct(o.quality), status: tone(o.quality, 99, 97) }])),
      h("div", { class: "mes-oee-model" }, [
        [t("oee.planned"), o.plannedMin], [t("oee.planned_stops"), -o.plannedStopMin], [t("oee.busy"), o.busyMin], [t("oee.downtime"), -o.downtimeMin],
        [t("oee.run"), o.runMin], [t("oee.speed_loss"), o.speedLossMin === null ? null : -o.speedLossMin], [t("oee.ideal"), o.idealMin],
      ].map(([l, m]) => h("div", { class: m !== null && m < 0 ? "is-loss" : "" }, h("span", { text: l }), h("b", {}, ui.ltr(m === null ? "—" : ui.fmtNumber(Math.abs(m)) + " " + t("bd.min")))))),
      h("footer", {}, ui.ltr(ui.fmtNumber(o.good) + " " + t("oee.good") + " · " + ui.fmtNumber(o.scrap) + " " + t("oee.scrap")),
        Object.keys(o.losses).length ? h("span", { class: "eco-muted" }, " · ", Object.entries(o.losses).map(([k, m]) => t("loss." + k) + " " + m + " " + t("bd.min")).join(" · ")) : null))));
    if (!trend.dataset.line) showTrend(rows[0].line);
  }
  async function showTrend(line) {
    trend.dataset.line = line;
    let rows;
    try { rows = await api("GET", "/api/oee/trend?" + new URLSearchParams({ line, from: dayShift(-13), to: today() })); } catch (e) { showError(e); return; }
    ui.clear(trend, h("section", { class: "mes-card" }, h("h3", { text: t("oee.trend", { line }) }),
      ui.barChart({ labels: rows.map((r) => r.date.slice(5)), height: 220, width: 900, target: 85, format: (x) => x + "%",
        series: [{ label: "OEE", values: rows.map((r) => r.oee ?? 0), cls: "eco-chart-good" }, { label: t("oee.availability"), values: rows.map((r) => r.availability ?? 0), cls: "eco-chart-plan" }] })));
  }
  api("GET", "/api/production-calendar").then((c) => { for (const s of c.shifts.filter((x) => x.active)) shiftSel.append(h("option", { value: s.code, text: s.code + " · " + s.start_at + "–" + s.end_at })); }).catch(() => {});
  day.addEventListener("change", load);
  shiftSel.addEventListener("change", load);
  load();
  return { el: sc.el };
}
