// Before the shell: the first administrator (a new installation), signing in, and the forced password change.
import * as ui from "/eco-ui/eco-ui.js";
import { api, showError, t, lang, product } from "./common.js";

const { h } = ui;

function page(title, sub, fields, submitLabel, onSubmit, foot) {
  const err = h("div", { class: "mes-auth-err" });
  const btn = ui.button({ label: submitLabel, kind: "primary", icon: "check" });
  btn.type = "submit";
  const form = h("form", { class: "mes-auth-card", novalidate: true },
    h("div", { class: "mes-auth-brand" }, h("span", { class: "eco-brand-mark", text: "IQ" }), h("div", {}, h("b", { text: product() }), h("span", { class: "eco-muted", text: t("edition") }))),
    h("h1", { text: title }), sub ? h("p", { class: "eco-muted", text: sub }) : null,
    h("div", { class: "mes-auth-fields" }, fields), err, btn, foot || null);
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    btn.disabled = true;
    ui.clear(err);
    try { await onSubmit(err); } catch (e) { showError(e, err); } finally { btn.disabled = false; }
  });
  document.body.replaceChildren(h("main", { class: "mes-auth", dir: lang() === "ar" ? "rtl" : "ltr" }, form));
  const first = form.querySelector("input");
  first && first.focus();
}
const field = (label, input) => ui.field(label, input, { required: true });

/** A new installation: the first account is an administrator; there is no default password to forget to change. */
export function setupPage(done) {
  const login = ui.input({ dir: "ltr", value: "admin" }), nm = ui.input({}), pw = ui.input({ type: "password" }), pw2 = ui.input({ type: "password" });
  page(t("auth.setup_title"), t("auth.setup_sub"), [field(t("u.login"), login), field(t("u.name"), nm), field(t("auth.password"), pw), field(t("auth.password_again"), pw2)],
    t("auth.setup_go"), async (err) => {
      if (pw.value !== pw2.value) { ui.clear(err, ui.banner("bad", t("auth.mismatch"))); return; }
      await api("POST", "/api/setup", { login: login.value, name: nm.value, password: pw.value, language: lang() });
      done();
    });
}

export function loginPage(done) {
  const login = ui.input({ dir: "ltr", autocomplete: "username" }), pw = ui.input({ type: "password", autocomplete: "current-password" });
  const other = lang() === "ar" ? "en" : "ar";
  const switchLang = h("button", { type: "button", class: "mes-auth-lang", text: other === "ar" ? "العربية" : "English",
    onclick: () => { ui.prefs.set("lang", other); location.reload(); } });
  page(t("auth.title"), t("auth.sub"), [field(t("u.login"), login), field(t("auth.password"), pw)], t("auth.go"), async () => {
    await api("POST", "/api/auth/login", { login: login.value, password: pw.value });
    done();
  }, switchLang);
}

/** A password given by an administrator is changed before anything else. */
export function changePasswordPage(done, forced) {
  const cur = ui.input({ type: "password", autocomplete: "current-password" }), pw = ui.input({ type: "password", autocomplete: "new-password" }), pw2 = ui.input({ type: "password", autocomplete: "new-password" });
  page(t("auth.change_title"), forced ? t("auth.change_forced") : null, [field(t("auth.current"), cur), field(t("auth.new"), pw), field(t("auth.password_again"), pw2)],
    t("save"), async (err) => {
      if (pw.value !== pw2.value) { ui.clear(err, ui.banner("bad", t("auth.mismatch"))); return; }
      await api("POST", "/api/auth/password", { current: cur.value, next: pw.value });
      done();
    });
}

/** The same change from the user menu, in a dialog. */
export function changePasswordDialog() {
  const cur = ui.input({ type: "password" }), pw = ui.input({ type: "password" }), pw2 = ui.input({ type: "password" });
  const err = h("div", { class: "eco-span-2" });
  ui.dialog({ title: t("auth.change_title"), icon: "key", width: 460,
    body: h("div", { class: "eco-form" }, h("div", { class: "eco-span-2" }, field(t("auth.current"), cur)), field(t("auth.new"), pw), field(t("auth.password_again"), pw2), err),
    actions: [{ label: t("cancel"), kind: "ghost", value: false }, { label: t("save"), kind: "primary", icon: "save", onClick: async () => {
      if (pw.value !== pw2.value) { ui.clear(err, ui.banner("bad", t("auth.mismatch"))); return false; }
      try { await api("POST", "/api/auth/password", { current: cur.value, next: pw.value }); } catch (e) { showError(e, err); return false; }
      ui.toast({ kind: "ok", title: t("auth.changed") });
    } }] });
}
