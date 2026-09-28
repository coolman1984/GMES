// Shared building blocks of the GMES screens: the inquiry screen (conditions -> Inquiry -> grid -> detail), the plant's
// lines as select options, small rows editors for dialogs, and the route strip of a serial unit. Everything a screen
// shows still comes from the server (each screen passes its own load function that calls the API).
import * as ui from "/eco-ui/eco-ui.js";
import { api, name, showError, t } from "./common.js";

const { h } = ui;

/**
 * An inquiry screen. fields: condition fields (eco-ui conditionPanel); columns: grid columns; load(values) -> rows;
 * detail(row, host) draws the detail panel (optional); toolbar(g) returns extra buttons; ready(g, sc, cond) runs once.
 */
export function inquiryScreen({ shell, code, path, fields, columns, load, detail, toolbar, rowKey = "id", presets, emptyText, selection = "single", auto = false, note, totals = true }) {
  const cond = fields && fields.length ? ui.conditionPanel(fields, { key: code, onSubmit: () => run() }) : null;
  const detailHost = detail ? h("div", { class: "mes-detail" }) : null;
  const g = ui.grid(columns, { rowKey, selection, totals, layoutKey: code, idleText: t("hint.inquiry"), ...(presets ? { presets } : {}),
    onSelect: (sel) => { if (detail) draw(sel[sel.length - 1]); onSel && onSel(sel); }, onOpen: (r) => detail && draw(r) });
  let onSel = null;
  const sc = ui.screen({ code, title: t("scr." + code), path, shell, note,
    toolbar: toolbar ? toolbar(g) : [],
    standard: { inquiry: () => run(), inquiryLabel: t("inquiry"), reset: cond ? () => { cond.reset(); g.setIdle(); sc.result({}); } : undefined, resetLabel: t("reset"),
      export: () => g.exportCSV(code), exportLabel: t("export"), columns: () => g.columnsDialog(), print: () => print(), printLabel: t("print") },
    conditions: cond, grid: g, detail: detailHost });
  function draw(r) {
    if (!detailHost) return;
    if (!r) { ui.clear(detailHost, ui.empty({ icon: "info", title: t("detail.none"), text: t("detail.pick") })); return; }
    Promise.resolve(detail(r, detailHost)).catch((e) => ui.clear(detailHost, ui.banner("bad", e.message)));
  }
  async function run() {
    if (cond) {
      const missing = cond.missing();
      if (missing.length) { ui.toast({ kind: "warn", title: t("required"), text: ui.kitText("required_missing", { fields: missing.join(", ") }) }); return; }
    }
    const t0 = performance.now();
    g.setLoading(ui.kitText("loading"));
    let rows;
    try { rows = await load(cond ? cond.values() : {}); }
    catch (e) { g.setEmptyText(e.message); g.setRows([]); showError(e); return; }
    g.setEmptyText(emptyText || t("empty.rows"));
    g.setRows(rows);
    sc.result({ chips: cond ? cond.chips() : [], ms: Math.round(performance.now() - t0) });
    if (rows.length && detail) g.select(rows[0][rowKey]);
    else if (detail) draw(null);
  }
  if (detail) draw(null);
  if (auto) run();
  return { el: sc.el, sc, grid: g, cond, run, onSelect: (fn) => { onSel = fn; } };
}

/** The plant's active lines as [code, label] options (for condition panels and dialogs). */
export async function lineOptions() {
  try {
    return (await api("GET", "/api/plant")).filter((n) => n.type === "line" && n.active).map((l) => [l.code, l.code + " · " + name(l)]);
  } catch (e) { showError(e); return []; }
}
/** Fills a select control created with no options. */
export function fillSelect(sel, options, keepFirst = true) {
  const first = keepFirst && sel.firstChild && sel.firstChild.value === "" ? sel.firstChild : null;
  ui.clear(sel, first, options.map(([v, l]) => h("option", { value: v, text: l })));
}

/**
 * A small table editor for a dialog: rows of inputs, add / remove, read back as objects.
 * cols: [{ key, label, width, kind: "text"|"number"|"select"|"check", options, dir }]
 */
export function rowsEditor(cols, rows = [], { addLabel, readonly = false } = {}) {
  const body = h("tbody");
  const addRow = (r = {}) => {
    const tr = h("tr");
    for (const c of cols) {
      let ctl;
      if (c.kind === "select") { ctl = ui.select({ options: c.options, value: r[c.key] ?? (c.options[0] || [])[0] }); }
      else if (c.kind === "check") { ctl = h("input", { type: "checkbox" }); ctl.checked = r[c.key] ?? true; }
      else ctl = ui.input({ value: r[c.key] === undefined || r[c.key] === null ? "" : String(r[c.key]), type: c.kind === "number" ? "number" : "text", dir: c.dir });
      if (readonly) ctl.disabled = true;
      ctl.dataset.key = c.key;
      tr.append(h("td", { style: { width: c.width ? c.width + "px" : null } }, ctl));
    }
    tr.append(h("td", {}, readonly ? null : ui.button({ icon: "x", kind: "ghost", size: "sm", title: t("remove"), onClick: () => tr.remove() })));
    body.append(tr);
  };
  rows.forEach(addRow);
  const el = h("div", { class: "mes-rows" }, h("table", { class: "mes-rows-table" }, h("thead", {}, h("tr", {}, cols.map((c) => h("th", { text: c.label })), h("th"))), body),
    readonly ? null : ui.button({ label: addLabel || t("add_row"), icon: "plus", size: "sm", onClick: () => addRow({}) }));
  return {
    el,
    values: () => [...body.children].map((tr) => Object.fromEntries([...tr.querySelectorAll("[data-key]")].map((x) => [x.dataset.key, x.type === "checkbox" ? x.checked : x.value]))),
  };
}

/** The route of a unit as a strip of operations: done / next / repair / pending. */
export function routeStrip(route) {
  return h("ol", { class: "mes-route" }, route.map((o) => h("li", { class: "mes-route-" + o.state, title: o.at ? o.station + " · " + o.at : "" },
    h("span", { class: "mes-route-dot" }, o.state === "done" ? ui.icon("check", 11) : o.state === "repair" ? ui.icon("wrench", 11) : o.state === "scrapped" ? ui.icon("x", 11) : null),
    h("b", {}, ui.ltr(o.code)), h("small", { text: name(o) + (o.tries > 1 ? " ×" + o.tries : "") }))));
}

/** Unit statuses as status chips. */
export const UNIT_STATE = { wip: "run", repair: "hold", completed: "done", scrapped: "down", consumed: "closed", packed: "done", shipped: "closed" };
export const unitChip = (s) => ui.statusChip(UNIT_STATE[s] || "planned", t("ust." + s));

export { h };
