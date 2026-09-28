// GMES — the application shell. The menu lists the whole screen catalogue (GMES docs/design/05 §5.2); screens not
// built yet are shown, greyed, with their code, so the map of the product is visible from the first day.
// Before the shell: the server says whether the installation has accounts and who is signed in (auth.js).
import * as ui from "/eco-ui/eco-ui.js";
import { api, can, loadLang, session, setSession, t, lang, today } from "./common.js";
import { changePasswordDialog, changePasswordPage, loginPage, setupPage } from "./auth.js";
import home from "./screens/home.js";
import exe3010 from "./screens/exe3010.js";
import exe2020 from "./screens/exe2020.js";
import mdm1010 from "./screens/mdm1010.js";
import mdm1020 from "./screens/mdm1020.js";
import sys9010 from "./screens/sys9010.js";
import dsh5010 from "./screens/dsh5010.js";

const VERSION = "0.3.0";
// [factory, icon, scope needed to open it]
const BUILT = { HOME: [home, "home", "exe.orders.read"], EXE3010: [exe3010, "clipboard", "exe.orders.read"], EXE2020: [exe2020, "tablet", "exe.orders.write"],
  MDM1010: [mdm1010, "sitemap", "mdm.plant.read"], MDM1020: [mdm1020, "box", "mdm.items.read"], SYS9010: [sys9010, "users", "sys.users.read"], DSH5010: [dsh5010, "monitor", "exe.orders.read"] };
const PATH = { EXE3010: ["m.production", "m.work_orders"], EXE2020: ["m.production", "m.shop_floor"], MDM1010: ["m.master", "m.plant_model"], MDM1020: ["m.master", "m.products"],
  SYS9010: ["m.system", "m.security"], DSH5010: ["m.boards"] };

// [group id, icon, [[subgroup key, [codes]]]]
const MENU = [
  ["production", "clipboard", [["m.work_orders", ["EXE2010", "EXE3010", "EXE2030", "EXE2040"]], ["m.shop_floor", ["EXE2020", "EXE3020", "EXE3030"]], ["m.wip", ["WIP3010", "WIP3020"]]]],
  ["quality", "shield", [["m.inspection", ["QMS1010", "QMS1020", "QMS2010"]], ["m.holds", ["QMS2020", "QMS4010"]]]],
  ["efficiency", "gauge", [["m.downtime", ["OEE2010", "OEE4010", "OEE4020"]]]],
  ["trace", "link", [["m.genealogy", ["TRC2010", "TRC3010", "TRC3020"]]]],
  ["reports", "chart", [["m.reports", ["RPT4010", "RPT4020", "RPT4030"]], ["m.labels", ["LBL1010", "LBL2010"]]]],
  ["boards", "monitor", [["m.boards", ["DSH5010", "DSH5020"]]]],
  ["master", "database", [["m.plant_model", ["MDM1010", "MDM1060"]], ["m.products", ["MDM1020", "MDM1030", "MDM1040", "MDM1050"]]]],
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
