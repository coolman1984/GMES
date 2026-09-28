// SYS9070 Backup and restore — a copy of the database made while the plant runs, and REHEARSED before it is called
// a backup: opened read-only, integrity-checked, every module's own checks (hash chains, units against the ledger)
// run against it, and its row counts kept beside it. "Verify" repeats that later, so a copy that rotted on disk is
// found before the day it is needed. Restoring is done with the server stopped (the steps are below), never here.
import * as ui from "/eco-ui/eco-ui.js";
import { api, showError, stamp, t } from "../common.js";

const { h } = ui;

export default function create({ shell }) {
  const host = h("div", {}), result = h("div", {});
  const sc = ui.screen({ code: "SYS9070", title: t("scr.SYS9070"), path: [t("m.system"), t("m.operations")], shell, standard: { inquiry: () => load(), inquiryLabel: t("refresh") },
    toolbar: [ui.button({ label: t("bk.now"), icon: "save", kind: "primary", onClick: () => backup() })], body: h("div", {}, result, host) });
  const showRehearsal = (name, r) => ui.clear(result, h("section", { class: "mes-card" },
    ui.banner(r.ok ? "ok" : "bad", r.ok ? t("bk.ok", { name }) : t("bk.bad", { name })),
    ui.props([[t("bk.integrity"), ui.ltr(r.integrity)], [t("bk.tables"), ui.ltr(String(Object.keys(r.tables).length))], [t("bk.rows"), ui.ltr(ui.fmtNumber(Object.values(r.tables).reduce((a, n) => a + n, 0)))]], { cols: 3 }),
    h("div", { class: "mes-checks" }, r.checks.map((c) => h("span", { class: "mes-check " + (c.ok ? "is-ok" : "is-bad") }, ui.icon(c.ok ? "check" : "x", 12), ui.ltr(c.module + " · " + c.id)))),
    r.mismatches.length ? ui.banner("bad", t("bk.mismatch") + " " + r.mismatches.join(" · ")) : null));
  async function backup() {
    ui.clear(result, ui.banner("info", t("bk.working")));
    try { const r = await api("POST", "/api/system/backups", {}); showRehearsal(r.name, r.rehearsal); load(); } catch (e) { ui.clear(result); showError(e); }
  }
  async function verify(name) {
    ui.clear(result, ui.banner("info", t("bk.working")));
    try { const r = await api("POST", "/api/system/backups/" + encodeURIComponent(name) + "/verify", {}); showRehearsal(name, r.rehearsal); load(); } catch (e) { ui.clear(result); showError(e); }
  }
  async function load() {
    let r;
    try { r = await api("GET", "/api/system/backups"); } catch (e) { showError(e); return; }
    ui.clear(host,
      h("section", { class: "mes-card" }, h("h3", { text: t("bk.list") + " · " + r.backups.length }), h("p", { class: "eco-muted" }, t("bk.where") + " ", ui.ltr(r.dir)),
        r.backups.length ? h("table", { class: "mes-table" }, h("thead", {}, h("tr", {}, [t("c.name"), t("bk.made"), t("c.user"), t("bk.size"), t("bk.rows"), t("bk.verified"), t("c.status"), ""].map((x) => h("th", { text: x })))),
          h("tbody", {}, r.backups.map((b) => h("tr", {}, h("td", {}, ui.ltr(b.name)), h("td", {}, ui.ltr(stamp(b.createdAt))), h("td", { text: b.by || "" }), h("td", {}, ui.ltr(ui.fmtNumber(b.bytes / 1048576, 1) + " MB")),
            h("td", {}, ui.ltr(b.rows === null ? "—" : ui.fmtNumber(b.rows))), h("td", {}, ui.ltr(stamp(b.verifiedAt))), h("td", {}, b.ok === null ? "—" : ui.statusChip(b.ok ? "done" : "down", b.ok ? t("bk.good") : t("bk.failed"))),
            h("td", {}, ui.button({ label: t("bk.verify"), icon: "check", size: "sm", onClick: () => verify(b.name) }))))))
          : ui.empty({ icon: "archive", title: t("bk.none"), text: t("bk.none_help") })),
      h("section", { class: "mes-card" }, h("h3", { text: t("bk.restore") }), h("ol", { class: "mes-steps" }, [1, 2, 3, 4, 5].map((n) => h("li", { text: t(`bk.step${n}`) })))));
  }
  load();
  return { el: sc.el };
}
