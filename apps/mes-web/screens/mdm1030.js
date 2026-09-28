// MDM1030 Units of measure — owned by accounting (Mizan) when it is connected (they travel inside each item); when
// manufacturing runs alone it names them here. Every unit used by an item is listed, named or not.
import * as ui from "/eco-ui/eco-ui.js";
import { api, can, session, showError, t } from "../common.js";
import { inquiryScreen } from "../views.js";

const { h } = ui;

export default function create({ shell }) {
  const own = session().plant.itemOwner === "gmes" && can("mdm.items.write");
  let current = null;
  const editBtn = ui.button({ label: t("edit"), icon: "edit", disabled: true, onClick: () => edit(current) });
  const v = inquiryScreen({ shell, code: "MDM1030", path: [t("m.master"), t("m.products")], auto: true, totals: false,
    note: own ? null : h("div", { class: "mes-pad" }, ui.banner("info", t("uom.owned_by_mizan"))),
    rowKey: "code",
    columns: [
      { key: "code", label: t("c.code"), type: "code", width: 90, frozen: true },
      { key: "name_en", label: t("c.name") + " (EN)", width: 180 },
      { key: "name_ar", label: t("c.name") + " (AR)", width: 180 },
      { key: "decimals", label: t("uom.decimals"), type: "number", width: 90 },
      { key: "items", label: t("uom.items"), type: "number", width: 90 },
      { key: "defined", label: t("uom.named"), width: 100, render: (r) => (r.defined ? ui.icon("check", 14, "mes-ok") : ui.badge(t("uom.unnamed"), "warn")) },
    ],
    load: async () => (await api("GET", "/api/uoms")).units,
    toolbar: () => [ui.button({ label: t("uom.new"), icon: "plus", disabled: !own, onClick: () => edit(null) }), editBtn],
  });
  v.onSelect((sel) => { current = sel[0] || null; editBtn.disabled = !own || !current; });
  function edit(u) {
    const code = ui.input({ value: u ? u.code : "", dir: "ltr", readonly: !!u }), en = ui.input({ value: u ? u.name_en : "" }), ar = ui.input({ value: u ? u.name_ar : "", dir: "rtl" });
    const dec = ui.select({ options: [0, 1, 2, 3].map((n) => [String(n), String(n)]), value: String(u ? u.decimals : 0) });
    const err = h("div", { class: "eco-span-2" });
    ui.dialog({ title: u ? u.code : t("uom.new"), icon: "scale", body: h("div", { class: "eco-form" }, ui.field(t("c.code"), code, { required: true }), ui.field(t("uom.decimals"), dec, { hint: t("uom.decimals_hint") }),
      ui.field(t("c.name") + " (EN)", en, { required: true }), ui.field(t("c.name") + " (AR)", ar), err),
    actions: [{ label: t("cancel"), kind: "ghost", value: false }, { label: t("save"), kind: "primary", icon: "save", onClick: async () => {
      try { await api("PUT", "/api/uoms/" + encodeURIComponent(code.value.trim()), { nameEn: en.value, nameAr: ar.value || undefined, decimals: Number(dec.value) }); } catch (e) { showError(e, err); return false; }
      ui.toast({ kind: "ok", title: t("saved") }); v.run();
    } }] });
  }
  return { el: v.el };
}
