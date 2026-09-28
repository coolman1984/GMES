// QMS2020 Hold and release — stop suspect units wherever they are (a unit, a list of serials, a work order, every product
// containing a material lot, a pallet); units already shipped are counted as the recall list. Releasing is a decision
// signed with the person's own password, with a disposition: release, rework (back to repair) or scrap.
import * as ui from "/eco-ui/eco-ui.js";
import { api, can, commandId, showError, stamp, t } from "../common.js";
import { inquiryScreen, unitChip } from "../views.js";

const { h } = ui;

export default function create({ shell }) {
  let current = null;
  const relBtn = ui.button({ label: t("qms.release"), icon: "key", disabled: true, onClick: () => release(current) });
  const v = inquiryScreen({ shell, code: "QMS2020", path: [t("g.quality"), t("m.holds")], auto: true,
    fields: [{ key: "status", label: t("f.status"), type: "toggle", options: [["open", t("hold.open")], ["released", t("hold.released")], ["", t("all")]], default: "open" }],
    columns: [
      { key: "status", label: t("c.status"), type: "status", width: 110, status: (r) => (r.status === "open" ? "hold" : "done"), label_of: (_s, r) => t("hold." + r.status), frozen: true },
      { key: "code", label: t("c.code"), type: "code", width: 110, frozen: true, total: "count" },
      { key: "target", label: t("qms.target"), width: 220, value: (r) => t("ht." + r.target_type) + ": " + r.target },
      { key: "reason", label: t("qms.reason"), width: 240 },
      { key: "units", label: t("hold.units"), type: "number", width: 80, total: "sum" },
      { key: "shipped", label: t("hold.shipped"), type: "number", width: 90, render: (r) => (r.shipped ? h("span", { class: "mes-bad", text: String(r.shipped) }) : "0") },
      { key: "held_at", label: t("hold.held_at"), width: 140, value: (r) => stamp(r.held_at) },
      { key: "held_by", label: t("hold.held_by"), width: 110 },
      { key: "disposition", label: t("hold.disposition"), width: 110, value: (r) => (r.disposition ? t("disp." + r.disposition) : "") },
      { key: "signed_by", label: t("hold.signed_by"), width: 170 },
    ],
    load: async (c) => api("GET", "/api/qms/holds?status=" + (c.status || "")),
    detail: async (r, host) => {
      current = r; relBtn.disabled = !can("qms.release") || r.status !== "open";
      const d = await api("GET", "/api/qms/holds/" + r.id);
      const g = ui.grid([{ key: "st", label: t("c.status"), width: 110, render: (u) => unitChip(u.status) }, { key: "serial", label: t("c.serial"), type: "code", width: 140 },
        { key: "item_code", label: t("c.item"), type: "code", width: 100 }, { key: "wo_code", label: t("c.wo"), type: "code", width: 140 }, { key: "op_code", label: t("c.op"), type: "code", width: 60 },
        { key: "held", label: t("wip.held"), width: 60, render: (u) => (u.held ? ui.icon("lock", 13) : "") }], { rows: d.list, layoutKey: "QMS2020-units" });
      ui.clear(host, h("div", { class: "mes-detail-head" }, h("div", { class: "mes-detail-title" }, h("span", { class: "mes-detail-code" }, ui.ltr(d.code)),
        ui.statusChip(d.status === "open" ? "hold" : "done", t("hold." + d.status))), h("div", { class: "mes-detail-sub", text: d.reason })),
        d.shipped ? h("div", { class: "mes-pad" }, ui.banner("warn", t("hold.recall", { n: d.shipped }))) : null,
        d.status === "released" ? ui.props([[t("hold.disposition"), t("disp." + d.disposition)], [t("hold.decision"), d.decision], [t("hold.signed_by"), d.signed_by], [t("c.time"), ui.ltr(stamp(d.released_at))]]) : null,
        h("div", { class: "mes-fill-grid" }, g.el));
    },
    toolbar: () => [ui.button({ label: t("qms.new_hold"), icon: "lock", kind: "primary", disabled: !can("qms.hold"), onClick: () => newHold() }), relBtn],
  });
  function newHold() {
    const type = ui.select({ options: ["unit", "serials", "work_order", "material_lot", "pallet"].map((x) => [x, t("ht." + x)]), value: "work_order" });
    const target = h("textarea", { class: "eco-input", rows: 3, dir: "ltr" }), item = ui.input({ dir: "ltr", placeholder: t("trc.item_code") }), reason = ui.input({});
    const err = h("div", { class: "eco-span-2" });
    ui.dialog({ title: t("qms.new_hold"), subtitle: "QMS2020", icon: "lock", width: 620, body: h("div", { class: "eco-form" },
      ui.field(t("qms.target_type"), type), ui.field(t("trc.item_code"), item, { hint: t("hold.item_hint") }), ui.field(t("qms.target"), target, { span: 2, hint: t("hold.target_hint") }),
      ui.field(t("qms.reason"), reason, { span: 2, required: true }), err),
    actions: [{ label: t("cancel"), kind: "ghost", value: false }, { label: t("qms.hold_now"), kind: "primary", icon: "lock", onClick: async () => {
      try {
        const r = await api("POST", "/api/qms/holds", { commandId: commandId(), targetType: type.value, target: target.value.trim(), item: item.value || undefined, reason: reason.value });
        ui.toast({ kind: "warn", title: t("hold.placed", { code: r.code, n: r.units }), text: r.shipped ? t("hold.recall", { n: r.shipped }) : "", keep: true });
      } catch (e) { showError(e, err); return false; }
      v.run();
    } }] });
  }
  function release(r) {
    const disp = ui.select({ options: ["release", "rework", "scrap"].map((x) => [x, t("disp." + x)]), value: "release" });
    const decision = h("textarea", { class: "eco-input", rows: 3 }), pw = ui.input({ type: "password", autocomplete: "current-password" });
    const err = h("div", { class: "eco-span-2" });
    ui.dialog({ title: t("qms.release") + " · " + r.code, subtitle: t("hold.sign_help"), icon: "key", width: 560, body: h("div", { class: "eco-form" },
      ui.field(t("hold.disposition"), disp, { span: 2, hint: t("hold.disp_hint") }), ui.field(t("hold.decision"), decision, { span: 2, required: true }),
      ui.field(t("hold.password"), pw, { span: 2, required: true, hint: t("hold.password_hint") }), err),
    actions: [{ label: t("cancel"), kind: "ghost", value: false }, { label: t("hold.sign_release"), kind: "primary", icon: "key", onClick: async () => {
      try { const x = await api("POST", `/api/qms/holds/${r.id}/release`, { commandId: commandId(), disposition: disp.value, decision: decision.value, password: pw.value });
        ui.toast({ kind: "ok", title: t("hold.released_n", { code: x.code, n: x.units }) }); }
      catch (e) { showError(e, err); return false; }
      v.run();
    } }] });
  }
  return { el: v.el };
}
