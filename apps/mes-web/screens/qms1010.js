// QMS1010 Inspection plans — what is checked, where, with which limits: incoming (IQC, sampled by AQL), in-process
// (IPQC), final (FQC) and outgoing (OQC, sampled by AQL before shipping). Limits are exact decimals (up to 3 places).
import * as ui from "/eco-ui/eco-ui.js";
import { api, can, name, showError, t } from "../common.js";
import { inquiryScreen, rowsEditor } from "../views.js";

const { h } = ui;
const STAGES = ["iqc", "ipqc", "fqc", "oqc"];
const AQLS = ["0.065", "0.10", "0.15", "0.25", "0.40", "0.65", "1.0", "1.5", "2.5", "4.0", "6.5"];

export default function create({ shell }) {
  const canWrite = can("qms.write");
  let current = null;
  const editBtn = ui.button({ label: t("edit"), icon: "edit", disabled: true, onClick: () => edit(current) });
  const v = inquiryScreen({ shell, code: "QMS1010", path: [t("g.quality"), t("m.inspection")], auto: true,
    fields: [{ key: "stage", label: t("qms.stage"), type: "select", options: STAGES.map((s) => [s, t("stage." + s)]), placeholder: t("all") }],
    columns: [
      { key: "stage", label: t("qms.stage"), width: 130, render: (r) => ui.badge(t("stage." + r.stage), r.stage === "oqc" ? "accent" : "neutral"), frozen: true },
      { key: "code", label: t("c.code"), type: "code", width: 130, frozen: true, total: "count" },
      { key: "name", label: t("c.name"), width: 220, value: (r) => name(r) },
      { key: "item_code", label: t("c.item"), type: "code", width: 110 },
      { key: "op_code", label: t("c.op"), type: "code", width: 70 },
      { key: "aql", label: "AQL", width: 110, value: (r) => (r.aql ? r.aql + " · " + (r.aql_level || "II") : "") },
      { key: "chars", label: t("qms.characteristics"), type: "number", width: 110 },
      { key: "active", label: t("c.record_status"), width: 100, render: (r) => ui.badge(t(r.active ? "rs.active" : "rs.inactive"), r.active ? "ok" : "neutral") },
    ],
    load: async (c) => (await api("GET", "/api/qms/plans")).filter((p) => !c.stage || p.stage === c.stage),
    detail: async (r, host) => {
      current = r; editBtn.disabled = !canWrite;
      const p = await api("GET", "/api/qms/plans/" + r.id);
      const g = ui.grid([{ key: "seq", label: t("c.seq"), type: "number", width: 50 }, { key: "code", label: t("c.code"), type: "code", width: 80 }, { key: "n", label: t("c.name"), width: 180, value: (x) => name(x) },
        { key: "kind", label: t("c.type"), width: 90, value: (x) => t("chk." + x.kind) }, { key: "lsl", label: "LSL", width: 70, align: "end" }, { key: "nominal", label: t("qms.nominal"), width: 80, align: "end" },
        { key: "usl", label: "USL", width: 70, align: "end" }, { key: "unit", label: t("c.unit"), width: 70 }], { rows: p.characteristics, layoutKey: "QMS1010-chars" });
      ui.clear(host, h("div", { class: "mes-detail-head" }, h("div", { class: "mes-detail-title" }, h("span", { class: "mes-detail-code" }, ui.ltr(p.code)), ui.badge(t("stage." + p.stage), "accent")),
        h("div", { class: "mes-detail-sub", text: name(p) })), h("div", { class: "mes-fill-grid" }, g.el));
    },
    toolbar: () => [ui.button({ label: t("qms.new_plan"), icon: "plus", disabled: !canWrite, onClick: () => edit(null) }), editBtn],
  });
  async function edit(r) {
    const p = r ? await api("GET", "/api/qms/plans/" + r.id) : null;
    let items = [];
    try { items = (await api("GET", "/api/items")).filter((i) => i.active); } catch (e) { showError(e); return; }
    const code = ui.input({ value: p ? p.code : "", dir: "ltr", readonly: !!p }), en = ui.input({ value: p ? p.name_en : "" }), ar = ui.input({ value: p ? p.name_ar : "", dir: "rtl" });
    const stage = ui.select({ options: STAGES.map((s) => [s, t("stage." + s)]), value: p ? p.stage : "ipqc" });
    const item = ui.select({ options: [["", t("all")]].concat(items.map((i) => [i.id, i.code + " · " + name(i)])), value: p ? p.item_id || "" : "" });
    const op = ui.input({ value: p ? p.op_code || "" : "", dir: "ltr" });
    const aql = ui.select({ options: [["", "—"]].concat(AQLS.map((a) => [a, a])), value: p ? p.aql || "" : "" });
    const lvl = ui.select({ options: [["I", "I"], ["II", "II"], ["III", "III"]], value: p ? p.aql_level || "II" : "II" });
    const ed = rowsEditor([{ key: "seq", label: t("c.seq"), kind: "number", width: 60 }, { key: "code", label: t("c.code"), width: 90, dir: "ltr" }, { key: "nameEn", label: t("c.name") + " (EN)" },
      { key: "nameAr", label: t("c.name") + " (AR)", dir: "rtl" }, { key: "kind", label: t("c.type"), kind: "select", width: 110, options: [["measure", t("chk.measure")], ["check", t("chk.check")]] },
      { key: "lsl", label: "LSL", width: 80, dir: "ltr" }, { key: "nominal", label: t("qms.nominal"), width: 80, dir: "ltr" }, { key: "usl", label: "USL", width: 80, dir: "ltr" }, { key: "unit", label: t("c.unit"), width: 70 }],
    p ? p.characteristics.map((c) => ({ seq: c.seq, code: c.code, nameEn: c.name_en, nameAr: c.name_ar, kind: c.kind, lsl: c.lsl ?? "", nominal: c.nominal ?? "", usl: c.usl ?? "", unit: c.unit ?? "" })) : []);
    const err = h("div", { class: "eco-span-2" });
    ui.dialog({ title: p ? p.code : t("qms.new_plan"), subtitle: "QMS1010", icon: "clipboard-check", width: 1060, body: h("div", {}, h("div", { class: "eco-form" },
      ui.field(t("c.code"), code, { required: true }), ui.field(t("qms.stage"), stage), ui.field(t("c.name") + " (EN)", en, { required: true }), ui.field(t("c.name") + " (AR)", ar),
      ui.field(t("c.item"), item), ui.field(t("c.op"), op, { hint: t("qms.op_hint") }), ui.field("AQL", aql, { hint: t("qms.aql_hint") }), ui.field(t("qms.level"), lvl)), h("h4", { text: t("qms.characteristics") }), ed.el, err),
    actions: [{ label: t("cancel"), kind: "ghost", value: false }, { label: t("save"), kind: "primary", icon: "save", onClick: async () => {
      const chars = ed.values().filter((c) => c.code).map((c) => ({ seq: Number(c.seq), code: c.code, nameEn: c.nameEn || c.code, nameAr: c.nameAr || undefined, kind: c.kind, unit: c.unit || undefined,
        ...(c.lsl ? { lsl: c.lsl } : {}), ...(c.nominal ? { nominal: c.nominal } : {}), ...(c.usl ? { usl: c.usl } : {}) }));
      const body = { code: code.value, nameEn: en.value, nameAr: ar.value || undefined, stage: stage.value, itemId: item.value || null, opCode: op.value || null, aql: aql.value || null, aqlLevel: aql.value ? lvl.value : null, characteristics: chars };
      try { if (p) await api("PUT", "/api/qms/plans/" + p.id, { ...body, version: p.version }); else await api("POST", "/api/qms/plans", body); } catch (e) { showError(e, err); return false; }
      ui.toast({ kind: "ok", title: t("saved") }); v.run();
    } }] });
  }
  return { el: v.el };
}
