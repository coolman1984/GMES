// TRC3010 Trace backward — what a product was made of: every part with its own serial (and ITS parts), every material
// lot, at which operation and station, when, on which work order and line. Answers "what is inside this TV?".
import * as ui from "/eco-ui/eco-ui.js";
import { api, name, stamp, t } from "../common.js";
import { routeStrip, unitChip } from "../views.js";

const { h } = ui;

export default function create({ shell }) {
  const input = ui.input({ placeholder: t("ph.serial"), dir: "ltr", onEnter: () => show() });
  const host = h("div", { class: "mes-unit" }, ui.empty({ icon: "link", title: t("trc.back_title"), text: t("trc.back_help") }));
  const sc = ui.screen({ code: "TRC3010", title: t("scr.TRC3010"), path: [t("g.trace"), t("m.genealogy")], shell,
    toolbar: [h("div", { class: "mes-serial-box" }, ui.icon("scan", 16), input), ui.button({ label: t("inquiry"), icon: "search", kind: "primary", onClick: () => show() })], body: host });
  const node = (p) => ({ id: (p.serial || p.lot) + p.op + p.at, label: `${t("gen." + p.kind)} · ${p.item.code} · ${p.serial || p.lot}`, icon: p.kind === "unit" ? "cpu" : p.kind === "part" ? "tag" : "box",
    badge: p.op, children: (p.parts || []).map(node), raw: p });
  async function show() {
    const serial = input.value.trim();
    if (!serial) return;
    let d;
    try { d = await api("GET", "/api/trace/backward/" + encodeURIComponent(serial)); } catch (e) { ui.clear(host, ui.empty({ icon: "alert", title: e.message })); return; }
    const info = h("div", { class: "mes-trace-info" }, ui.empty({ icon: "info", title: t("trc.pick_part") }));
    const flat = [];
    const walk = (list) => { for (const p of list) { flat.push(p); walk(p.parts || []); } };
    walk(d.parts);
    const tree = ui.tree(d.parts.map(node), { expanded: flat.map((p) => (p.serial || p.lot) + p.op + p.at), onSelect: (n) => {
      const p = n.raw;
      ui.clear(info, ui.props([[t("c.type"), t("gen." + p.kind)], [t("c.item"), p.item.code + " · " + name(p.item)], [t("unit.serial_or_lot"), ui.ltr(p.serial || p.lot)], [t("c.qty"), ui.ltr(p.qty)],
        [t("c.op"), ui.ltr(p.op)], [t("c.station"), ui.ltr(p.station)], [t("c.time"), ui.ltr(stamp(p.at))], [t("unit.verified"), p.verified ? t("yes") : t("no")],
        [t("c.wo"), p.work_order ? ui.ltr(p.work_order.code + " · " + p.work_order.line + " · " + p.work_order.date) : null]]));
    } });
    const u = d.unit;
    ui.clear(host,
      h("div", { class: "mes-unit-head" }, h("div", {}, h("div", { class: "mes-unit-serial" }, ui.ltr(u.serial)), h("div", { class: "mes-detail-sub", text: u.item.code + " · " + name(u.item) })),
        unitChip(u.status), h("span", { class: "eco-grow" }), ui.props([[t("c.wo"), ui.ltr(u.work_order.code)], [t("c.line"), ui.ltr(u.line_code)], [t("unit.completed_at"), u.completed_at ? ui.ltr(stamp(u.completed_at)) : null]], { cols: 1 })),
      d.route.length ? routeStrip(d.route) : null,
      d.parts.length ? ui.split(h("div", { class: "mes-tree-host" }, tree), info, { key: "TRC3010", initial: 460 }) : ui.empty({ icon: "layers", title: t("trc.no_parts") }));
  }
  return { el: sc.el, onActivate: () => setTimeout(() => input.focus(), 30) };
}
