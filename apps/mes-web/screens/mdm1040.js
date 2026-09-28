// MDM1040 Bills of materials — what each operation of a product consumes, and how the station takes it: the part's own
// serial (a key part, e.g. the main board), a lot loaded on the station (e.g. cartons), or nothing (backflushed: screws).
// Same revision rule as routings: a draft is edited, an approved revision is frozen.
import * as ui from "/eco-ui/eco-ui.js";
import { api, can, name, showError, stamp, t } from "../common.js";
import { inquiryScreen, rowsEditor } from "../views.js";

const { h } = ui;
const statusKind = { draft: "planned", approved: "done", obsolete: "closed" };

export default function create({ shell }) {
  const canWrite = can("eng.write"), canApprove = can("eng.approve");
  let current = null;
  const act = {
    add: ui.button({ label: t("eng.new_revision"), icon: "plus", disabled: !canWrite, onClick: () => newRevision() }),
    edit: ui.button({ label: t("edit"), icon: "edit", disabled: true, onClick: () => edit(current) }),
    approve: ui.button({ label: t("eng.approve"), icon: "check", disabled: true, onClick: () => approve(current) }),
    used: ui.button({ label: t("eng.where_used"), icon: "link", onClick: () => whereUsed() }),
  };
  const v = inquiryScreen({ shell, code: "MDM1040", path: [t("m.master"), t("m.products")], auto: true,
    fields: [
      { key: "item", label: t("f.item"), placeholder: t("ph.item") },
      { key: "status", label: t("f.status"), type: "select", options: ["draft", "approved", "obsolete"].map((s) => [s, t("rev." + s)]), placeholder: t("all") },
    ],
    columns: [
      { key: "status", label: t("c.status"), type: "status", width: 110, status: (r) => statusKind[r.status], label_of: (_s, r) => t("rev." + r.status), frozen: true },
      { key: "item_code", label: t("c.item"), type: "code", width: 120, frozen: true, total: "count" },
      { key: "item_name", label: t("c.item_name"), width: 220, value: (r) => name(r) },
      { key: "revision", label: t("c.revision"), type: "number", width: 80 },
      { key: "lines", label: t("eng.components"), type: "number", width: 100 },
      { key: "approved_at", label: t("eng.approved_at"), width: 140, value: (r) => stamp(r.approved_at) },
      { key: "approved_by", label: t("eng.approved_by"), width: 120 },
    ],
    load: async (c) => api("GET", "/api/boms?" + new URLSearchParams({ item: c.item || "", status: c.status || "" })),
    detail: async (r, host) => {
      current = r;
      act.edit.disabled = !canWrite || r.status !== "draft";
      act.approve.disabled = !canApprove || r.status !== "draft";
      const d = await api("GET", "/api/boms/" + r.id);
      const lg = ui.grid([
        { key: "op_code", label: t("c.op"), type: "code", width: 60 },
        { key: "component_code", label: t("c.item"), type: "code", width: 120 },
        { key: "cname", label: t("c.item_name"), width: 200, value: (l) => name(l) },
        { key: "qty_per", label: t("eng.qty_per"), width: 80, align: "end" },
        { key: "base_uom", label: t("c.unit"), width: 60 },
        { key: "scan", label: t("eng.scan"), width: 130, render: (l) => ui.badge(t("scan." + l.scan), l.scan === "serial" ? "accent" : l.scan === "lot" ? "warn" : "neutral") },
      ], { rows: d.lines, layoutKey: "MDM1040-lines" });
      ui.clear(host,
        h("div", { class: "mes-detail-head" }, h("div", { class: "mes-detail-title" }, h("span", { class: "mes-detail-code" }, ui.ltr(r.item_code + " · R" + r.revision)),
          ui.statusChip(statusKind[r.status], t("rev." + r.status))), h("div", { class: "mes-detail-sub", text: name(r) })),
        h("div", { class: "mes-fill-grid" }, lg.el), h("p", { class: "mes-pad eco-muted", text: t("eng.scan_rule") }));
    },
    toolbar: () => [act.add, act.edit, act.approve, ui.sep(), act.used],
  });

  async function items() { return (await api("GET", "/api/items")).filter((i) => i.active && i.kind === "product"); }
  async function newRevision() {
    let list; try { list = await items(); } catch (e) { showError(e); return; }
    const item = ui.select({ options: [["", "—"]].concat(list.map((i) => [i.id, i.code + " · " + name(i)])) });
    const err = h("div", { class: "eco-span-2" });
    ui.dialog({ title: t("eng.new_revision"), subtitle: "MDM1040", icon: "layers", body: h("div", { class: "eco-form" }, ui.field(t("f.item"), item, { required: true, span: 2, hint: t("eng.copy_hint") }), err),
      actions: [{ label: t("cancel"), kind: "ghost", value: false }, { label: t("act.create"), kind: "primary", icon: "check", onClick: async () => {
        if (!item.value) { ui.clear(err, ui.banner("bad", t("err.required"))); return false; }
        try { const r = await api("POST", "/api/boms", { itemId: item.value }); ui.toast({ kind: "ok", title: t("act.created"), text: "R" + r.revision }); } catch (e) { showError(e, err); return false; }
        v.run();
      } }] });
  }
  async function edit(r) {
    const [d, list] = await Promise.all([api("GET", "/api/boms/" + r.id), api("GET", "/api/items")]);
    const opts = list.filter((i) => i.active).map((i) => [i.id, i.code + " · " + name(i)]);
    const ed = rowsEditor([
      { key: "componentId", label: t("c.item"), kind: "select", options: opts },
      { key: "qtyPer", label: t("eng.qty_per"), width: 90, dir: "ltr" }, { key: "opCode", label: t("c.op"), width: 80, dir: "ltr" },
      { key: "scan", label: t("eng.scan"), kind: "select", width: 140, options: ["none", "lot", "serial"].map((k) => [k, t("scan." + k)]) },
    ], d.lines.map((l) => ({ componentId: l.component_id, qtyPer: l.qty_per, opCode: l.op_code, scan: l.scan })));
    const err = h("div");
    ui.dialog({ title: t("eng.edit_bom", { code: r.item_code, rev: r.revision }), subtitle: t("rev.draft"), icon: "layers", width: 900, body: h("div", {}, ed.el, err),
      actions: [{ label: t("cancel"), kind: "ghost", value: false }, { label: t("save"), kind: "primary", icon: "save", onClick: async () => {
        const lines = ed.values().filter((l) => l.componentId && l.opCode);
        try { await api("PUT", "/api/boms/" + r.id, { version: d.version, lines }); } catch (e) { showError(e, err); return false; }
        ui.toast({ kind: "ok", title: t("saved") }); v.run();
      } }] });
  }
  async function approve(r) {
    const d = await api("GET", "/api/boms/" + r.id);
    if (!(await ui.confirm({ title: t("eng.approve"), text: t("eng.approve_text", { code: r.item_code, rev: r.revision }), okLabel: t("eng.approve") }))) return;
    try { await api("POST", `/api/boms/${r.id}/approve`, { version: d.version }); ui.toast({ kind: "ok", title: t("eng.approved") }); } catch (e) { showError(e); }
    v.run();
  }
  async function whereUsed() {
    let list; try { list = await api("GET", "/api/items"); } catch (e) { showError(e); return; }
    const item = ui.select({ options: [["", "—"]].concat(list.map((i) => [i.id, i.code + " · " + name(i)])) });
    const host = h("div", { class: "mes-subgrid" });
    const g = ui.grid([{ key: "item_code", label: t("c.item"), type: "code", width: 120 }, { key: "n", label: t("c.item_name"), width: 200, value: (x) => name(x) },
      { key: "revision", label: t("c.revision"), type: "number", width: 70 }, { key: "status", label: t("c.status"), width: 100, value: (x) => t("rev." + x.status) },
      { key: "op_code", label: t("c.op"), type: "code", width: 60 }, { key: "qty_per", label: t("eng.qty_per"), width: 80 }], { rows: [] });
    host.append(g.el);
    item.addEventListener("change", async () => { try { g.setRows(item.value ? await api("GET", "/api/boms/where-used/" + item.value) : []); } catch (e) { showError(e); } });
    ui.dialog({ title: t("eng.where_used"), icon: "link", width: 760, body: h("div", {}, ui.field(t("f.item"), item), host), actions: [{ label: t("close"), kind: "primary" }] });
  }
  return { el: v.el };
}
