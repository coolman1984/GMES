// GMES — the application shell. The menu lists the whole screen catalogue (GMES docs/design/05 §5.2); screens not
// built yet are shown, greyed, with their code, so the map of the product is visible from the first day.
// Before the shell: the server says whether the installation has accounts and who is signed in (auth.js).
import * as ui from "/eco-ui/eco-ui.js";
import { api, can, loadLang, loadStopReasons, session, setSession, t, lang, today } from "./common.js";
import { changePasswordDialog, changePasswordPage, loginPage, setupPage } from "./auth.js";
import home from "./screens/home.js";
import exe3010 from "./screens/exe3010.js";
import exe2020 from "./screens/exe2020.js";
import mdm1010 from "./screens/mdm1010.js";
import mdm1020 from "./screens/mdm1020.js";
import sys9010 from "./screens/sys9010.js";
import dsh5010 from "./screens/dsh5010.js";
import exe2010 from "./screens/exe2010.js";
import exe3020 from "./screens/exe3020.js";
import exe3030 from "./screens/exe3030.js";
import wip3010 from "./screens/wip3010.js";
import wip3020 from "./screens/wip3020.js";
import trc2010 from "./screens/trc2010.js";
import trc3010 from "./screens/trc3010.js";
import trc3020 from "./screens/trc3020.js";
import mdm1030 from "./screens/mdm1030.js";
import mdm1040 from "./screens/mdm1040.js";
import mdm1050 from "./screens/mdm1050.js";
import mdm1060 from "./screens/mdm1060.js";
import mdm1070 from "./screens/mdm1070.js";
import mdm1080 from "./screens/mdm1080.js";
import pln1020 from "./screens/pln1020.js";
import pln1030 from "./screens/pln1030.js";
import pln1040 from "./screens/pln1040.js";
import pln1050 from "./screens/pln1050.js";
import qms1010 from "./screens/qms1010.js";
import qms1020 from "./screens/qms1020.js";
import qms2010 from "./screens/qms2010.js";
import qms2020 from "./screens/qms2020.js";
import qms2030 from "./screens/qms2030.js";
import qms4010 from "./screens/qms4010.js";
import shp1010 from "./screens/shp1010.js";
import shp2010 from "./screens/shp2010.js";
import shp2020 from "./screens/shp2020.js";
import shp2030 from "./screens/shp2030.js";
import shp3010 from "./screens/shp3010.js";
import oee2010 from "./screens/oee2010.js";
import oee4010 from "./screens/oee4010.js";
import oee4020 from "./screens/oee4020.js";
import rpt4010 from "./screens/rpt4010.js";
import rpt4020 from "./screens/rpt4020.js";
import rpt4030 from "./screens/rpt4030.js";
import lbl1010 from "./screens/lbl1010.js";
import lbl2010 from "./screens/lbl2010.js";
import dsh5020 from "./screens/dsh5020.js";
import sys9020 from "./screens/sys9020.js";
import sys9030 from "./screens/sys9030.js";
import sys9040 from "./screens/sys9040.js";
import sys9060 from "./screens/sys9060.js";
import sys9070 from "./screens/sys9070.js";
import sys9090 from "./screens/sys9090.js";
import sys9100 from "./screens/sys9100.js";

