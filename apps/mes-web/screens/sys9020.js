// SYS9020 Roles and permissions — which role may do what, as the server enforces it (the roles are defined in the
// product; a person holds one role, set in SYS9010). Read-only: a permission changed on a screen would be a
// permission nobody reviewed.
import * as ui from "/eco-ui/eco-ui.js";
import { api, showError, t } from "../common.js";

const { h } = ui;

export default function create({ shell }) {
  const host = h("div", { class: "mes-matrix-host" });
  const sc = ui.screen({ code: "SYS9020", title: t("scr.SYS9020"), path: [t("m.system"), t("m.security")], shell, standard: { inquiry: () => load(), inquiryLabel: t("refresh") },
    note: t("rl.note"), body: host });
  async function load() {
    let r;
    try { r = await api("GET", "/api/system/roles"); } catch (e) { showError(e); return; }
    const has = (role, s) => role.scopes.includes("*") || role.scopes.includes(s) || role.scopes.includes(s.split(".")[0] + ".*");
    const groups = [...new Set(r.scopes.map((s) => s.split(".")[0]))];
    ui.clear(host, h("table", { class: "mes-table mes-matrix" },
      h("thead", {}, h("tr", {}, h("th", { text: t("rl.permission") }), r.roles.map((x) => h("th", { text: t("role." + x.role) })))),
      groups.map((g) => h("tbody", {}, h("tr", { class: "mes-matrix-group" }, h("td", { colspan: r.roles.length + 1 }, h("b", {}, ui.ltr(g)), h("span", { class: "eco-muted", text: " · " + t("mod." + g) }))),
        r.scopes.filter((s) => s.split(".")[0] === g).map((s) => h("tr", {}, h("td", {}, ui.ltr(s)),
          r.roles.map((x) => h("td", { class: "mes-matrix-cell" + (has(x, s) ? " is-yes" : "") }, has(x, s) ? ui.icon("check", 14) : "")))))),
      h("tfoot", {}, h("tr", {}, h("td", { text: t("rl.count") }), r.roles.map((x) => h("td", {}, ui.ltr(x.scopes.includes("*") ? t("rl.all") : String(x.scopes.length))))))));
  }
  load();
  return { el: sc.el };
}
