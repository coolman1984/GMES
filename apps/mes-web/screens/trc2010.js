// TRC2010 Material lots — supplier lots registered on receipt (when manufacturing owns its materials; with accounting
// connected, receipts are recorded there and a lot scanned on a station is marked "not verified"), and the lots loaded
// on stations right now.
import * as ui from "/eco-ui/eco-ui.js";
import { api, can, name, session, showError, stamp, t } from "../common.js";
import { inquiryScreen } from "../views.js";

const { h } = ui;

export default function create({ shell }) {
  const own = session().plant.itemOwner === "gmes" && can("trk.materials.write");
  const v = inquiryScreen({ shell, code: "TRC2010", path: [t("g.trace"), t("m.genealogy")], rowKey: "key", auto: true,
    fields: [{ key: "view", label: t("trc.show"), type: "toggle", options: [["lots", t("trc.lots")], ["loads", t("trc.loads")]], default: "lots" },
      { key: "item", label: t("f.item"), placeholder: t("ph.item") }, { key: "lot", label: t("c.lot"), dir: "ltr" }],
    columns: [
      { key: "item_code", label: t("c.item"), type: "code", width: 120, frozen: true, total: "count" },
      { key: "iname", label: t("c.item_name"), width: 190, value: (r) => name(r) },
      { key: "lot_no", label: t("c.lot"), type: "code", width: 150 },
      { key: "where", label: t("trc.supplier_or_station"), width: 160 },
      { key: "qty", label: t("c.qty"), width: 90, align: "end" },
      { key: "use", label: t("trc.used_in"), type: "number", width: 90 },
      { key: "at", label: t("c.time"), width: 140 },
      { key: "by", label: t("c.user"), width: 120 },
      { key: "state", label: t("c.status"), width: 130, render: (r) => r.state ? ui.badge(t("trc." + r.state), r.state === "unverified" ? "warn" : r.state === "loaded" ? "accent" : "neutral") : "" },
    ],
    load: async (c) => {
      if (c.view === "loads") {
        const rows = await api("GET", "/api/loads");
        const it = (c.item || "").toLowerCase(), lot = (c.lot || "").toUpperCase();
        return rows.filter((r) => (!it || (r.item_code + " " + name(r)).toLowerCase().includes(it)) && (!lot || r.lot_no.includes(lot)))
          .map((r) => ({ ...r, key: "L" + r.id, where: r.station, qty: "", use: r.units, at: stamp(r.loaded_at), by: r.loaded_by, state: r.verified ? "loaded" : "unverified" }));
      }
      const rows = await api("GET", "/api/material-lots?" + new URLSearchParams({ item: c.item || "", lot: c.lot || "" }));
      return rows.map((r) => ({ ...r, key: r.item_id + r.lot_no, where: [r.supplier, r.supplier_lot].filter(Boolean).join(" · "), qty: r.qty + " " + r.base_uom, use: r.used_in, at: stamp(r.received_at), by: r.received_by,
        state: r.loaded_now ? "loaded" : r.expires_on && r.expires_on < new Date().toISOString().slice(0, 10) ? "expired" : "" }));
    },
    toolbar: () => [ui.button({ label: t("trc.receive"), icon: "plus", disabled: !own, onClick: () => receive() })],
    note: own ? null : h("div", { class: "mes-pad" }, ui.banner("info", t("trc.owned_by_mizan"))),
  });
  async function receive() {
    let items; try { items = (await api("GET", "/api/items")).filter((i) => i.active && i.stock_tracked); } catch (e) { showError(e); return; }
    const item = ui.select({ options: [["", "—"]].concat(items.map((i) => [i.id, i.code + " · " + name(i)])) });
    const lot = ui.input({ dir: "ltr" }), qty = ui.input({ dir: "ltr" }), sup = ui.input({}), slot = ui.input({ dir: "ltr" }), exp = ui.input({ type: "date" });
    const err = h("div", { class: "eco-span-2" });
    ui.dialog({ title: t("trc.receive"), subtitle: "TRC2010", icon: "box", width: 620, body: h("div", { class: "eco-form" },
      ui.field(t("f.item"), item, { required: true, span: 2 }), ui.field(t("c.lot"), lot, { required: true }), ui.field(t("c.qty"), qty, { required: true, hint: t("hint.qty_exact") }),
      ui.field(t("trc.supplier"), sup), ui.field(t("trc.supplier_lot"), slot), ui.field(t("trc.expires"), exp), err),
    actions: [{ label: t("cancel"), kind: "ghost", value: false }, { label: t("save"), kind: "primary", icon: "save", onClick: async () => {
      try { await api("POST", "/api/material-lots", { itemId: item.value, lotNo: lot.value, qty: qty.value, supplier: sup.value || undefined, supplierLot: slot.value || undefined, expiresOn: exp.value || undefined }); }
      catch (e) { showError(e, err); return false; }
      ui.toast({ kind: "ok", title: t("saved"), text: lot.value }); v.run();
    } }] });
  }
  return { el: v.el };
}