const VERSION = "0.5.0";
// [factory, icon, scope needed to open it]
const BUILT = { HOME: [home, "home", "exe.orders.read"], EXE3010: [exe3010, "clipboard", "exe.orders.read"], EXE2020: [exe2020, "tablet", "exe.orders.write"],
  MDM1010: [mdm1010, "sitemap", "mdm.plant.read"], MDM1020: [mdm1020, "box", "mdm.items.read"], SYS9010: [sys9010, "users", "sys.users.read"], DSH5010: [dsh5010, "monitor", "exe.orders.read"],
  EXE2010: [exe2010, "calendar-check", "exe.orders.read"], EXE3020: [exe3020, "history", "trk.units.read"], EXE3030: [exe3030, "table", "exe.ledger.read"],
  WIP3010: [wip3010, "dashboard", "trk.units.read"], WIP3020: [wip3020, "clock", "trk.units.read"],
  TRC2010: [trc2010, "box", "trk.units.read"], TRC3010: [trc3010, "link", "trk.units.read"], TRC3020: [trc3020, "link", "trk.units.read"],
  MDM1030: [mdm1030, "scale", "eng.read"], MDM1040: [mdm1040, "layers", "eng.read"], MDM1050: [mdm1050, "list", "eng.read"], MDM1060: [mdm1060, "calendar", "eng.read"],
  MDM1070: [mdm1070, "sliders", "mdm.items.read"], MDM1080: [mdm1080, "users", "mdm.items.read"], PLN1020: [pln1020, "clipboard", "mdm.items.read"],
  PLN1030: [pln1030, "chart", "mdm.items.read"], PLN1040: [pln1040, "box", "mdm.items.read"], PLN1050: [pln1050, "archive", "mdm.items.read"],
  QMS1010: [qms1010, "clipboard-check", "qms.read"], QMS1020: [qms1020, "alert", "qms.read"], QMS2010: [qms2010, "clipboard-check", "qms.read"],
  QMS2020: [qms2020, "lock", "qms.read"], QMS2030: [qms2030, "wrench", "qms.read"], QMS4010: [qms4010, "chart", "qms.read"],
  SHP1010: [shp1010, "box", "shp.read"], SHP2010: [shp2010, "scan", "shp.pack"], SHP2020: [shp2020, "archive", "shp.read"], SHP2030: [shp2030, "archive", "shp.load"], SHP3010: [shp3010, "list", "shp.read"],
  OEE2010: [oee2010, "pause", "oee.stops.read"], OEE4010: [oee4010, "gauge", "oee.stops.read"], OEE4020: [oee4020, "chart", "oee.stops.read"],
  RPT4010: [rpt4010, "table", "rpt.read"], RPT4020: [rpt4020, "x-octagon", "rpt.read"], RPT4030: [rpt4030, "clipboard-check", "rpt.read"],
  LBL1010: [lbl1010, "tag", "lbl.read"], LBL2010: [lbl2010, "printer", "lbl.print"], DSH5020: [dsh5020, "factory", "exe.orders.read"],
  SYS9020: [sys9020, "shield", "sys.users.read"], SYS9030: [sys9030, "key", "sys.keys.read"], SYS9040: [sys9040, "list", "oee.stops.read"], SYS9060: [sys9060, "settings", "system.health.read"],
  SYS9070: [sys9070, "archive", "system.backup"], SYS9090: [sys9090, "history", "sys.audit.read"], SYS9100: [sys9100, "activity", "system.health.read"] };
const PATH = { EXE3010: ["m.production", "m.work_orders"], EXE2020: ["m.production", "m.shop_floor"], MDM1010: ["m.master", "m.plant_model"], MDM1020: ["m.master", "m.products"],
  SYS9010: ["m.system", "m.security"], DSH5010: ["m.boards"], EXE2010: ["m.production", "m.work_orders"], EXE3020: ["m.production", "m.shop_floor"], EXE3030: ["m.production", "m.shop_floor"],
  WIP3010: ["m.production", "m.wip"], WIP3020: ["m.production", "m.wip"], TRC2010: ["g.trace", "m.genealogy"], TRC3010: ["g.trace", "m.genealogy"], TRC3020: ["g.trace", "m.genealogy"],
  MDM1030: ["m.master", "m.products"], MDM1040: ["m.master", "m.products"], MDM1050: ["m.master", "m.products"], MDM1060: ["m.master", "m.plant_model"],
  MDM1070: ["m.master", "m.products"], MDM1080: ["m.master", "m.products"], PLN1020: ["g.planning", "m.demand"], PLN1030: ["g.planning", "m.demand"],
  PLN1040: ["g.planning", "m.supply"], PLN1050: ["g.planning", "m.supply"],
  QMS1010: ["g.quality", "m.inspection"], QMS1020: ["g.quality", "m.inspection"], QMS2010: ["g.quality", "m.inspection"], QMS2030: ["g.quality", "m.inspection"],
  QMS2020: ["g.quality", "m.holds"], QMS4010: ["g.quality", "m.holds"],
  SHP1010: ["g.shipping", "m.shipping"], SHP2010: ["g.shipping", "m.shipping"], SHP2020: ["g.shipping", "m.shipping"], SHP2030: ["g.shipping", "m.shipping"], SHP3010: ["g.shipping", "m.shipping"],
  OEE2010: ["g.efficiency", "m.downtime"], OEE4010: ["g.efficiency", "m.downtime"], OEE4020: ["g.efficiency", "m.downtime"],
  RPT4010: ["g.reports", "m.reports"], RPT4020: ["g.reports", "m.reports"], RPT4030: ["g.reports", "m.reports"], LBL1010: ["g.reports", "m.labels"], LBL2010: ["g.reports", "m.labels"],
  DSH5020: ["m.boards"], SYS9020: ["m.system", "m.security"], SYS9090: ["m.system", "m.security"], SYS9030: ["m.system", "m.devices"], SYS9040: ["m.system", "m.devices"],
  SYS9060: ["m.system", "m.operations"], SYS9070: ["m.system", "m.operations"], SYS9100: ["m.system", "m.operations"] };

