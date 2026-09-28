// QMS4010 Quality analysis — first-pass yield of every test and inspection per line (and the rolled throughput yield:
// the share of units that passed EVERY operation at the first try), and the Pareto of defects, repair causes, operations
// and stations. All from the unit history; nothing is typed in twice.
import * as ui from "/eco-ui/eco-ui.js";
import { api, dayShift, name, showError, t, today } from "../common.js";
import { lineOptions } from "../views.js";

const { h } = ui;

export default function create({ shell }) {
  const from = ui.input({ type: "date", value: dayShift(-6), width: "150px" }), to = ui.input({ type: "date", value: today(), width: "150px" });
  const lineSel = ui.select({ options: [["", t("all")]], width: "220px" });
  let by = "defect";
  const bySel = ui.segmented({ options: [["defect", t("par.defect")], ["cause", t("par.cause")], ["op", t("par.op")], ["station", t("par.station")]], value: by, onChange: (x) => { by = x; load(); } });
  const host = h("div", { class: "mes-analysis" });
  const sc = ui.screen({ code: "QMS4010", title: t("scr.QMS4010"), path: [t("g.quality"), t("m.holds")], shell,
    toolbar: [from, h("span", { text: "–" }), to, lineSel, ui.sep(), bySel], standard: { inquiry: () => load(), inquiryLabel: t("inquiry") }, body: host });
  async function load() {
    const q = new URLSearchParams({ from: from.value, to: to.value, ...(lineSel.value ? { line: lineSel.value } : {}) });
    let y, p;
    try { [y, p] = await Promise.all([api("GET", "/api/qms/yield?" + q), api("GET", "/api/qms/pareto?" + q + "&by=" + by)]); } catch (e) { showError(e); return; }
    const top = p.rows.slice(0, 12);
    ui.clear(host,
      h("section", { class: "mes-card" }, h("h3", { text: t("qa.fpy_title") }),
        y.length ? h("table", { class: "mes-table" }, h("thead", {}, h("tr", {}, h("th", { text: t("c.line") }), h("th", { text: "RTY" }), h("th", { text: t("qa.by_op") }))),
          h("tbody", {}, y.map((l) => h("tr", {}, h("td", {}, ui.ltr(l.line)), h("td", { class: l.rty < 95 ? "mes-bad" : "mes-ok" }, ui.ltr(l.rty.toFixed(1) + "%")),
            h("td", {}, h("div", { class: "mes-fpy" }, l.ops.map((o) => h("span", { class: "mes-fpy-op " + (o.fpy === null ? "" : o.fpy < 97 ? "is-bad" : o.fpy < 99 ? "is-warn" : "is-ok"), title: o.firstPass + " / " + o.units + " · " + o.fails + " " + t("rep.fails") },
              h("b", {}, ui.ltr(o.op)), ui.ltr(o.fpy === null ? "—" : o.fpy.toFixed(1) + "%"))))))))) : ui.empty({ icon: "chart", title: t("qa.no_tests") })),
      h("section", { class: "mes-card" }, h("h3", { text: t("qa.pareto_title", { by: t("par." + by) }) + " · " + ui.fmtNumber(p.total) }),
        top.length ? [ui.barChart({ labels: top.map((r) => r.key), series: [{ label: t("qa.count"), values: top.map((r) => r.n), cls: "eco-chart-bad" }], height: 260, width: 900 }),
          h("table", { class: "mes-table" }, h("thead", {}, h("tr", {}, [t("c.code"), t("c.name"), t("qa.count"), "%", t("qa.cum")].map((x) => h("th", { text: x })))),
            h("tbody", {}, top.map((r) => h("tr", {}, h("td", {}, ui.ltr(r.key)), h("td", { text: r.name_en ? name(r) : "" }), h("td", {}, ui.ltr(String(r.n))), h("td", {}, ui.ltr(r.pct + "%")), h("td", {}, ui.ltr(r.cum + "%"))))))]
          : ui.empty({ icon: "check-circle", title: t("qa.no_defects") })));
  }
  lineOptions().then((opts) => { for (const [a, b] of opts) lineSel.append(h("option", { value: a, text: b })); });
  lineSel.addEventListener("change", load);
  load();
  return { el: sc.el };
}
