// MDM1060 Production shifts and calendar — the PLANT's working time (capacity, planned production time of OEE): its
// shifts, weekly rest days and holidays. People's shifts and rosters are HR-System's; this is not a roster.
import * as ui from "/eco-ui/eco-ui.js";
import { api, can, name, showError, t } from "../common.js";

const { h } = ui;
const DAYS = [6, 0, 1, 2, 3, 4, 5];  // the Egyptian week starts on Saturday

export default function create({ shell }) {
  const canWrite = can("eng.write");
  const shiftGrid = ui.grid([
    { key: "code", label: t("c.code"), type: "code", width: 70, frozen: true },
    { key: "name", label: t("c.name"), width: 160, value: (r) => name(r) },
    { key: "start_at", label: t("cal.start"), width: 80, align: "center" },
    { key: "end_at", label: t("cal.end"), width: 80, align: "center" },
    { key: "break_min", label: t("cal.break"), type: "number", width: 90 },
    { key: "net", label: t("cal.net"), type: "number", width: 110, value: (r) => net(r) },
    { key: "active", label: t("c.record_status"), width: 100, render: (r) => ui.badge(t(r.active ? "rs.active" : "rs.inactive"), r.active ? "ok" : "neutral") },
  ], { rowKey: "code", layoutKey: "MDM1060-shifts", onOpen: (r) => canWrite && editShift(r) });
  const exGrid = ui.grid([
    { key: "day", label: t("c.prod_day"), type: "date", width: 120 },
    { key: "kind", label: t("c.type"), width: 120, render: (r) => ui.badge(t("cal." + r.kind), r.kind === "holiday" ? "warn" : "ok") },
    { key: "note", label: t("eng.note"), width: 260 },
  ], { rowKey: "day", layoutKey: "MDM1060-days", onOpen: (r) => canWrite && editDay(r) });
  const restHost = h("div", { class: "mes-row-gap" });
  let rest = [];
  const body = h("div", { class: "mes-cal" },
    ui.section(t("cal.shifts"), h("div", { class: "mes-subgrid" }, shiftGrid.el), { actions: [ui.button({ label: t("cal.new_shift"), icon: "plus", size: "sm", disabled: !canWrite, onClick: () => editShift(null) })] }),
    ui.section(t("cal.rest_days"), restHost),
    ui.section(t("cal.exceptions"), h("div", { class: "mes-subgrid" }, exGrid.el), { actions: [ui.button({ label: t("cal.new_day"), icon: "plus", size: "sm", disabled: !canWrite, onClick: () => editDay(null) })] }));
  const sc = ui.screen({ code: "MDM1060", title: t("scr.MDM1060"), path: [t("m.master"), t("m.plant_model")], shell,
    note: h("div", { class: "mes-pad" }, ui.banner("info", t("cal.not_roster"))),
    standard: { inquiry: () => load(), inquiryLabel: t("refresh") }, body });

  function net(r) {
    const m = (s) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
    return ((m(r.end_at) - m(r.start_at) + 1440) % 1440) - r.break_min;
  }
  function drawRest() {
    ui.clear(restHost, DAYS.map((d) => ui.checkbox({ label: t("wd." + d), checked: rest.includes(d), disabled: !canWrite, onChange: async (on) => {
      const next = on ? [...rest, d] : rest.filter((x) => x !== d);
      try { rest = (await api("PUT", "/api/production-calendar/rest-weekdays", next)).restWeekdays; } catch (e) { showError(e); }
      drawRest();
    } })));
  }
  async function load() {
    try {
      const c = await api("GET", "/api/production-calendar");
      shiftGrid.setRows(c.shifts); exGrid.setRows(c.exceptions); rest = c.restWeekdays; drawRest();
      shiftGrid.setEmptyText(t("cal.no_shifts")); exGrid.setEmptyText(t("cal.no_days"));
    } catch (e) { showError(e); }
  }
  function editShift(r) {
    const code = ui.input({ value: r ? r.code : "", dir: "ltr", readonly: !!r }), en = ui.input({ value: r ? r.name_en : "" }), ar = ui.input({ value: r ? r.name_ar : "", dir: "rtl" });
    const st = ui.input({ type: "time", value: r ? r.start_at : "07:00" }), en2 = ui.input({ type: "time", value: r ? r.end_at : "15:00" }), br = ui.input({ type: "number", value: String(r ? r.break_min : 40) });
    const err = h("div", { class: "eco-span-2" });
    ui.dialog({ title: r ? r.code : t("cal.new_shift"), icon: "clock", body: h("div", { class: "eco-form" }, ui.field(t("c.code"), code, { required: true }), ui.field(t("cal.break"), br),
      ui.field(t("c.name") + " (EN)", en, { required: true }), ui.field(t("c.name") + " (AR)", ar), ui.field(t("cal.start"), st), ui.field(t("cal.end"), en2, { hint: t("cal.overnight") }), err),
    actions: [{ label: t("cancel"), kind: "ghost", value: false }, { label: t("save"), kind: "primary", icon: "save", onClick: async () => {
      try { await api("PUT", "/api/production-shifts/" + encodeURIComponent(code.value.trim()), { nameEn: en.value, nameAr: ar.value || undefined, start: st.value, end: en2.value, breakMin: Number(br.value || 0), version: r ? r.version : undefined }); }
      catch (e) { showError(e, err); return false; }
      load();
    } }] });
  }
  function editDay(r) {
    const day = ui.input({ type: "date", value: r ? r.day : "" }), note = ui.input({ value: r ? r.note || "" : "" });
    const kind = ui.select({ options: [["holiday", t("cal.holiday")], ["working", t("cal.working")], ["normal", t("cal.normal")]], value: r ? r.kind : "holiday" });
    const err = h("div", { class: "eco-span-2" });
    ui.dialog({ title: t("cal.new_day"), icon: "calendar", body: h("div", { class: "eco-form" }, ui.field(t("c.prod_day"), day, { required: true }), ui.field(t("c.type"), kind), ui.field(t("eng.note"), note, { span: 2 }), err),
      actions: [{ label: t("cancel"), kind: "ghost", value: false }, { label: t("save"), kind: "primary", icon: "save", onClick: async () => {
        try { await api("PUT", "/api/production-calendar/" + day.value, { kind: kind.value, note: note.value || undefined }); } catch (e) { showError(e, err); return false; }
        load();
      } }] });
  }
  load();
  return { el: sc.el };
}
