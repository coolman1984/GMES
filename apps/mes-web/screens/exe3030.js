// EXE3030 Transaction inquiry — the facts themselves: the production ledger (released, consumed, produced, scrapped,
// closed; what accounting receives) and the unit history (every scan of every serial), filtered.
import * as ui from "/eco-ui/eco-ui.js";
import { api, datePresets, num, stamp, t, today } from "../common.js";
import { inquiryScreen, lineOptions } from "../views.js";

const LEDGER = ["RELEASE", "CONSUME", "COMPLETE", "SCRAP", "CLOSE"];
const UNIT = ["CREATE", "PASS", "FAIL", "REPAIR", "SCRAP", "COMPLETE", "ATTACH", "HOLD", "RELEASE", "PACK", "UNPACK", "SHIP", "LOAD", "UNLOAD"];

export default function create({ shell }) {
  const lineField = { key: "line", label: t("f.line"), type: "select", options: [], placeholder: t("all") };
  const v = inquiryScreen({ shell, code: "EXE3030", path: [t("m.production"), t("m.shop_floor")], rowKey: "key",
    fields: [
      { key: "days", label: t("f.prod_day"), type: "daterange", required: true, default: [today(), today()], span: 2, presets: datePresets(), presetsLabel: t("presets") },
      { key: "source", label: t("txn.source"), type: "toggle", options: [["ledger", t("txn.ledger")], ["units", t("txn.units")]], default: "ledger" },
      lineField,
      { key: "type", label: t("c.type"), type: "select", options: LEDGER.map((k) => ["L:" + k, t("txn.ledger") + " · " + t("txn." + k)])
        .concat(UNIT.map((k) => ["U:" + k, t("txn.units") + " · " + t("uev." + k)])), placeholder: t("all") },
      { key: "text", label: t("txn.wo_or_serial"), dir: "ltr" },
    ],
    columns: [
      { key: "seq", label: "#", type: "number", width: 80, frozen: true },
      { key: "kind", label: t("c.type"), width: 120, frozen: true },
      { key: "at", label: t("c.time"), width: 140 },
      { key: "day", label: t("c.prod_day"), type: "date", width: 100 },
      { key: "shift", label: t("c.shift"), width: 60, align: "center" },
      { key: "line", label: t("c.line"), type: "code", width: 80 },
      { key: "where", label: t("c.station"), type: "code", width: 110 },
      { key: "ref", label: t("txn.ref"), type: "code", width: 150, total: "count" },
      { key: "item", label: t("c.item"), type: "code", width: 110 },
      { key: "qty", label: t("c.qty"), type: "number", digits: 0, width: 80, total: "sum" },
      { key: "extra", label: t("txn.detail"), width: 200 },
      { key: "user", label: t("c.user"), width: 120 },
    ],
    load: async (c) => {
      const [from, to] = c.days;
      if (c.source === "ledger") {
        const rows = await api("GET", "/api/ledger?" + new URLSearchParams({ from, to, type: (c.type || "").startsWith("L:") ? c.type.slice(2) : "", line: c.line || "",
          ...(c.text && /^WO/i.test(c.text) ? { wo: c.text } : c.text ? { lot: c.text } : {}) }));
        return rows.map((r) => ({ key: "l" + r.seq, seq: r.seq, kind: t("txn." + r.txn_type), at: stamp(r.occurred_at), day: r.production_date, shift: r.shift_code || "", line: r.line_code || "",
          where: r.wh_code || "", ref: r.wo_code, item: r.item_code || "", qty: num(r.qty), extra: [r.lot_no, r.reason_code].filter(Boolean).join(" · "), user: r.user_name }));
      }
      const out = [];
      for (let d = from; d <= to; d = dayShift0(d, 1)) {
        const rows = await api("GET", "/api/unit-events?" + new URLSearchParams({ date: d, kind: (c.type || "").startsWith("U:") ? c.type.slice(2) : "",
          line: c.line || "", ...(c.text ? { serial: c.text } : {}), limit: "5000" }));
        for (const r of rows) {
          const det = r.detail ? JSON.parse(r.detail) : {};
          out.push({ key: "u" + r.seq, seq: r.seq, kind: t("uev." + r.kind), at: stamp(r.occurred_at), day: r.production_date, shift: r.shift_code || "", line: r.line_code || "", where: r.station || "",
            ref: r.serial || det.lot || "", item: r.op_code || "", qty: null, extra: [r.defect_code, det.part, det.cause, det.box, det.container].filter(Boolean).join(" · "), user: r.user_name });
        }
      }
      return out;
    },
  });
  lineOptions().then((opts) => { lineField.options.push(...opts); const box = v.cond.control("line"); for (const [val, lab] of opts) box.append(ui.h("option", { value: val, text: lab })); });
  return { el: v.el };
}
function dayShift0(day, n) { const d = new Date(day + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
