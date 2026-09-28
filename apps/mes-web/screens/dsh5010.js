// DSH5010 Line Board — the TEMPLATE of every TV board: readable across the hall, status first, numbers huge.
// Everything comes from the ledger and the stoppage facts, refreshed every 30 s. No figure is invented: the hourly plan
// needs the line's capacity, OEE needs cycle times (not held yet), so they show "—" until they exist.
import * as ui from "/eco-ui/eco-ui.js";
import { api, hhmm, name, session, showError, t, today } from "../common.js";

const { h } = ui;

export default function create() {
  let line = ui.prefs.get("board:line", "");
  const clock = h("span", { class: "bd-clock" });
  const lineSel = ui.select({ options: [], onChange: (v) => { line = v; ui.prefs.set("board:line", v); refresh(); } });
  lineSel.classList.add("bd-pick");
  const kpis = h("div", { class: "bd-kpis" });
  const chart = h("section", { class: "bd-chart" });
  const side = h("aside", { class: "bd-side" });
  const shiftEl = h("span", { class: "bd-shift" });
  const el = h("div", { class: "bd" },
    h("header", { class: "bd-head" }, h("div", { class: "bd-title" }, lineSel, h("span", { text: t("bd.title") })), h("span", { class: "eco-grow" }), shiftEl, clock),
    kpis, h("div", { class: "bd-main" }, chart, side));
  const kpi = (label, value, unit, cls, sub) => h("div", { class: "bd-kpi " + (cls || "") }, h("span", { class: "bd-kpi-label", text: label }),
    h("b", {}, ui.ltr(value), unit ? h("small", { text: unit }) : null), sub ? h("span", { class: "bd-kpi-sub", text: sub }) : null);

  async function refresh() {
    if (!line) return;
    let b;
    try { b = await api("GET", "/api/boards/line/" + encodeURIComponent(line)); } catch (e) { showError(e); return; }
    // hours from the start of the production day up to the current hour (in the PLANT's time zone) or the last hour with output
    const nowHour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: session().plant.timeZone, hour: "2-digit", hourCycle: "h23" }).format(new Date()));
    const current = b.date === today() ? b.hours.findIndex((x) => x.hour === nowHour) : -1;
    const lastActive = b.hours.map((x, i) => (x.good || x.scrap ? i : -1)).reduce((a, i) => Math.max(a, i), -1);
    const hrs = b.hours.slice(0, Math.max(current, lastActive, 7) + 1);
    const planSoFar = b.planPerHour ? b.planPerHour * hrs.length : null;
    const gap = planSoFar === null ? null : b.good - planSoFar;
    const scrapPct = b.good + b.scrap ? (b.scrap / (b.good + b.scrap)) * 100 : 0;
    shiftEl.textContent = t("st.prod_day") + " " + b.date;
    ui.clear(kpis,
      kpi(t("bd.plan"), planSoFar === null ? "—" : ui.fmtNumber(planSoFar), planSoFar === null ? null : t("unit.pcs"), null, planSoFar === null ? t("bd.no_capacity") : t("bd.plan_sofar")),
      kpi(t("bd.actual"), ui.fmtNumber(b.good), t("unit.pcs"), "is-accent", t("bd.of_orders", { n: ui.fmtNumber(b.planned) })),
      kpi(t("bd.gap"), gap === null ? "—" : (gap > 0 ? "+" : "") + ui.fmtNumber(gap), gap === null ? null : t("unit.pcs"), gap === null ? null : gap < 0 ? "is-bad" : "is-ok"),
      kpi(t("bd.oee"), "—", null, null, t("bd.oee_later")),
      kpi(t("bd.scrap"), scrapPct.toFixed(1), "%", scrapPct > 3 ? "is-bad" : "is-ok", ui.fmtNumber(b.scrap) + " " + t("unit.pcs")));
    const series = [{ label: t("bd.actual"), values: hrs.map((x) => x.good), cls: "eco-chart-good" }];
    if (b.planPerHour) series.unshift({ label: t("bd.plan"), values: hrs.map(() => b.planPerHour), cls: "eco-chart-plan" });
    ui.clear(chart, h("h3", { text: t("bd.hourly") }), ui.barChart({ labels: hrs.map((x) => String(x.hour).padStart(2, "0") + ":00"), series, height: 330, width: 900 }));
    const open = b.openStop, wo = b.workOrder;
    ui.clear(side,
      h("div", { class: "bd-state " + (open ? "is-down" : "is-run") }, ui.icon(open ? "pause" : "play", 34), h("div", {}, h("b", { text: open ? t("bd.stopped") : t("bd.running") }),
        h("span", { text: open ? t("stop." + open.reason) + " · " + open.minutes + " " + t("bd.min") + (open.station ? " · " + open.station : "") : "" }))),
      wo ? h("div", { class: "bd-wo" }, h("small", { text: t("c.wo") }), h("b", {}, ui.ltr(wo.code)), h("span", { text: name(wo.item) }), ui.progress(wo.completed, wo.planned, { label: ui.fmtNumber(wo.completed) + " / " + ui.fmtNumber(wo.planned) }))
        : h("div", { class: "bd-wo" }, h("span", { class: "eco-muted", text: t("hm.no_wo") })),
      h("div", { class: "bd-stops" }, h("h3", { text: t("bd.stops") }), b.stoppages.length ? b.stoppages.slice(0, 6).map((s) => h("div", { class: "bd-stop" + (s.endedAt ? "" : " is-open") },
        h("span", {}, ui.ltr(hhmm(s.startedAt))), h("b", { text: t("stop." + s.reason) }), h("span", {}, ui.ltr(s.station || s.line)), h("span", { class: "bd-stop-min" }, ui.ltr(s.minutes + " " + t("bd.min")))))
        : h("span", { class: "eco-muted", text: t("bd.no_stops") })));
  }
  async function start() {
    try {
      const lines = (await api("GET", "/api/plant")).filter((n) => n.type === "line" && n.active);
      if (!lines.length) { ui.clear(kpis, ui.empty({ icon: "sitemap", title: t("st.no_lines"), text: t("hint.no_lines") })); return; }
      if (!lines.some((l) => l.code === line)) line = lines[0].code;
      ui.clear(lineSel, lines.map((l) => h("option", { value: l.code, text: l.code + " · " + name(l) })));
      lineSel.value = line;
      await refresh();
    } catch (e) { showError(e); }
  }
  const timer = setInterval(() => { clock.textContent = ui.fmtTime(); }, 1000);
  const data = setInterval(refresh, 30000);
  clock.textContent = ui.fmtTime();
  start();
  return { el, onClose: () => { clearInterval(timer); clearInterval(data); } };
}
