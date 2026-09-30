// SYS9060 General settings — what this installation is: its node, company id, time zone, start of the production
// day, who owns items, warehouses and people, the database and the installed modules. Read-only here: these are set
// in data/config.json by the start script (Start-Itqan.bat), because changing them under a running plant changes
// which day a fact belongs to.
import * as ui from "/eco-ui/eco-ui.js";
import { api, showError, t } from "../common.js";

const { h } = ui;

export default function create({ shell }) {
  const host = h("div", {});
  const sc = ui.screen({ code: "SYS9060", title: t("scr.SYS9060"), path: [t("m.system"), t("m.operations")], shell, standard: { inquiry: () => load(), inquiryLabel: t("refresh") },
    note: t("set.note"), body: host });
  async function load() {
    let i;
    try { i = await api("GET", "/api/system/info"); } catch (e) { showError(e); return; }
    ui.clear(host,
      h("section", { class: "mes-card" }, h("h3", { text: t("set.installation") }), ui.props([
        [t("set.version"), ui.ltr(i.version)], [t("set.node"), ui.ltr(i.node)], [t("set.company"), ui.ltr(i.companyId)], [t("set.tz"), ui.ltr(i.timeZone)],
        [t("set.day_start"), ui.ltr(i.productionDayStart)], [t("set.items_owner"), t("own." + i.ownership.item)], [t("set.wh_owner"), t("own." + i.ownership.warehouse)],
        [t("set.people_owner"), t("own." + (i.ownership.person || "none"))], [t("set.db"), ui.ltr(i.database.file + " · " + ui.fmtNumber((i.database.bytes || 0) / 1048576, 1) + " MB")], [t("set.backups"), ui.ltr(i.backupDir)]], { cols: 2 })),
      h("section", { class: "mes-card" }, h("h3", { text: t("set.modules") + " · " + i.modules.length }), h("table", { class: "mes-table" },
        h("thead", {}, h("tr", {}, [t("set.module"), t("set.depends"), t("set.migrations"), t("key.scopes")].map((x) => h("th", { text: x })))),
        h("tbody", {}, i.modules.map((m) => h("tr", {}, h("td", {}, h("b", {}, ui.ltr(m.id)), h("span", { class: "eco-muted", text: " · " + t("mod." + m.id) })), h("td", {}, ui.ltr(m.dependsOn.join(", "))),
          h("td", {}, ui.ltr(String(m.migrations))), h("td", {}, ui.ltr(m.scopes.join(" ")))))))));
  }
  load();
  return { el: sc.el };
}
