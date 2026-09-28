// OEE2010 Downtime log — every stoppage of a day (or a range): line, station, reason, loss category, start, end,
// minutes, who. A stoppage still open can be ended here; a new one can be recorded for a line that has no station screen.
// The facts are append-only (START, END): a wrong reason is corrected by a note in the shift handover, not by editing.
import * as ui from "/eco-ui/eco-ui.js";
import { api, can, commandId, datePresets, loadStopReasons, name, showError, stamp, stopName, t, today } from "../common.js";
import { inquiryScreen, lineOptions } from "../views.js";

const { h } = ui;

export default function create({ shell }) {
  let reasons = [];
  const lineField = { key: "line", label: t("f.line"), type: "select", options: [], placeholder: t("all") };
  const v = inquiryScreen({ shell, code: "OEE2010", path: [t("g.efficiency"), t("m.downtime")], auto: true,
    fields: [
      { key: "days", label: t("f.prod_day"), type: "daterange", required: true, default: [today(), today()], span: 2, presets: datePresets(), presetsLabel: t("presets") },
      lineField,
      { key: "open", label: t("oee.only_open"), type: "toggle", options: [["", t("all")], ["1", t("oee.open")]], default: "" },
    ],
    columns: [
      { key: "state", label: t("c.status"), width: 90, render: (r) => ui.statusChip(r.endedAt ? "closed" : "down", r.endedAt ? t("oee.ended") : t("oee.open")) },
      { key: "day", label: t("c.prod_day"), type: "date", width: 100 },
      { key: "line", label: t("c.line"), type: "code", width: 80 },
      { key: "station", label: t("c.station"), type: "code", width: 120 },
      { key: "reasonName", label: t("oee.reason"), width: 160 },
      { key: "loss", label: t("oee.loss"), width: 120 },
      { key: "from", label: t("oee.from"), width: 140 },
      { key: "to", label: t("oee.to"), width: 140 },
      { key: "minutes", label: t("oee.minutes"), type: "number", digits: 0, width: 80, total: "sum" },
      { key: "startedBy", label: t("c.user"), width: 120, total: "count" },
    ],
    detail: (r, host) => ui.clear(host, ui.props([[t("c.line"), r.line], [t("c.station"), r.station || "—"], [t("oee.reason"), r.reasonName], [t("oee.loss"), r.loss],
      [t("oee.from"), r.from + " · " + r.startedBy], [t("oee.to"), r.endedAt ? r.to + " · " + r.endedBy : t("oee.open")], [t("oee.minutes"), String(r.minutes)]]),
      !r.endedAt && can("oee.stops.write") ? ui.button({ label: t("st.resume"), icon: "play", kind: "primary", onClick: () => end(r) }) : null),
    toolbar: () => can("oee.stops.write") ? [ui.button({ label: t("oee.record"), icon: "pause", onClick: () => record() })] : [],
    load: async (c) => {
      const [from, to] = c.days;
      const out = [];
      for (let d = from; d <= to; d = next(d)) {
        const rows = await api("GET", "/api/stoppages?" + new URLSearchParams({ date: d, ...(c.line ? { line: c.line } : {}), ...(c.open ? { open: "1" } : {}) }));
        for (const s of rows) {
          const r = reasons.find((x) => x.code === s.reason);
          out.push({ ...s, day: s.productionDate, reasonName: stopName(s.reason), loss: r ? t("loss." + r.loss) : "", from: stamp(s.startedAt), to: s.endedAt ? stamp(s.endedAt) : "" });
        }
        if (out.length > 5000) break;
      }
      return out;
    },
  });
  async function end(r) {
    try { await api("POST", `/api/stoppages/${r.id}/end`, { commandId: commandId() }); ui.toast({ kind: "ok", title: t("st.resumed"), text: r.line }); v.run(); } catch (e) { showError(e); }
  }
  async function record() {
    const lines = await lineOptions();
    const lineSel = ui.select({ options: lines, required: true });
    const reasonSel = ui.select({ options: reasons.filter((x) => x.active).map((x) => [x.code, name(x) + " · " + t("loss." + x.loss)]), required: true });
    const d = ui.dialog({ title: t("oee.record"), icon: "pause", body: h("div", { class: "mes-form" }, ui.field(t("f.line"), lineSel, { required: true }), ui.field(t("oee.reason"), reasonSel, { required: true })),
      actions: [ui.button({ label: t("cancel"), onClick: () => d.close() }), ui.button({ label: t("oee.record"), kind: "primary", onClick: async () => {
        try { await api("POST", "/api/stoppages", { commandId: commandId(), line: lineSel.value, reason: reasonSel.value }); d.close(); v.run(); } catch (e) { showError(e); }
      } })] });
  }
  loadStopReasons().then((r) => { reasons = r; });
  lineOptions().then((opts) => { lineField.options.push(...opts); const box = v.cond.control("line"); for (const [a, b] of opts) box.append(h("option", { value: a, text: b })); });
  return { el: v.el };
}
const next = (day) => { const d = new Date(day + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };
