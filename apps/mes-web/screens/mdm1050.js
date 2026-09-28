// MDM1050 Routings — the operations a unit passes, in order, with their kind and ideal cycle time. A draft is edited;
// approving it freezes it for ever (a work order keeps the revision it was released with). The station that performs an
// operation on a line is <line>-<operation code>, so the routing and the plant model meet by code.
import * as ui from "/eco-ui/eco-ui.js";
import { api, can, name, showError, stamp, t } from "../common.js";
import { inquiryScreen, rowsEditor } from "../views.js";

const { h } = ui;
const KINDS = ["work", "test", "inspection", "pack"];
const statusKind = { draft: "planned", approved: "done", obsolete: "closed" };

export default function create({ shell }) {
  const canWrite = can("eng.write"), canApprove = can("eng.approve");
  const act = {
    add: ui.button({ label: t("eng.new_revision"), icon: "plus", disabled: !canWrite, onClick: () => newRevision() }),
    edit: ui.button({ label: t("edit"), icon: "edit", disabled: true, onClick: () => edit(current) }),
    approve: ui.button({ label: t("eng.approve"), icon: "check", disabled: true, onClick: () => approve(current) }),
  };
  let current = null;
  const v = inquiryScreen({ shell, code: "MDM1050", path: [t("m.master"), t("m.products")], auto: true,
    fields: [
      { key: "item", label: t("f.item"), placeholder: t("ph.item") },
      { key: "status", label: t("f.status"), type: "select", options: ["draft", "approved", "obsolete"].map((s) => [s, t("rev." + s)]), placeholder: t("all") },
    ],
    columns: [
      { key: "status", label: t("c.status"), type: "status", width: 110, status: (r) => statusKind[r.status], label_of: (_s, r) => t("rev." + r.status), frozen: true },
      { key: "item_code", label: t("c.item"), type: "code", width: 120, frozen: true, total: "count" },
      { key: "item_name", label: t("c.item_name"), width: 220, value: (r) => name(r) },
      { key: "revision", label: t("c.revision"), type: "number", width: 80 },
      { key: "ops", label: t("eng.operations"), type: "number", width: 100 },
      { key: "approved_at", label: t("eng.approved_at"), width: 140, value: (r) => stamp(r.approved_at) },
      { key: "approved_by", label: t("eng.approved_by"), width: 120 },
      { key: "created_by", label: t("eng.created_by"), width: 120, hidden: true },
    ],
    load: async (c) => api("GET", "/api/routings?" + new URLSearchParams({ item: c.item || "", status: c.status || "" })),
    detail: async (r, host) => {
      current = r;
      act.edit.disabled = !canWrite || r.status !== "draft";
      act.approve.disabled = !canApprove || r.status !== "draft";
      const d = await api("GET", "/api/routings/" + r.id);
      const opGrid = ui.grid([
        { key: "seq", label: t("c.seq"), type: "number", width: 60 },
        { key: "code", label: t("c.code"), type: "code", width: 70 },
        { key: "name", label: t("c.name"), width: 190, value: (o) => name(o) },
        { key: "kind", label: t("c.type"), width: 100, value: (o) => t("opk." + o.kind) },
        { key: "mandatory", label: t("eng.mandatory"), width: 90, align: "center", render: (o) => o.mandatory ? ui.icon("check", 14, "mes-ok") : "—" },
        { key: "cycle", label: t("eng.cycle_sec"), type: "number", digits: 1, width: 90, value: (o) => (o.cycle_ms ? o.cycle_ms / 1000 : null) },
      ], { rows: d.operations, layoutKey: "MDM1050-ops" });
      ui.clear(host,
        h("div", { class: "mes-detail-head" }, h("div", { class: "mes-detail-title" }, h("span", { class: "mes-detail-code" }, ui.ltr(r.item_code + " · R" + r.revision)),
          ui.statusChip(statusKind[r.status], t("rev." + r.status))), h("div", { class: "mes-detail-sub", text: name(r) + (d.note ? " — " + d.note : "") })),
        h("div", { class: "mes-route-flow" }, d.operations.map((o, i) => [i ? ui.icon("chev-right", 12) : null, h("span", { class: "mes-op mes-op-" + o.kind }, ui.ltr(o.code))])),
        h("div", { class: "mes-fill-grid" }, opGrid.el),
        h("p", { class: "mes-pad eco-muted", text: t("eng.station_rule") }));
    },
    toolbar: () => [act.add, act.edit, act.approve],
  });

  async function newRevision() {
    let items;
    try { items = (await api("GET", "/api/items")).filter((i) => i.active && i.kind === "product"); } catch (e) { showError(e); return; }
    const item = ui.select({ options: [["", "—"]].concat(items.map((i) => [i.id, i.code + " · " + name(i)])) });
    const note = ui.input({});
    const err = h("div", { class: "eco-span-2" });
    ui.dialog({ title: t("eng.new_revision"), subtitle: "MDM1050", icon: "list", body: h("div", { class: "eco-form" },
      ui.field(t("f.item"), item, { required: true, span: 2, hint: t("eng.copy_hint") }), ui.field(t("eng.note"), note, { span: 2 }), err),
    actions: [{ label: t("cancel"), kind: "ghost", value: false }, { label: t("act.create"), kind: "primary", icon: "check", onClick: async () => {
      if (!item.value) { ui.clear(err, ui.banner("bad", t("err.required"))); return false; }
      try { const r = await api("POST", "/api/routings", { itemId: item.value, note: note.value || undefined }); ui.toast({ kind: "ok", title: t("act.created"), text: "R" + r.revision }); }
      catch (e) { showError(e, err); return false; }
      v.run();
    } }] });
  }
  async function edit(r) {
    const d = await api("GET", "/api/routings/" + r.id);
    const ed = rowsEditor([
      { key: "seq", label: t("c.seq"), kind: "number", width: 70 }, { key: "code", label: t("c.code"), width: 80, dir: "ltr" },
      { key: "nameEn", label: t("c.name") + " (EN)" }, { key: "nameAr", label: t("c.name") + " (AR)", dir: "rtl" },
      { key: "kind", label: t("c.type"), kind: "select", options: KINDS.map((k) => [k, t("opk." + k)]), width: 120 },
      { key: "mandatory", label: t("eng.mandatory"), kind: "check", width: 60 }, { key: "cycleSec", label: t("eng.cycle_sec"), kind: "number", width: 90 },
    ], d.operations.map((o) => ({ seq: o.seq, code: o.code, nameEn: o.name_en, nameAr: o.name_ar, kind: o.kind, mandatory: !!o.mandatory, cycleSec: o.cycle_ms ? o.cycle_ms / 1000 : "" })));
    const err = h("div");
    ui.dialog({ title: t("eng.edit_routing", { code: r.item_code, rev: r.revision }), subtitle: t("rev.draft"), icon: "list", width: 980, body: h("div", {}, ed.el, err),
      actions: [{ label: t("cancel"), kind: "ghost", value: false }, { label: t("save"), kind: "primary", icon: "save", onClick: async () => {
        const ops = ed.values().filter((o) => o.code).map((o) => ({ seq: Number(o.seq), code: o.code, nameEn: o.nameEn || o.code, nameAr: o.nameAr || undefined, kind: o.kind,
          mandatory: o.mandatory, cycleSec: o.cycleSec ? Number(o.cycleSec) : undefined }));
        try { await api("PUT", "/api/routings/" + r.id, { version: d.version, operations: ops }); } catch (e) { showError(e, err); return false; }
        ui.toast({ kind: "ok", title: t("saved") }); v.run();
      } }] });
  }
  async function approve(r) {
    const d = await api("GET", "/api/routings/" + r.id);
    if (!(await ui.confirm({ title: t("eng.approve"), text: t("eng.approve_text", { code: r.item_code, rev: r.revision }), okLabel: t("eng.approve") }))) return;
    try { await api("POST", `/api/routings/${r.id}/approve`, { version: d.version }); ui.toast({ kind: "ok", title: t("eng.approved") }); } catch (e) { showError(e); }
    v.run();
  }
  return { el: v.el };
}
