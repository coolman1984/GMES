// The start page: the plant at a glance (from the ledger and the stoppage facts) and the way into every screen.
import * as ui from "/eco-ui/eco-ui.js";
import { api, can, name, session, showError, statusLabel, t, today, stopName } from "../common.js";

const { h } = ui;

export default function create({ shell }) {
  const me = session().user;
  const kpis = h("div", { class: "hm-kpis" });
  const linesHost = h("div", { class: "hm-lines" });
  const lineCard = (l) => h("button", { type: "button", class: "hm-line hm-" + l.state, onclick: () => { ui.prefs.set("board:line", l.code); shell.open("DSH5010"); } },
    h("div", { class: "hm-line-top" }, h("b", {}, ui.ltr(l.code)), ui.statusChip(l.state, statusLabel(l.state))),
    h("div", { class: "hm-line-wo" }, l.workOrder ? [ui.ltr(l.workOrder.code), h("span", { class: "eco-muted", text: " · " + name(l.workOrder.item) })]
      : h("span", { class: "eco-muted", text: l.stop ? stopName(l.stop.reason) : t("hm.no_wo") })),
    l.workOrder ? ui.progress(l.workOrder.completed, l.workOrder.planned, { status: l.state === "down" ? "down" : "run" }) : h("div", { class: "hm-line-empty" }));
  const quick = (code, ic) => h("button", { type: "button", class: "hm-quick", onclick: () => shell.open(code) }, h("span", { class: "hm-quick-ic" }, ui.icon(ic, 18)),
    h("div", {}, h("b", { text: t("scr." + code) }), h("span", {}, ui.ltr(code))));
  const starts = [["EXE3010", "clipboard", "exe.orders.read"], ["EXE2020", "tablet", "exe.orders.write"], ["MDM1010", "sitemap", "mdm.plant.read"], ["MDM1020", "box", "mdm.items.read"],
    ["SYS9010", "users", "sys.users.read"], ["DSH5010", "monitor", "exe.orders.read"]].filter(([, , s]) => can(s));

  const el = h("div", { class: "hm" },
    h("div", { class: "hm-head" }, h("div", {}, h("h1", { text: t("hm.title") }), h("span", { class: "eco-muted" }, t("hm.hello", { name: me.name }), " · ", t("st.prod_day"), " ", ui.ltr(today()))),
      h("span", { class: "eco-grow" }), ui.button({ label: t("refresh"), icon: "refresh", kind: "ghost", onClick: () => load() }),
      ui.button({ label: t("scr.EXE3010"), icon: "search", kind: "primary", onClick: () => shell.open("EXE3010") })),
    kpis,
    h("div", { class: "hm-grid" },
      ui.card({ title: t("hm.line_status"), icon: "activity", subtitle: t("hm.line_status_sub"), body: linesHost,
        actions: [ui.button({ label: t("scr.DSH5010"), icon: "monitor", kind: "ghost", size: "sm", onClick: () => shell.open("DSH5010") })] }),
      h("div", { class: "hm-col" },
        ui.card({ title: t("hm.start"), icon: "star", body: h("div", { class: "hm-quicks" }, starts.map(([c, ic]) => quick(c, ic))) }),
        ui.card({ title: t("hm.tips"), icon: "keyboard", body: h("ul", { class: "hm-tips" },
          [["Ctrl K", t("hm.tip_search")], ["F5", t("hm.tip_inquiry")], ["Ctrl E", t("hm.tip_export")], ["Alt 1…9", t("hm.tip_tabs")]].map(([k, v]) => h("li", {}, ui.kbd(k), h("span", { text: v })))) }))));

  async function load() {
    let b;
    try { b = await api("GET", "/api/boards/plant"); } catch (e) { showError(e); return; }
    const running = b.lines.filter((l) => l.state === "run").length, down = b.lines.filter((l) => l.state === "down").length;
    const scrapPct = b.good + b.scrap ? ((b.scrap / (b.good + b.scrap)) * 100).toFixed(1) : "0.0";
    ui.clear(kpis,
      ui.kpi({ label: t("hm.output"), value: ui.fmtNumber(b.good), unit: t("unit.pcs"), icon: "box", delta: b.planned ? Math.round((b.good / b.planned) * 100) + "% " + t("hm.of_plan") : null, deltaKind: "neutral",
        hint: b.planned ? null : t("hm.no_plan_today") }),
      ui.kpi({ label: t("hm.scrap_rate"), value: scrapPct, unit: "%", icon: "x-octagon", hint: ui.fmtNumber(b.scrap) + " " + t("unit.pcs"), status: Number(scrapPct) > 3 ? "down" : "run" }),
      ui.kpi({ label: t("hm.lines"), value: running + " / " + b.lines.length, icon: "activity", delta: down ? down + " " + t("st.down") : t("hm.all_ok"), deltaKind: down ? "bad" : "ok", status: down ? "down" : "run" }),
      ui.kpi({ label: t("hm.open_orders"), value: String(b.openOrders), icon: "clipboard", hint: t("hm.orders_today", { n: b.ordersOfDay }) }),
      ui.kpi({ label: t("hm.downtime"), value: String(b.stoppages.minutesToday), unit: t("bd.min"), icon: "pause", hint: t("hm.open_stops", { n: b.stoppages.open }), status: b.stoppages.open ? "down" : null }));
    ui.clear(linesHost, b.lines.length ? b.lines.map(lineCard) : ui.empty({ icon: "sitemap", title: t("st.no_lines"), text: t("hint.no_lines"),
      action: can("mdm.plant.read") ? ui.button({ label: t("scr.MDM1010"), icon: "sitemap", kind: "primary", onClick: () => shell.open("MDM1010") }) : null }));
  }
  load();
  const timer = setInterval(load, 60000);
  return { el, onClose: () => clearInterval(timer) };
}
