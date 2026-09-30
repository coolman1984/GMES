// EXE3010 Work Order Inquiry — the TEMPLATE of every inquiry screen (conditions -> Inquiry -> grid -> details).
// Everything shown is read from the server; every change is a command recorded in the production ledger.
import * as ui from "/eco-ui/eco-ui.js";
import { api, can, commandId, datePresets, dayShift, name, num, showError, stamp, statusLabel, t, today, woState } from "../common.js";

const { h } = ui;
const STATES = ["released", "run", "done", "closed"];

export default function create({ shell }) {
  const lineField = { key: "line", label: t("f.line"), type: "select", options: [], placeholder: t("all") };  // filled from the plant model
  const cond = ui.conditionPanel([
    { key: "days", label: t("f.prod_day"), type: "daterange", required: true, default: [dayShift(-6), today()], span: 2, presets: datePresets(), presetsLabel: t("presets") },
    lineField,
    { key: "status", label: t("f.status"), type: "select", options: STATES.map((s) => [s, statusLabel(s)]), placeholder: t("all") },
    { key: "shift", label: t("f.shift"), type: "toggle", options: [["all", t("all")], ["A", "A"], ["B", "B"], ["C", "C"]], default: "all" },
    { key: "item", label: t("f.item"), placeholder: t("ph.item") },
    { key: "wo", label: t("f.wo"), placeholder: "WO-…", dir: "ltr" },
  ], { key: "EXE3010", onSubmit: () => inquiry() });
  let lines = [];

  const cols = [
    { key: "state", label: t("c.status"), type: "status", width: 112, frozen: true, label_of: (s) => statusLabel(s) },
    { key: "code", label: t("c.wo"), type: "code", width: 118, frozen: true, total: "count" },
    { key: "itemCode", label: t("c.item"), type: "code", width: 96 },
    { key: "itemName", label: t("c.item_name"), width: 188 },
    { key: "line", label: t("c.line"), type: "code", width: 84 },
    { key: "shift", label: t("c.shift"), width: 64, align: "center" },
    { key: "day", label: t("c.prod_day"), type: "date", width: 110 },
    { key: "planned", label: t("c.planned"), type: "number", width: 84, total: "sum" },
    { key: "good", label: t("c.good"), type: "number", width: 90, total: "sum" },
    { key: "scrap", label: t("c.scrap"), type: "number", width: 72, total: "sum", render: (r) => r.scrap ? h("span", { class: "mes-bad", text: ui.fmtNumber(r.scrap) }) : "0" },
    { key: "remaining", label: t("c.remaining"), type: "number", width: 90, total: "sum" },
    { key: "progress", label: t("c.progress"), type: "progress", width: 128, status: (r) => r.progress >= 100 ? "done" : "run" },
    { key: "priority", label: t("c.priority"), width: 76, align: "center", render: (r) => h("span", { class: "mes-prio mes-prio-" + r.priority, text: "P" + r.priority }) },
    { key: "due", label: t("c.due"), type: "date", width: 104, render: (r) => (r.late ? h("span", { class: "mes-bad", text: r.due }) : r.due) },
    { key: "start", label: t("c.start"), type: "date", width: 128 },
    { key: "end", label: t("c.end"), type: "date", width: 128 },
    { key: "uom", label: t("c.unit"), width: 64, hidden: true },
  ];
  const detailBody = h("div", { class: "mes-detail" });
  const g = ui.grid(cols, { rowKey: "id", selection: "multi", totals: true, layoutKey: "EXE3010", idleText: t("hint.inquiry"),
    rowStatus: (r) => (r.state === "run" ? "run" : null),
    onSelect: (sel) => { drawDetail(sel[sel.length - 1]); actions(sel); }, onOpen: (r) => drawDetail(r) });

  const act = {
    close: ui.button({ label: t("act.close_wo"), icon: "check", disabled: true, onClick: () => closeOrders() }),
  };
  function actions(sel) {
    act.close.disabled = !can("exe.orders.write") || !sel.length || !sel.every((r) => r.state !== "closed");
  }
  async function closeOrders() {
    const sel = g.selected();
    const short = sel.filter((r) => r.remaining > 0).length;
    const ok = await ui.confirm({ title: t("act.confirm_title", { action: statusLabel("closed") }), text: t("act.confirm_text", { n: sel.length }) + (short ? " " + t("act.close_short", { n: short }) : ""),
      okLabel: t("act.close_wo"), danger: short > 0 });
    if (!ok) return;
    let done = 0;
    for (const r of sel) {
      try { await api("POST", `/api/work-orders/${r.id}/close`, { commandId: commandId() }); done++; }
      catch (e) { showError(e); }
    }
    if (done) ui.toast({ kind: "ok", title: t("act.done", { n: done }), keep: true });
    await inquiry();
  }

  const sc = ui.screen({
    code: "EXE3010", title: t("scr.EXE3010"), path: [t("m.production"), t("m.work_orders")], shell,
    toolbar: [ui.button({ label: t("act.new_wo"), icon: "plus", disabled: !can("exe.orders.write"), onClick: () => newWorkOrder() }), ui.sep(), act.close],
    standard: { inquiry: () => inquiry(), inquiryLabel: t("inquiry"), reset: () => { cond.reset(); g.setIdle(); sc.result({}); }, resetLabel: t("reset"),
      export: () => g.exportCSV("EXE3010-work-orders"), exportLabel: t("export"), columns: () => g.columnsDialog(), print: () => print(), printLabel: t("print") },
    conditions: cond, grid: g, detail: detailBody,
  });
  drawDetail(null);
  loadLines();

  async function loadLines() {
    try {
      lines = (await api("GET", "/api/plant")).filter((n) => n.type === "line" && n.active);
      const box = cond.control("line");
      for (const l of lines) {
        lineField.options.push([l.code, l.code + " · " + name(l)]);  // the chips read their labels from here
        box.append(h("option", { value: l.code, text: l.code + " · " + name(l) }));
      }
    } catch (e) { showError(e); }
  }

  function toRow(w) {
    const planned = num(w.planned_qty), good = num(w.completed_qty), scrap = num(w.scrapped_qty);
    return { id: w.id, code: w.code, state: woState(w), status: w.status, itemCode: w.item.code, itemName: name(w.item), uom: w.item.uom, tracking: w.item.tracking,
      line: w.line_code || "", shift: w.shift_code || "", day: w.production_date, planned, good, scrap, remaining: num(w.open_qty),
      progress: planned ? Math.round((good / planned) * 1000) / 10 : 0, priority: w.priority || 2, due: w.due_date || "", late: !!(w.due_date && w.status === "released" && w.due_date < today()), start: stamp(w.first_at),
      end: w.status === "released" ? "" : stamp(w.last_at), raw: w };
  }

  async function inquiry() {
    const missing = cond.missing();
    if (missing.length) { ui.toast({ kind: "warn", title: t("required"), text: ui.kitText("required_missing", { fields: missing.join(", ") }) }); return; }
    const v = cond.values(), t0 = performance.now();
    g.setLoading(t("loading.wo"));
    const q = new URLSearchParams({ from: v.days[0], to: v.days[1] });
    if (v.line) q.set("line", v.line);
    if (v.status === "closed") q.set("status", "closed");
    else if (v.status === "done") q.set("status", "completed");
    else if (v.status === "released" || v.status === "run") q.set("status", "released");
    if (v.shift && v.shift !== "all") q.set("shift", v.shift);
    if (v.item) q.set("item", v.item);
    if (v.wo) q.set("code", v.wo);
    let rows;
    try { rows = (await api("GET", "/api/work-orders?" + q)).map(toRow); }
    catch (e) { g.setEmptyText(e.message); g.setRows([]); showError(e); return; }
    if (v.status === "released" || v.status === "run") rows = rows.filter((r) => r.state === v.status);
    g.setEmptyText(t("empty.wo"));
    g.setRows(rows);
    sc.result({ chips: cond.chips(), ms: Math.round(performance.now() - t0) });
    if (rows.length) g.select(rows[0].id);
  }

  async function drawDetail(r) {
    if (!r) { ui.clear(detailBody, ui.empty({ icon: "clipboard", title: t("detail.none"), text: t("detail.none_help") })); return; }
    const head = h("div", { class: "mes-detail-head" },
      h("div", { class: "mes-detail-title" }, h("span", { class: "mes-detail-code" }, ui.ltr(r.code)), ui.statusChip(r.state, statusLabel(r.state))),
      h("div", { class: "mes-detail-sub", text: r.itemCode + " · " + r.itemName }),
      h("div", { class: "mes-detail-bar" }, ui.progress(r.good, r.planned, { label: ui.fmtNumber(r.good) + " / " + ui.fmtNumber(r.planned), status: "run" })),
      h("div", { class: "mes-mini-kpis" }, [["c.good", r.good, "ok"], ["c.scrap", r.scrap, "bad"], ["c.planned", r.planned, "neutral"], ["c.remaining", r.remaining, "neutral"]].map(([k, v, cls]) =>
        h("div", { class: "mes-mini mes-" + cls }, h("span", { text: t(k) }), h("b", {}, ui.ltr(ui.fmtNumber(v)))))));
    const summary = () => ui.props([
      [t("c.line"), r.line ? ui.ltr(r.line) : null], [t("c.shift"), r.shift || null], [t("c.prod_day"), ui.ltr(r.day)], [t("c.priority"), "P" + r.priority],
      [t("c.start"), r.start ? ui.ltr(r.start) : null], [t("c.end"), r.end ? ui.ltr(r.end) : null], [t("c.unit"), ui.ltr(r.uom)], [t("c.tracking"), t("trk." + r.tracking)],
    ], { cols: 1 });
    const historyHost = h("div", {}, ui.empty({ icon: "history", title: ui.kitText("loading") }));
    const history = () => historyHost;
    ui.clear(detailBody, head, ui.tabs([
      { id: "sum", label: t("tab.summary"), icon: "info", render: summary },
      { id: "his", label: t("tab.history"), icon: "history", render: history },
    ]));
    try {
      const d = await api("GET", `/api/work-orders/${r.id}`);
      ui.clear(historyHost, d.ledger.length ? h("ol", { class: "mes-timeline" }, d.ledger.slice().reverse().map((e) => h("li", {}, h("span", { class: "mes-tl-dot" }),
        h("div", {}, h("b", { text: t("txn." + e.txn_type) + (e.txn_type === "CLOSE" ? "" : " · " + ui.fmtNumber(num(e.qty))) + (e.reason_code ? " · " + t("scrap." + e.reason_code) : "") }),
          h("span", { class: "eco-muted" }, ui.ltr(stamp(e.occurred_at)), " · ", ui.ltr(e.user_name), e.lot_no ? h("span", {}, " · ", ui.ltr(e.lot_no)) : null)))))
        : ui.empty({ icon: "history", title: t("detail.no_history") }));
    } catch (e) { ui.clear(historyHost, ui.banner("bad", e.message)); }
  }

  async function newWorkOrder() {
    let items = [], whs = [];
    try { [items, whs] = await Promise.all([api("GET", "/api/items"), api("GET", "/api/warehouses")]); } catch (e) { showError(e); return; }
    items = items.filter((i) => i.active && i.kind === "product");
    whs = whs.filter((w) => w.active);
    if (!items.length || !whs.length) { ui.toast({ kind: "warn", title: t("act.new_wo"), text: t("err.no_items"), timeout: 9000 }); return; }
    const item = ui.select({ options: [["", "—"]].concat(items.map((i) => [i.id, i.code + " · " + name(i)])) });
    const qty = ui.input({ type: "number", value: "", min: "1", step: "1" });
    const line = ui.select({ options: [["", "—"]].concat(lines.map((l) => [l.code, l.code + " · " + name(l)])) });
    const wh = ui.select({ options: whs.map((w) => [w.id, w.code + " · " + name(w)]), value: (whs.find((w) => w.is_default) || whs[0]).id });
    const dayI = ui.input({ type: "date", value: today() });
    let shiftV = "A", prioV = "2";
    const shiftS = ui.segmented({ options: [["A", "A"], ["B", "B"], ["C", "C"]], value: shiftV, onChange: (v) => { shiftV = v; } });
    const prioS = ui.segmented({ options: [["1", "P1"], ["2", "P2"], ["3", "P3"]], value: prioV, onChange: (v) => { prioV = v; } });
    const err = h("div", { class: "eco-span-2" });
    ui.dialog({ title: t("act.new_wo"), subtitle: "EXE2010", icon: "clipboard", width: 600, body: h("div", { class: "eco-form" },
      ui.field(t("f.item"), item, { required: true, span: 2 }), ui.field(t("c.planned"), qty, { required: true, hint: t("hint.qty_exact") }), ui.field(t("f.line"), line, { hint: lines.length ? null : t("hint.no_lines") }),
      ui.field(t("c.prod_day"), dayI, { required: true }), ui.field(t("f.warehouse"), wh, { required: true }), ui.field(t("f.shift"), shiftS), ui.field(t("c.priority"), prioS), err),
    actions: [
      { label: t("cancel"), kind: "ghost", value: false },
      { label: t("act.create"), kind: "primary", icon: "check", onClick: async () => {
        if (!item.value || !/^\d+(\.\d{1,3})?$/.test(qty.value) || !(Number(qty.value) > 0)) { ui.clear(err, ui.banner("bad", t("err.wo_fields"))); return false; }
        try {
          const r = await api("POST", "/api/work-orders", { commandId: commandId(), itemId: item.value, plannedQty: qty.value, warehouseId: wh.value, line: line.value || undefined,
            productionDate: dayI.value, shift: shiftV, priority: Number(prioV) });
          ui.toast({ kind: "ok", title: t("act.created"), text: r.code, keep: true });
        } catch (e) { showError(e, err); return false; }
        if (!cond.missing().length) inquiry();
      } }] });
  }

  return { el: sc.el, onActivate: () => {} };
}
