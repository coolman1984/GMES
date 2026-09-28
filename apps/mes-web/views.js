// Shared building blocks of the GMES screens: the inquiry screen (conditions -> Inquiry -> grid -> detail), the plant's
// lines as select options, small rows editors for dialogs, and the route strip of a serial unit. Everything a screen
// shows still comes from the server (each screen passes its own load function that calls the API).
import * as ui from "/eco-ui/eco-ui.js";
import { api, name, showError, t } from "./common.js";
import { code128Widths } from "./barcode.js";

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

/**
 * A preview of a ZPL label as SVG: the commands a label template uses (^PW ^LL ^FO ^A0 ^BY ^BC ^GB ^FD ^FS). Anything
 * else is ignored — the printer is the truth; this is for seeing the values and the layout before printing.
 */
export function zplPreview(zpl, { scale = 0.5 } = {}) {
  const NS = "http://www.w3.org/2000/svg";
  const el = (tag, attrs, text) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v)); if (text !== undefined) e.textContent = text; return e; };
  let W = 812, H = 406, x = 0, y = 0, font = 30, module = 2, barcode = null, box = null;
  const parts = [];
  for (const raw of String(zpl).split("^").slice(1)) {
    const cmd = raw.slice(0, 2).toUpperCase(), arg = raw.slice(2).replace(/\s+$/, "");
    const nums = arg.split(",").map((v) => parseInt(v, 10));
    if (cmd === "PW") W = nums[0] || W;
    else if (cmd === "LL") H = nums[0] || H;
    else if (cmd === "FO") { x = nums[0] || 0; y = nums[1] || 0; }
    else if (cmd === "A0") { const f = arg.split(","); font = parseInt(f[1], 10) || font; }
    else if (cmd === "BY") module = nums[0] || module;
    else if (cmd === "BC") { const f = arg.split(","); barcode = { h: parseInt(f[1], 10) || 80, text: f[2] !== "N" }; }
    else if (cmd === "GB") box = { w: nums[0] || 1, h: nums[1] || 1, t: nums[2] || 1 };
    else if (cmd === "FD") {
      if (barcode) {
        let bx = x;
        try {
          code128Widths(arg).forEach((w, i) => { if (i % 2 === 0) parts.push(el("rect", { x: bx, y, width: w * module, height: barcode.h, fill: "#000" })); bx += w * module; });
          if (barcode.text) parts.push(el("text", { x: x + (bx - x) / 2, y: y + barcode.h + 26, "font-size": 24, "text-anchor": "middle", "font-family": "monospace" }, arg));
        } catch (_) { parts.push(el("text", { x, y: y + 30, "font-size": 24, fill: "#c00" }, "✕ " + arg)); }
      } else parts.push(el("text", { x, y: y + font * 0.8, "font-size": font, "font-family": "Arial, sans-serif", "font-weight": 600 }, arg));
    } else if (cmd === "FS") {
      if (box) parts.push(el("rect", { x: x + box.t / 2, y: y + box.t / 2, width: Math.max(1, box.w - box.t), height: Math.max(1, box.h - box.t), fill: "none", stroke: "#000", "stroke-width": box.t }));
      barcode = null; box = null;
    }
  }
  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, width: Math.round(W * scale), height: Math.round(H * scale), class: "mes-label", role: "img" });
  svg.append(el("rect", { x: 0, y: 0, width: W, height: H, fill: "#fff", stroke: "#bbb" }), ...parts);
  return svg;
}

export { h };
