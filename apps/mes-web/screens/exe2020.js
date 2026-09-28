// EXE2020 Operator Station — the TEMPLATE of every shop-floor screen: a gloved hand on a touch screen, noise, poor
// light (GMES docs/design/05 §5.3 flow 3). Scan is the main action; big buttons for what is not scanned; every
// reaction has a colour, an icon and large words; a lost connection is a full-width red bar, never silent storage.
import * as ui from "/eco-ui/eco-ui.js";
import { workOrders } from "../data.js";
import { t, sampleNote } from "../common.js";

const { h } = ui;
const SCRAP = [["dimension", "gauge"], ["surface", "eye"], ["short_shot", "minus"], ["contamination", "alert"], ["assembly", "wrench"], ["other", "more"]];
const STOP = [["material", "box"], ["breakdown", "x-octagon"], ["changeover", "refresh"], ["quality", "shield"], ["break", "clock"], ["other", "more"]];

export default function create({ shell }) {
  const wo = workOrders.find((w) => w.status === "run" && w.line.startsWith("ASM")) || workOrders[0];
  const S = { good: wo.good, scrap: wo.scrap, rework: wo.rework, stopped: null, online: true, last: null, events: [] };

  const clock = h("span", { class: "st-clock" });
  const conn = h("span", { class: "st-conn" });
  const offline = h("div", { class: "st-offline", hidden: true }, ui.icon("x-octagon", 28), h("span", { text: t("st.offline") }));
  const progressHost = h("div", { class: "st-wo-progress" });
  const counters = h("div", { class: "st-counters" });
  const lastBox = h("div", { class: "st-last" });
  const events = h("ol", { class: "st-events" });
  const stopBar = h("div", { class: "st-stopbar", hidden: true });
  const scan = h("input", { class: "st-scan-input", placeholder: t("st.scan_ph"), autocomplete: "off", spellcheck: "false", dir: "ltr", "aria-label": t("st.scan") });
  scan.addEventListener("keydown", (ev) => { if (ev.key === "Enter" && scan.value.trim()) { onScan(scan.value.trim()); scan.value = ""; } });

  const big = (kind, ic, label, onClick) => h("button", { type: "button", class: "st-big st-big-" + kind, onclick: onClick }, ui.icon(ic, 38), h("span", { text: label }));
  const buttons = h("div", { class: "st-buttons" },
    big("good", "check", t("st.good"), () => record("good")), big("scrap", "x", t("st.scrap"), () => reasons("scrap")),
    big("rework", "rotate", t("st.rework"), () => record("rework")), big("stop", "pause", t("st.stop"), () => (S.stopped ? resume() : reasons("stop"))));

  const el = h("div", { class: "st" },
    offline,
    h("header", { class: "st-head" },
      h("div", { class: "st-where" }, h("span", { class: "st-line" }, ui.ltr(wo.line)), h("span", { class: "st-station", text: t("st.station_name") })),
      h("div", { class: "st-shift" }, ui.icon("clock", 18), h("span", { text: t("f.shift") + " A" })),
      h("div", { class: "st-op" }, ui.avatar("Ahmed Mansour", 34), h("div", {}, h("b", { text: "Ahmed Mansour" }), h("small", {}, ui.ltr("B10370")))),
      h("span", { class: "eco-grow" }), sampleNote(), conn, clock),
    h("section", { class: "st-wo" },
      h("div", { class: "st-wo-id" }, h("small", { text: t("c.wo") }), h("b", {}, ui.ltr(wo.code))),
      h("div", { class: "st-wo-item" }, h("small", { text: t("c.item") }), h("b", { text: wo.itemName }), h("span", {}, ui.ltr(wo.item))),
      progressHost),
    stopBar,
    h("div", { class: "st-main" },
      h("section", { class: "st-scan" }, h("label", { class: "st-scan-label" }, ui.icon("scan", 22), h("span", { text: t("st.scan") })), scan, lastBox),
      h("aside", { class: "st-side" }, counters, h("div", { class: "st-events-head", text: t("st.recent") }), events)),
    buttons);

  function draw() {
    const done = S.good, pct = Math.min(100, (done / wo.planned) * 100);
    ui.clear(progressHost, h("div", { class: "st-wo-nums" }, h("span", { text: t("st.required") }), h("b", {}, ui.ltr(ui.fmtNumber(wo.planned))), h("span", { text: t("st.done") }), h("b", { class: "st-good-num" }, ui.ltr(ui.fmtNumber(done))),
      h("span", { text: t("c.remaining") }), h("b", {}, ui.ltr(ui.fmtNumber(Math.max(0, wo.planned - done - S.scrap))))),
      h("div", { class: "st-bar" }, h("div", { class: "st-bar-fill", style: { width: pct.toFixed(1) + "%" } }), h("span", {}, ui.ltr(pct.toFixed(0) + "%"))));
    ui.clear(counters, [["good", "check", S.good], ["scrap", "x", S.scrap], ["rework", "rotate", S.rework]].map(([k, ic, v]) =>
      h("div", { class: "st-counter st-c-" + k }, ui.icon(ic, 22), h("span", { text: t("st." + k) }), h("b", {}, ui.ltr(ui.fmtNumber(v))))));
    ui.clear(events, S.events.slice(0, 7).map((e) => h("li", { class: "st-ev st-ev-" + e.kind }, ui.icon(e.icon, 16), h("span", { text: e.text }), h("small", {}, ui.ltr(e.at)))));
    ui.clear(conn, ui.icon(S.online ? "wifi" : "x-octagon", 16), h("span", { text: S.online ? ui.kitText("connected") : ui.kitText("disconnected") }));
    conn.className = "st-conn " + (S.online ? "is-ok" : "is-bad");
    offline.hidden = S.online;
    buttons.classList.toggle("is-blocked", !S.online);
    stopBar.hidden = !S.stopped;
    if (S.stopped) ui.clear(stopBar, ui.icon("pause", 26), h("b", { text: t("st.stopped_for", { reason: t("stop." + S.stopped.reason) }) }), h("span", {}, ui.ltr(S.stopped.at)), h("span", { class: "eco-grow" }),
      h("button", { type: "button", class: "st-resume", onclick: resume }, ui.icon("play", 22), h("span", { text: t("st.resume") })));
    buttons.querySelector(".st-big-stop span").textContent = S.stopped ? t("st.resume") : t("st.stop");
  }
  function feedback(kind, title, text, ic) {
    ui.clear(lastBox, h("div", { class: "st-result st-r-" + kind }, ui.icon(ic, 44), h("div", {}, h("b", { text: title }), h("span", { text }))));
    lastBox.firstChild.animate([{ transform: "scale(.98)", opacity: .6 }, { transform: "scale(1)", opacity: 1 }], { duration: 180 });
  }
  function log(kind, icon, text) { S.events.unshift({ kind, icon, text, at: ui.fmtTime() }); }
  function onScan(code) {
    if (!S.online) return;
    if (/H/i.test(code.slice(-1))) { feedback("bad", t("st.rej_hold", { code }), t("st.rej_hold_help"), "lock"); log("bad", "lock", code + " · " + t("st.rejected")); draw(); return; }
    if (S.stopped) { feedback("warn", t("st.rej_stopped"), t("st.rej_stopped_help"), "pause"); draw(); return; }
    S.good++; S.last = code;
    feedback("ok", t("st.ok_scan", { code }), t("st.ok_scan_help"), "check-circle"); log("ok", "check", code + " · " + t("st.good")); draw();
  }
  function record(kind, reason) {
    if (!S.online) return;
    if (S.stopped) { feedback("warn", t("st.rej_stopped"), t("st.rej_stopped_help"), "pause"); return; }
    S[kind]++;
    const txt = kind === "scrap" ? t("st.scrap") + " · " + t("scrap." + reason) : t("st." + kind);
    feedback(kind === "good" ? "ok" : kind === "scrap" ? "bad" : "warn", txt, t("st.recorded"), kind === "good" ? "check-circle" : kind === "scrap" ? "x-octagon" : "rotate");
    log(kind === "good" ? "ok" : kind === "scrap" ? "bad" : "warn", kind === "good" ? "check" : kind === "scrap" ? "x" : "rotate", txt);
    draw(); scan.focus();
  }
  function reasons(kind) {
    const list = kind === "scrap" ? SCRAP : STOP;
    const d = ui.dialog({ title: kind === "scrap" ? t("st.scrap_why") : t("st.stop_why"), icon: kind === "scrap" ? "x-octagon" : "pause", width: 720,
      body: h("div", { class: "st-reasons" }, list.map(([r, ic]) => h("button", { type: "button", class: "st-reason st-reason-" + kind, onclick: () => {
        d.close();
        if (kind === "scrap") record("scrap", r);
        else { S.stopped = { reason: r, at: ui.fmtTime() }; log("warn", "pause", t("st.stop") + " · " + t("stop." + r)); draw(); }
      } }, ui.icon(ic, 34), h("span", { text: t((kind === "scrap" ? "scrap." : "stop.") + r) })))) });
    d.el.classList.add("st-dialog");
  }
  function resume() { if (!S.stopped) return; log("ok", "play", t("st.resumed") + " · " + t("stop." + S.stopped.reason)); S.stopped = null; draw(); scan.focus(); }

  // the connection is observed, never assumed: the real server's health every 10 s
  async function ping() {
    try { const r = await fetch("/api/health", { cache: "no-store" }); S.online = r.ok; } catch (_) { S.online = false; }
    draw();
  }
  const timer = setInterval(() => { clock.textContent = ui.fmtTime(); }, 1000);
  const health = setInterval(ping, 10000);
  clock.textContent = ui.fmtTime();
  log("ok", "play", t("st.resumed") + " · " + t("stop.changeover"));
  feedback("ok", t("st.ready"), t("st.ready_help"), "scan");
  draw();
  return { el, onActivate: () => setTimeout(() => scan.focus(), 30), onClose: () => { clearInterval(timer); clearInterval(health); } };
}
