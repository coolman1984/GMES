// SYS9010 Users — the TEMPLATE of every administration list: conditions, a multi-select grid with bulk actions,
// a detail card, and the standard add/edit dialog. The accounts, roles and locks are the server's; every change is
// in the audit log with the administrator's name.
import * as ui from "/eco-ui/eco-ui.js";
import { api, can, session, showError, stamp, t } from "../common.js";

const { h } = ui;
const ROLES = ["ADMIN", "PLANNER", "SUPERVISOR", "OPERATOR", "QUALITY", "MAINT", "VIEWER"];
const ST = { active: "ok", locked: "bad", inactive: "neutral" };
// what each role may do (the server's ROLE_SCOPES, in words)
const PERMS = { ADMIN: ["sys.users", "mdm.write", "exe.write", "exe.read", "oee.reason"], PLANNER: ["exe.plan", "exe.write", "exe.read", "mdm.write"],
  SUPERVISOR: ["exe.write", "exe.read", "oee.reason", "mdm.read"], OPERATOR: ["exe.station", "exe.read", "oee.reason"], QUALITY: ["exe.read", "mdm.read"],
  MAINT: ["oee.reason", "exe.read", "mdm.read"], VIEWER: ["exe.read", "mdm.read"] };

export default function create({ shell }) {
  const me = session().user;
  const canEdit = can("sys.users.write");
  const roleName = (code) => t("role." + code);
  const cond = ui.conditionPanel([
    { key: "text", label: t("u.search"), placeholder: t("u.search_ph") },
    { key: "role", label: t("u.role"), type: "select", options: ROLES.map((c) => [c, roleName(c)]), placeholder: t("all") },
    { key: "status", label: t("c.record_status"), type: "select", options: ["active", "locked", "inactive"].map((s) => [s, t("us." + s)]), placeholder: t("all") },
  ], { key: "SYS9010", onSubmit: () => inquiry() });
  const detail = h("div", { class: "mes-detail" });
  const g = ui.grid([
    { key: "status", label: t("c.record_status"), type: "status", width: 110, frozen: true, status: (r) => ST[r.status], label_of: (s, r) => t("us." + r.status) },
    { key: "login", label: t("u.login"), type: "code", width: 140, frozen: true },
    { key: "name", label: t("u.name"), width: 190, render: (r) => h("span", { class: "mes-person" }, ui.avatar(r.name, 20), h("span", { text: r.name })) },
    { key: "role", label: t("u.role"), width: 140, value: (r) => roleName(r.role) },
    { key: "area", label: t("f.area"), width: 110, value: (r) => r.area || "" },
    { key: "language", label: t("u.language"), width: 96, value: (r) => (r.language === "ar" ? "العربية" : "English") },
    { key: "mustChangePassword", label: t("u.must_change"), width: 110, align: "center", render: (r) => r.mustChangePassword ? ui.icon("key", 14) : "" },
    { key: "last", label: t("u.last_sign_in"), type: "date", width: 138, value: (r) => stamp(r.lastSignInAt) },
    { key: "created", label: t("u.created"), type: "date", width: 138, value: (r) => stamp(r.createdAt) },
  ], { rowKey: "id", selection: "multi", layoutKey: "SYS9010", idleText: t("hint.inquiry"), onSelect: (sel) => { drawDetail(sel); bulk(sel); }, onOpen: (r) => canEdit && edit(r) });

  const act = {
    lock: ui.button({ label: t("u.lock"), icon: "lock", disabled: true, onClick: () => setStatus("locked") }),
    unlock: ui.button({ label: t("u.unlock"), icon: "key", disabled: true, onClick: () => setStatus("active") }),
    deactivate: ui.button({ label: t("u.deactivate"), icon: "x", disabled: true, onClick: () => setStatus("inactive") }),
    reset: ui.button({ label: t("u.reset_pw"), icon: "refresh", disabled: true, onClick: () => resetPw() }),
    role: ui.button({ label: t("u.assign_role"), icon: "shield", disabled: true, onClick: (ev) => ui.menu(ev.currentTarget, ROLES.map((c) => ({ label: roleName(c), onSelect: () => patchAll({ role: c }) }))) }),
  };
  function bulk(sel) {
    const others = sel.filter((u) => u.id !== me.id);
    for (const b of Object.values(act)) b.disabled = !canEdit || !others.length;
    act.unlock.disabled = !canEdit || !others.some((u) => u.status !== "active");
    act.lock.disabled = !canEdit || !others.some((u) => u.status === "active");
    act.reset.disabled = !canEdit || sel.length !== 1;
  }
  /** One request per person; each refusal (the last administrator, one's own account) is shown, the others still apply. */
  async function patchAll(change, confirmText) {
    const sel = g.selected().filter((u) => u.id !== me.id);
    if (confirmText && !(await ui.confirm(confirmText))) return;
    let n = 0;
    for (const u of sel) { try { await api("PATCH", `/api/users/${u.id}`, change); n++; } catch (e) { showError(e); } }
    if (n) ui.toast({ kind: "ok", title: t("act.done", { n }), keep: true });
    inquiry();
  }
  function setStatus(to) {
    const n = g.selected().filter((u) => u.id !== me.id).length;
    const label = to === "locked" ? t("u.lock") : to === "active" ? t("u.unlock") : t("u.deactivate");
    return patchAll({ status: to }, { title: label, text: t("u.bulk_text", { n }), danger: to !== "active", okLabel: label });
  }
  async function resetPw() {
    const u = g.selected()[0];
    const pw = await ui.promptValue({ title: t("u.reset_pw"), label: t("u.first_pw_label", { login: u.login }), type: "text", hint: t("u.first_pw_hint"), okLabel: t("u.reset_pw") });
    if (!pw) return;
    try { await api("POST", `/api/users/${u.id}/password`, { password: pw }); ui.toast({ kind: "ok", title: t("u.reset_done"), text: t("u.reset_text", { n: 1 }), keep: true }); }
    catch (e) { showError(e); }
    inquiry();
  }

  const sc = ui.screen({
    code: "SYS9010", title: t("scr.SYS9010"), path: [t("m.system"), t("m.security")], shell,
    toolbar: [ui.button({ label: t("u.new"), icon: "user-plus", disabled: !canEdit, onClick: () => edit(null) }), ui.sep(), act.lock, act.unlock, act.deactivate, act.reset, act.role],
    standard: { inquiry: () => inquiry(), inquiryLabel: t("inquiry"), reset: () => { cond.reset(); }, resetLabel: t("reset"), export: () => g.exportCSV("SYS9010-users"), exportLabel: t("export"), columns: () => g.columnsDialog() },
    conditions: cond, grid: g, detail, detailKey: "SYS9010:detail",
  });

  async function inquiry() {
    const t0 = performance.now();
    g.setLoading();
    const v = cond.values();
    const q = new URLSearchParams(Object.entries(v).filter(([, x]) => x));
    try {
      const rows = await api("GET", "/api/users?" + q);
      g.setEmptyText(t("empty.users"));
      g.setRows(rows);
      sc.result({ chips: cond.chips(), ms: Math.round(performance.now() - t0) });
    } catch (e) { g.setEmptyText(e.message); g.setRows([]); showError(e); }
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
        h("div", { class: "mes-row-gap" }, ui.statusChip(ST[u.status], t("us." + u.status)), u.id === me.id ? ui.badge(t("u.you"), "accent") : null))),
      ui.section(t("u.account"), ui.props([[t("f.area"), u.area || null], [t("u.language"), u.language === "ar" ? "العربية" : "English"],
        [t("u.must_change"), u.mustChangePassword ? t("yes") : t("no")], [t("u.created"), ui.ltr(stamp(u.createdAt))], [t("u.last_sign_in"), u.lastSignInAt ? ui.ltr(stamp(u.lastSignInAt)) : null]])),
      ui.section(t("u.permissions"), h("div", { class: "mes-perms" }, (PERMS[u.role] || []).map((p) => ui.badge(t("perm." + p), "neutral")))),
      canEdit ? h("div", { class: "mes-pad mes-row-gap" }, ui.button({ label: t("edit"), icon: "edit", onClick: () => edit(u) })) : null);
  }
  function edit(u) {
    const self = u && u.id === me.id;
    const login = ui.input({ value: u ? u.login : "", dir: "ltr", readonly: !!u }), nm = ui.input({ value: u ? u.name : "" });
    const role = ui.select({ options: ROLES.map((c) => [c, roleName(c)]), value: u ? u.role : "OPERATOR" });
    if (self) role.disabled = true;
    const area = ui.input({ value: u ? u.area || "" : "", dir: "ltr" });
    let langV = u ? u.language : "ar";
    const langS = ui.segmented({ options: [["ar", "العربية"], ["en", "English"]], value: langV, onChange: (v) => { langV = v; } });
    const pw = ui.input({ type: "text", dir: "ltr", autocomplete: "off" });
    const err = h("div", { class: "eco-span-2" });
    ui.dialog({ title: u ? t("u.edit_title", { login: u.login }) : t("u.new"), icon: u ? "user" : "user-plus", width: 600,
      body: h("div", { class: "eco-form" }, ui.field(t("u.login"), login, { required: true, hint: u ? t("u.login_fixed") : t("u.login_hint") }), ui.field(t("u.name"), nm, { required: true }),
        ui.field(t("u.role"), role, { required: true, hint: self ? t("u.own_role") : null }), ui.field(t("f.area"), area), ui.field(t("u.language"), langS),
        u ? null : ui.field(t("u.first_pw_label", { login: "" }), pw, { required: true, hint: t("u.first_pw_hint") }), err),
      actions: [{ label: t("cancel"), kind: "ghost", value: false }, { label: u ? t("save") : t("u.create"), kind: "primary", icon: "check", onClick: async () => {
        try {
          if (u) await api("PATCH", `/api/users/${u.id}`, { name: nm.value, ...(self ? {} : { role: role.value }), area: area.value || null, language: langV });
          else await api("POST", "/api/users", { login: login.value, name: nm.value, role: role.value, area: area.value || null, language: langV, password: pw.value });
        } catch (e) { showError(e, err); return false; }
        ui.toast({ kind: "ok", title: u ? t("saved") : t("u.created_ok"), text: u ? u.login : login.value, keep: true });
        inquiry();
      } }] });
  }
  drawDetail([]);
  inquiry();
  return { el: sc.el };
}
