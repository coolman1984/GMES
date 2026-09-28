// DSH5020 Plant board — the whole plant on the hall's big screen: every line (running / stopped / idle, its order,
// its output and its OEE), and the plant's figures of the day: output, scrap, OEE, open stops, open quality holds,
// containers loading and dispatched. Refreshed every 30 s; nothing is typed in, nothing is estimated.
import * as ui from "/eco-ui/eco-ui.js";
import { api, can, name, showError, stopName, t, today } from "../common.js";

const { h } = ui;

export default function create() {
  const clock = h("span", { class: "bd-clock" });
  const kpis = h("div", { class: "bd-kpis" });
  const tiles = h("div", { class: "pb-tiles" });
  const el = h("div", { class: "bd pb" }, h("header", { class: "bd-head" }, h("div", { class: "bd-title" }, h("span", { text: t("scr.DSH5020") })), h("span", { class: "eco-grow" }),
    h("span", { class: "bd-shift" }, t("st.prod_day") + " ", ui.ltr(today())), clock), kpis, tiles);
  const kpi = (label, value, unit, cls, sub) => h("div", { class: "bd-kpi " + (cls || "") }, h("span", { class: "bd-kpi-label", text: label }),
    h("b", {}, ui.ltr(value), unit ? h("small", { text: unit }) : null), sub ? h("span", { class: "bd-kpi-sub", text: sub }) : null);
  async function refresh() {
    let b, holds = [], boxes = [];
    try {
      [b, holds, boxes] = await Promise.all([api("GET", "/api/boards/plant"), can("qms.read") ? api("GET", "/api/qms/holds?status=open") : [],
        can("shp.read") ? api("GET", "/api/containers?from=" + today()) : []]);
    } catch (e) { showError(e); return; }
    const withOee = b.lines.filter((l) => l.oee && l.oee.oee !== null);
    const oee = withOee.length ? withOee.reduce((a, l) => a + l.oee.oee * (l.good + l.scrap), 0) / Math.max(1, withOee.reduce((a, l) => a + l.good + l.scrap, 0)) : null;
    const scrapPct = b.good + b.scrap ? (b.scrap / (b.good + b.scrap)) * 100 : 0;
    const loading = boxes.filter((c) => c.status === "loading").length, gone = boxes.filter((c) => c.status === "dispatched").length;
    ui.clear(kpis,
      kpi(t("bd.actual"), ui.fmtNumber(b.good), t("unit.pcs"), "is-accent", t("bd.of_orders", { n: ui.fmtNumber(b.planned) })),
      kpi("OEE", oee === null ? "—" : oee.toFixed(1), oee === null ? null : "%", oee === null ? null : oee >= 85 ? "is-ok" : oee < 60 ? "is-bad" : null, t("pb.weighted")),
      kpi(t("bd.scrap"), scrapPct.toFixed(1), "%", scrapPct > 2 ? "is-bad" : "is-ok", ui.fmtNumber(b.scrap) + " " + t("unit.pcs")),
      kpi(t("ho.open_stops"), String(b.stoppages.open), null, b.stoppages.open ? "is-bad" : "is-ok", b.stoppages.minutesToday + " " + t("bd.min") + " " + t("pb.today")),
      kpi(t("ho.open_holds"), String(holds.length), null, holds.length ? "is-bad" : "is-ok", holds.reduce((a, x) => a + x.units, 0) + " " + t("unit.pcs")),
      kpi(t("shp.containers"), String(gone), null, null, loading + " " + t("pb.loading")));
    ui.clear(tiles, b.lines.map((l) => h("div", { class: "pb-tile is-" + l.state },
      h("div", { class: "pb-top" }, h("b", {}, ui.ltr(l.code)), h("span", { class: "pb-state", text: l.state === "down" ? t("bd.stopped") : l.state === "run" ? t("bd.running") : t("st.idle") })),
      h("div", { class: "pb-name", text: name(l) }),
      l.stop ? h("div", { class: "pb-stop" }, ui.icon("pause", 18), h("span", { text: stopName(l.stop.reason) + " · " + l.stop.minutes + " " + t("bd.min") })) : null,
      l.workOrder ? h("div", { class: "pb-wo" }, h("span", {}, ui.ltr(l.workOrder.code), " · ", name(l.workOrder.item)), ui.progress(l.workOrder.completed, l.workOrder.planned,
        { label: ui.fmtNumber(l.workOrder.completed) + " / " + ui.fmtNumber(l.workOrder.planned), status: l.state === "down" ? "down" : "run" })) : h("div", { class: "pb-wo eco-muted", text: t("hm.no_wo") }),
      h("div", { class: "pb-figs" }, h("div", {}, h("small", { text: t("bd.actual") }), h("b", {}, ui.ltr(ui.fmtNumber(l.good)))), h("div", {}, h("small", { text: t("bd.scrap") }), h("b", {}, ui.ltr(ui.fmtNumber(l.scrap)))),
        ui.ring(l.oee && l.oee.oee !== null ? l.oee.oee : 0, { size: 64, label: l.oee && l.oee.oee !== null ? (l.oee.oee < 10 ? l.oee.oee.toFixed(1) : Math.round(l.oee.oee)) + "%" : "—", status: l.oee && l.oee.oee !== null ? (l.oee.oee >= 85 ? "ok" : l.oee.oee >= 60 ? "warn" : "bad") : null })))));
  }
  const timer = setInterval(() => { clock.textContent = ui.fmtTime(); }, 1000);
  const data = setInterval(refresh, 30000);
  clock.textContent = ui.fmtTime();
  refresh();
  return { el, onClose: () => { clearInterval(timer); clearInterval(data); } };
}