// [group id, icon, [[subgroup key, [codes]]]]
const MENU = [
  ["production", "clipboard", [["m.work_orders", ["EXE2010", "EXE3010", "EXE2030", "EXE2040"]], ["m.shop_floor", ["EXE2020", "EXE3020", "EXE3030"]], ["m.wip", ["WIP3010", "WIP3020"]]]],
  ["planning", "calendar-check", [["m.demand", ["PLN1020", "PLN1030"]], ["m.supply", ["PLN1040", "PLN1050"]]]],
  ["quality", "shield", [["m.inspection", ["QMS1010", "QMS1020", "QMS2010", "QMS2030"]], ["m.holds", ["QMS2020", "QMS4010"]]]],
  ["efficiency", "gauge", [["m.downtime", ["OEE2010", "OEE4010", "OEE4020"]]]],
  ["trace", "link", [["m.genealogy", ["TRC2010", "TRC3010", "TRC3020"]]]],
  ["shipping", "archive", [["m.shipping", ["SHP2020", "SHP2010", "SHP2030", "SHP3010", "SHP1010"]]]],
  ["reports", "chart", [["m.reports", ["RPT4010", "RPT4020", "RPT4030"]], ["m.labels", ["LBL1010", "LBL2010"]]]],
  ["boards", "monitor", [["m.boards", ["DSH5010", "DSH5020"]]]],
  ["master", "database", [["m.plant_model", ["MDM1010", "MDM1060"]], ["m.products", ["MDM1020", "MDM1070", "MDM1030", "MDM1040", "MDM1050", "MDM1080"]]]],
  ["system", "settings", [["m.security", ["SYS9010", "SYS9020", "SYS9090"]], ["m.devices", ["SYS9030", "SYS9040", "SYS9050"]], ["m.operations", ["SYS9060", "SYS9070", "SYS9100", "SYS9120"]]]],
];

async function boot() {
  ui.configure({ prefix: "gmes" });  // preferences are read below: the store must be named first
  const l = await loadLang(ui.prefs.get("lang", navigator.language && navigator.language.startsWith("ar") ? "ar" : "en"));
  ui.configure({ prefix: "gmes", product: "mes", lang: l, theme: ui.prefs.get("theme", "light"), density: ui.prefs.get("density", "compact") });
  let state;
  try { state = await api("GET", "/api/auth/state"); }
  catch (e) {
    document.body.replaceChildren(ui.h("main", { class: "mes-auth" }, ui.h("div", { class: "mes-auth-card" }, ui.banner("bad", t("err.no_server")),
      ui.button({ label: t("retry"), icon: "refresh", onClick: () => location.reload() }))));
    return;
  }
  const again = () => location.reload();
  if (state.needsSetup) return setupPage(again);
  if (!state.user) return loginPage(again);
  if (state.user.mustChangePassword) return changePasswordPage(again, true);
  setSession(state);
  if (can("oee.stops.read")) await loadStopReasons();
  // the plant's own name from the plant model (the installation node name until one exists)
  let plantName = state.plant.node;
  if (can("mdm.plant.read")) {
    try { const p = (await api("GET", "/api/plant")).find((n) => n.type === "plant" && n.active); if (p) plantName = p.code + " · " + (l === "ar" ? p.name_ar : p.name_en); } catch (_) { /* the node name stays */ }
  }
  start(plantName);
}

