// SHP2020 Shipping orders — what leaves the plant, for whom and where to: products and quantities, the container type and
// the loading date; its containers and how far each product is loaded and shipped. The customer is a name here: the
// customer record, the sale and the invoice belong to accounting.
import * as ui from "/eco-ui/eco-ui.js";
import { api, can, name, showError, stamp, t, today } from "../common.js";
import { inquiryScreen, rowsEditor } from "../views.js";

const { h } = ui;
const OST = { open: "planned", loading: "run", shipped: "done", cancelled: "closed" };

export default function create({ shell }) {
  const canWrite = can("shp.orders.write");
  let current = null;
  const editBtn = ui.button({ label: t("edit"), icon: "edit", disabled: true, onClick: () => edit(current) });
  const v = inquiryScreen({ shell, code: "SHP2020", path: [t("g.shipping"), t("m.shipping")], auto: true,
    fields: [{ key: "status", label: t("f.status"), type: "select", options: ["open", "loading", "shipped", "cancelled"].map((s) => [s, t("ost." + s)]), placeholder: t("all") }],
    columns: [
      { key: "status", label: t("c.status"), type: "status", width: 110, status: (r) => OST[r.status], label_of: (_s, r) => t("ost." + r.status), frozen: true },
      { key: "code", label: t("shp.order"), type: "code", width: 110, frozen: true, total: "count" },
      { key: "customer", label: t("shp.customer"), width: 200 },
      { key: "destination", label: t("shp.destination"), width: 160 },
      { key: "ship_date", label: t("shp.ship_date"), type: "date", width: 110 },
      { key: "container_type", label: t("c.type"), width: 70 },
      { key: "ordered", label: t("shp.ordered"), type: "number", width: 90, total: "sum" },
      { key: "loaded", label: t("shp.loaded_units"), type: "number", width: 90, total: "sum" },
      { key: "progress", label: t("c.progress"), type: "progress", width: 120, value: (r) => (r.ordered ? Math.round((r.loaded / r.ordered) * 100) : 0) },
      { key: "containers", label: t("shp.containers"), type: "number", width: 90 },
    ],
    load: async (c) => api("GET", "/api/shipping-orders" + (c.status ? "?status=" + c.status : "")),
    detail: async (r, host) => {
      current = r; editBtn.disabled = !canWrite || r.status === "shipped" || r.status === "cancelled";
      const o = await api("GET", "/api/shipping-orders/" + r.id);
      ui.clear(host, h("div", { class: "mes-detail-head" }, h("div", { class: "mes-detail-title" }, h("span", { class: "mes-detail-code" }, ui.ltr(o.code)), ui.statusChip(OST[o.status], t("ost." + o.status))),
        h("div", { class: "mes-detail-sub", text: o.customer + (o.destination ? " → " + o.destination : "") + " · " + o.ship_date })),
        ui.section(t("shp.lines"), h("div", { class: "shp-lines" }, o.lines.map((l) => h("div", { class: "shp-line" }, h("b", {}, ui.ltr(l.code)), h("span", { text: name(l) }),
          ui.progress(l.loaded, l.qty, { label: l.loaded + " / " + l.qty }), h("small", { class: "eco-muted", text: t("shp.shipped_n", { n: l.shipped }) }))))),
        ui.section(t("shp.containers"), o.containers.length ? h("table", { class: "mes-table" }, h("tbody", {}, o.containers.map((c) => h("tr", {},
          h("td", {}, ui.ltr(c.number)), h("td", { text: c.type }), h("td", {}, ui.statusChip(c.status === "dispatched" ? "done" : "run", t("cst." + c.status))),
          h("td", {}, ui.ltr(c.pallets + " / " + c.units)), h("td", {}, ui.ltr(c.seal || "")), h("td", {}, ui.ltr(stamp(c.dispatched_at || c.opened_at))))))) : h("p", { class: "mes-pad eco-muted", text: t("shp.no_containers") })),
        o.note ? h("p", { class: "mes-pad", text: o.note }) : null);
    },
    toolbar: () => [ui.button({ label: t("shp.new_order"), icon: "plus", kind: "primary", disabled: !canWrite, onClick: () => edit(null) }), editBtn],
  });
  async function edit(r) {
    let items, o = null;
    try { [items, o] = await Promise.all([api("GET", "/api/items"), r ? api("GET", "/api/shipping-orders/" + r.id) : null]); } catch (e) { showError(e); return; }
    const prods = items.filter((i) => i.active && i.kind === "product").map((i) => [i.id, i.code + " · " + name(i)]);
    const cust = ui.input({ value: o ? o.customer : "" }), dest = ui.input({ value: o ? o.destination || "" : "" }), date = ui.input({ type: "date", value: o ? o.ship_date : today() });
    const type = ui.select({ options: ["40HC", "40GP", "20GP", "TRUCK"].map((x) => [x, x]), value: o ? o.container_type : "40HC" }), note = ui.input({ value: o ? o.note || "" : "" });
    const ed = rowsEditor([{ key: "itemId", label: t("c.item"), kind: "select", options: prods }, { key: "qty", label: t("shp.ordered"), kind: "number", width: 110 }],
      o ? o.lines.map((l) => ({ itemId: l.item_id, qty: l.qty })) : [{}]);
    const err = h("div");
    ui.dialog({ title: o ? o.code : t("shp.new_order"), subtitle: "SHP2020", icon: "archive", width: 760, body: h("div", {}, h("div", { class: "eco-form" },
      ui.field(t("shp.customer"), cust, { required: true, hint: t("shp.customer_hint") }), ui.field(t("shp.destination"), dest), ui.field(t("shp.ship_date"), date, { required: true }), ui.field(t("c.type"), type),
      ui.field(t("eng.note"), note, { span: 2 })), h("h4", { text: t("shp.lines") }), ed.el, err),
    actions: [
      o ? { label: t("shp.cancel_order"), kind: "ghost", onClick: async () => {
        if (!(await ui.confirm({ title: t("shp.cancel_order"), text: o.code, danger: true }))) return false;
        try { await api("PUT", "/api/shipping-orders/" + o.id, { version: o.version, customer: o.customer, destination: o.destination || undefined, shipDate: o.ship_date, containerType: o.container_type, lines: o.lines.map((l) => ({ itemId: l.item_id, qty: l.qty })), cancel: true }); }
        catch (e) { ui.clear(err, ui.banner("bad", e.message)); return false; }
        v.run();
      } } : null,
      { label: t("cancel"), kind: "ghost", value: false },
      { label: t("save"), kind: "primary", icon: "save", onClick: async () => {
        const lines = ed.values().filter((l) => l.itemId && Number(l.qty) > 0).map((l) => ({ itemId: l.itemId, qty: Number(l.qty) }));
        const body = { customer: cust.value, destination: dest.value || undefined, shipDate: date.value, containerType: type.value, note: note.value || undefined, lines };
        try { if (o) await api("PUT", "/api/shipping-orders/" + o.id, { ...body, version: o.version }); else { const x = await api("POST", "/api/shipping-orders", body); ui.toast({ kind: "ok", title: t("act.created"), text: x.code }); } }
        catch (e) { ui.clear(err, ui.banner("bad", e.message)); return false; }
        v.run();
      } }].filter(Boolean) });
  }
  return { el: v.el };
}
