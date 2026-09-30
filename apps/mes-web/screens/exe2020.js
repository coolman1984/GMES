// EXE2020 Operator Station — the TEMPLATE of every shop-floor screen: a gloved hand on a touch screen, noise, poor
// light (GMES docs/design/05 §5.3 flow 3). Scan is the main action; big buttons for what is not scanned; every
// reaction has a colour, an icon and large words; a lost connection is a full-width red bar, never silent storage.
// Every press is a command to the server with its own id; the counters show what the ledger holds, not local counts.
import * as ui from "/eco-ui/eco-ui.js";
import { api, ApiError, commandId, hhmm, loadStopReasons, name, num, session, stopName, t } from "../common.js";
// (serial mode: GMES docs/design/05 flow 3 with a routing: scan the unit, then its key parts; FAIL sends it to repair)

const { h } = ui;
const SCRAP = [["dimension", "gauge"], ["surface", "eye"], ["short_shot", "minus"], ["contamination", "alert"], ["assembly", "wrench"], ["other", "more"]];
// the reasons that fit the kind of line (its area's code); any other area gets the general list above
const SCRAP_BY_AREA = {
  SMD: [["solder", "zap"], ["component", "cpu"], ["function", "x-octagon"], ["other", "more"]],
  INJ: [["short_shot", "minus"], ["surface", "eye"], ["dimension", "gauge"], ["contamination", "alert"], ["other", "more"]],
  LCM: [["panel", "monitor"], ["cosmetic", "eye"], ["function", "x-octagon"], ["contamination", "alert"], ["other", "more"]],
  MAIN: [["function", "x-octagon"], ["cosmetic", "eye"], ["assembly", "wrench"], ["panel", "monitor"], ["other", "more"]],
  // ceramic tiles: what a kiln line loses, and the second grade the sorting sends down
  CER: [["kiln_crack", "zap"], ["lamination", "minus"], ["shade", "eye"], ["caliber", "gauge"], ["chipped", "alert"], ["downgrade", "x"], ["other", "more"]],
};
// stop reasons come from the plant's own list (SYS9040); the icon follows the loss category of the reason
const LOSS_ICON = { breakdown: "x-octagon", setup: "refresh", material: "box", quality: "shield", planned: "clock", other: "more" };

