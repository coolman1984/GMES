// EXE3010 Work Order Inquiry — the TEMPLATE of every inquiry screen (conditions -> Inquiry -> grid -> details).
import * as ui from "/eco-ui/eco-ui.js";
import { lines, source, TODAY, woHistory, woOperations } from "../data.js";
import { t, statusLabel, datePresets, sampleNote } from "../common.js";

const { h } = ui;

export default function create({ shell }) {
  const allLines = lines();
  const cond = ui.conditionPanel([
    { key: "plant", label: t("f.plant"), type: "select", options: [["P1", "P1 · " + t("plant.p1")]], default: "P1", required: true },
    { key: "area", label: t("f.area"), type: "select", options: [["INJ", t("area.INJ")], ["ASM", t("area.ASM")], ["PKG", t("area.PKG")]], placeholder: t("all") },
    { key: "line", label: t("f.line"), type: "select", options: allLines.map((l) => [l.code, l.code]), placeholder: t("all") },
    { key: "days", label: t("f.prod_day"), type: "daterange", required: true, default: [shiftDay(-6), TODAY], span: 2, presets: datePresets(), presetsLabel: t("presets") },
    { key: "status", label: t("f.status"), type: "select", options: ["planned", "released", "run", "hold", "done", "closed"].map((s) => [s, statusLabel(s)]), placeholder: t("all") },
    { key: "shift", label: t("f.shift"), type: "toggle", options: [["all", t("all")], ["A", "A"], ["B", "B"], ["C", "C"]], default: "all" },
    { key: "item", label: t("f.item"), placeholder: t("ph.item") },
    { key: "wo", label: t("f.wo"), placeholder: "WO-2609-…", dir: "ltr" },
  ], { key: "EXE3010", onSubmit: () => inquiry() });

  const cols = [
    { key: "status", label: t("c.status"), type: "status", width: 112, frozen: true, label_of: (s) => statusLabel(s) },
    { key: "code", label: t("c.wo"), type: "code", width: 118, frozen: true, total: "count" },
    { key: "item", label: t("c.item"), type: "code", width: 86 },
    { key: "itemName", label: t("c.item_name"), width: 188 },
    { key: "line", label: t("c.line"), type: "code", width: 74 },
    { key: "shift", label: t("c.shift"), width: 64, align: "center" },
    { key: "day", label: t("c.prod_day"), type: "date", width: 110 },
    { key: "planned", label: t("c.planned"), type: "number", width: 84, total: "sum" },
    { key: "good", label: t("c.good"), type: "number", width: 90, total: "sum" },
    { key: "scrap", label: t("c.scrap"), type: "number", width: 72, total: "sum", render: (r) => r.scrap ? h("span", { class: "mes-bad", text: ui.fmtNumber(r.scrap) }) : "0" },
    { key: "rework", label: t("c.rework"), type: "number", width: 76, total: "sum" },
    { key: "remaining", label: t("c.remaining"), type: "number", width: 90, total: "sum" },
    { key: "progress", label: t("c.progress"), type: "progress", width: 128, status: (r) => r.status === "hold" ? "hold" : r.progress >= 100 ? "done" : "run" },
    { key: "priority", label: t("c.priority"), width: 76, align: "center", render: (r) => h("span", { class: "mes-prio mes-prio-" + r.priority, text: "P" + r.priority }) },
    { key: "start", label: t("c.start"), type: "date", width: 118 },
    { key: "end", label: t("c.end"), type: "date", width: 118 },
    { key: "routing", label: t("c.routing"), type: "code", width: 76, hidden: true },
    { key: "planner", label: t("c.planner"), type: "code", width: 90, hidden: true },
  ];
  const detailBody = h("div", { class: "mes-detail" });
  const g = ui.grid(cols, { rowKey: "id", selection: "multi", totals: true, layoutKey: "EXE3010", idleText: t("hint.inquiry"),
    rowStatus: (r) => (r.status === "hold" ? "hold" : r.status === "run" ? "run" : null),
    onSelect: (sel) => { drawDetail(sel[sel.length - 1]); actions(sel); }, onOpen: (r) => drawDetail(r) });

  const act = {
    release: ui.button({ label: t("act.release"), icon: "play", disabled: true, onClick: () => change("released") }),
    hold: ui.button({ label: t("act.hold"), icon: "lock", disabled: true, onClick: () => change("hold") }),
    close: ui.button({ label: t("act.close_wo"), icon: "check", disabled: true, onClick: () => change("closed") }),
  };
  function actions(sel) {
    act.release.disabled = !sel.length || !sel.every((r) => r.status === "planned");
    act.hold.disabled = !sel.length || !sel.every((r) => r.status === "run" || r.status === "released");
    act.close.disabled = !sel.length || !sel.every((r) => r.status === "done");
  }
  async function change(to) {
    const sel = g.selected();
    const ok = await ui.confirm({ title: t("act.confirm_title", { action: statusLabel(to) }), text: t("act.confirm_text", { n: sel.length }), okLabel: statusLabel(to), danger: to === "hold" });
    if (!ok) return;
    sel.forEach((r) => { r.status = to; });
    g.setRows(g.rows(), { keepSelection: true });
    ui.toast({ kind: "ok", title: t("act.done", { n: sel.length }), text: t("sample.nothing_saved"), keep: true });
  }

  const sc = ui.screen({
    code: "EXE3010", title: t("scr.EXE3010"), path: [t("m.production"), t("m.work_orders")], shell,
    toolbar: [ui.button({ label: t("act.new_wo"), icon: "plus", onClick: () => newWorkOrder() }), ui.sep(), act.release, act.hold, act.close,
      ui.sep(), ui.button({ label: t("act.unit_history"), icon: "history", kind: "ghost", onClick: () => ui.toast({ kind: "info", text: "EXE3020 · " + t("planned_screen") }) })],
    standard: { inquiry: () => inquiry(), inquiryLabel: t("inquiry"), reset: () => { cond.reset(); g.setIdle(); sc.result({}); }, resetLabel: t("reset"),
      export: () => g.exportCSV("EXE3010-work-orders"), exportLabel: t("export"), columns: () => g.columnsDialog(), print: () => print(), printLabel: t("print") },
    conditions: cond, grid: g, detail: detailBody, headExtra: sampleNote(),
  });
  drawDetail(null);

  async function inquiry() {
    const missing = cond.missing();
    if (missing.length) { ui.toast({ kind: "warn", title: t("required"), text: ui.kitText("required_missing", { fields: missing.join(", ") }) }); return; }
    const v = cond.values(), t0 = performance.now();
    g.setLoading(t("loading.wo"));
    const rows = await source.workOrders({ area: v.area, line: v.line, status: v.status, shift: v.shift, from: v.days[0], to: v.days[1], item: v.item, wo: v.wo });
    g.setEmptyText(t("empty.wo"));
    g.setRows(rows);
    sc.result({ chips: cond.chips(), ms: Math.round(performance.now() - t0) });
    if (rows.length) g.select(rows[0].id);
  }

  function drawDetail(r) {
    if (!r) { ui.clear(detailBody, ui.empty({ icon: "clipboard", title: t("detail.none"), text: t("detail.none_help") })); return; }
    const head = h("div", { class: "mes-detail-head" },
      h("div", { class: "mes-detail-title" }, h("span", { class: "mes-detail-code" }, ui.ltr(r.code)), ui.statusChip(r.status === "hold" ? "hold" : r.status, statusLabel(r.status))),
      h("div", { class: "mes-detail-sub", text: r.item + " · " + r.itemName }),
      h("div", { class: "mes-detail-bar" }, ui.progress(r.good, r.planned, { label: ui.fmtNumber(r.good) + " / " + ui.fmtNumber(r.planned), status: r.status === "hold" ? "hold" : "run" })),
      h("div", { class: "mes-mini-kpis" }, [["c.good", r.good, "ok"], ["c.scrap", r.scrap, "bad"], ["c.rework", r.rework, "warn"], ["c.remaining", r.remaining, "neutral"]].map(([k, v, cls]) =>
        h("div", { class: "mes-mini mes-" + cls }, h("span", { text: t(k) }), h("b", {}, ui.ltr(ui.fmtNumber(v)))))));
    const summary = () => ui.props([
      [t("c.line"), ui.ltr(r.line)], [t("c.shift"), r.shift], [t("c.prod_day"), ui.ltr(r.day)], [t("c.routing"), ui.ltr(r.routing)],
      [t("c.start"), r.start ? ui.ltr(r.start) : null], [t("c.end"), r.end ? ui.ltr(r.end) : null], [t("c.priority"), "P" + r.priority], [t("c.planner"), ui.ltr(r.planner)], [t("c.unit"), t("unit.pcs")],
    ], { cols: 1 });
    const ops = () => {
      const og = ui.grid([
        { key: "seq", label: "#", type: "number", width: 44 }, { key: "name", label: t("c.operation"), width: 130 },
        { key: "state", label: t("c.status"), type: "status", width: 96, label_of: (s) => statusLabel(s) }, { key: "good", label: t("c.good"), type: "number", width: 64 }, { key: "scrap", label: t("c.scrap"), type: "number", width: 56 },
      ], { rows: woOperations(r), selection: "none" });
      og.el.classList.add("mes-subgrid");
      return og.el;
    };
    const history = () => h("ol", { class: "mes-timeline" }, woHistory(r).map((e) => h("li", {}, h("span", { class: "mes-tl-dot" }), h("div", {}, h("b", { text: t("ev." + e.kind) }),
      h("span", { class: "eco-muted" }, ui.ltr(e.at), " · ", ui.ltr(e.by))))));
    ui.clear(detailBody, head, ui.tabs([
      { id: "sum", label: t("tab.summary"), icon: "info", render: summary },
      { id: "ops", label: t("tab.operations"), icon: "layers", render: ops },
      { id: "his", label: t("tab.history"), icon: "history", render: history },
    ]));
  }

  function newWorkOrder() {
    const item = ui.select({ options: [["", "—"]].concat([["FG-10400", "FG-10400 · Storage box 40 L"], ["FG-20310", "FG-20310 · Washer tub assembly"], ["FG-30100", "FG-30100 · Box 40 L, carton of 6"]]) });
    const qty = ui.input({ type: "number", value: "480" }), line = ui.select({ options: allLines.map((l) => [l.code, l.code]) }), dayI = ui.input({ type: "date", value: TODAY });
    const shiftS = ui.segmented({ options: [["A", "A"], ["B", "B"], ["C", "C"]], value: "A" });
    const err = h("div");
    const form = h("div", { class: "eco-form" },
      ui.field(t("f.item"), item, { required: true, span: 2 }), ui.field(t("c.planned"), qty, { required: true, hint: t("hint.qty_exact") }), ui.field(t("f.line"), line, { required: true }),
      ui.field(t("c.prod_day"), dayI, { required: true }), ui.field(t("f.shift"), shiftS), err);
    ui.dialog({ title: t("act.new_wo"), subtitle: "EXE2010", icon: "clipboard", width: 560, body: form, actions: [
      { label: t("cancel"), kind: "ghost", value: false },
      { label: t("act.create"), kind: "primary", icon: "check", onClick: () => {
        if (!item.value || !(Number(qty.value) > 0) || !Number.isInteger(Number(qty.value))) { ui.clear(err, ui.banner("bad", t("err.wo_fields"))); return false; }
        ui.toast({ kind: "ok", title: t("act.created"), text: t("sample.nothing_saved"), keep: true });
      } }] });
  }

  return { el: sc.el, onActivate: () => {} };
}
function shiftDay(n) { const d = new Date(TODAY); d.setDate(d.getDate() + n); return ui.isoDate(d); }
