// The start page: the plant at a glance and the way into every screen (favourites, recent, the most used).
import * as ui from "/eco-ui/eco-ui.js";
import { lines, workOrders, TODAY } from "../data.js";
import { t, statusLabel, sampleNote } from "../common.js";

const { h } = ui;

export default function create({ shell }) {
  const today = workOrders.filter((w) => w.day === TODAY);
  const good = today.reduce((a, w) => a + w.good, 0), scrap = today.reduce((a, w) => a + w.scrap, 0), plan = today.reduce((a, w) => a + w.planned, 0);
  const all = lines(), running = all.filter((l) => l.state === "run").length, down = all.filter((l) => l.state === "down").length;
  const holds = workOrders.filter((w) => w.status === "hold").length;
  const lineCard = (l) => {
    const wo = workOrders.find((w) => w.line === l.code && (w.status === "run" || w.status === "hold"));
    return h("button", { type: "button", class: "hm-line hm-" + l.state, onclick: () => shell.open("DSH5010") },
      h("div", { class: "hm-line-top" }, h("b", {}, ui.ltr(l.code)), ui.statusChip(l.state, statusLabel(l.state))),
      h("div", { class: "hm-line-wo" }, wo ? [ui.ltr(wo.code), h("span", { class: "eco-muted", text: " · " + wo.itemName })] : h("span", { class: "eco-muted", text: t("hm.no_wo") })),
      wo ? ui.progress(wo.good, wo.planned, { status: l.state === "down" ? "down" : "run" }) : h("div", { class: "hm-line-empty" }));
  };
  const quick = (code, ic) => h("button", { type: "button", class: "hm-quick", onclick: () => shell.open(code) }, h("span", { class: "hm-quick-ic" }, ui.icon(ic, 18)),
    h("div", {}, h("b", { text: t("scr." + code) }), h("span", {}, ui.ltr(code))));
  const el = h("div", { class: "hm" },
    h("div", { class: "hm-head" }, h("div", {}, h("h1", { text: t("hm.title") }), h("span", { class: "eco-muted" }, t("hm.sub"), " · ", ui.ltr(TODAY), " · ", t("f.shift"), " A")), h("span", { class: "eco-grow" }), sampleNote(),
      ui.button({ label: t("scr.EXE3010"), icon: "search", kind: "primary", onClick: () => shell.open("EXE3010") })),
    h("div", { class: "hm-kpis" },
      ui.kpi({ label: t("hm.output"), value: ui.fmtNumber(good), unit: t("unit.pcs"), icon: "box", delta: Math.round((good / Math.max(1, plan)) * 100) + "% " + t("hm.of_plan"), deltaKind: "neutral", spark: [12, 18, 15, 22, 26, 24, 31] }),
      ui.kpi({ label: t("bd.oee"), value: "72.8", unit: "%", icon: "gauge", delta: "+1.6", deltaKind: "ok", hint: t("hm.vs_yesterday"), spark: [68, 70, 69, 71, 70, 72, 73], status: "run" }),
      ui.kpi({ label: t("hm.scrap_rate"), value: ((scrap / Math.max(1, good + scrap)) * 100).toFixed(1), unit: "%", icon: "x-octagon", delta: "−0.3", deltaKind: "ok", hint: t("hm.vs_yesterday"), status: "down" }),
      ui.kpi({ label: t("hm.lines"), value: running + " / " + all.length, icon: "activity", delta: down ? down + " " + t("st.down") : t("hm.all_ok"), deltaKind: down ? "bad" : "ok", status: "run" }),
      ui.kpi({ label: t("hm.holds"), value: String(holds), icon: "lock", hint: t("hm.holds_hint"), status: "hold" })),
    h("div", { class: "hm-grid" },
      ui.card({ title: t("hm.line_status"), icon: "activity", subtitle: t("hm.line_status_sub"), body: h("div", { class: "hm-lines" }, all.map(lineCard)),
        actions: [ui.button({ label: t("scr.DSH5010"), icon: "monitor", kind: "ghost", size: "sm", onClick: () => shell.open("DSH5010") })] }),
      h("div", { class: "hm-col" },
        ui.card({ title: t("hm.start"), icon: "star", body: h("div", { class: "hm-quicks" }, quick("EXE3010", "clipboard"), quick("EXE2020", "tablet"), quick("MDM1010", "sitemap"), quick("SYS9010", "users"), quick("DSH5010", "monitor")) }),
        ui.card({ title: t("hm.tips"), icon: "keyboard", body: h("ul", { class: "hm-tips" },
          [["Ctrl K", t("hm.tip_search")], ["F5", t("hm.tip_inquiry")], ["Ctrl E", t("hm.tip_export")], ["Alt 1…9", t("hm.tip_tabs")]].map(([k, v]) => h("li", {}, ui.kbd(k), h("span", { text: v })))) }))));
  return { el };
}
