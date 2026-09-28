// SYS9040 Lists and reasons — the plant's own lists that other screens offer: the stop reasons (each in a loss
// category of ISO 22400; a planned one, like a break, is not a loss of availability). A reason in use is never
// deleted, only switched off, so old stoppages keep their meaning. Defect and repair codes live in QMS1020.
import * as ui from "/eco-ui/eco-ui.js";
import { api, can, commandId, loadStopReasons, name, showError, t } from "../common.js";

const { h } = ui;
const LOSSES = ["breakdown", "setup", "material", "quality", "planned", "other"];

export default function create({ shell }) {
  const host = h("div", {});
  const sc = ui.screen({ code: "SYS9040", title: t("scr.SYS9040"), path: [t("m.system"), t("m.devices")], shell, standard: { inquiry: () => load(), inquiryLabel: t("refresh") },
    toolbar: [ui.button({ label: t("scr.QMS1020"), icon: "alert", kind: "ghost", onClick: () => shell.open("QMS1020") })], body: host });
  const edit = can("oee.reasons.write");
  async function load() {
    let rows;
    try { rows = await api("GET", "/api/stop-reasons"); } catch (e) { showError(e); return; }
    loadStopReasons();
    const add = { code: ui.input({ dir: "ltr", width: "140px", placeholder: "cooling" }), en: ui.input({}), ar: ui.input({ dir: "rtl" }), loss: ui.select({ options: LOSSES.map((l) => [l, t("loss." + l)]) }) };
    ui.clear(host, h("section", { class: "mes-card" }, h("h3", { text: t("sl.stop_reasons") }), h("p", { class: "eco-muted", text: t("sl.help") }),
      h("table", { class: "mes-table" }, h("thead", {}, h("tr", {}, [t("c.code"), t("c.name") + " (EN)", t("c.name") + " (AR)", t("oee.loss"), t("c.status"), ""].map((x) => h("th", { text: x })))),
        h("tbody", {}, rows.map((r) => row(r)),
          edit ? h("tr", { class: "mes-add-row" }, h("td", {}, add.code), h("td", {}, add.en), h("td", {}, add.ar), h("td", {}, add.loss), h("td"),
            h("td", {}, ui.button({ label: t("sl.add"), icon: "plus", kind: "primary", size: "sm", onClick: () => put(add.code.value.trim().toLowerCase(), { name_en: add.en.value, name_ar: add.ar.value, loss: add.loss.value, active: true }) }))) : null))));
  }
  function row(r) {
    const en = ui.input({ value: r.name_en }), ar = ui.input({ value: r.name_ar, dir: "rtl" }), loss = ui.select({ options: LOSSES.map((l) => [l, t("loss." + l)]), value: r.loss });
    for (const x of [en, ar, loss]) x.disabled = !edit;
    return h("tr", { class: r.active ? "" : "is-off" }, h("td", {}, ui.ltr(r.code)), h("td", {}, en), h("td", {}, ar), h("td", {}, loss),
      h("td", {}, ui.statusChip(r.active ? "run" : "closed", r.active ? t("key.active") : t("sl.off"))),
      h("td", {}, edit ? [ui.button({ label: t("save"), size: "sm", onClick: () => put(r.code, { name_en: en.value, name_ar: ar.value, loss: loss.value, active: !!r.active, version: r.version }) }),
        ui.button({ label: r.active ? t("sl.switch_off") : t("sl.switch_on"), size: "sm", kind: "ghost", onClick: () => put(r.code, { name_en: r.name_en, name_ar: r.name_ar, loss: r.loss, active: !r.active, version: r.version }) })] : null));
  }
  async function put(code, body) {
    try { await api("PUT", "/api/stop-reasons/" + encodeURIComponent(code), { commandId: commandId(), ...body }); ui.toast({ kind: "ok", title: t("saved"), text: code }); load(); } catch (e) { showError(e); }
  }
  load();
  return { el: sc.el };
}
