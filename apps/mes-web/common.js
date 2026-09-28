// Shared by every GMES screen: the dictionary, status names, date shortcuts, the sample-data note.
import * as ui from "/eco-ui/eco-ui.js";
import { TODAY } from "./data.js";

const S = { dict: {}, fallback: {}, lang: "en" };

export async function loadLang(lang) {
  S.fallback = await (await fetch("/ui/i18n/en.json")).json();
  S.dict = lang === "ar" ? await (await fetch("/ui/i18n/ar.json")).json() : S.fallback;
  S.lang = lang === "ar" ? "ar" : "en";
  return S.lang;
}
export function t(key, vars) {
  let s = S.dict[key] ?? S.fallback[key] ?? key;
  for (const [k, v] of Object.entries(vars || {})) s = s.replace("{" + k + "}", String(v));
  return s;
}
export const lang = () => S.lang;
export const statusLabel = (s) => t("st." + s);
/** Names from sample master data carry both languages. */
export const name = (n) => (S.lang === "ar" && n.ar ? n.ar : n.en || n.name || n.code);

function shift(n) { const d = new Date(TODAY); d.setDate(d.getDate() + n); return ui.isoDate(d); }
/** Production-day shortcuts (a production day, not a clock date: GMES docs/design/06 §6.4). */
export function datePresets() {
  const d = new Date(TODAY), dow = (d.getDay() + 1) % 7;  // weeks start on Saturday in Egypt
  return [[t("pr.today"), () => [TODAY, TODAY]], [t("pr.yesterday"), () => [shift(-1), shift(-1)]], [t("pr.week"), () => [shift(-dow), TODAY]],
    [t("pr.7days"), () => [shift(-6), TODAY]], [t("pr.month"), () => [TODAY.slice(0, 8) + "01", TODAY]]];
}
/** Every screen that shows invented data says so, in its head, in both languages. */
export function sampleNote() {
  const b = ui.badge(t("sample.title"), "warn", "alert");
  b.title = t("sample.text");
  return b;
}