function start(plantName) {
  const me = session().user, plant = session().plant;
  const mode = ui.prefs.get("mode", "office");
  document.documentElement.dataset.mode = mode;

  const screens = {};
  for (const [code, [factory, icon, scope]] of Object.entries(BUILT)) {
    if (!can(scope)) continue;  // a screen the role cannot use is shown greyed in the menu, like a screen not built yet
    screens[code] = { title: t("scr." + code), icon, path: (PATH[code] || []).map((k) => t(k)), create: factory, keywords: t("kw." + code) };
  }
  if (!screens.HOME) screens.HOME = { title: t("scr.HOME"), icon: "home", create: () => ({ el: ui.empty({ icon: "lock", title: t("err.no_screens") }) }) };
  screens.HOME.hidden = true;
  screens.HOME.tabTitle = t("hm.tab");
  const menu = [{ id: "home", code: "HOME", label: t("hm.tab"), icon: "home" }].concat(MENU.map(([id, icon, subs]) => ({ id, label: t("g." + id), icon,
    children: subs.map(([k, codes]) => ({ id: id + ":" + k, label: t(k), children: codes.map((c) => ({ code: c, label: t("scr." + c) })) })) })));

  const modeSwitch = ui.segmented({ size: "top", value: mode, options: [["office", t("mode.office"), "briefcase"], ["station", t("mode.station"), "tablet"], ["board", t("mode.board"), "monitor"]],
    onChange: (m) => setMode(m) });
  modeSwitch.classList.add("mes-modes");
  const shell = ui.createShell({
    product: { name: "GMES", short: "GM", edition: t("edition") },
    company: { name: plantName, code: plant.companyId.slice(0, 8), note: plant.companyId },
    user: { name: me.name, role: t("role." + me.role), detail: me.login },
    menu, screens, home: "HOME", maxTabs: 10, searchExample: "EXE3010",
    topActions: [modeSwitch],
    onTheme: (th) => { ui.prefs.set("theme", th); ui.configure({ theme: th }); },
    onLanguage: (lg) => { ui.prefs.set("lang", lg); location.reload(); },
    onActivate: () => ui.prefs.set("tabs", [...document.querySelectorAll(".eco-view")].map((v) => v.dataset.code)),
    userMenu: [
      { label: t("auth.change_title"), icon: "key", onSelect: () => changePasswordDialog() },
      { label: t("signout"), icon: "logout", onSelect: async () => { try { await api("POST", "/api/auth/logout"); } finally { location.reload(); } } },
    ],
    shortcuts: [["F2", t("hm.tip_station")]],
  });
  document.body.replaceChildren(shell.el);
  const conn = ui.statusItem("wifi", ui.kitText("connected"), "is-ok");
  const clock = ui.statusItem("clock", ui.fmtTime());
  shell.setStatus([conn, ui.statusItem("factory", plantName), ui.statusItem("calendar", t("st.prod_day") + " " + today()),
    ui.statusItem("user", me.login), clock, ui.statusItem(null, "GMES " + VERSION + " · " + (lang() === "ar" ? "العربية" : "English"), "is-end")]);
  setInterval(() => { clock.lastChild.textContent = ui.fmtTime(); }, 1000);
  // the connection is observed, never assumed
  async function ping() {
    let ok = false;
    try { ok = (await fetch("/api/health", { cache: "no-store" })).ok; } catch (_) { ok = false; }
    conn.className = "eco-status-item " + (ok ? "is-ok" : "is-bad");
    conn.lastChild.textContent = ok ? ui.kitText("connected") : ui.kitText("disconnected");
  }
  ping(); setInterval(ping, 15000);

  shell.start(ui.prefs.get("tabs", []).filter((c) => screens[c]));
  if (mode !== "office") setMode(mode);
  document.addEventListener("keydown", (ev) => { if (ev.key === "F2") { ev.preventDefault(); setMode(document.documentElement.dataset.mode === "station" ? "office" : "station"); } });

  /** Office: the full shell. Station: the operator screen only, no menu, big touch targets. Board: the line board
   *  only, dark and high-contrast, for a TV. The same screens, the same data; only the frame changes. */
  function setMode(m) {
    ui.prefs.set("mode", m);
    document.documentElement.dataset.mode = m;
    if (m === "station" && screens.EXE2020) shell.open("EXE2020");
    else if (m === "board" && screens.DSH5010) shell.open("DSH5010");
    modeSwitch.redraw(m);
  }
}
boot();
