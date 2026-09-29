// MDM1070 Planning parameters — how each item is planned and bought: make or buy, lead time, minimum order, lot rule and
// safety stock. With Mizan they arrive with the item and are read-only here; a plant running manufacturing alone
// (it owns its items) sets them on this screen.
import * as ui from "/eco-ui/eco-ui.js";
import { api, can, session, showError, t } from "../common.js";
import { inquiryScreen } from "../views.js";

const { h } = ui;

export default function create({ shell }) {
  const own = session().plant.itemOwner === "gmes" && can("mdm.items.write");
  let current = null;
  const editBtn = ui.button({ label: t("edit"), icon: "edit", disabled: true, onClick: () => edit(current) });
  const v = inquiryScreen({ shell, code: "MDM1070", path: [t("m.master"), t("m.products")], auto: true, rowKey: "item_id", totals: false,
    note: own ? null : h("div", { class: "mes-pad" }, ui.banner("info", t("plan.owned_by_mizan"))),
    columns: [
      { key: "item_code", label: t("c.item"), type: "code", width: 140, frozen: true },
      { key: "name_en", label: t("c.name"), width: 200 },
      { key: "material_type", label: t("plan.material"), width: 120, value: (r) => (r.material_type ? t("plan.mt." + r.material_type) : "") },
      { key: "procurement", label: t("plan.procurement"), width: 100, value: (r) => (r.procurement ? t("plan.proc." + r.procurement) : "") },
      { key: "lead_time_days", label: t("plan.lead_time"), type: "number", width: 100 },
      { key: "moq", label: t("plan.moq"), type: "number", width: 90 },
      { key: "lot_rule", label: t("plan.lot_rule"), width: 150, value: (r) => (r.lot_rule ? t("plan.lot." + r.lot_rule) : "") },
      { key: "lot_size", label: t("plan.lot_size"), type: "number", width: 90 },
      { key: "safety_stock", label: t("plan.safety"), type: "number", width: 100 },
      { key: "default_supplier_code", label: t("plan.supplier"), width: 130 },
      { key: "expedite_lead_time_days", label: t("plan.expedite"), type: "number", width: 110 },
      { key: "set", label: t("plan.set"), width: 90, render: (r) => (r.material_type ? ui.icon("check", 14, "mes-ok") : ui.badge(t("plan.not_set"), "warn")) },
    ],
    load: async () => api("GET", "/api/item-planning"),
    toolbar: () => [editBtn],
  });
  v.onSelect((sel) => { current = sel[0] || null; editBtn.disabled = !own || !current; });
  function edit(r) {
    const mt = ui.select({ options: ["raw", "semi", "finished", "packaging", "service"].map((k) => [k, t("plan.mt." + k)]), value: r.material_type || "raw" });
    const proc = ui.select({ options: ["buy", "make"].map((k) => [k, t("plan.proc." + k)]), value: r.procurement || "buy" });
    const lead = ui.input({ value: r.lead_time_days ?? 0, type: "number" });
    const moq = ui.input({ value: r.moq ?? "0", dir: "ltr" });
    const rule = ui.select({ options: ["lot_for_lot", "fixed", "multiple"].map((k) => [k, t("plan.lot." + k)]), value: r.lot_rule || "lot_for_lot" });
    const size = ui.input({ value: r.lot_size ?? "0", dir: "ltr" });
    const safety = ui.input({ value: r.safety_stock ?? "0", dir: "ltr" });
    const sup = ui.input({ value: r.default_supplier_code || "", dir: "ltr" });
    const exp = ui.input({ value: r.expedite_lead_time_days ?? "", type: "number" });
    const err = h("div", { class: "eco-span-2" });
    ui.dialog({ title: r.item_code, icon: "sliders", body: h("div", { class: "eco-form" },
      ui.field(t("plan.material"), mt), ui.field(t("plan.procurement"), proc), ui.field(t("plan.lead_time"), lead, { required: true }), ui.field(t("plan.moq"), moq),
      ui.field(t("plan.lot_rule"), rule), ui.field(t("plan.lot_size"), size), ui.field(t("plan.safety"), safety), ui.field(t("plan.supplier"), sup),
      ui.field(t("plan.expedite"), exp, { hint: t("plan.expedite_hint") }), err),
    actions: [{ label: t("cancel"), kind: "ghost", value: false }, { label: t("save"), kind: "primary", icon: "save", onClick: async () => {
      try {
        await api("PUT", "/api/items/" + r.item_id + "/planning", { materialType: mt.value, procurement: proc.value, leadTimeDays: Number(lead.value), moq: moq.value || "0", lotRule: rule.value,
          lotSize: size.value || "0", safetyStock: safety.value || "0", defaultSupplierCode: sup.value.trim() || undefined, expediteLeadTimeDays: exp.value === "" ? undefined : Number(exp.value) });
      } catch (e) { showError(e, err); return false; }
      ui.toast({ kind: "ok", title: t("saved") }); v.run();
    } }] });
  }
  return { el: v.el };
}
