// SHP2030 Container loading — the loading dock: choose the shipping order, open (or pick) the container at the door, and
// scan each pallet as the forklift loads it. The server checks every pallet (closed, inspected, not held, ordered, room in
// the container) and answers big and in colour. Sealing the container dispatches it.
import * as ui from "/eco-ui/eco-ui.js";
import { api, commandId, showError, t } from "../common.js";

const { h } = ui;

export default function create({ shell }) {
  const S = { orders: [], order: null, container: null, events: [], busy: false };
  const orderSel = ui.select({ options: [], onChange: (v) => { pickOrder(v); } });
  const contSel = ui.select({ options: [], onChange: (v) => { S.container = (S.order ? S.order.containers : []).find((c) => c.id === v) || null; draw(); } });
  orderSel.classList.add("st-pick"); contSel.classList.add("st-pick");
  const scan = h("input", { class: "st-scan-input", placeholder: t("shp.scan_pallet"), autocomplete: "off", spellcheck: "false", dir: "ltr" });
  scan.addEventListener("keydown", (ev) => { if (ev.key === "Enter" && scan.value.trim()) { load1(scan.value.trim()); scan.value = ""; } });
  const lastBox = h("div", { class: "st-last" }), side = h("aside", { class: "st-side" }), events = h("ol", { class: "st-events" });
  const contBox = h("div", { class: "shp-container" });
  const el = h("div", { class: "st shp-station" },
    h("header", { class: "st-head" }, h("div", { class: "st-where" }, orderSel, contSel), h("span", { class: "eco-grow" }),
      ui.button({ label: t("shp.open_container"), icon: "plus", onClick: () => openContainer() }), ui.button({ label: t("shp.seal_dispatch"), icon: "lock", kind: "primary", onClick: () => dispatch() })),
    h("div", { class: "st-main" }, h("section", { class: "st-scan" }, h("label", { class: "st-scan-label" }, ui.icon("scan", 22), h("span", { text: t("shp.scan_pallet") })), scan, lastBox, contBox),
      h("aside", { class: "st-side" }, side, h("div", { class: "st-events-head", text: t("st.recent") }), events)));

  function feedback(kind, title, text, ic) { ui.clear(lastBox, h("div", { class: "st-result st-r-" + kind }, ui.icon(ic, 44), h("div", {}, h("b", { text: title }), h("span", { text })))); }
  function log(kind, icon, text) { S.events.unshift({ kind, icon, text, at: ui.fmtTime() }); ui.clear(events, S.events.slice(0, 8).map((e) => h("li", { class: "st-ev st-ev-" + e.kind }, ui.icon(e.icon, 16), h("span", { text: e.text }), h("small", {}, ui.ltr(e.at))))); }
  function draw() {
    const o = S.order;
    ui.clear(side, o ? [h("div", { class: "st-events-head", text: o.code + " · " + o.customer }), h("small", { class: "eco-muted", text: (o.destination || "") + " · " + o.ship_date }),
      o.lines.map((l) => h("div", { class: "shp-line" }, h("b", {}, ui.ltr(l.code)), ui.progress(l.loaded, l.qty, { label: l.loaded + " / " + l.qty, status: l.loaded >= l.qty ? "done" : "run" })))] : ui.empty({ icon: "archive", title: t("shp.no_orders") }));
    ui.clear(contSel, (o ? o.containers.filter((c) => c.status === "loading") : []).map((c) => h("option", { value: c.id, text: c.number + " · " + c.type + " · " + c.pallets + " " + t("shp.pallets") })));
    if (S.container) contSel.value = S.container.id;
    const c = S.container;
    ui.clear(contBox, c ? h("div", { class: "shp-cont-card" }, ui.icon("archive", 28), h("div", {}, h("b", {}, ui.ltr(c.number)), h("span", { text: c.type + " · " + (c.truck || "") })),
      h("div", { class: "shp-cont-nums" }, h("b", {}, ui.ltr(String(c.pallets))), h("small", { text: t("shp.pallets") }), h("b", {}, ui.ltr(String(c.units))), h("small", { text: t("hold.units") }))) : ui.banner("info", t("shp.open_first")));
  }
  async function loadOrders(keep) {
    try {
      S.orders = (await api("GET", "/api/shipping-orders")).filter((o) => o.status === "open" || o.status === "loading");
      ui.clear(orderSel, S.orders.length ? S.orders.map((o) => h("option", { value: o.id, text: o.code + " · " + o.customer + " · " + o.ship_date })) : [h("option", { value: "", text: t("shp.no_orders") })]);
      const id = keep || (S.order && S.order.id) || (S.orders[0] || {}).id;
      if (id) { orderSel.value = id; await pickOrder(id); } else { S.order = null; draw(); }
    } catch (e) { showError(e); }
  }
  async function pickOrder(id) {
    try { S.order = await api("GET", "/api/shipping-orders/" + id); } catch (e) { showError(e); return; }
    const open = S.order.containers.filter((c) => c.status === "loading");
    S.container = open.find((c) => S.container && c.id === S.container.id) || open[0] || null;
    draw(); scan.focus();
  }
  async function load1(pallet) {
    if (!S.container || S.busy) { feedback("warn", t("shp.open_first"), "", "archive"); return; }
    S.busy = true;
    try {
      const r = await api("POST", `/api/containers/${S.container.id}/load`, { commandId: commandId(), pallet });
      feedback("ok", t("shp.loaded", { pallet: r.pallet }), t("shp.loaded_help", { item: r.item, units: r.units, done: r.orderLoaded, qty: r.orderQty, fill: r.fill }), "check-circle");
      log("ok", "check", r.pallet + " → " + r.container);
    } catch (e) { feedback("bad", t("st.refused", { what: pallet }), e.message, "x-octagon"); log("bad", "x", pallet + " · " + t("st.rejected")); }
    finally { S.busy = false; await pickOrder(S.order.id); }
  }
  function openContainer() {
    if (!S.order) return;
    const no = ui.input({ dir: "ltr", placeholder: "CSQU3054383" }), type = ui.select({ options: ["40HC", "40GP", "20GP", "TRUCK"].map((x) => [x, x]), value: S.order.container_type });
    const truck = ui.input({ dir: "ltr" }), driver = ui.input({});
    const err = h("div", { class: "eco-span-2" });
    ui.dialog({ title: t("shp.open_container"), subtitle: S.order.code, icon: "archive", body: h("div", { class: "eco-form" }, ui.field(t("shp.container_no"), no, { required: true, hint: t("shp.iso_hint") }), ui.field(t("c.type"), type),
      ui.field(t("shp.truck"), truck), ui.field(t("shp.driver"), driver), err),
    actions: [{ label: t("cancel"), kind: "ghost", value: false }, { label: t("act.create"), kind: "primary", icon: "check", onClick: async () => {
      try { const c = await api("POST", `/api/shipping-orders/${S.order.id}/containers`, { commandId: commandId(), number: no.value, type: type.value, truck: truck.value || undefined, driver: driver.value || undefined });
        S.container = { id: c.id }; log("ok", "archive", c.number); } catch (e) { ui.clear(err, ui.banner("bad", e.message)); return false; }
      await pickOrder(S.order.id);
    } }] });
  }
  function dispatch() {
    if (!S.container) return;
    const seal = ui.input({ dir: "ltr" });
    const err = h("div", { class: "eco-span-2" });
    const c = S.order.containers.find((x) => x.id === S.container.id) || S.container;
    ui.dialog({ title: t("shp.seal_dispatch") + " · " + c.number, subtitle: t("shp.dispatch_help", { pallets: c.pallets, units: c.units }), icon: "lock", body: h("div", { class: "eco-form" }, ui.field(t("shp.seal"), seal, { required: true, span: 2 }), err),
      actions: [{ label: t("cancel"), kind: "ghost", value: false }, { label: t("shp.seal_dispatch"), kind: "primary", icon: "lock", onClick: async () => {
        try { const r = await api("POST", `/api/containers/${c.id}/dispatch`, { commandId: commandId(), seal: seal.value });
          feedback("ok", t("shp.dispatched", { container: r.container }), t("shp.dispatched_help", { pallets: r.pallets, units: r.units }), "check-circle"); log("ok", "lock", r.container + " · " + r.seal);
          S.container = null; } catch (e) { ui.clear(err, ui.banner("bad", e.message)); return false; }
        await loadOrders();
      } }] });
  }
  feedback("ok", t("st.ready"), t("shp.dock_help"), "scan");
  loadOrders();
  return { el, onActivate: () => setTimeout(() => scan.focus(), 30) };
}
