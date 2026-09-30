// PLN2060 Capacity and crew — load per line and day, the shift proposals of the last run, and the people each line needs.
import * as ui from "/eco-ui/eco-ui.js";
import { api, can, showError, t } from "../common.js";
import { inquiryScreen } from "../views.js";

const { h } = ui;

export default function create({ shell }) {
  const proposals = h("div", { class: "mes-pad" });
  const v = inquiryScreen({ shell, code: "PLN2060", path: [t("g.planning"), t("m.mrp")], auto: true, rowKey: "k", totals: false, note: proposals,
    columns: [
      { key: "line", label: t("c.line"), type: "code", width: 90, frozen: true },
      { key: "date", label: t("pln.date"), width: 100 },
      { key: "loaded", label: t("pln.loaded"), type: "number", width: 100 },
      { key: "capacity", label: t("pln.capacity"), type: "number", width: 100 },
      { key: "percent", label: "%", type: "number", width: 70, value: (r) => (r.percent === null ? "" : r.percent) },
      { key: "crew", label: t("pln.crew"), width: 220, value: (r) => r.crew },
    ],
    load: async () => {
      const cap = await api("GET", "/api/pln/capacity");
      const days = cap.load.map((l) => l.date).sort();
      const crew = days.length ? await api("GET", `/api/pln/crew?from=${days[0]}&to=${days[days.length - 1]}`) : [];
      ui.clear(proposals, ...cap.proposals.map((p) => ui.banner("warn", h("span", {}, t("pln.proposal", { shift: p.shift, line: p.line, from: p.from, to: p.to }), " ",
        ui.button({ label: t("pln.accept"), size: "sm", disabled: !can("pln.plan"), onClick: async () => {
          try { await api("POST", "/api/pln/line-shifts", { line: p.line, shift: p.shift, from: p.from, to: p.to }); await api("POST", "/api/pln/runs"); await v.run(); }
          catch (e) { showError(e); }
        } })))));
      const people = new Map();
      for (const c of crew) people.set(`${c.line}|${c.date}`, [...(people.get(`${c.line}|${c.date}`) || []), `${c.shift}: ${c.required}`]);
      return cap.load.map((l) => ({ ...l, k: `${l.line}|${l.date}`, crew: (people.get(`${l.line}|${l.date}`) || []).join(" · ") }));
    },
  });
  return { el: v.el };
}
