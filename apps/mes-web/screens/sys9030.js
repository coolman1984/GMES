// SYS9030 Devices and links — the API keys of station devices, scanners and the other apps' agents (Mizan, HR).
// A key is shown ONCE, when it is made (only its hash is kept); a lost key is revoked and a new one made. Revoking
// is immediate and cannot be undone; keys are never renamed or reused, so the audit log always names one thing.
import * as ui from "/eco-ui/eco-ui.js";
import { api, can, showError, stamp, t } from "../common.js";
import { inquiryScreen } from "../views.js";

const { h } = ui;
const PROFILES = {
  station: ["exe.orders.read", "exe.orders.write", "oee.stops.read", "oee.stops.write", "trk.units.read", "trk.units.write", "trk.materials.write", "mdm.plant.read", "mdm.items.read", "eng.read"],
  mizan: ["eco.feed.read", "eco.acks.write", "eco.inbox.write", "mdm.items.read"],
  hr: ["eco.inbox.write", "eco.feed.read"],
  board: ["exe.orders.read", "oee.stops.read", "qms.read", "shp.read", "mdm.plant.read"],
};

export default function create({ shell }) {
  const v = inquiryScreen({ shell, code: "SYS9030", path: [t("m.system"), t("m.devices")], rowKey: "name", auto: true,
    columns: [
      { key: "state", label: t("c.status"), width: 100, render: (r) => ui.statusChip(r.active ? "run" : "closed", r.active ? t("key.active") : t("key.revoked")) },
      { key: "name", label: t("c.name"), type: "code", width: 200, total: "count" },
      { key: "scopesText", label: t("key.scopes"), width: 520 },
      { key: "created", label: t("key.created"), width: 150 },
    ],
    toolbar: () => can("sys.keys.write") ? [ui.button({ label: t("key.new"), icon: "key", kind: "primary", onClick: () => create() })] : [],
    detail: (r, host) => ui.clear(host, ui.props([[t("c.name"), ui.ltr(r.name)], [t("key.created"), r.created], [t("c.status"), r.active ? t("key.active") : t("key.revoked")]]),
      h("div", { class: "mes-scopes" }, r.scopes.map((s) => h("span", { class: "eco-badge eco-badge-neutral" }, ui.ltr(s)))),
      r.active && can("sys.keys.write") ? ui.button({ label: t("key.revoke"), icon: "x", kind: "danger", onClick: () => revoke(r) }) : null),
    load: async () => (await api("GET", "/api/keys")).map((k) => ({ ...k, scopesText: k.scopes.join(" "), created: stamp(k.created_at) })),
  });
  function create() {
    const nameIn = ui.input({ dir: "ltr", placeholder: "station-MA01-10" });
    const prof = ui.select({ options: Object.keys(PROFILES).map((p) => [p, t(`key.p_${p}`)]).concat([["custom", t("key.p_custom")]]) });
    const scopes = h("textarea", { class: "eco-input", rows: 4, dir: "ltr" });
    const fill = () => { if (prof.value !== "custom") scopes.value = PROFILES[prof.value].join(" "); };
    prof.addEventListener("change", fill); fill();
    const d = ui.dialog({ title: t("key.new"), icon: "key", width: 620, body: h("div", { class: "mes-form" }, ui.field(t("c.name"), nameIn, { required: true, hint: t("key.name_hint") }), ui.field(t("key.profile"), prof),
      ui.field(t("key.scopes"), scopes, { hint: t("key.scopes_hint") })),
      actions: [ui.button({ label: t("cancel"), onClick: () => d.close() }), ui.button({ label: t("key.make"), kind: "primary", onClick: async () => {
        let r;
        try { r = await api("POST", "/api/keys", { name: nameIn.value.trim(), scopes: scopes.value.split(/\s+/).filter(Boolean) }); } catch (e) { showError(e); return; }
        d.close();
        const box = ui.input({ value: r.key, dir: "ltr", readonly: true });
        const shown = ui.dialog({ title: t("key.once_title"), icon: "key", width: 620, dismissable: false, body: h("div", {}, ui.banner("warn", t("key.once")), box),
          actions: [ui.button({ label: t("key.copy"), icon: "copy", onClick: () => { box.select(); navigator.clipboard && navigator.clipboard.writeText(r.key); ui.toast({ kind: "ok", title: t("key.copied") }); } }),
            ui.button({ label: t("key.stored"), kind: "primary", onClick: () => { shown.close(); v.run(); } })] });
      } })] });
  }
  async function revoke(r) {
    if (!(await ui.confirm({ title: t("key.revoke") + " · " + r.name, text: t("key.revoke_help"), okLabel: t("key.revoke"), danger: true }))) return;
    try { await api("POST", "/api/keys/" + encodeURIComponent(r.name) + "/revoke", {}); v.run(); } catch (e) { showError(e); }
  }
  return { el: v.el };
}
