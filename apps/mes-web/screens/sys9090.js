// SYS9090 Audit and integrity — who changed what in the administration and master data (the audit log), and the
// proof that no production fact was altered: every module's hash chains and cross-checks, verified on request.
import * as ui from "/eco-ui/eco-ui.js";
import { api, showError, stamp, t } from "../common.js";
import { inquiryScreen } from "../views.js";

const { h } = ui;

export default function create({ shell }) {
  const checks = h("div", {});
  const v = inquiryScreen({ shell, code: "SYS9090", path: [t("m.system"), t("m.security")], rowKey: "seq", auto: true,
    fields: [{ key: "text", label: t("aud.search"), dir: "ltr" }],
    toolbar: () => [ui.button({ label: t("aud.verify"), icon: "shield", kind: "primary", onClick: () => verify() })],
    columns: [
      { key: "seq", label: "#", type: "number", width: 70 },
      { key: "when", label: t("c.time"), width: 150 },
      { key: "actor", label: t("c.user"), width: 140 },
      { key: "action", label: t("aud.action"), type: "code", width: 180, total: "count" },
      { key: "target", label: t("aud.target"), type: "code", width: 200 },
      { key: "details", label: t("txn.detail"), width: 420 },
    ],
    load: async (c) => (await api("GET", "/api/audit")).map((r) => ({ ...r, when: stamp(r.at), details: r.details || "" }))
      .filter((r) => !c.text || [r.actor, r.action, r.target, r.details].join(" ").toLowerCase().includes(c.text.toLowerCase())),
  });
  async function verify() {
    ui.clear(checks, ui.banner("info", t("bk.working")));
    let r;
    try { r = await api("GET", "/api/system/health"); } catch (e) { ui.clear(checks); showError(e); return; }
    const all = Object.entries(r).flatMap(([m, list]) => list.map((c) => ({ m, ...c })));
    const bad = all.filter((c) => !c.ok);
    ui.clear(checks, h("section", { class: "mes-card" }, ui.banner(bad.length ? "bad" : "ok", bad.length ? t("aud.broken", { n: bad.length }) : t("aud.intact", { n: all.length })),
      h("div", { class: "mes-checks" }, all.map((c) => h("span", { class: "mes-check " + (c.ok ? "is-ok" : "is-bad"), title: JSON.stringify(c.details || {}) }, ui.icon(c.ok ? "check" : "x", 12), ui.ltr(c.m + " · " + c.id))))));
  }
  v.el.prepend(checks);
  return { el: v.el };
}
