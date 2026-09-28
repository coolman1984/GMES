// Shared by every GMES screen: the dictionary, the session, calls to the server, status names, dates.
import * as ui from "/eco-ui/eco-ui.js";

const S = { dict: {}, fallback: {}, lang: "en", session: null };

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
/** A server row with name_en / name_ar, or a node with en / ar. */
export const name = (n) => (!n ? "" : S.lang === "ar" ? n.name_ar || n.ar || n.name_en || n.en || n.code : n.name_en || n.en || n.code);

// ------------------------------------------------------------------ stop reasons: the plant's own list (SYS9040)
const STOPS = new Map();
export async function loadStopReasons() {
  try { for (const r of await api("GET", "/api/stop-reasons")) STOPS.set(r.code, r); } catch (_) { /* the dictionary names stay */ }
  return [...STOPS.values()];
}
/** The name of a stop reason: the plant's own name when known, else the dictionary's. */
export const stopName = (code) => (STOPS.has(code) ? name(STOPS.get(code)) : t("stop." + code));

// ------------------------------------------------------------------ the session (who signed in, the plant)
export const setSession = (s) => { S.session = s; };
export const session = () => S.session;
export const today = () => S.session.plant.today;
/** Whether the signed-in person's role grants a scope; the server checks again on every request. */
export function can(scope) {
  const scopes = (S.session && S.session.user && S.session.user.scopes) || [];
  return scopes.includes("*") || scopes.includes(scope) || scopes.includes(scope.split(".")[0] + ".*");
}

// ------------------------------------------------------------------ the server
export class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
/** JSON to and from the server. A lost session returns to the sign-in page; errors carry the server's message. */
export async function api(method, url, body) {
  let res;
  try {
    res = await fetch(url, { method, cache: "no-store", headers: body === undefined ? {} : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch (_) {
    throw new ApiError(0, "network", t("err.network"));
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (_) { data = null; }
  if (res.status === 401 && !url.startsWith("/api/auth/")) { location.reload(); throw new ApiError(401, "auth.required", t("err.signed_out")); }
  if (!res.ok) {
    const e = (data && data.error) || {};
    throw new ApiError(res.status, e.code || "http." + res.status, e.message || t("err.server", { status: res.status }));
  }
  return data;
}
/** Shows a server error: in a dialog's error box when given one, else as a toast. */
export function showError(err, box) {
  const text = err instanceof ApiError ? err.message : String(err && err.message || err);
  if (box) ui.clear(box, ui.banner("bad", text));
  else ui.toast({ kind: "bad", title: t("err.title"), text, timeout: 8000 });
}
/** Every command carries its own id, so a retry on a weak network is applied once (idempotency). */
export const commandId = () => "ui-" + (crypto.randomUUID ? crypto.randomUUID() : Date.now() + "-" + Math.random().toString(36).slice(2));

/** Quantities travel as exact decimal strings; screens show them as numbers. */
export const num = (q) => (q === null || q === undefined || q === "" ? 0 : Number(q));

// ------------------------------------------------------------------ work-order states as the screens show them
/** The ledger knows released / completed / closed; a released order that has output is "running". */
export function woState(w) {
  if (w.status === "closed") return "closed";
  if (w.status === "completed") return "done";
  return num(w.completed_qty) + num(w.scrapped_qty) > 0 ? "run" : "released";
}

function shift(n) { const d = new Date(today() + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
export const dayShift = shift;
/** Production-day shortcuts (a production day, not a clock date: GMES docs/design/06 §6.4). */
export function datePresets() {
  const d = new Date(today() + "T12:00:00Z"), dow = (d.getUTCDay() + 1) % 7;  // weeks start on Saturday in Egypt
  return [[t("pr.today"), () => [today(), today()]], [t("pr.yesterday"), () => [shift(-1), shift(-1)]], [t("pr.week"), () => [shift(-dow), today()]],
    [t("pr.7days"), () => [shift(-6), today()]], [t("pr.month"), () => [today().slice(0, 8) + "01", today()]]];
}
/** "HH:MM" of a stored ISO moment in the PLANT's time zone (not the browser's), digits left to right like every number. */
export const hhmm = (iso) => (iso ? new Intl.DateTimeFormat("en-GB", { timeZone: S.session.plant.timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso)) : "");
/** "YYYY-MM-DD HH:MM" in the plant's time zone. */
export const stamp = (iso) => (iso ? new Intl.DateTimeFormat("en-CA", { timeZone: S.session.plant.timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso)) + " " + hhmm(iso) : "");
