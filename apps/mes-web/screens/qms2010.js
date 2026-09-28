// QMS2010 Record an inspection — against a plan: the measurements (checked against their limits by the server), the
// defects found, and for sampled inspections (IQC / OQC) the ISO 2859-1 plan for the lot size: sample, accept, reject.
// A failed OQC holds the whole lot at once. The records are signed-off facts: listed here, never changed.
import * as ui from "/eco-ui/eco-ui.js";
import { api, can, commandId, datePresets, name, showError, stamp, t, today } from "../common.js";
import { inquiryScreen } from "../views.js";

const { h } = ui;
const STAGES = ["iqc", "ipqc", "fqc", "oqc"];

export default function create({ shell }) {
  const v = inquiryScreen({ shell, code: "QMS2010", path: [t("g.quality"), t("m.inspection")], auto: true,
    fields: [{ key: "days", label: t("f.prod_day"), type: "daterange", required: true, default: [today(), today()], span: 2, presets: datePresets(), presetsLabel: t("presets") },
      { key: "stage", label: t("qms.stage"), type: "select", options: STAGES.map((s) => [s, t("stage." + s)]), placeholder: t("all") },
      { key: "result", label: t("qms.result"), type: "select", options: [["pass", t("qms.pass")], ["fail", t("qms.fail")]], placeholder: t("all") },
      { key: "target", label: t("qms.target"), dir: "ltr" }],
    columns: [
      { key: "result", label: t("qms.result"), type: "status", width: 100, status: (r) => (r.result === "pass" ? "done" : "down"), label_of: (_s, r) => t("qms." + r.result), frozen: true },
      { key: "seq", label: "#", type: "number", width: 70, frozen: true, total: "count" },
      { key: "stage", label: t("qms.stage"), width: 110, value: (r) => t("stage." + r.stage) },
      { key: "plan_code", label: t("qms.plan"), type: "code", width: 120 },
      { key: "target", label: t("qms.target"), type: "code", width: 150, value: (r) => r.target_type === "unit" ? r.target : t("tt." + r.target_type) + " " + r.target },
      { key: "item_code", label: t("c.item"), type: "code", width: 100 },
      { key: "lot_size", label: t("qms.lot_size"), type: "number", width: 80 },
      { key: "sample_size", label: t("qms.sample"), type: "number", width: 80 },
      { key: "accept", label: "Ac", type: "number", width: 50 },
      { key: "defects", label: t("qms.defects_found"), type: "number", width: 80, total: "sum" },
      { key: "inspector", label: t("qms.inspector"), width: 110 },
      { key: "at", label: t("c.time"), width: 140, value: (r) => stamp(r.at) },
    ],
    load: async (c) => api("GET", "/api/qms/inspections?" + new URLSearchParams({ from: c.days[0], to: c.days[1], stage: c.stage || "", result: c.result || "", target: c.target || "" })),
    detail: (r, host) => {
      ui.clear(host, h("div", { class: "mes-detail-head" }, h("div", { class: "mes-detail-title" }, h("span", { class: "mes-detail-code" }, ui.ltr("#" + r.seq)),
        ui.statusChip(r.result === "pass" ? "done" : "down", t("qms." + r.result))), h("div", { class: "mes-detail-sub", text: t("stage." + r.stage) + " · " + r.target })),
        ui.props([[t("qms.lot_size"), r.lot_size ?? null], [t("qms.sample"), r.sample_size ?? null], ["Ac", r.accept ?? null], [t("qms.defects_found"), r.defects], [t("qms.inspector"), r.inspector], [t("eng.note"), r.note]]),
        r.measures.length ? ui.section(t("qms.characteristics"), h("div", { class: "mes-measures" }, r.measures.map((m) => h("div", { class: m.ok ? "" : "is-bad" }, h("b", {}, ui.ltr(m.code)), h("span", {}, ui.ltr(m.value)), ui.icon(m.ok ? "check" : "x", 14))))) : null,
        r.findings.length ? ui.section(t("qms.findings"), h("div", { class: "mes-measures" }, r.findings.map((f) => h("div", { class: "is-bad" }, h("b", {}, ui.ltr(f.defectCode)), h("span", {}, ui.ltr("× " + f.qty + (f.serial ? " · " + f.serial : ""))))))) : null);
    },
    toolbar: () => [ui.button({ label: t("qms.record"), icon: "clipboard-check", kind: "primary", disabled: !can("qms.inspect"), onClick: () => record() })],
  });

  async function record() {
    let plans, defects;
    try { [plans, defects] = await Promise.all([api("GET", "/api/qms/plans"), api("GET", "/api/defect-codes?active=1")]); } catch (e) { showError(e); return; }
    plans = plans.filter((p) => p.active);
    const planSel = ui.select({ options: [["", "—"]].concat(plans.map((p) => [p.id, p.code + " · " + t("stage." + p.stage) + " · " + name(p)])) });
    const ttype = ui.select({ options: ["unit", "work_order", "pallet", "lot"].map((x) => [x, t("tt." + x)]), value: "unit" });
    const target = ui.input({ dir: "ltr" }), lot = ui.input({ type: "number", min: "2" }), note = ui.input({});
    const aqlBox = h("div", { class: "eco-span-2" }), measHost = h("div", { class: "eco-span-2 mes-measure-form" }), findHost = h("div", { class: "eco-span-2" });
    let plan = null;
    const finds = [];
    const drawFinds = () => ui.clear(findHost, h("div", { class: "mes-row-gap" }, finds.map((f, i) => h("span", { class: "eco-chip" }, ui.ltr(f.defectCode + " ×" + f.qty + (f.serial ? " · " + f.serial : "")),
      h("button", { type: "button", class: "eco-chip-x", onclick: () => { finds.splice(i, 1); drawFinds(); } }, ui.icon("x", 11)))),
      ui.button({ label: t("qms.add_finding"), icon: "plus", size: "sm", onClick: () => addFinding() })));
    function addFinding() {
      const code = ui.select({ options: defects.length ? defects.map((d) => [d.code, d.code + " · " + name(d)]) : [["DEFECT", "DEFECT"]] }), qty = ui.input({ type: "number", value: "1", min: "1" }), ser = ui.input({ dir: "ltr" });
      ui.dialog({ title: t("qms.add_finding"), icon: "alert", body: h("div", { class: "eco-form" }, ui.field(t("qms.defect"), code, { span: 2 }), ui.field(t("c.qty"), qty), ui.field(t("c.serial"), ser)),
        actions: [{ label: t("cancel"), kind: "ghost", value: false }, { label: t("save"), kind: "primary", onClick: () => { finds.push({ defectCode: code.value, qty: Number(qty.value || 1), ...(ser.value ? { serial: ser.value } : {}) }); drawFinds(); } }] });
    }
    async function drawPlan() {
      plan = planSel.value ? await api("GET", "/api/qms/plans/" + planSel.value) : null;
      ui.clear(measHost, plan && plan.characteristics.length ? plan.characteristics.map((c) => {
        const inp = c.kind === "check" ? ui.select({ options: [["1", "OK"], ["0", "NG"]], value: "1" }) : ui.input({ dir: "ltr", placeholder: [c.lsl, c.usl].filter((x) => x !== null).join(" … ") });
        inp.dataset.code = c.code;
        return ui.field(c.code + " · " + name(c) + (c.unit ? " (" + c.unit + ")" : ""), inp, { hint: c.kind === "measure" ? t("qms.limits", { lsl: c.lsl ?? "—", usl: c.usl ?? "—" }) : null });
      }) : null);
      await drawAql();
    }
    async function drawAql() {
      if (!plan || !plan.aql || !(Number(lot.value) >= 2)) { ui.clear(aqlBox); return; }
      try {
        const p = await api("GET", `/api/qms/aql?lotSize=${Number(lot.value)}&level=${plan.aql_level || "II"}&aql=${plan.aql}`);
        ui.clear(aqlBox, ui.banner("info", t("qms.aql_plan", { letter: p.letter, n: p.sample, ac: p.accept, re: p.reject, aql: plan.aql })));
      } catch (e) { ui.clear(aqlBox, ui.banner("bad", e.message)); }
    }
    planSel.addEventListener("change", drawPlan);
    lot.addEventListener("input", drawAql);
    drawFinds();
    const err = h("div", { class: "eco-span-2" });
    ui.dialog({ title: t("qms.record"), subtitle: "QMS2010", icon: "clipboard-check", width: 760, body: h("div", { class: "eco-form" },
      ui.field(t("qms.plan"), planSel, { span: 2 }), ui.field(t("qms.target_type"), ttype), ui.field(t("qms.target"), target, { required: true }), ui.field(t("qms.lot_size"), lot, { hint: t("qms.lot_hint") }), ui.field(t("eng.note"), note),
      aqlBox, measHost, h("div", { class: "eco-span-2" }, h("strong", { text: t("qms.findings") })), findHost, err),
    actions: [{ label: t("cancel"), kind: "ghost", value: false }, { label: t("save"), kind: "primary", icon: "save", onClick: async () => {
      const measurements = [...measHost.querySelectorAll("[data-code]")].map((x) => ({ code: x.dataset.code, value: x.value }));
      try {
        const r = await api("POST", "/api/qms/inspections", { commandId: commandId(), planId: planSel.value || undefined, stage: planSel.value ? undefined : "ipqc", targetType: ttype.value, target: target.value,
          ...(lot.value ? { lotSize: Number(lot.value) } : {}), measurements, findings: finds, note: note.value || undefined });
        ui.toast({ kind: r.result === "pass" ? "ok" : "bad", title: t("qms." + r.result), text: r.hold ? t("qms.lot_held", { code: r.hold.code, n: r.hold.units }) : "", keep: !!r.hold });
      } catch (e) { showError(e, err); return false; }
      v.run();
    } }] });
  }
  return { el: v.el };
}
