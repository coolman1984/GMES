// EXE2010 Release plan — the planner's view of one production day: every line with its capacity per shift, the work
// orders released on it per shift, the load against capacity, and the routing / BOM revision each order was frozen with.
// New orders are released from here onto a line and shift; the engineering in force is frozen into the order.
import * as ui from "/eco-ui/eco-ui.js";
import { api, can, commandId, name, num, showError, t, today, woState, statusLabel } from "../common.js";

const { h } = ui;

export default function create({ shell }) {
  let day = today();
  const dayIn = ui.input({ type: "date", value: day, width: "160px" });
  dayIn.addEventListener("change", () => { day = dayIn.value || today(); load(); });
  const host = h("div", { class: "mes-plan" });
  const sc = ui.screen({ code: "EXE2010", title: t("scr.EXE2010"), path: [t("m.production"), t("m.work_orders")], shell,
    toolbar: [ui.button({ icon: "chev-left", kind: "ghost", title: t("pr.yesterday"), onClick: () => move(-1) }), dayIn, ui.button({ icon: "chev-right", kind: "ghost", title: t("plan.next_day"), onClick: () => move(1) }),
      ui.sep(), ui.button({ label: t("act.new_wo"), icon: "plus", kind: "primary", disabled: !can("exe.orders.write"), onClick: () => release(null, null) })],
    standard: { inquiry: () => load(), inquiryLabel: t("refresh") }, body: host });
  function move(n) { const d = new Date(day + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); day = d.toISOString().slice(0, 10); dayIn.value = day; load(); }
  let lines = [], items = [], whs = [], shifts = [];
  async function load() {
    let orders;
    try {
      const [plant, o, cal] = await Promise.all([api("GET", "/api/plant"), api("GET", "/api/work-orders?" + new URLSearchParams({ from: day, to: day })), api("GET", "/api/production-calendar")]);
      lines = plant.filter((n) => n.type === "line" && n.active);
      orders = o;
      shifts = cal.shifts.filter((s) => s.active).map((s) => s.code);
      if (!shifts.length) shifts = ["A", "B", "C"];
    } catch (e) { ui.clear(host, ui.banner("bad", e.message)); return; }
    const byLine = new Map(lines.map((l) => [l.code, []]));
    const loose = [];
    for (const o of orders) (byLine.get(o.line_code) || loose).push(o);
    const planned = orders.reduce((a, o) => a + num(o.planned_qty), 0), good = orders.reduce((a, o) => a + num(o.completed_qty), 0);
    const cap = lines.reduce((a, l) => a + (l.capacity_per_shift || 0) * shifts.length, 0);
    ui.clear(host,
      ui.kpiStrip([{ label: t("plan.orders"), value: String(orders.length), icon: "clipboard" }, { label: t("c.planned"), value: ui.fmtNumber(planned), icon: "flag" },
        { label: t("c.good"), value: ui.fmtNumber(good), icon: "check" }, { label: t("plan.load"), value: cap ? Math.round((planned / cap) * 100) + "%" : "—", icon: "gauge" }]),
      h("div", { class: "mes-plan-grid", style: { "--shifts": String(shifts.length) } },
        h("div", { class: "mes-plan-hd" }, h("span", { text: t("c.line") }), shifts.map((s) => h("span", { text: t("c.shift") + " " + s }))),
        lines.map((l) => {
          const os = byLine.get(l.code);
          return h("div", { class: "mes-plan-row" },
            h("div", { class: "mes-plan-line" }, h("b", {}, ui.ltr(l.code)), h("small", { text: name(l) }), l.capacity_per_shift ? h("small", { class: "eco-muted" }, ui.ltr(ui.fmtNumber(l.capacity_per_shift)), " / " + t("mdm.per_shift")) : null),
            shifts.map((s) => {
              const here = os.filter((o) => (o.shift_code || shifts[0]) === s);
              const q = here.reduce((a, o) => a + num(o.planned_qty), 0);
              const pct = l.capacity_per_shift ? Math.round((q / l.capacity_per_shift) * 100) : null;
              return h("div", { class: "mes-plan-cell" + (pct !== null && pct > 100 ? " is-over" : "") },
                here.map((o) => h("div", { class: "mes-plan-wo", title: o.item.code + " · " + name(o.item) },
                  ui.statusChip(woState(o), statusLabel(woState(o))), h("b", {}, ui.ltr(o.item.code)), h("span", {}, ui.ltr(ui.fmtNumber(num(o.completed_qty)) + " / " + ui.fmtNumber(num(o.planned_qty)))),
                  o.routing_id ? ui.badge(t("plan.serial_flow"), "accent") : null)),
                pct !== null && q ? h("div", { class: "mes-plan-load" }, ui.progress(q, l.capacity_per_shift, { label: pct + "%", status: pct > 100 ? "down" : "run" })) : null,
                can("exe.orders.write") ? ui.button({ icon: "plus", kind: "ghost", size: "sm", title: t("act.new_wo"), onClick: () => release(l.code, s) }) : null);
            }));
        })),
      loose.length ? ui.banner("warn", t("plan.no_line", { n: loose.length })) : null);
  }
  async function release(line, shift) {
    try { if (!items.length) [items, whs] = await Promise.all([api("GET", "/api/items"), api("GET", "/api/warehouses")]); } catch (e) { showError(e); return; }
    const prods = items.filter((i) => i.active && i.kind === "product");
    const item = ui.select({ options: [["", "—"]].concat(prods.map((i) => [i.id, i.code + " · " + name(i)])) });
    const qty = ui.input({ type: "number", min: "1", step: "1" });
    const lineS = ui.select({ options: lines.map((l) => [l.code, l.code + " · " + name(l)]), value: line || (lines[0] || {}).code });
    const shiftS = ui.select({ options: shifts.map((s) => [s, s]), value: shift || shifts[0] });
    const wh = ui.select({ options: whs.filter((w) => w.active).map((w) => [w.id, w.code + " · " + name(w)]), value: ((whs.find((w) => w.is_default) || whs[0]) || {}).id });
    const prio = ui.select({ options: [["1", "P1"], ["2", "P2"], ["3", "P3"]], value: "2" });
    const eng = h("div", { class: "eco-span-2" });
    item.addEventListener("change", async () => {
      if (!item.value) { ui.clear(eng); return; }
      try {
        const [r, b] = await Promise.all([api("GET", "/api/routings?status=approved"), api("GET", "/api/boms?status=approved")]);
        const ri = r.find((x) => x.item_id === item.value), bi = b.find((x) => x.item_id === item.value);
        ui.clear(eng, ui.banner(ri ? "info" : "warn", ri ? t("plan.frozen_with", { r: ri.revision, b: bi ? "R" + bi.revision : "—" }) : t("plan.no_routing")));
      } catch (_) { ui.clear(eng); }
    });
    const err = h("div", { class: "eco-span-2" });
    ui.dialog({ title: t("act.new_wo"), subtitle: "EXE2010 · " + day, icon: "clipboard", width: 620, body: h("div", { class: "eco-form" },
      ui.field(t("f.item"), item, { required: true, span: 2 }), ui.field(t("c.planned"), qty, { required: true }), ui.field(t("f.line"), lineS, { required: true }),
      ui.field(t("f.shift"), shiftS), ui.field(t("c.priority"), prio), ui.field(t("f.warehouse"), wh, { span: 2 }), eng, err),
    actions: [{ label: t("cancel"), kind: "ghost", value: false }, { label: t("act.create"), kind: "primary", icon: "check", onClick: async () => {
      if (!item.value || !(Number(qty.value) > 0)) { ui.clear(err, ui.banner("bad", t("err.wo_fields"))); return false; }
      try {
        const r = await api("POST", "/api/work-orders", { commandId: commandId(), itemId: item.value, plannedQty: qty.value, warehouseId: wh.value, line: lineS.value, shift: shiftS.value, priority: Number(prio.value), productionDate: day });
        ui.toast({ kind: "ok", title: t("act.created"), text: r.code, keep: true });
      } catch (e) { showError(e, err); return false; }
      load();
    } }] });
  }
  load();
  return { el: sc.el };
}
