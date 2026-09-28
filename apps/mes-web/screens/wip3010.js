// WIP3010 WIP map — for every running work order, how many units wait at each operation of its route, how many are in
// repair and how many are held by quality, and the oldest of them. Read from the units themselves, not from counters.
import * as ui from "/eco-ui/eco-ui.js";
import { api, name, stamp, t } from "../common.js";
import { lineOptions } from "../views.js";

const { h } = ui;

export default function create({ shell }) {
  let line = "";
  const lineSel = ui.select({ options: [["", t("all")]], onChange: (v) => { line = v; load(); } });
  const host = h("div", { class: "mes-wip" });
  const sc = ui.screen({ code: "WIP3010", title: t("scr.WIP3010"), path: [t("m.production"), t("m.wip")], shell,
    toolbar: [ui.field(t("f.line"), lineSel)], standard: { inquiry: () => load(), inquiryLabel: t("refresh") }, body: host });
  const age = (iso) => Math.round((Date.now() - Date.parse(iso)) / 60000);
  async function load() {
    let rows;
    try { rows = await api("GET", "/api/wip" + (line ? "?line=" + encodeURIComponent(line) : "")); } catch (e) { ui.clear(host, ui.banner("bad", e.message)); return; }
    if (!rows.length) { ui.clear(host, ui.empty({ icon: "dashboard", title: t("wip.empty"), text: t("wip.empty_help") })); return; }
    const totals = rows.reduce((a, o) => { for (const c of Object.values(o.at)) { a.q += c.queued; a.r += c.repair; a.h += c.held; } return a; }, { q: 0, r: 0, h: 0 });
    ui.clear(host,
      ui.kpiStrip([{ label: t("wip.in_process"), value: ui.fmtNumber(totals.q), icon: "activity" }, { label: t("wip.in_repair"), value: ui.fmtNumber(totals.r), icon: "wrench", tone: totals.r ? "warn" : null },
        { label: t("wip.held"), value: ui.fmtNumber(totals.h), icon: "lock", tone: totals.h ? "bad" : null }, { label: t("wip.orders"), value: String(rows.length), icon: "clipboard" }]),
      rows.map((o) => h("section", { class: "mes-wip-order" },
        h("header", {}, h("b", {}, ui.ltr(o.code)), h("span", { class: "eco-badge eco-badge-neutral" }, ui.ltr(o.line || "—")), h("span", { text: o.item.code + " · " + name(o.item) }), h("span", { class: "eco-grow" }),
          ui.progress(o.completed, o.planned, { label: ui.fmtNumber(o.completed) + " / " + ui.fmtNumber(o.planned) })),
        h("div", { class: "mes-wip-route" }, o.route.map((op) => {
          const c = o.at[op.code] || { queued: 0, repair: 0, held: 0 };
          const n = c.queued + c.repair + c.held;
          return h("div", { class: "mes-wip-op" + (n ? " has" : "") + (c.held ? " is-held" : c.repair ? " is-repair" : ""), title: c.oldest ? t("wip.oldest") + " " + stamp(c.oldest) : "" },
            h("small", {}, ui.ltr(op.code)), h("span", { class: "mes-wip-name", text: name(op) }), h("b", {}, ui.ltr(ui.fmtNumber(c.queued))),
            c.repair ? h("span", { class: "mes-wip-tag is-repair" }, ui.icon("wrench", 11), ui.ltr(String(c.repair))) : null,
            c.held ? h("span", { class: "mes-wip-tag is-held" }, ui.icon("lock", 11), ui.ltr(String(c.held))) : null,
            c.oldest && n ? h("span", { class: "mes-wip-age" }, ui.ltr(age(c.oldest) + " " + t("bd.min"))) : null);
        })))));
  }
  lineOptions().then((opts) => { for (const [v, l] of opts) lineSel.append(h("option", { value: v, text: l })); });
  load();
  const timer = setInterval(load, 60000);
  return { el: sc.el, onClose: () => clearInterval(timer) };
}
