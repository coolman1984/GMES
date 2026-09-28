// EXE3020 Unit history — everything a serial went through: its route (done / next / repair), every fact with where,
// when and who, the parts fitted into it and the unit it was fitted into, and where it is now (box, pallet, container).
import * as ui from "/eco-ui/eco-ui.js";
import { api, name, showError, stamp, t } from "../common.js";
import { routeStrip, unitChip } from "../views.js";

const { h } = ui;

export default function create({ shell }) {
  const input = ui.input({ placeholder: t("ph.serial"), dir: "ltr", onEnter: () => show(input.value) });
  const host = h("div", { class: "mes-unit" }, ui.empty({ icon: "scan", title: t("unit.scan_one"), text: t("unit.scan_help") }));
  const sc = ui.screen({ code: "EXE3020", title: t("scr.EXE3020"), path: [t("m.production"), t("m.shop_floor")], shell,
    toolbar: [h("div", { class: "mes-serial-box" }, ui.icon("scan", 16), input), ui.button({ label: t("inquiry"), icon: "search", kind: "primary", onClick: () => show(input.value) })],
    body: host });

  async function show(serial) {
    serial = (serial || "").trim();
    if (!serial) return;
    let d;
    try { d = await api("GET", "/api/units/" + encodeURIComponent(serial)); } catch (e) { ui.clear(host, ui.empty({ icon: "alert", title: e.message })); return; }
    const u = d.unit;
    const partsGrid = ui.grid([
      { key: "kind", label: t("c.type"), width: 110, value: (p) => t("gen." + p.kind) },
      { key: "item_code", label: t("c.item"), type: "code", width: 120 },
      { key: "n", label: t("c.item_name"), width: 200, value: (p) => name(p) },
      { key: "id", label: t("unit.serial_or_lot"), type: "code", width: 150, value: (p) => p.child_serial || p.lot_no },
      { key: "qty", label: t("c.qty"), width: 70, align: "end" },
      { key: "op_code", label: t("c.op"), type: "code", width: 60 },
      { key: "station", label: t("c.station"), type: "code", width: 110 },
      { key: "verified", label: t("unit.verified"), width: 90, render: (p) => (p.verified ? ui.icon("check", 14, "mes-ok") : ui.badge(t("unit.unverified"), "warn")) },
    ], { rows: d.parts, layoutKey: "EXE3020-parts", onOpen: (p) => p.child_serial && show(p.child_serial) });
    const where = u.where || {};
    ui.clear(host,
      h("div", { class: "mes-unit-head" },
        h("div", {}, h("div", { class: "mes-unit-serial" }, ui.ltr(u.serial)), h("div", { class: "mes-detail-sub", text: u.item.code + " · " + name(u.item) })),
        unitChip(u.status), u.held ? ui.badge(t("unit.on_hold"), "bad", "lock") : null, h("span", { class: "eco-grow" }),
        ui.props([[t("c.wo"), ui.ltr(u.work_order.code)], [t("c.line"), ui.ltr(u.line_code)], [t("c.prod_day"), ui.ltr(u.work_order.date)],
          [t("unit.fitted_into"), u.parent ? h("a", { href: "#", onclick: (ev) => { ev.preventDefault(); show(u.parent); } }, ui.ltr(u.parent)) : null],
          [t("shp.box"), where.box ? ui.ltr(where.box) : null], [t("shp.pallet"), where.pallet ? ui.ltr(where.pallet) : null], [t("shp.container"), where.container ? ui.ltr(where.container) : null]], { cols: 2 })),
      d.route.length ? routeStrip(d.route) : null,
      ui.tabs([
        { id: "ev", label: t("unit.events"), icon: "history", count: d.events.length, render: () => h("ol", { class: "mes-timeline" }, d.events.slice().reverse().map((e) => h("li", {}, h("span", { class: "mes-tl-dot mes-ev-" + e.kind }),
          h("div", {}, h("b", { text: t("uev." + e.kind) + (e.op_code ? " · " + e.op_code : "") + (e.defect_code ? " · " + e.defect_code : "") }),
            h("span", { class: "eco-muted" }, ui.ltr(stamp(e.occurred_at)), " · ", ui.ltr(e.station || "—"), " · ", ui.ltr(e.user_name),
              e.detail && (e.detail.part || e.detail.cause) ? h("span", {}, " · ", ui.ltr(e.detail.part || (e.detail.cause + " → " + e.detail.action))) : null))))) },
        { id: "parts", label: t("unit.parts"), icon: "layers", count: d.parts.length, render: () => h("div", { class: "mes-subgrid" }, partsGrid.el) },
      ]));
  }
  return { el: sc.el, onActivate: () => setTimeout(() => input.focus(), 30) };
}
