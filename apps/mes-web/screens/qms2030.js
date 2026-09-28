// QMS2030 Repair — the units a test failed, oldest first: the defect, where it failed, how many times. The repairer
// records the cause and the action (the plant's codes) and, when a key part was changed, the old and the new serial.
// The unit then goes back to the test it failed: a repaired unit is always tested again.
import * as ui from "/eco-ui/eco-ui.js";
import { api, can, commandId, name, showError, stamp, t } from "../common.js";
import { inquiryScreen, lineOptions, routeStrip } from "../views.js";

const { h } = ui;

export default function create({ shell }) {
  let current = null, codes = { cause: [], action: [] };
  const lineField = { key: "line", label: t("f.line"), type: "select", options: [], placeholder: t("all") };
  const repBtn = ui.button({ label: t("rep.record"), icon: "wrench", kind: "primary", disabled: true, onClick: () => repair(current) });
  const scrapBtn = ui.button({ label: t("st.scrap_unit"), icon: "x", disabled: true, onClick: () => scrap(current) });
  const v = inquiryScreen({ shell, code: "QMS2030", path: [t("g.quality"), t("m.inspection")], rowKey: "serial", auto: true,
    fields: [lineField],
    columns: [
      { key: "serial", label: t("c.serial"), type: "code", width: 150, frozen: true, total: "count" },
      { key: "item_code", label: t("c.item"), type: "code", width: 100 },
      { key: "defect_code", label: t("qms.defect"), type: "code", width: 120 },
      { key: "op_code", label: t("rep.failed_at"), type: "code", width: 80 },
      { key: "failed_at", label: t("c.station"), type: "code", width: 110 },
      { key: "fails", label: t("rep.fails"), type: "number", width: 70 },
      { key: "line_code", label: t("c.line"), type: "code", width: 80 },
      { key: "wo_code", label: t("c.wo"), type: "code", width: 150 },
      { key: "updated_at", label: t("wip.since"), width: 140, value: (r) => stamp(r.updated_at) },
      { key: "held", label: t("wip.held"), width: 60, render: (r) => (r.held ? ui.icon("lock", 13) : "") },
    ],
    load: async (c) => {
      const [q, rc] = await Promise.all([api("GET", "/api/qms/repair-queue" + (c.line ? "?line=" + encodeURIComponent(c.line) : "")), api("GET", "/api/repair-codes")]);
      codes = { cause: rc.filter((x) => x.kind === "cause" && x.active), action: rc.filter((x) => x.kind === "action" && x.active) };
      return q;
    },
    detail: async (r, host) => {
      current = r; repBtn.disabled = scrapBtn.disabled = !can("trk.repair.write") || !!r.held;
      const d = await api("GET", "/api/units/" + encodeURIComponent(r.serial));
      ui.clear(host, h("div", { class: "mes-detail-head" }, h("div", { class: "mes-detail-title" }, h("span", { class: "mes-detail-code" }, ui.ltr(r.serial)), ui.badge(r.defect_code || "?", "bad")),
        h("div", { class: "mes-detail-sub", text: r.item_code + " · " + name(r) })), routeStrip(d.route),
        ui.section(t("unit.parts"), h("div", { class: "mes-measures" }, d.parts.filter((p) => p.kind !== "lot").map((p) => h("div", {}, h("b", {}, ui.ltr(p.item_code)), h("span", {}, ui.ltr(p.child_serial || p.lot_no)))))),
        ui.section(t("unit.events"), h("ol", { class: "mes-timeline" }, d.events.slice(-8).reverse().map((e) => h("li", {}, h("span", { class: "mes-tl-dot mes-ev-" + e.kind }),
          h("div", {}, h("b", { text: t("uev." + e.kind) + (e.op_code ? " · " + e.op_code : "") + (e.defect_code ? " · " + e.defect_code : "") }), h("span", { class: "eco-muted" }, ui.ltr(stamp(e.occurred_at)))))))));
    },
    toolbar: () => [repBtn, scrapBtn],
  });
  lineOptions().then((opts) => { lineField.options.push(...opts); for (const [a, b] of opts) v.cond.control("line").append(h("option", { value: a, text: b })); });
  async function repair(r) {
    const d = await api("GET", "/api/units/" + encodeURIComponent(r.serial));
    const sel = (list) => (list.length ? ui.select({ options: list.map((c) => [c.code, c.code + " · " + name(c)]) }) : ui.input({ dir: "ltr" }));
    const cause = sel(codes.cause), action = sel(codes.action);
    const parts = d.parts.filter((p) => p.kind !== "lot");
    const oldP = ui.select({ options: [["", t("rep.no_part")]].concat(parts.map((p) => [p.child_serial || p.lot_no, p.item_code + " · " + (p.child_serial || p.lot_no)])) });
    const newP = ui.input({ dir: "ltr", placeholder: t("rep.new_serial") });
    const err = h("div", { class: "eco-span-2" });
    ui.dialog({ title: t("rep.record") + " · " + r.serial, subtitle: r.defect_code, icon: "wrench", width: 620, body: h("div", { class: "eco-form" },
      ui.field(t("rep.cause"), cause, { required: true }), ui.field(t("rep.action"), action, { required: true }), ui.field(t("rep.replaced"), oldP), ui.field(t("rep.new_part"), newP),
      h("p", { class: "eco-span-2 eco-muted", text: t("rep.back_to_test", { op: r.op_code }) }), err),
    actions: [{ label: t("cancel"), kind: "ghost", value: false }, { label: t("save"), kind: "primary", icon: "save", onClick: async () => {
      try {
        const x = await api("POST", `/api/units/${encodeURIComponent(r.serial)}/repair`, { commandId: commandId(), cause: cause.value, action: action.value, defectCode: r.defect_code || undefined,
          ...(oldP.value && newP.value ? { replace: { oldSerial: oldP.value, newSerial: newP.value } } : {}) });
        ui.toast({ kind: "ok", title: t("rep.done", { serial: r.serial, op: x.back_to }) });
      } catch (e) { showError(e, err); return false; }
      v.run();
    } }] });
  }
  async function scrap(r) {
    if (!(await ui.confirm({ title: t("st.scrap_unit") + " · " + r.serial, text: t("rep.scrap_text"), danger: true, okLabel: t("st.scrap_unit") }))) return;
    try { await api("POST", `/api/units/${encodeURIComponent(r.serial)}/scrap`, { commandId: commandId(), reasonCode: "function" }); } catch (e) { showError(e); }
    v.run();
  }
  return { el: v.el };
}
