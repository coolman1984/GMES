// SYS9010 Users — the TEMPLATE of every administration list: conditions, a multi-select grid with bulk actions,
// a detail card, and the standard add/edit dialog.
import * as ui from "/eco-ui/eco-ui.js";
import { roles, source } from "../data.js";
import { t, sampleNote } from "../common.js";

const { h } = ui;
const ST = { active: "ok", locked: "bad", inactive: "neutral" };

export default function create({ shell }) {
  const roleName = (code) => t("role." + code);
  const cond = ui.conditionPanel([
    { key: "text", label: t("u.search"), placeholder: t("u.search_ph") },
    { key: "role", label: t("u.role"), type: "select", options: roles.map(([c]) => [c, roleName(c)]), placeholder: t("all") },
    { key: "status", label: t("c.record_status"), type: "select", options: ["active", "locked", "inactive"].map((s) => [s, t("us." + s)]), placeholder: t("all") },
    { key: "area", label: t("f.area"), type: "select", options: [["INJ", t("area.INJ")], ["ASM", t("area.ASM")], ["PKG", t("area.PKG")]], placeholder: t("all") },
  ], { key: "SYS9010", onSubmit: () => inquiry() });
  const detail = h("div", { class: "mes-detail" });
  const g = ui.grid([
    { key: "status", label: t("c.record_status"), type: "status", width: 110, frozen: true, status: (r) => ST[r.status] === "ok" ? "ok" : ST[r.status] === "bad" ? "bad" : "neutral", label_of: (s, r) => t("us." + r.status) },
    { key: "login", label: t("u.login"), type: "code", width: 140, frozen: true },
    { key: "name", label: t("u.name"), width: 170, render: (r) => h("span", { class: "mes-person" }, ui.avatar(r.name, 20), h("span", { text: r.name })) },
    { key: "role", label: t("u.role"), width: 130, value: (r) => roleName(r.role) },
    { key: "area", label: t("f.area"), width: 110, value: (r) => (r.area === "—" ? "—" : t("area." + r.area)) },
    { key: "badge", label: t("u.badge"), type: "code", width: 80 },
    { key: "source", label: t("u.source"), width: 124, render: (r) => ui.badge(r.source === "hr" ? "HR-System" : t("u.local"), r.source === "hr" ? "accent" : "neutral", r.source === "hr" ? "link" : null) },
    { key: "mfa", label: t("u.mfa"), width: 76, align: "center", render: (r) => r.mfa ? ui.icon("shield", 14, "mes-ok") : h("span", { class: "eco-muted", text: "—" }) },
    { key: "language", label: t("u.language"), width: 96, value: (r) => (r.language === "ar" ? "العربية" : "English") },
    { key: "lastSignIn", label: t("u.last_sign_in"), type: "date", width: 128 },
    { key: "created", label: t("u.created"), type: "date", width: 96 },
  ], { rowKey: "id", selection: "multi", layoutKey: "SYS9010", idleText: t("hint.inquiry"), onSelect: (sel) => { drawDetail(sel); bulk(sel); }, onOpen: (r) => edit(r) });

  const act = {
    lock: ui.button({ label: t("u.lock"), icon: "lock", disabled: true, onClick: () => setStatus("locked") }),
    unlock: ui.button({ label: t("u.unlock"), icon: "key", disabled: true, onClick: () => setStatus("active") }),
    reset: ui.button({ label: t("u.reset_pw"), icon: "refresh", disabled: true, onClick: () => resetPw() }),
    role: ui.button({ label: t("u.assign_role"), icon: "shield", disabled: true, onClick: (ev) => ui.menu(ev.currentTarget, roles.map(([c]) => ({ label: roleName(c), onSelect: () => assign(c) }))) }),
  };
  function bulk(sel) { for (const b of Object.values(act)) b.disabled = !sel.length; act.unlock.disabled = !sel.some((u) => u.status !== "active"); act.lock.disabled = !sel.some((u) => u.status === "active"); }
  async function setStatus(to) {
    const sel = g.selected();
    if (!(await ui.confirm({ title: to === "locked" ? t("u.lock") : t("u.unlock"), text: t("u.bulk_text", { n: sel.length }), danger: to === "locked", okLabel: to === "locked" ? t("u.lock") : t("u.unlock") }))) return;
    sel.forEach((u) => { u.status = to; }); g.setRows(g.rows(), { keepSelection: true });
    ui.toast({ kind: "ok", title: t("act.done", { n: sel.length }), text: t("sample.nothing_saved"), keep: true });
  }
  function assign(role) { const sel = g.selected(); sel.forEach((u) => { u.role = role; }); g.setRows(g.rows(), { keepSelection: true }); ui.toast({ kind: "ok", title: t("act.done", { n: sel.length }), text: roleName(role) }); }
  async function resetPw() {
    const sel = g.selected();
    if (await ui.confirm({ title: t("u.reset_pw"), text: t("u.reset_text", { n: sel.length }), okLabel: t("u.reset_pw") })) ui.toast({ kind: "ok", title: t("u.reset_done"), text: t("sample.nothing_saved") });
  }

  const sc = ui.screen({
    code: "SYS9010", title: t("scr.SYS9010"), path: [t("m.system"), t("m.security")], shell, headExtra: sampleNote(),
    toolbar: [ui.button({ label: t("u.new"), icon: "user-plus", onClick: () => edit(null) }), ui.sep(), act.lock, act.unlock, act.reset, act.role],
    standard: { inquiry: () => inquiry(), inquiryLabel: t("inquiry"), reset: () => { cond.reset(); }, resetLabel: t("reset"), export: () => g.exportCSV("SYS9010-users"), exportLabel: t("export"), columns: () => g.columnsDialog() },
    conditions: cond, grid: g, detail, detailKey: "SYS9010:detail",
  });

  async function inquiry() {
    const t0 = performance.now();
    g.setLoading();
    const rows = await source.users(cond.values());
    g.setEmptyText(t("empty.users"));
    g.setRows(rows);
    sc.result({ chips: cond.chips(), ms: Math.round(performance.now() - t0) });
    if (rows.length) g.select(rows[0].id);
  }
  function drawDetail(sel) {
    if (!sel.length) { ui.clear(detail, ui.empty({ icon: "user", title: t("u.none"), text: t("u.none_help") })); return; }
    if (sel.length > 1) {
      const byRole = {};
      sel.forEach((u) => { byRole[u.role] = (byRole[u.role] || 0) + 1; });
      ui.clear(detail, h("div", { class: "mes-detail-head" }, h("h2", { text: t("selected_n", { n: sel.length }) }), h("span", { class: "eco-muted", text: t("u.bulk_hint") })),
        ui.section(t("u.role"), ui.props(Object.entries(byRole).map(([r, n]) => [roleName(r), ui.ltr(String(n))]))));
      return;
    }
    const u = sel[0];
    ui.clear(detail,
      h("div", { class: "mes-usercard" }, ui.avatar(u.name, 48), h("div", {}, h("h2", { text: u.name }), h("div", { class: "eco-muted" }, ui.ltr(u.login), " · ", roleName(u.role)),
        h("div", { class: "mes-row-gap" }, ui.statusChip(ST[u.status], t("us." + u.status)), u.source === "hr" ? ui.badge("HR-System", "accent", "link") : null))),
      u.source === "hr" ? h("div", { class: "mes-pad" }, ui.banner("info", t("u.from_hr"))) : null,
      ui.section(t("u.account"), ui.props([[t("u.badge"), ui.ltr(u.badge)], [t("f.area"), u.area === "—" ? null : t("area." + u.area)], [t("u.language"), u.language === "ar" ? "العربية" : "English"],
        [t("u.mfa"), u.mfa ? t("yes") : t("no")], [t("u.created"), ui.ltr(u.created)], [t("u.last_sign_in"), ui.ltr(u.lastSignIn)]])),
      ui.section(t("u.permissions"), h("div", { class: "mes-perms" }, permsOf(u.role).map((p) => ui.badge(t("perm." + p), "neutral")))),
      h("div", { class: "mes-pad mes-row-gap" }, ui.button({ label: t("edit"), icon: "edit", onClick: () => edit(u) }), ui.button({ label: t("u.reset_pw"), icon: "refresh", kind: "ghost", onClick: () => resetPw() })));
  }
  function edit(u) {
    const login = ui.input({ value: u ? u.login : "", dir: "ltr", readonly: !!u }), nm = ui.input({ value: u ? u.name : "" });
    const role = ui.select({ options: roles.map(([c]) => [c, roleName(c)]), value: u ? u.role : "OPERATOR" });
    const area = ui.select({ options: [["—", "—"], ["INJ", t("area.INJ")], ["ASM", t("area.ASM")], ["PKG", t("area.PKG")]], value: u ? u.area : "—" });
    const langS = ui.segmented({ options: [["ar", "العربية"], ["en", "English"]], value: u ? u.language : "ar" });
    const mfa = ui.toggle({ label: t("u.mfa_long"), checked: u ? u.mfa : false, hint: t("u.mfa_hint") });
    const err = h("div", { class: "eco-span-2" });
    ui.dialog({ title: u ? t("u.edit_title", { login: u.login }) : t("u.new"), icon: u ? "user" : "user-plus", width: 600,
      body: h("div", { class: "eco-form" }, ui.field(t("u.login"), login, { required: true, hint: u ? t("u.login_fixed") : t("u.login_hint") }), ui.field(t("u.name"), nm, { required: true }),
        ui.field(t("u.role"), role, { required: true }), ui.field(t("f.area"), area), ui.field(t("u.language"), langS), h("div", { class: "eco-span-2" }, mfa),
        u ? null : h("div", { class: "eco-span-2" }, ui.banner("info", t("u.first_pw"))), err),
      actions: [{ label: t("cancel"), kind: "ghost", value: false }, { label: u ? t("save") : t("u.create"), kind: "primary", icon: "check", onClick: () => {
        if (!/^[a-z0-9._-]{3,50}$/.test(login.value.trim()) || !nm.value.trim()) { ui.clear(err, ui.banner("bad", t("u.err_fields"))); return false; }
        ui.toast({ kind: "ok", title: u ? t("saved") : t("u.created_ok"), text: t("sample.nothing_saved"), keep: true });
      } }] });
  }
  drawDetail([]);
  inquiry();
  return { el: sc.el };
}
function permsOf(role) {
  return { ADMIN: ["sys.users", "sys.roles", "sys.backup", "mdm.write", "exe.write", "exe.read"], PLANNER: ["exe.plan", "exe.read", "mdm.read"], SUPERVISOR: ["exe.release", "exe.write", "exe.read", "oee.reason"],
    OPERATOR: ["exe.station"], QUALITY: ["qms.hold", "qms.inspect", "exe.read"], MAINT: ["oee.reason", "mdm.read"], VIEWER: ["exe.read"] }[role] || [];
}
