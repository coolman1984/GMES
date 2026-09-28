// QMS1020 Defect and repair codes — the plant's lists: defects by category and severity (what the stations report when a
// unit fails), and repair causes and actions (what the repair station records). An empty list accepts any code.
import * as ui from "/eco-ui/eco-ui.js";
import { api, can, name, showError, t } from "../common.js";

const { h } = ui;
const SEV = { critical: "bad", major: "warn", minor: "neutral" };

export default function create({ shell }) {
  const canWrite = can("qms.write");
  let tab = "defects", dSel = null, rSel = null;
  const dGrid = ui.grid([
    { key: "code", label: t("c.code"), type: "code", width: 120, frozen: true, total: "count" },
    { key: "name", label: t("c.name"), width: 220, value: (r) => name(r) },
    { key: "category", label: t("qms.category"), width: 120 },
    { key: "severity", label: t("qms.severity"), width: 100, render: (r) => ui.badge(t("sev." + r.severity), SEV[r.severity]) },
    { key: "area", label: t("qms.area"), type: "code", width: 80 },
    { key: "active", label: t("c.record_status"), width: 100, render: (r) => ui.badge(t(r.active ? "rs.active" : "rs.inactive"), r.active ? "ok" : "neutral") },
  ], { rowKey: "code", totals: true, layoutKey: "QMS1020-d", onSelect: (s) => { dSel = s[0] || null; }, onOpen: (r) => canWrite && editDefect(r) });
  const rGrid = ui.grid([
    { key: "kind", label: t("c.type"), width: 100, value: (r) => t("rc." + r.kind) },
    { key: "code", label: t("c.code"), type: "code", width: 120, total: "count" },
    { key: "name", label: t("c.name"), width: 240, value: (r) => name(r) },
    { key: "active", label: t("c.record_status"), width: 100, render: (r) => ui.badge(t(r.active ? "rs.active" : "rs.inactive"), r.active ? "ok" : "neutral") },
  ], { rowKey: "key", totals: true, layoutKey: "QMS1020-r", onSelect: (s) => { rSel = s[0] || null; }, onOpen: (r) => canWrite && editRepair(r) });
  const body = h("div", { class: "mes-fill" }, ui.tabs([
    { id: "defects", label: t("qms.defects"), icon: "alert", render: () => dGrid.el },
    { id: "repair", label: t("qms.repair_codes"), icon: "wrench", render: () => rGrid.el },
  ], { onChange: (id) => { tab = id; } }));
  const sc = ui.screen({ code: "QMS1020", title: t("scr.QMS1020"), path: [t("g.quality"), t("m.inspection")], shell,
    toolbar: [ui.button({ label: t("qms.new_code"), icon: "plus", disabled: !canWrite, onClick: () => (tab === "defects" ? editDefect(null) : editRepair(null)) }),
      ui.button({ label: t("edit"), icon: "edit", disabled: !canWrite, onClick: () => (tab === "defects" ? dSel && editDefect(dSel) : rSel && editRepair(rSel)) })],
    standard: { inquiry: () => load(), inquiryLabel: t("refresh"), export: () => (tab === "defects" ? dGrid : rGrid).exportCSV("QMS1020-" + tab), exportLabel: t("export") },
    body: h("div", { class: "mes-col" }, h("div", { class: "mes-pad" }, ui.banner("info", t("qms.codes_help"))), body) });
  async function load() {
    try { const [d, r] = await Promise.all([api("GET", "/api/defect-codes"), api("GET", "/api/repair-codes")]); dGrid.setRows(d); rGrid.setRows(r.map((x) => ({ ...x, key: x.kind + ":" + x.code }))); } catch (e) { showError(e); }
  }
  function editDefect(r) {
    const code = ui.input({ value: r ? r.code : "", dir: "ltr", readonly: !!r }), en = ui.input({ value: r ? r.name_en : "" }), ar = ui.input({ value: r ? r.name_ar : "", dir: "rtl" });
    const cat = ui.input({ value: r ? r.category : "" }), area = ui.input({ value: r ? r.area || "" : "", dir: "ltr", placeholder: "SMD, MAIN…" });
    const sev = ui.select({ options: ["critical", "major", "minor"].map((s) => [s, t("sev." + s)]), value: r ? r.severity : "major" });
    const act = ui.checkbox({ label: t("rs.active"), checked: r ? !!r.active : true });
    const err = h("div", { class: "eco-span-2" });
    ui.dialog({ title: r ? r.code : t("qms.new_code"), icon: "alert", body: h("div", { class: "eco-form" }, ui.field(t("c.code"), code, { required: true }), ui.field(t("qms.severity"), sev),
      ui.field(t("c.name") + " (EN)", en, { required: true }), ui.field(t("c.name") + " (AR)", ar), ui.field(t("qms.category"), cat, { required: true }), ui.field(t("qms.area"), area, { hint: t("qms.area_hint") }), act, err),
    actions: [{ label: t("cancel"), kind: "ghost", value: false }, { label: t("save"), kind: "primary", icon: "save", onClick: async () => {
      try { await api("PUT", "/api/defect-codes/" + encodeURIComponent(code.value.trim()), { nameEn: en.value, nameAr: ar.value || undefined, category: cat.value, severity: sev.value, area: area.value || null,
        active: act.querySelector("input").checked, version: r ? r.version : undefined }); } catch (e) { showError(e, err); return false; }
      load();
    } }] });
  }
  function editRepair(r) {
    const kind = ui.select({ options: [["cause", t("rc.cause")], ["action", t("rc.action")]], value: r ? r.kind : "cause" });
    const code = ui.input({ value: r ? r.code : "", dir: "ltr", readonly: !!r }), en = ui.input({ value: r ? r.name_en : "" }), ar = ui.input({ value: r ? r.name_ar : "", dir: "rtl" });
    const err = h("div", { class: "eco-span-2" });
    ui.dialog({ title: r ? r.code : t("qms.new_code"), icon: "wrench", body: h("div", { class: "eco-form" }, ui.field(t("c.type"), kind), ui.field(t("c.code"), code, { required: true }),
      ui.field(t("c.name") + " (EN)", en, { required: true }), ui.field(t("c.name") + " (AR)", ar), err),
    actions: [{ label: t("cancel"), kind: "ghost", value: false }, { label: t("save"), kind: "primary", icon: "save", onClick: async () => {
      try { await api("PUT", `/api/repair-codes/${kind.value}/${encodeURIComponent(code.value.trim())}`, { nameEn: en.value, nameAr: ar.value || undefined }); } catch (e) { showError(e, err); return false; }
      load();
    } }] });
  }
  load();
  return { el: sc.el };
}
