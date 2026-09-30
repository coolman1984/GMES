// QMS2040 Incoming lots — material received by accounting, waiting for inspection. Quality accepts, rejects, splits, holds
// or releases a lot; accounting moves the rejected or held quantity to the quality-hold warehouse. A lot that is not
// released can never be loaded on a station.
import * as ui from "/eco-ui/eco-ui.js";
import { api, can, showError, stamp, t } from "../common.js";
import { inquiryScreen } from "../views.js";

const { h } = ui;
const STATUSES = ["pending_iqc", "accepted", "partially_accepted", "rejected", "on_hold", "voided"];

export default function create({ shell }) {
  let current = null;
  const decideBtn = ui.button({ label: t("lot.decide"), icon: "check", kind: "primary", disabled: true, onClick: () => decide(current) });
  const v = inquiryScreen({ shell, code: "QMS2040", path: [t("g.quality"), t("m.inspection")], rowKey: "k", auto: true,
    fields: [{ key: "status", label: t("c.status"), type: "select", options: STATUSES.map((s) => [s, t("lot.st." + s)]), placeholder: t("all") }],
    columns: [
      { key: "status", label: t("c.status"), width: 130, frozen: true, value: (r) => t("lot.st." + r.status) },
      { key: "item_code", label: t("c.item"), type: "code", width: 110 },
      { key: "lot_no", label: t("c.lot"), type: "code", width: 150, total: "count" },
      { key: "qty", label: t("c.qty"), type: "number", width: 90 },
      { key: "accepted_qty", label: t("lot.accepted"), type: "number", width: 90, value: (r) => r.accepted_qty ?? "" },
      { key: "rejected_qty", label: t("lot.rejected"), type: "number", width: 90, value: (r) => r.rejected_qty ?? "" },
      { key: "supplier", label: t("c.supplier"), width: 110 },
      { key: "goods_receipt_code", label: t("lot.receipt"), type: "code", width: 120 },
      { key: "received_at", label: t("lot.received"), width: 140, value: (r) => stamp(r.received_at) },
      { key: "decided_by", label: t("lot.decided_by"), width: 100, value: (r) => r.decided_by ?? "" },
    ],
    load: async (c) => (await api("GET", "/api/qms/incoming-lots" + (c.status ? "?status=" + c.status : ""))).map((r) => ({ ...r, k: r.item_id + "|" + r.lot_no })),
    detail: async (r, host) => {
      current = r;
      decideBtn.disabled = !can("qms.release") || r.status === "voided";
      ui.clear(host, h("div", { class: "mes-detail-head" }, h("div", { class: "mes-detail-title" }, h("span", { class: "mes-detail-code" }, ui.ltr(r.lot_no)), ui.badge(t("lot.st." + r.status), r.status === "rejected" || r.status === "on_hold" ? "bad" : "info")),
        h("div", { class: "mes-detail-sub", text: r.item_code + " · " + (r.supplier || "") + " · " + (r.goods_receipt_code || "") })));
    },
    toolbar: () => [decideBtn],
  });

  function decide(r) {
    const decisions = r.status === "on_hold" ? ["released", "rejected"] : ["accepted", "rejected", "partially_accepted", "on_hold"];
    const pick = ui.select({ options: decisions.map((d) => [d, t("lot.dec." + d)]) });
    const acc = ui.input({ dir: "ltr", placeholder: t("lot.accepted") });
    const rej = ui.input({ dir: "ltr", placeholder: t("lot.rejected") });
    const defects = ui.input({ dir: "ltr", placeholder: "SCRATCH, CRACK" });
    const err = h("div", { class: "eco-span-2" });
    ui.dialog({ title: t("lot.decide") + " · " + r.lot_no, subtitle: r.item_code + " · " + r.qty, icon: "check", width: 560, body: h("div", { class: "eco-form" },
      ui.field(t("lot.decision"), pick, { required: true }), ui.field(t("lot.defects"), defects), ui.field(t("lot.accepted"), acc), ui.field(t("lot.rejected"), rej),
      h("p", { class: "eco-span-2 eco-muted", text: t("lot.decide_note") }), err),
    actions: [{ label: t("cancel"), kind: "ghost", value: false }, { label: t("save"), kind: "primary", icon: "save", onClick: async () => {
      try {
        await api("POST", "/api/qms/incoming-lots/decision", { itemId: r.item_id, lotNo: r.lot_no, decision: pick.value,
          defectCodes: defects.value.split(",").map((x) => x.trim()).filter(Boolean),
          ...(pick.value === "partially_accepted" ? { acceptedQty: acc.value.trim(), rejectedQty: rej.value.trim() } : {}) });
        ui.toast({ kind: "ok", title: t("lot.decided", { lot: r.lot_no }) });
      } catch (e) { showError(e, err); return false; }
      v.run();
    } }] });
  }
  return { el: v.el };
}