export default function create() {
  const me = session().user;
  const S = { lines: [], stations: [], line: ui.prefs.get("station:line", ""), station: ui.prefs.get("station:station", ""), orders: [], wo: null, stop: null, online: true, events: [], busy: false };

  const clock = h("span", { class: "st-clock" });
  const conn = h("span", { class: "st-conn" });
  const offline = h("div", { class: "st-offline", hidden: true }, ui.icon("x-octagon", 28), h("span", { text: t("st.offline") }));
  const lineSel = ui.select({ options: [], onChange: (v) => { S.line = v; S.station = ""; ui.prefs.set("station:line", v); ui.prefs.set("station:station", ""); loadLine(); } });
  const stationSel = ui.select({ options: [], placeholder: t("st.whole_line"), onChange: (v) => { S.station = v; ui.prefs.set("station:station", v); Promise.all([loadStop(), loadStation()]).then(draw); } });
  const woSel = ui.select({ options: [], onChange: (v) => { S.wo = S.orders.find((o) => o.id === v) || null; loadStation().then(draw); scan.focus(); } });
  lineSel.classList.add("st-pick"); stationSel.classList.add("st-pick"); woSel.classList.add("st-pick", "st-pick-wo");
  const progressHost = h("div", { class: "st-wo-progress" });
  const itemHost = h("div", { class: "st-wo-item" });
  const counters = h("div", { class: "st-counters" });
  const lastBox = h("div", { class: "st-last" });
  const events = h("ol", { class: "st-events" });
  const stopBar = h("div", { class: "st-stopbar", hidden: true });
  const scan = h("input", { class: "st-scan-input", placeholder: t("st.scan_ph"), autocomplete: "off", spellcheck: "false", dir: "ltr", "aria-label": t("st.scan") });
  scan.addEventListener("keydown", (ev) => { if (ev.key === "Enter" && scan.value.trim()) { onScan(scan.value.trim()); scan.value = ""; } });

  const big = (kind, ic, label, onClick) => h("button", { type: "button", class: "st-big st-big-" + kind, onclick: onClick }, ui.icon(ic, 38), h("span", { text: label }));
  // serial mode (the order follows a routing): every unit is scanned; the station is the operation it performs
  const modeBox = h("div", { class: "st-mode", hidden: true });
  const loadsBox = h("div", { class: "st-loads", hidden: true });
  const serialBtns = [big("good", "check", t("st.pass"), () => setMode("pass")), big("scrap", "x-octagon", t("st.fail"), () => pickDefect()),
    big("rework", "x", t("st.scrap_unit"), () => pickScrap())];
  serialBtns.forEach((b) => b.classList.add("st-serial-only"));
  const buttons = h("div", { class: "st-buttons" },
    big("good", "check", t("st.good"), () => book("good", 1)), big("rework", "plus", t("st.good_qty"), () => goodQty()), big("scrap", "x", t("st.scrap"), () => reasons("scrap")),
    serialBtns, big("stop", "pause", t("st.stop"), () => (S.stop ? resume() : reasons("stop"))));

  const el = h("div", { class: "st" },
    offline,
    h("header", { class: "st-head" },
      h("div", { class: "st-where" }, lineSel, stationSel),
      h("div", { class: "st-op" }, ui.avatar(me.name, 34), h("div", {}, h("b", { text: me.name }), h("small", {}, ui.ltr(me.login)))),
      h("span", { class: "eco-grow" }), conn, clock),
    h("section", { class: "st-wo" }, h("div", { class: "st-wo-id" }, h("small", { text: t("c.wo") }), woSel), itemHost, progressHost),
    stopBar,
    h("div", { class: "st-main" },
      h("section", { class: "st-scan" }, h("label", { class: "st-scan-label" }, ui.icon("scan", 22), h("span", { text: t("st.scan") })), scan, lastBox),
      h("aside", { class: "st-side" }, modeBox, counters, loadsBox, h("div", { class: "st-events-head", text: t("st.recent") }), events)),
    buttons);

  const blocked = () => !S.online || S.busy;
  // unit by unit only for serialised items, the server's own rule: a lot or bulk item on a routing is booked by quantity
  const serial = () => !!(S.wo && S.wo.routing_id && S.wo.item.tracking === "serial");
  function draw() {
    const sm = serial();
    el.classList.toggle("is-serial", sm);
    modeBox.hidden = !sm; loadsBox.hidden = !sm || !S.station;
    if (sm) drawSerial();
    const wo = S.wo;
    ui.clear(itemHost, wo ? [h("small", { text: t("c.item") }), h("b", { text: name(wo.item) }), h("span", {}, ui.ltr(wo.item.code))] : h("span", { class: "eco-muted", text: t("st.no_wo") }));
    const planned = wo ? num(wo.planned_qty) : 0, good = wo ? num(wo.completed_qty) : 0, scrap = wo ? num(wo.scrapped_qty) : 0, open = wo ? num(wo.open_qty) : 0;
    const pct = planned ? Math.min(100, (good / planned) * 100) : 0;
    ui.clear(progressHost, wo ? [h("div", { class: "st-wo-nums" }, h("span", { text: t("st.required") }), h("b", {}, ui.ltr(ui.fmtNumber(planned))), h("span", { text: t("st.done") }), h("b", { class: "st-good-num" }, ui.ltr(ui.fmtNumber(good))),
      h("span", { text: t("c.remaining") }), h("b", {}, ui.ltr(ui.fmtNumber(open)))),
      h("div", { class: "st-bar" }, h("div", { class: "st-bar-fill", style: { width: pct.toFixed(1) + "%" } }), h("span", {}, ui.ltr(pct.toFixed(0) + "%")))] : null);
    ui.clear(counters, [["good", "check", good], ["scrap", "x", scrap], ["remaining", "clock", open]].map(([k, ic, v]) =>
      h("div", { class: "st-counter st-c-" + (k === "remaining" ? "rework" : k) }, ui.icon(ic, 22), h("span", { text: k === "remaining" ? t("c.remaining") : t("st." + k) }), h("b", {}, ui.ltr(ui.fmtNumber(v))))));
    ui.clear(events, S.events.slice(0, 7).map((e) => h("li", { class: "st-ev st-ev-" + e.kind }, ui.icon(e.icon, 16), h("span", { text: e.text }), h("small", {}, ui.ltr(e.at)))));
    ui.clear(conn, ui.icon(S.online ? "wifi" : "x-octagon", 16), h("span", { text: S.online ? ui.kitText("connected") : ui.kitText("disconnected") }));
    conn.className = "st-conn " + (S.online ? "is-ok" : "is-bad");
    offline.hidden = S.online;
    buttons.classList.toggle("is-blocked", blocked() || !wo);
    stopBar.hidden = !S.stop;
    if (S.stop) ui.clear(stopBar, ui.icon("pause", 26), h("b", { text: t("st.stopped_for", { reason: stopName(S.stop.reason) }) }), h("span", {}, ui.ltr(hhmm(S.stop.startedAt) + " · " + S.stop.startedBy + (S.stop.station ? "" : " · " + S.stop.line))),
      h("span", { class: "eco-grow" }), h("button", { type: "button", class: "st-resume", onclick: resume }, ui.icon("play", 22), h("span", { text: t("st.resume") })));
    buttons.querySelector(".st-big-stop span").textContent = S.stop ? t("st.resume") : t("st.stop");
    buttons.querySelector(".st-big-stop").disabled = !S.line || blocked();
  }
  function feedback(kind, title, text, ic) {
    ui.clear(lastBox, h("div", { class: "st-result st-r-" + kind }, ui.icon(ic, 44), h("div", {}, h("b", { text: title }), h("span", { text }))));
    lastBox.firstChild.animate([{ transform: "scale(.98)", opacity: .6 }, { transform: "scale(1)", opacity: 1 }], { duration: 180 });
  }
  function log(kind, icon, text) { S.events.unshift({ kind, icon, text, at: ui.fmtTime() }); }
  /** A refusal from the server is shown as it is: big, red, with the server's reason. A lost network blocks the station. */
  function refused(e, what) {
    if (e instanceof ApiError && e.code === "network") { S.online = false; feedback("bad", t("st.offline"), t("err.network"), "x-octagon"); }
    else feedback("bad", t("st.refused", { what }), e.message, "x-octagon");
    log("bad", "x", what + " · " + t("st.rejected"));
    draw();
  }

  async function loadPlant() {
    try {
      const nodes = await api("GET", "/api/plant");
      S.lines = nodes.filter((n) => n.type === "line" && n.active);
      S.allStations = nodes.filter((n) => n.type === "station" && n.active);
      S.areaOf = Object.fromEntries(S.lines.map((l) => [l.code, (nodes.find((n) => n.id === l.parent_id) || {}).code]));
      S.stopReasons = await loadStopReasons();
    } catch (e) { refused(e, t("scr.MDM1010")); return; }
    if (!S.lines.length) { feedback("warn", t("st.no_lines"), t("hint.no_lines"), "sitemap"); draw(); return; }
    if (!S.lines.some((l) => l.code === S.line)) S.line = S.lines[0].code;
    ui.clear(lineSel, S.lines.map((l) => h("option", { value: l.code, text: l.code + " · " + name(l) })));
    lineSel.value = S.line;
    await loadLine();
  }
  async function loadLine() {
    const line = S.lines.find((l) => l.code === S.line);
    S.stations = line ? S.allStations.filter((s) => s.parent_id === line.id) : [];
    if (!S.stations.some((s) => s.code === S.station)) S.station = "";
    ui.clear(stationSel, [h("option", { value: "", text: t("st.whole_line") })].concat(S.stations.map((s) => h("option", { value: s.code, text: s.code + " · " + name(s) }))));
    stationSel.value = S.station;
    await Promise.all([loadOrders(), loadStop()]);
    await loadStation();
    feedback("ok", t("st.ready"), t("st.ready_help"), "scan");
    draw();
  }
  async function loadOrders(keep) {
    try {
      const [orders, board] = await Promise.all([api("GET", "/api/work-orders?status=released&line=" + encodeURIComponent(S.line)), api("GET", "/api/boards/line/" + encodeURIComponent(S.line))]);
      S.orders = orders.sort((a, b) => a.priority - b.priority || a.production_date.localeCompare(b.production_date) || a.code.localeCompare(b.code));
      const want = keep || (S.wo && S.wo.id) || (board.workOrder && board.workOrder.id);
      S.wo = S.orders.find((o) => o.id === want) || S.orders[0] || null;
      ui.clear(woSel, S.orders.length ? S.orders.map((o) => h("option", { value: o.id, text: o.code + " · " + o.item.code + " · P" + o.priority })) : [h("option", { value: "", text: t("st.no_wo") })]);
      woSel.value = S.wo ? S.wo.id : "";
      S.online = true;
    } catch (e) { refused(e, t("c.wo")); }
  }
  async function loadStop() {
    try {
      const open = await api("GET", "/api/stoppages?open=1&line=" + encodeURIComponent(S.line));
      // this station's own stop, else a stop of the whole line (which stops every station on it)
      S.stop = open.find((s) => (s.station || "") === S.station) || open.find((s) => !s.station) || null;
    } catch (e) { refused(e, t("st.stop")); }
  }

  function onScan(code) {
    if (blocked()) return;
    if (serial() && !S.orders.some((o) => o.code.toLowerCase() === code.toLowerCase())) { serialScan(code); return; }
    const hit = S.orders.find((o) => o.code.toLowerCase() === code.toLowerCase());
    if (hit) { S.wo = hit; woSel.value = hit.id; feedback("ok", t("st.wo_selected", { code: hit.code }), name(hit.item), "clipboard"); log("ok", "clipboard", hit.code); draw(); return; }
    if (!S.wo) { feedback("warn", t("st.no_wo"), t("st.scan_wo_first"), "clipboard"); return; }
    if (S.wo.item.tracking === "none") { feedback("warn", t("st.unknown_code", { code }), t("st.untracked_help"), "alert"); log("warn", "alert", code + " · " + t("st.rejected")); draw(); return; }
    book("good", 1, code);
  }
  /** One press = one command. The counters are re-read from the server, so they show the ledger, not a local guess. */
  async function book(kind, qty, lot, reason) {
    if (blocked() || !S.wo) return;
    if (S.stop) { feedback("warn", t("st.rej_stopped"), t("st.rej_stopped_help"), "pause"); return; }
    if (kind === "good" && S.wo.item.tracking !== "none" && !lot) { feedback("warn", t("st.scan_lot"), t("st.scan_lot_help", { tracking: t("trk." + S.wo.item.tracking) }), "scan"); scan.focus(); return; }
    S.busy = true; draw();
    const what = kind === "good" ? t("st.good") : t("st.scrap") + " · " + t("scrap." + reason);
    const body = { commandId: commandId(), qty: String(qty), ...(S.station ? { station: S.station } : {}), ...(lot ? { lotNo: lot } : {}), ...(reason ? { reasonCode: reason } : {}) };
    try {
      const r = await api("POST", `/api/work-orders/${S.wo.id}/${kind === "good" ? "complete" : "scrap"}`, body);
      const txt = what + (qty !== 1 ? " × " + qty : "") + (lot ? " · " + lot : "");
      feedback(kind === "good" ? "ok" : "bad", txt, t("st.recorded"), kind === "good" ? "check-circle" : "x-octagon");
      log(kind === "good" ? "ok" : "bad", kind === "good" ? "check" : "x", txt);
      if (r.status === "completed") { feedback("ok", t("st.wo_done", { code: S.wo.code }), t("st.wo_done_help"), "check-circle"); }
      await loadOrders(r.status === "completed" ? null : S.wo.id);
    } catch (e) { refused(e, what); }
    finally { S.busy = false; draw(); scan.focus(); }
  }
  async function goodQty() {
    if (blocked() || !S.wo) return;
    const v = await ui.promptValue({ title: t("st.good_qty"), label: t("st.qty_label", { open: ui.fmtNumber(num(S.wo.open_qty)) }), type: "number", okLabel: t("st.good") });
    if (v === null || v === "") return;
    if (!/^\d+(\.\d{1,3})?$/.test(v) || !(Number(v) > 0)) { feedback("bad", t("st.bad_qty"), t("hint.qty_exact"), "alert"); return; }
    // a tracked item says which lot the quantity is (for tiles: its shade and caliber)
    let lot = null;
    if (S.wo.item.tracking !== "none") {
      lot = await ui.promptValue({ title: t("st.good_qty"), label: t("st.lot_label"), okLabel: t("st.good") });
      if (lot === null || !lot.trim()) return;
      lot = lot.trim();
    }
    await book("good", v, lot);
  }
  function reasons(kind) {
    if (blocked() || (kind === "scrap" && !S.wo)) return;
    const list = kind === "scrap" ? SCRAP_BY_AREA[(S.areaOf || {})[S.line]] || SCRAP
      : (S.stopReasons || []).filter((r) => r.active).map((r) => [r.code, LOSS_ICON[r.loss] || "more"]);
    // scrap: one press books the quantity above (1 unless changed: a whole kiln car is not pressed piece by piece)
    const qtyIn = kind === "scrap" ? ui.input({ value: "1", type: "number", dir: "ltr", "aria-label": t("st.scrap_qty") }) : null;
    const d = ui.dialog({ title: kind === "scrap" ? t("st.scrap_why") : t("st.stop_why"), icon: kind === "scrap" ? "x-octagon" : "pause", width: 720,
      body: h("div", {}, qtyIn ? ui.field(t("st.scrap_qty"), qtyIn) : null, h("div", { class: "st-reasons" }, list.map(([r, ic]) => h("button", { type: "button", class: "st-reason st-reason-" + kind, onclick: () => {
        const q = qtyIn ? qtyIn.value.trim() : "1";
        if (kind === "scrap" && (!/^\d+(\.\d{1,3})?$/.test(q) || !(Number(q) > 0))) { feedback("bad", t("st.bad_qty"), t("hint.qty_exact"), "alert"); return; }
        d.close();
        if (kind === "scrap") book("scrap", Number(q) === 1 ? 1 : q, null, r); else stop(r);
      } }, ui.icon(ic, 34), h("span", { text: kind === "scrap" ? t("scrap." + r) : stopName(r) }))))) });
    d.el.classList.add("st-dialog");
  }
  async function stop(reason) {
    S.busy = true; draw();
    try {
      await api("POST", "/api/stoppages", { commandId: commandId(), line: S.line, station: S.station || null, reason });
      await loadStop();
      log("warn", "pause", t("st.stop") + " · " + stopName(reason));
      feedback("warn", t("st.stopped_for", { reason: stopName(reason) }), t("st.recorded"), "pause");
    } catch (e) { refused(e, t("st.stop")); }
    finally { S.busy = false; draw(); }
  }
  async function resume() {
    if (!S.stop || blocked()) return;
    S.busy = true; draw();
    const reason = S.stop.reason;
    try {
      await api("POST", `/api/stoppages/${S.stop.id}/end`, { commandId: commandId() });
      await loadStop();
      log("ok", "play", t("st.resumed") + " · " + stopName(reason));
      feedback("ok", t("st.resumed"), t("st.ready_help"), "play");
    } catch (e) { refused(e, t("st.resume")); }
    finally { S.busy = false; draw(); scan.focus(); }
  }

  // ------------------------------------------------------------------ serial mode
  S.mode = "pass"; S.defect = null; S.scrapReason = null; S.pending = null; S.expected = []; S.loads = [];
  function setMode(m) { S.mode = m; if (m === "pass") { S.defect = null; S.scrapReason = null; } S.pending = null; draw(); scan.focus(); }
  function drawSerial() {
    const station = S.stations.find((x) => x.code === S.station);
    const op = station ? station.code.slice(S.line.length + 1) : null;
    const tone = S.mode === "fail" ? "bad" : S.mode === "scrap" ? "warn" : "ok";
    ui.clear(modeBox, h("div", { class: "st-mode-card st-r-" + tone },
      h("small", { text: op ? t("st.operation") + " " + op : t("st.pick_station") }),
      h("b", { text: S.mode === "pass" ? t("st.mode_pass") : S.mode === "fail" ? t("st.mode_fail", { defect: S.defect }) : t("st.mode_scrap", { reason: t("scrap." + S.scrapReason) }) }),
      S.pending ? h("span", { class: "st-pending" }, ui.icon("scan", 16), t("st.scan_part", { part: S.pending.need[0].code + " · " + name(S.pending.need[0]), serial: S.pending.serial })) : null,
      S.mode !== "pass" || S.pending ? ui.button({ label: t("cancel"), size: "sm", onClick: () => setMode("pass") }) : null));
    ui.clear(loadsBox, h("div", { class: "st-events-head", text: t("st.materials") }),
      S.expected.filter((x) => x.scan === "lot").map((x) => {
        const l = S.loads.find((y) => y.item_id === x.item_id);
        return h("div", { class: "st-load" + (l ? "" : " is-missing") }, ui.icon(l ? "box" : "alert", 16), h("span", { text: x.code }), h("b", {}, ui.ltr(l ? l.lot_no : t("st.not_loaded"))),
          l ? h("small", {}, ui.ltr(String(l.units))) : null, ui.button({ label: l ? t("st.change_lot") : t("st.load"), size: "sm", onClick: () => loadLot(x, l) }));
      }), S.expected.some((x) => x.scan === "serial") ? h("div", { class: "st-load" }, ui.icon("tag", 16), h("span", { text: t("st.key_parts") }),
        h("b", { text: S.expected.filter((x) => x.scan === "serial").map((x) => x.code).join(", ") })) : null);
  }
  async function loadStation() {
    if (!serial() || !S.station) { S.expected = []; S.loads = []; return; }
    try { const r = await api("GET", "/api/stations/" + encodeURIComponent(S.station) + "/loads"); S.expected = r.expected; S.loads = r.open; } catch (e) { refused(e, t("st.materials")); }
  }
  async function serialScan(code) {
    if (!S.station) { feedback("warn", t("st.pick_station"), t("st.pick_station_help"), "cpu"); return; }
    if (S.stop) { feedback("warn", t("st.rej_stopped"), t("st.rej_stopped_help"), "pause"); return; }
    if (S.mode === "scrap") return scrapSerial(code);
    const needParts = S.mode === "pass" ? S.expected.filter((x) => x.scan === "serial") : [];
    if (S.pending) {   // a key part of the unit scanned just before
      S.pending.parts.push({ serial: code, itemId: S.pending.need[0].item_id });
      S.pending.need.shift();
      if (S.pending.need.length) { draw(); return; }
      const p = S.pending; S.pending = null;
      return postScan(p.serial, p.parts);
    }
    if (needParts.length) { S.pending = { serial: code, need: needParts.slice(), parts: [] }; feedback("warn", t("st.unit_scanned", { serial: code }), t("st.now_parts"), "scan"); draw(); return; }
    return postScan(code, []);
  }
  async function postScan(code, parts) {
    S.busy = true; draw();
    const failing = S.mode === "fail";
    try {
      const r = await api("POST", "/api/units/scan", { commandId: commandId(), station: S.station, serial: code, workOrderId: S.wo.id, result: failing ? "fail" : "pass",
        ...(failing ? { defectCode: S.defect } : {}), ...(parts.length ? { parts } : {}) });
      const txt = code + " · " + r.op.code;
      if (r.result === "fail") { feedback("bad", t("st.failed", { serial: code }), t("st.to_repair", { defect: S.defect }), "x-octagon"); log("bad", "x", txt + " · " + S.defect); setMode("pass"); }
      else if (r.result === "complete") { feedback("ok", t("st.unit_done", { serial: code }), t("st.unit_done_help"), "check-circle"); log("ok", "check", txt + " · " + t("st.unit_done_short")); }
      else { feedback("ok", t("st.passed", { serial: code }), r.next ? t("st.next_op", { op: r.next.code + " · " + name(r.next) }) : "", "check-circle"); log("ok", "check", txt); }
      await Promise.all([loadOrders(S.wo.id), loadStation()]);
    } catch (e) { refused(e, code); }
    finally { S.busy = false; draw(); scan.focus(); }
  }
  async function scrapSerial(code) {
    S.busy = true; draw();
    try {
      await api("POST", "/api/units/" + encodeURIComponent(code) + "/scrap", { commandId: commandId(), reasonCode: S.scrapReason, station: S.station });
      feedback("bad", t("st.scrapped", { serial: code }), t("scrap." + S.scrapReason), "x-octagon"); log("bad", "x", code + " · " + t("scrap." + S.scrapReason));
      setMode("pass");
      await loadOrders(S.wo.id);
    } catch (e) { refused(e, code); }
    finally { S.busy = false; draw(); scan.focus(); }
  }
  async function pickDefect() {
    if (blocked()) return;
    let list = [];
    try { list = (await api("GET", "/api/defect-codes?active=1")).map((d) => [d.code, name(d), d.category]); }
    catch (_) { list = (SCRAP_BY_AREA[(S.areaOf || {})[S.line]] || SCRAP).map(([r]) => [r.toUpperCase(), t("scrap." + r), ""]); }
    const d = ui.dialog({ title: t("st.fail_why"), icon: "x-octagon", width: 820,
      body: h("div", { class: "st-reasons" }, list.map(([c, label]) => h("button", { type: "button", class: "st-reason st-reason-scrap", onclick: () => { d.close(); S.mode = "fail"; S.defect = c; S.pending = null; draw(); scan.focus(); } },
        h("b", {}, ui.ltr(c)), h("span", { text: label })))) });
    d.el.classList.add("st-dialog");
  }
  function pickScrap() {
    if (blocked()) return;
    const list = SCRAP_BY_AREA[(S.areaOf || {})[S.line]] || SCRAP;
    const d = ui.dialog({ title: t("st.scrap_why"), icon: "x", width: 720,
      body: h("div", { class: "st-reasons" }, list.map(([r, ic]) => h("button", { type: "button", class: "st-reason st-reason-scrap", onclick: () => { d.close(); S.mode = "scrap"; S.scrapReason = r; S.pending = null; draw(); scan.focus(); } },
        ui.icon(ic, 34), h("span", { text: t("scrap." + r) })))) });
    d.el.classList.add("st-dialog");
  }
  async function loadLot(x, current) {
    let whs = [];
    try { whs = (await api("GET", "/api/warehouses")).filter((w) => w.active); } catch (e) { refused(e, t("st.load")); return; }
    const lot = ui.input({ dir: "ltr", placeholder: t("c.lot") });
    const wh = ui.select({ options: whs.map((w) => [w.id, w.code + " · " + name(w)]), value: ((whs.find((w) => w.is_default) || whs[0]) || {}).id });
    const err = h("div");
    ui.dialog({ title: t("st.load") + " · " + x.code, subtitle: S.station, icon: "box", body: h("div", { class: "eco-form" },
      current ? ui.banner("info", t("st.unload_first", { lot: current.lot_no })) : null, ui.field(t("c.lot"), lot, { required: true }), ui.field(t("f.warehouse"), wh), err),
    actions: [{ label: t("cancel"), kind: "ghost", value: false }, { label: t("st.load"), kind: "primary", icon: "check", onClick: async () => {
      try {
        if (current) await api("POST", `/api/loads/${current.id}/unload`, { commandId: commandId() });
        const r = await api("POST", "/api/stations/" + encodeURIComponent(S.station) + "/loads", { commandId: commandId(), itemId: x.item_id, lotNo: lot.value, warehouseId: wh.value });
        log(r.verified ? "ok" : "warn", "box", x.code + " · " + r.lot + (r.verified ? "" : " · " + t("unit.unverified")));
      } catch (e) { showErr(e, err); return false; }
      await loadStation(); draw();
    } }] });
  }
  const showErr = (e, box) => ui.clear(box, ui.banner("bad", e.message));

  // the connection is observed, never assumed: the real server's health every 10 s
  async function ping() {
    const was = S.online;
    try { const r = await fetch("/api/health", { cache: "no-store" }); S.online = r.ok; } catch (_) { S.online = false; }
    if (S.online && !was) await loadOrders();
    draw();
  }
  const timer = setInterval(() => { clock.textContent = ui.fmtTime(); }, 1000);
  const health = setInterval(ping, 10000);
  clock.textContent = ui.fmtTime();
  draw();
  loadPlant();
  return { el, onActivate: () => setTimeout(() => scan.focus(), 30), onClose: () => { clearInterval(timer); clearInterval(health); } };
}
