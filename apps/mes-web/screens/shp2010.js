// SHP2010 Palletizing — a station at the end of the packing line: scan a finished set, it goes onto the open pallet of
// its product; the pallet closes by itself when full and the next scan opens a new one. Big, colour-coded feedback like
// the operator station; every scan is a command on the server (a held or unfinished set is refused there).
import * as ui from "/eco-ui/eco-ui.js";
import { api, ApiError, commandId, name, session, stamp, t } from "../common.js";

const { h } = ui;

export default function create({ shell }) {
  const me = session().user;
  const S = { busy: false, online: true, events: [] };
  const scan = h("input", { class: "st-scan-input", placeholder: t("shp.scan_set"), autocomplete: "off", spellcheck: "false", dir: "ltr" });
  scan.addEventListener("keydown", (ev) => { if (ev.key === "Enter" && scan.value.trim()) { onScan(scan.value.trim()); scan.value = ""; } });
  const lastBox = h("div", { class: "st-last" });
  const palletsBox = h("div", { class: "shp-pallets" });
  const events = h("ol", { class: "st-events" });
  const stock = h("div", { class: "shp-stock" });
  const el = h("div", { class: "st shp-station" },
    h("header", { class: "st-head" }, h("div", { class: "st-where" }, h("b", { class: "shp-title", text: t("scr.SHP2010") })),
      h("div", { class: "st-op" }, ui.avatar(me.name, 34), h("div", {}, h("b", { text: me.name }), h("small", {}, ui.ltr(me.login)))), h("span", { class: "eco-grow" }),
      ui.button({ label: t("shp.unpack"), icon: "x", onClick: () => unpack() })),
    h("div", { class: "st-main" },
      h("section", { class: "st-scan" }, h("label", { class: "st-scan-label" }, ui.icon("scan", 22), h("span", { text: t("shp.scan_set") })), scan, lastBox),
      h("aside", { class: "st-side" }, stock, h("div", { class: "st-events-head", text: t("st.recent") }), events)),
    h("section", { class: "shp-open" }, h("div", { class: "st-events-head", text: t("shp.open_pallets") }), palletsBox));

  function feedback(kind, title, text, ic) {
    ui.clear(lastBox, h("div", { class: "st-result st-r-" + kind }, ui.icon(ic, 44), h("div", {}, h("b", { text: title }), h("span", { text }))));
  }
  function log(kind, icon, text) { S.events.unshift({ kind, icon, text, at: ui.fmtTime() }); ui.clear(events, S.events.slice(0, 8).map((e) => h("li", { class: "st-ev st-ev-" + e.kind }, ui.icon(e.icon, 16), h("span", { text: e.text }), h("small", {}, ui.ltr(e.at))))); }
  async function onScan(serial) {
    if (S.busy) return;
    S.busy = true;
    try {
      const r = await api("POST", "/api/pallets/pack", { commandId: commandId(), serial });
      if (r.closed) { feedback("ok", t("shp.pallet_full", { pallet: r.pallet }), t("shp.pallet_full_help", { n: r.units }), "check-circle"); log("ok", "box", r.pallet + " · " + t("shp.closed")); }
      else feedback("ok", t("shp.packed", { serial: r.serial }), t("shp.on_pallet", { pallet: r.pallet, n: r.units, cap: r.capacity }), r.opened ? "plus" : "check-circle");
      log("ok", "check", r.serial + " → " + r.pallet + " (" + r.units + "/" + r.capacity + ")");
    } catch (e) {
      feedback("bad", t("st.refused", { what: serial }), e.message, "x-octagon"); log("bad", "x", serial + " · " + t("st.rejected"));
      if (e instanceof ApiError && e.code === "network") S.online = false;
    } finally { S.busy = false; await load(); scan.focus(); }
  }
  async function load() {
    try {
      const [open, fg] = await Promise.all([api("GET", "/api/pallets?status=open"), api("GET", "/api/fg-stock")]);
      ui.clear(palletsBox, open.length ? open.map((p) => h("div", { class: "shp-pallet" },
        h("div", { class: "shp-pallet-top" }, h("b", {}, ui.ltr(p.code)), ui.badge(p.line_code, "neutral")), h("span", { text: p.item_code + " · " + name(p) }),
        ui.progress(p.units, p.capacity, { label: p.units + " / " + p.capacity }), h("small", { class: "eco-muted" }, ui.ltr(stamp(p.opened_at))),
        ui.button({ label: t("shp.close_pallet"), icon: "check", size: "sm", onClick: () => closePallet(p) }))) : ui.empty({ icon: "box", title: t("shp.no_open") }));
      ui.clear(stock, h("div", { class: "st-events-head", text: t("shp.waiting") }), fg.filter((r) => r.loose || r.open || r.closed).map((r) => h("div", { class: "st-load" }, ui.icon("box", 16), h("span", { text: r.code }),
        h("b", {}, ui.ltr(String(r.loose))), h("small", { text: t("shp.loose") }))));
    } catch (e) { feedback("bad", t("err.title"), e.message, "x-octagon"); }
  }
  async function closePallet(p) {
    if (!(await ui.confirm({ title: t("shp.close_pallet") + " · " + p.code, text: t("shp.close_partial", { n: p.units, cap: p.capacity }), okLabel: t("shp.close_pallet") }))) return;
    try { await api("POST", `/api/pallets/${encodeURIComponent(p.code)}/close`, { commandId: commandId() }); log("warn", "box", p.code + " · " + t("shp.closed")); } catch (e) { feedback("bad", t("st.refused", { what: p.code }), e.message, "x-octagon"); }
    load();
  }
  function unpack() {
    const pal = ui.input({ dir: "ltr", placeholder: "PLT…" }), ser = ui.input({ dir: "ltr" }), why = ui.input({});
    const err = h("div", { class: "eco-span-2" });
    ui.dialog({ title: t("shp.unpack"), icon: "x", body: h("div", { class: "eco-form" }, ui.field(t("shp.pallet"), pal, { required: true }), ui.field(t("c.serial"), ser, { required: true }), ui.field(t("qms.reason"), why, { span: 2, required: true }), err),
      actions: [{ label: t("cancel"), kind: "ghost", value: false }, { label: t("shp.unpack"), kind: "primary", onClick: async () => {
        try { await api("POST", `/api/pallets/${encodeURIComponent(pal.value.trim())}/unpack`, { commandId: commandId(), serial: ser.value, reason: why.value }); } catch (e) { ui.clear(err, ui.banner("bad", e.message)); return false; }
        log("warn", "x", ser.value + " ← " + pal.value); load();
      } }] });
  }
  feedback("ok", t("st.ready"), t("shp.ready_help"), "scan");
  load();
  const timer = setInterval(load, 30000);
  return { el, onActivate: () => setTimeout(() => scan.focus(), 30), onClose: () => clearInterval(timer) };
}
