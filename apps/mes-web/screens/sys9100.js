// SYS9100 System health — every module's own checks (hash chains intact, units match the ledger, links delivering,
// stoppage facts complete), the database size and the last backup, refreshed every minute. Red is a fact to act on.
import * as ui from "/eco-ui/eco-ui.js";
import { api, can, showError, stamp, t } from "../common.js";

const { h } = ui;

export default function create({ shell }) {
  const host = h("div", { class: "mes-health" });
  const sc = ui.screen({ code: "SYS9100", title: t("scr.SYS9100"), path: [t("m.system"), t("m.operations")], shell, standard: { inquiry: () => load(), inquiryLabel: t("refresh") }, body: host });
  async function load() {
    let r, info, bk = null;
    try { [r, info] = await Promise.all([api("GET", "/api/system/health"), api("GET", "/api/system/info")]); if (can("system.backup")) bk = await api("GET", "/api/system/backups"); }
    catch (e) { showError(e); return; }
    const all = Object.values(r).flat(), bad = all.filter((c) => !c.ok);
    const last = bk && bk.backups[0];
    const age = last && last.createdAt ? (Date.now() - Date.parse(last.createdAt)) / 3600000 : null;
    ui.clear(host,
      ui.healthBanner(bad.length ? "bad" : "ok", bad.length ? t("hl.bad", { n: bad.length }) : t("hl.ok"), t("hl.checked", { n: all.length, at: stamp(new Date().toISOString()) })),
      ui.kpiStrip([{ label: t("set.version"), value: info.version }, { label: t("set.db"), value: ui.fmtNumber((info.database.bytes || 0) / 1048576, 1), unit: "MB" },
        { label: t("set.modules"), value: String(info.modules.length) },
        bk ? { label: t("hl.last_backup"), value: last ? stamp(last.createdAt) : "—", status: age === null || age > 26 ? "bad" : last.ok ? "ok" : "bad", hint: age === null ? t("bk.none") : age > 26 ? t("hl.backup_old") : "" } : null]),
      h("div", { class: "mes-health-grid" }, Object.entries(r).map(([m, list]) => h("section", { class: "mes-card mes-health-mod " + (list.every((c) => c.ok) ? "is-ok" : "is-bad") },
        h("h3", {}, ui.icon(list.every((c) => c.ok) ? "check-circle" : "x-octagon", 18), ui.ltr(" " + m), h("span", { class: "eco-muted", text: " · " + t("mod." + m) })),
        h("ul", {}, list.map((c) => h("li", { class: c.ok ? "" : "is-bad" }, ui.icon(c.ok ? "check" : "x", 12), ui.ltr(" " + c.id),
          c.details ? h("small", { class: "eco-muted" }, ui.ltr(" " + JSON.stringify(c.details).slice(0, 160))) : null)))))));
  }
  load();
  const timer = setInterval(load, 60000);
  return { el: sc.el, onClose: () => clearInterval(timer) };
}
