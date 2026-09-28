// eco-ui — the one reusable interface kit of the ecosystem's products (GMES, HR-System, ...).
//
// Plain JavaScript (an ES module), no library, no build step: the same file runs in GMES's web app and inside the
// installed HR-System. Screens are BUILT FROM these parts, never styled one by one:
//   createShell()      top bar, collapsible menu tree, screen search (Ctrl+K), MDI tabs, status bar
//   screen()           breadcrumb + screen code, standard toolbar, condition panel, result bar, grid, detail panel
//   conditionPanel()   search conditions: required marks, saved filters, summary chips
//   grid()             dense data grid: virtual rows, sort, resize, hide/pin/reorder columns, totals, CSV export,
//                      saved column layouts, keyboard navigation, explicit empty/loading/error states
//   dialog(), confirm(), toast(), menu(), tree(), tabs(), split(), kpi(), barChart(), statusChip() ...
// Every value is written as text (textContent / createTextNode), never parsed as HTML: a name typed by a user
// cannot become code on another user's screen (the products' tests reject innerHTML in these files).
// Preferences (favourites, column layouts, saved filters, theme) live in the browser of the person (localStorage,
// wrapped: a blocked store leaves the defaults working).

// ------------------------------------------------------------------ built-in texts (the kit's own chrome)
const TEXT = {
  en: {
    close: "Close", cancel: "Cancel", ok: "OK", save: "Save", yes: "Yes", no: "No", apply: "Apply", reset: "Reset", delete: "Delete",
    search_screens: "Search screens by code or name", search_hint: "Type a screen code (e.g. {example}) or a name",
    no_screens: "No screen matches", recent: "Recent", favourites: "Favourites", all_screens: "All screens", menu: "Menu",
    filter_menu: "Filter menu", collapse_menu: "Collapse menu", expand_menu: "Expand menu",
    home: "Home", close_tab: "Close", close_others: "Close other tabs", close_all: "Close all tabs", too_many_tabs: "Up to {n} screens can be open. Close one first.",
    favourite_add: "Add to favourites", favourite_remove: "Remove from favourites",
    conditions: "Search conditions", required_missing: "Fill the required conditions: {fields}", saved_filters: "Saved filters",
    save_filter: "Save current conditions…", filter_name: "Name of this filter", default_filter: "Use as default", no_saved: "No saved filters yet",
    delete_filter: "Delete “{name}”", applied: "Applied", none_applied: "No conditions",
    rows: "{n} rows", of_rows: "{shown} of {n} rows", selected: "{n} selected", queried_at: "at {time}", took: "{ms} ms",
    quick_filter: "Filter these rows", export: "Export", export_csv: "Export to Excel (CSV)", columns: "Columns", layout_reset: "Reset layout",
    sort_asc: "Sort ascending", sort_desc: "Sort descending", sort_clear: "Clear sort", pin: "Freeze column", unpin: "Unfreeze column", hide: "Hide column",
    show_columns: "Visible columns", move_up: "Move up", move_down: "Move down", total: "Total",
    loading: "Loading…", no_data: "No rows", not_queried: "Set the conditions and press Inquiry (F5).",
    notifications: "Notifications", no_notifications: "Nothing new", mark_read: "Mark all as read",
    theme: "Theme", light: "Light", dark: "Dark", density: "Density", compact: "Compact", comfortable: "Comfortable", language: "Language",
    connected: "Connected", disconnected: "Not connected", keyboard: "Keyboard shortcuts", details: "Details", more: "More",
    shortcuts: [["Ctrl+K", "Search screens"], ["F5", "Inquiry"], ["Ctrl+E", "Export"], ["Alt+1…9", "Switch tab"], ["Esc", "Close dialog or menu"],
                ["↑ ↓", "Move in the grid"], ["Enter", "Open the selected row"]],
  },
  ar: {
    close: "إغلاق", cancel: "إلغاء", ok: "موافق", save: "حفظ", yes: "نعم", no: "لا", apply: "تطبيق", reset: "إعادة ضبط", delete: "حذف",
    search_screens: "ابحث عن شاشة بالكود أو الاسم", search_hint: "اكتب كود الشاشة (مثل {example}) أو اسمها",
    no_screens: "لا توجد شاشة مطابقة", recent: "الأخيرة", favourites: "المفضلة", all_screens: "كل الشاشات", menu: "القائمة",
    filter_menu: "تصفية القائمة", collapse_menu: "طي القائمة", expand_menu: "فتح القائمة",
    home: "الرئيسية", close_tab: "إغلاق", close_others: "إغلاق التبويبات الأخرى", close_all: "إغلاق كل التبويبات", too_many_tabs: "أقصى عدد للشاشات المفتوحة {n}. أغلق واحدة أولًا.",
    favourite_add: "إضافة إلى المفضلة", favourite_remove: "إزالة من المفضلة",
    conditions: "شروط البحث", required_missing: "املأ الشروط الإلزامية: {fields}", saved_filters: "الفلاتر المحفوظة",
    save_filter: "حفظ الشروط الحالية…", filter_name: "اسم هذا الفلتر", default_filter: "استخدمه افتراضيًا", no_saved: "لا توجد فلاتر محفوظة بعد",
    delete_filter: "حذف «{name}»", applied: "المطبّق", none_applied: "بدون شروط",
    rows: "{n} صف", of_rows: "{shown} من {n} صف", selected: "{n} محدد", queried_at: "الساعة {time}", took: "{ms} م.ث",
    quick_filter: "تصفية هذه الصفوف", export: "تصدير", export_csv: "تصدير إلى إكسل (CSV)", columns: "الأعمدة", layout_reset: "استعادة التخطيط",
    sort_asc: "ترتيب تصاعدي", sort_desc: "ترتيب تنازلي", sort_clear: "إلغاء الترتيب", pin: "تثبيت العمود", unpin: "إلغاء تثبيت العمود", hide: "إخفاء العمود",
    show_columns: "الأعمدة الظاهرة", move_up: "لأعلى", move_down: "لأسفل", total: "الإجمالي",
    loading: "جارٍ التحميل…", no_data: "لا توجد صفوف", not_queried: "حدد الشروط ثم اضغط استعلام (F5).",
    notifications: "الإشعارات", no_notifications: "لا جديد", mark_read: "تعليم الكل كمقروء",
    theme: "المظهر", light: "فاتح", dark: "داكن", density: "الكثافة", compact: "مضغوط", comfortable: "مريح", language: "اللغة",
    connected: "متصل", disconnected: "غير متصل", keyboard: "اختصارات لوحة المفاتيح", details: "التفاصيل", more: "المزيد",
    shortcuts: [["Ctrl+K", "البحث عن شاشة"], ["F5", "استعلام"], ["Ctrl+E", "تصدير"], ["Alt+1…9", "التنقل بين التبويبات"], ["Esc", "إغلاق النافذة أو القائمة"],
                ["↑ ↓", "التنقل في الجدول"], ["Enter", "فتح الصف المحدد"]],
  },
};
let LANG = "en";
export function kitText(key, vars) {
  let s = (TEXT[LANG] && TEXT[LANG][key]) ?? TEXT.en[key] ?? key;
  if (typeof s === "string") for (const [k, v] of Object.entries(vars || {})) s = s.replace("{" + k + "}", String(v));
  return s;
}
const T = kitText;

// ------------------------------------------------------------------ DOM (text only, never HTML)
export function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  setAttrs(e, attrs);
  append(e, kids);
  return e;
}
function setAttrs(e, attrs) {
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") e.className = Array.isArray(v) ? v.filter(Boolean).join(" ") : v;
    else if (k === "text") e.textContent = v;
    else if (k === "style" && typeof v === "object") for (const [p, x] of Object.entries(v)) { if (p.startsWith("--")) e.style.setProperty(p, x); else e.style[p] = x; }
    else if (k.startsWith("on") && typeof v === "function") e.addEventListener(k.slice(2), v);
    else if (k === "value") e.value = v;
    else if (k === "checked") e.checked = !!v;
    else e.setAttribute(k, v === true ? "" : v);
  }
}
function append(e, kids) {
  for (const kid of kids.flat(Infinity)) if (kid !== null && kid !== undefined && kid !== false) e.append(kid instanceof Node ? kid : String(kid));
}
export function clear(e, ...kids) { e.replaceChildren(); append(e, kids); return e; }
const SVG = "http://www.w3.org/2000/svg";
function s(tag, attrs, ...kids) {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v !== null && v !== undefined) e.setAttribute(k, v);
  for (const kid of kids.flat()) if (kid) e.append(kid);
  return e;
}

// ------------------------------------------------------------------ icons (our own line drawings, 24x24)
const ICONS = {
  menu: "M4 6h16M4 12h16M4 18h16", search: "M17 10.5a6.5 6.5 0 1 1-13 0a6.5 6.5 0 1 1 13 0zM20 20l-4.8-4.8",
  bell: "M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0",
  help: "M21 12a9 9 0 1 1-18 0a9 9 0 1 1 18 0zM9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7v.3M12 17h.01",
  user: "M16 8a4 4 0 1 1-8 0a4 4 0 1 1 8 0zM4 20c1.5-3.5 4.5-5 8-5s6.5 1.5 8 5",
  users: "M13 8a3.5 3.5 0 1 1-7 0a3.5 3.5 0 1 1 7 0zM3 19c1-3 3.5-4.5 6.5-4.5S15 16 16 19M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5c1.5.6 2.5 2 3 4.5",
  "user-plus": "M14 8a3.5 3.5 0 1 1-7 0a3.5 3.5 0 1 1 7 0zM3.5 19.5c1-3 3.5-4.5 7-4.5 1.5 0 2.8.3 3.8.9M18.5 13v6M15.5 16h6",
  settings: "M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4",
  sun: "M16 12a4 4 0 1 1-8 0a4 4 0 1 1 8 0zM12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4",
  moon: "M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z",
  globe: "M21 12a9 9 0 1 1-18 0a9 9 0 1 1 18 0zM3 12h18M12 3c2.5 2.5 3.5 5.5 3.5 9s-1 6.5-3.5 9c-2.5-2.5-3.5-5.5-3.5-9s1-6.5 3.5-9z",
  logout: "M10 4H5v16h5M14 8l4 4-4 4M18 12H9",
  "chev-right": "M9 6l6 6-6 6", "chev-left": "M15 6l-6 6 6 6", "chev-down": "M6 9l6 6 6-6", "chev-up": "M6 15l6-6 6 6",
  x: "M6 6l12 12M18 6L6 18", plus: "M12 5v14M5 12h14", minus: "M5 12h14",
  edit: "M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4", trash: "M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6",
  save: "M5 4h11l3 3v13H5zM8 4v5h7V4M8 20v-6h8v6",
  refresh: "M20 11a8 8 0 0 0-14.5-4.5L4 8M4 4v4h4M4 13a8 8 0 0 0 14.5 4.5L20 16M20 20v-4h-4",
  download: "M12 4v11M7 10l5 5 5-5M5 20h14", upload: "M12 16V5M7 10l5-5 5 5M5 20h14",
  filter: "M4 5h16l-6 7.5V19l-4-2v-4.5z", columns: "M4 5h16v14H4zM9.5 5v14M14.5 5v14",
  star: "M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z",
  more: { d: "M6 12h.01M12 12h.01M18 12h.01", w: 3 }, grip: { d: "M9 6h.01M9 12h.01M9 18h.01M15 6h.01M15 12h.01M15 18h.01", w: 2.6 },
  home: "M4 11l8-7 8 7M6 9.5V20h12V9.5M10 20v-6h4v6",
  factory: "M3 20V11l5 3v-3l5 3V5h4v4h4v11zM7 17h2M12 17h2M17 17h2",
  box: "M12 3l8 4.5v9L12 21l-8-4.5v-9zM4 7.5l8 4.5 8-4.5M12 12v9",
  clipboard: "M9 4h6v3H9zM8 5.5H6V21h12V5.5h-2M9 12h6M9 16h4",
  shield: "M12 3l7 3v5c0 5-3 8.5-7 10-4-1.5-7-5-7-10V6zM9 12l2 2 4-4",
  lock: "M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3",
  key: "M11 12.5a3.5 3.5 0 1 1-7 0a3.5 3.5 0 1 1 7 0zM10.3 10.3L19 4M16 6.2l2.2 2.2M13.8 7.8l1.8 1.8",
  database: "M5 6c0-1.7 3.1-3 7-3s7 1.3 7 3-3.1 3-7 3-7-1.3-7-3zM5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3",
  archive: "M3 5h18v4H3zM5 9v11h14V9M10 13h4", activity: "M3 12h4l3-7 4 14 3-7h4",
  history: "M4 12a8 8 0 1 0 2.3-5.7L4 8.5M4 4v4.5h4.5M12 8v4.5l3 2",
  calendar: "M4 6h16v14H4zM4 10h16M8 3.5v4M16 3.5v4", "calendar-check": "M4 6h16v14H4zM4 10h16M8 3.5v4M16 3.5v4M9 15l2 2 4-4",
  clock: "M21 12a9 9 0 1 1-18 0a9 9 0 1 1 18 0zM12 7v5l3.5 2",
  check: "M5 12.5l4.5 4.5L19 7.5", "check-circle": "M21 12a9 9 0 1 1-18 0a9 9 0 1 1 18 0zM8 12.5l3 3 5-6",
  alert: "M12 4l9 16H3zM12 10v4.5M12 17.5h.01", "x-octagon": "M8.2 3h7.6L21 8.2v7.6L15.8 21H8.2L3 15.8V8.2zM9 9l6 6M15 9l-6 6",
  info: "M21 12a9 9 0 1 1-18 0a9 9 0 1 1 18 0zM12 11v6M12 7.5h.01",
  play: "M8 5.5v13l10.5-6.5z", pause: "M8 5v14M16 5v14",
  wrench: "M14.5 4.5a4.5 4.5 0 0 0-4.3 5.9L4 16.6 7.4 20l6.2-6.2a4.5 4.5 0 0 0 5.9-4.3l-2.7 2.7-3-3z",
  rotate: "M4 12a8 8 0 1 0 2.5-5.8M4 4v4.5h4.5", layers: "M12 4l9 4.5-9 4.5-9-4.5zM3 13l9 4.5 9-4.5",
  dashboard: "M4 4h7v9H4zM13 4h7v5h-7zM13 11h7v9h-7zM4 15h7v5H4z",
  sitemap: "M10 3h4v4h-4zM4 16h4v4H4zM10 16h4v4h-4zM16 16h4v4h-4zM12 7v9M6 16v-3h12v3",
  building: "M5 21V4h9v17M14 9h5v12M3 21h18M8 8h3M8 12h3M8 16h3",
  monitor: "M3 5h18v11H3zM8 20h8M12 16v4", tablet: "M6 3h12v18H6zM11 18h2", briefcase: "M4 8h16v11H4zM9 8V5h6v3M4 13h16",
  printer: "M7 9V4h10v5M5 9h14v7h-2M7 16H5M7 13h10v7H7z", copy: "M8 8h11v12H8zM5 16V4h11",
  eye: "M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12zM15 12a3 3 0 1 1-6 0a3 3 0 1 1 6 0z",
  "arrow-up": "M12 19V5M6 11l6-6 6 6", "arrow-down": "M12 5v14M6 13l6 6 6-6", sort: "M8 9l4-4 4 4M8 15l4 4 4-4",
  pin: "M9 4h6l-1 5 3 3v1H7v-1l3-3zM12 13v7", panel: "M4 5h16v14H4zM15 5v14",
  scan: "M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4M7 12h10",
  link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
  table: "M4 5h16v14H4zM4 10h16M4 15h16M10 10v9", bookmark: "M6 4h12v17l-6-4-6 4z",
  chart: "M4 20V4M4 20h16M8 17v-6M12 17V7M16 17v-4",
  cpu: "M7 7h10v10H7zM10 10h4v4h-4zM9 3v4M15 3v4M9 17v4M15 17v4M3 9h4M3 15h4M17 9h4M17 15h4",
  flag: "M5 21V4M5 4h11l-2 4 2 4H5", expand: "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5",
  keyboard: "M3 6h18v12H3zM7 10h.01M11 10h.01M15 10h.01M7 14h10", wifi: "M5 13a10 10 0 0 1 14 0M8.5 16.5a5 5 0 0 1 7 0M12 20h.01",
  "id-card": "M3 5h18v14H3zM9.5 10.5a2 2 0 1 1-4 0a2 2 0 1 1 4 0zM5 16c.6-1.5 1.8-2.2 2.5-2.2s1.9.7 2.5 2.2M13 9h5M13 13h5",
  mail: "M3 6h18v12H3zM3 7l9 6 9-6", phone: "M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1z",
  "map-pin": "M12 21s-6.5-5.7-6.5-11a6.5 6.5 0 0 1 13 0c0 5.3-6.5 11-6.5 11zM14.5 10a2.5 2.5 0 1 1-5 0a2.5 2.5 0 1 1 5 0z",
  tag: "M3 12V4h8l10 10-8 8zM7.5 8h.01", zap: "M13 3L5 13h6l-1 8 8-10h-6z", gauge: "M4 17a8 8 0 1 1 16 0M12 17l4-5",
};
export function icon(name, size = 16, cls) {
  const def = ICONS[name] || ICONS.info;
  const d = typeof def === "string" ? def : def.d;
  return s("svg", { class: "eco-ic" + (cls ? " " + cls : ""), width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor",
    "stroke-width": typeof def === "object" ? def.w : 1.6, "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true", focusable: "false" },
  s("path", { d }));
}
export const iconNames = () => Object.keys(ICONS);

// ------------------------------------------------------------------ preferences (per person, per browser)
let PREFIX = "eco";
export const prefs = {
  get(key, fallback) {
    try { const v = localStorage.getItem(PREFIX + ":" + key); return v === null ? fallback : JSON.parse(v); } catch (_) { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(PREFIX + ":" + key, JSON.stringify(value)); } catch (_) { /* a blocked store keeps the defaults */ }
  },
};

/** Theme, density, language and product: applied as attributes on <html>, read by tokens.css. */
export function configure({ product, lang, theme, density, prefix } = {}) {
  const root = document.documentElement;
  if (prefix) PREFIX = prefix;
  if (product) root.dataset.product = product;
  if (lang) { LANG = TEXT[lang] ? lang : "en"; root.lang = lang; root.dir = lang === "ar" ? "rtl" : "ltr"; }
  if (theme) root.dataset.theme = theme === "system" ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : theme;
  if (density) root.dataset.density = density;
}
export const isRTL = () => document.documentElement.dir === "rtl";
export const lang = () => LANG;

// ------------------------------------------------------------------ numbers and dates (codes stay left-to-right)
export function fmtNumber(v, digits = 0) {
  if (v === null || v === undefined || v === "") return "";
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  return n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
export function fmtTime(d = new Date()) { return d.toTimeString().slice(0, 8); }
export function isoDate(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}
/** Left-to-right island for codes, numbers and ids inside right-to-left text. */
export function ltr(text, cls) { return h("bdi", { class: ["eco-ltr", cls], dir: "ltr", text: String(text ?? "") }); }

// ------------------------------------------------------------------ small parts
export function kbd(keys) { return h("kbd", { class: "eco-kbd", text: keys }); }

/** kind: primary | default | ghost | danger | subtle | top (for the dark bar) */
export function button({ label, icon: ic, kind = "default", kbd: keys, onClick, title, disabled, size, type = "button", pressed, cls } = {}) {
  const b = h("button", { type, class: ["eco-btn", "eco-btn-" + kind, size && "eco-btn-" + size, !label && "eco-btn-icon", cls], title: title || (!label ? undefined : null),
    "aria-label": !label ? title : null, disabled: !!disabled, "aria-pressed": pressed === undefined ? null : String(!!pressed) },
  ic ? icon(ic, size === "lg" ? 20 : 15) : null, label ? h("span", { class: "eco-btn-label", text: label }) : null, keys ? kbd(keys) : null);
  if (onClick) b.addEventListener("click", async (ev) => {
    if (b.dataset.busy) return;
    b.dataset.busy = "1"; b.classList.add("is-busy");
    try { await onClick(ev); } finally { delete b.dataset.busy; b.classList.remove("is-busy"); }
  });
  return b;
}
export function sep() { return h("span", { class: "eco-sep", "aria-hidden": "true" }); }

export function badge(text, kind = "neutral", ic) { return h("span", { class: "eco-badge eco-badge-" + kind }, ic ? icon(ic, 12) : null, h("span", { text })); }

const STATUS_ICON = { run: "play", idle: "pause", down: "x-octagon", setup: "wrench", planned: "calendar", hold: "lock", rework: "rotate", done: "check",
  ok: "check", warn: "alert", bad: "x-octagon", info: "info", neutral: null, released: "play", open: "clock", closed: "check" };
/** A status is never colour alone: a coloured dot + an icon + the word. */
export function statusChip(status, label) {
  return h("span", { class: "eco-status eco-st-" + status }, STATUS_ICON[status] ? icon(STATUS_ICON[status], 12) : h("i", { class: "eco-dot" }), h("span", { text: label }));
}
export function progress(value, max = 100, { label, status } = {}) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return h("span", { class: "eco-progress" + (status ? " eco-st-" + status : ""), title: label || Math.round(pct) + "%" },
    h("span", { class: "eco-progress-track" }, h("span", { class: "eco-progress-fill", style: { width: pct.toFixed(1) + "%" } })),
    h("span", { class: "eco-progress-text", text: label ?? Math.round(pct) + "%" }));
}
export function avatar(name, size = 28) {
  const letters = String(name || "?").trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  let hue = 0;
  for (const ch of String(name || "")) hue = (hue * 31 + ch.charCodeAt(0)) % 360;
  return h("span", { class: "eco-avatar", style: { width: size + "px", height: size + "px", fontSize: Math.round(size * 0.4) + "px", background: `hsl(${hue} 42% 44%)` }, text: letters, "aria-hidden": "true" });
}
export function empty({ icon: ic = "search", title, text, action } = {}) {
  return h("div", { class: "eco-empty" }, h("div", { class: "eco-empty-icon" }, icon(ic, 28)), title ? h("div", { class: "eco-empty-title", text: title }) : null,
    text ? h("div", { class: "eco-empty-text", text }) : null, action || null);
}
export function banner(kind, text, { title, action } = {}) {
  return h("div", { class: "eco-banner eco-banner-" + kind, role: kind === "bad" ? "alert" : "status" },
    icon({ ok: "check-circle", warn: "alert", bad: "x-octagon", info: "info" }[kind] || "info", 16),
    h("div", { class: "eco-banner-body" }, title ? h("strong", { text: title }) : null, h("span", { text })), action || null);
}
/** Label/value pairs for detail panels. Values may be nodes. */
export function props(pairs, { cols = 1 } = {}) {
  return h("dl", { class: "eco-props", style: { gridTemplateColumns: `repeat(${cols}, minmax(0, auto) minmax(0, 1fr))` } },
    pairs.filter(Boolean).map(([k, v]) => [h("dt", { text: k }), h("dd", {}, v === null || v === undefined || v === "" ? h("span", { class: "eco-muted", text: "—" }) : v)]));
}
export function section(title, body, { actions, cls } = {}) {
  return h("section", { class: ["eco-section", cls] }, h("header", { class: "eco-section-head" }, h("h3", { text: title }), actions ? h("div", { class: "eco-section-actions" }, actions) : null), body);
}
export function card({ title, subtitle, icon: ic, actions, body, cls, footer } = {}) {
  return h("div", { class: ["eco-card", cls] },
    title ? h("header", { class: "eco-card-head" }, ic ? h("span", { class: "eco-card-icon" }, icon(ic, 16)) : null,
      h("div", { class: "eco-card-titles" }, h("h3", { text: title }), subtitle ? h("span", { class: "eco-muted", text: subtitle }) : null),
      actions ? h("div", { class: "eco-card-actions" }, actions) : null) : null,
    h("div", { class: "eco-card-body" }, body), footer ? h("footer", { class: "eco-card-foot" }, footer) : null);
}
export function kpi({ label, value, unit, delta, deltaKind, hint, icon: ic, status, spark } = {}) {
  return h("div", { class: ["eco-kpi", status && "eco-st-" + status] },
    h("div", { class: "eco-kpi-top" }, ic ? h("span", { class: "eco-kpi-icon" }, icon(ic, 15)) : null, h("span", { class: "eco-kpi-label", text: label })),
    h("div", { class: "eco-kpi-value" }, h("bdi", { dir: "ltr", text: value }), unit ? h("span", { class: "eco-kpi-unit", text: unit }) : null),
    h("div", { class: "eco-kpi-foot" }, delta ? h("span", { class: "eco-kpi-delta eco-" + (deltaKind || "neutral"), text: delta }) : null, hint ? h("span", { class: "eco-muted", text: hint }) : null,
      spark ? sparkline(spark) : null));
}
export function sparkline(values, { w = 84, hgt = 22 } = {}) {
  if (!values || values.length < 2) return null;
  const max = Math.max(...values), min = Math.min(...values), span = max - min || 1;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * w, hgt - 2 - ((v - min) / span) * (hgt - 4)]);
  return s("svg", { class: "eco-spark", width: w, height: hgt, viewBox: `0 0 ${w} ${hgt}`, "aria-hidden": "true" },
    s("path", { d: "M" + pts.map((p) => p[0].toFixed(1) + " " + p[1].toFixed(1)).join("L"), fill: "none", stroke: "currentColor", "stroke-width": 1.5 }));
}
/** Bars (optionally stacked) with an optional target line; labels along the bottom. series: [{label, values, cls}] */
export function barChart({ labels, series, height = 180, width, target, stacked = false, format = (v) => fmtNumber(v) } = {}) {
  const W = width || Math.max(560, labels.length * 64), H = height, padL = 36, padB = 22, padT = 10;
  const totals = labels.map((_, i) => stacked ? series.reduce((a, sr) => a + (sr.values[i] || 0), 0) : Math.max(...series.map((sr) => sr.values[i] || 0)));
  const max = Math.max(1, target || 0, ...totals) * 1.1;
  const y = (v) => padT + (H - padT - padB) * (1 - v / max);
  const bw = ((W - padL) / labels.length) * (stacked ? 0.62 : 0.72 / series.length);
  const g = [];
  for (let k = 0; k <= 4; k++) {
    const v = (max / 4) * k;
    g.push(s("line", { x1: padL, x2: W, y1: y(v), y2: y(v), class: "eco-chart-grid" }), s("text", { x: padL - 6, y: y(v) + 3, class: "eco-chart-axis", "text-anchor": "end" }, document.createTextNode(format(Math.round(v)))));
  }
  labels.forEach((lab, i) => {
    const slot = (W - padL) / labels.length, x0 = padL + slot * i + (slot - (stacked ? bw : bw * series.length)) / 2;
    let acc = 0;
    series.forEach((sr, j) => {
      const v = sr.values[i] || 0;
      const x = stacked ? x0 : x0 + j * bw, top = stacked ? y(acc + v) : y(v), bottom = stacked ? y(acc) : y(0);
      g.push(s("rect", { x, y: top, width: Math.max(1, bw - 2), height: Math.max(0, bottom - top), class: "eco-chart-bar " + (sr.cls || "eco-chart-s" + j), rx: 1.5 },
        s("title", {}, document.createTextNode(`${lab} · ${sr.label}: ${format(v)}`))));
      acc += v;
    });
    g.push(s("text", { x: padL + slot * i + slot / 2, y: H - 6, class: "eco-chart-axis", "text-anchor": "middle" }, document.createTextNode(lab)));
  });
  if (target) g.push(s("line", { x1: padL, x2: W, y1: y(target), y2: y(target), class: "eco-chart-target" }));
  const legend = h("div", { class: "eco-chart-legend" }, series.map((sr, j) => h("span", {}, h("i", { class: "eco-chart-key " + (sr.cls || "eco-chart-s" + j) }), sr.label)));
  return h("div", { class: "eco-chart" }, legend, s("svg", { viewBox: `0 0 ${W} ${H}`, class: "eco-chart-svg", role: "img" }, g));
}
/** A ring for a single percentage (OEE, completion). */
export function ring(pct, { size = 64, label, status } = {}) {
  const r = size / 2 - 5, c = 2 * Math.PI * r, v = Math.max(0, Math.min(100, pct));
  return h("span", { class: ["eco-ring", status && "eco-st-" + status], style: { width: size + "px", height: size + "px" } },
    s("svg", { width: size, height: size, viewBox: `0 0 ${size} ${size}` },
      s("circle", { cx: size / 2, cy: size / 2, r, class: "eco-ring-track" }),
      s("circle", { cx: size / 2, cy: size / 2, r, class: "eco-ring-fill", "stroke-dasharray": `${(c * v) / 100} ${c}`, transform: `rotate(-90 ${size / 2} ${size / 2})` })),
    h("span", { class: "eco-ring-text", text: label ?? Math.round(v) + "%" }));
}

// ------------------------------------------------------------------ form controls
export function input({ value, placeholder, type = "text", dir, required, onInput, onEnter, cls, width, readonly, ...rest } = {}) {
  const e = h("input", { class: ["eco-input", cls], type, placeholder, dir, required: !!required, readonly: !!readonly, style: width ? { width } : null, ...rest });
  if (value !== undefined && value !== null) e.value = value;
  if (onInput) e.addEventListener("input", () => onInput(e.value));
  if (onEnter) e.addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); onEnter(e.value); } });
  return e;
}
/** options: [[value, label]] or [{value, label}] */
export function select({ options = [], value, onChange, placeholder, cls, width, required } = {}) {
  const e = h("select", { class: ["eco-select", cls], style: width ? { width } : null, required: !!required },
    placeholder !== undefined ? h("option", { value: "", text: placeholder }) : null,
    options.map((o) => Array.isArray(o) ? h("option", { value: o[0], text: o[1] }) : h("option", { value: o.value, text: o.label })));
  if (value !== undefined && value !== null) e.value = String(value);
  if (onChange) e.addEventListener("change", () => onChange(e.value));
  return e;
}
export function checkbox({ label, checked, onChange, disabled } = {}) {
  const c = h("input", { type: "checkbox", class: "eco-check", checked: !!checked, disabled: !!disabled });
  if (onChange) c.addEventListener("change", () => onChange(c.checked));
  return label === undefined ? c : h("label", { class: "eco-check-label" }, c, h("span", { text: label }));
}
export function toggle({ label, checked, onChange, hint } = {}) {
  const c = h("input", { type: "checkbox", role: "switch", class: "eco-switch-input", checked: !!checked });
  if (onChange) c.addEventListener("change", () => onChange(c.checked));
  return h("label", { class: "eco-switch" }, c, h("span", { class: "eco-switch-track", "aria-hidden": "true" }, h("span", { class: "eco-switch-thumb" })),
    h("span", { class: "eco-switch-text" }, h("span", { text: label }), hint ? h("small", { class: "eco-muted", text: hint }) : null));
}
/** options: [[value, label, icon?]] */
export function segmented({ options, value, onChange, size } = {}) {
  const wrap = h("div", { class: ["eco-seg", size && "eco-seg-" + size], role: "radiogroup" });
  const draw = (v) => clear(wrap, options.map(([val, lab, ic]) => h("button", { type: "button", role: "radio", "aria-checked": String(val === v), class: val === v ? "is-on" : null,
    onclick: () => { draw(val); onChange && onChange(val); } }, ic ? icon(ic, 14) : null, lab ? h("span", { text: lab }) : null)));
  draw(value);
  wrap.redraw = draw;
  return wrap;
}
/** A labelled field; `required` shows the star and the red edge when empty on Inquiry. */
export function field(label, control, { required, hint, span, error } = {}) {
  return h("div", { class: ["eco-field", span && "eco-span-" + span, required && "is-required"] },
    h("label", { class: "eco-label" }, h("span", { text: label }), required ? h("b", { class: "eco-req", text: "*", "aria-hidden": "true" }) : null), control,
    hint ? h("small", { class: "eco-hint", text: hint }) : null, error ? h("small", { class: "eco-error", text: error }) : null);
}
export function searchBox({ placeholder, onInput, value, width } = {}) {
  const i = input({ placeholder, value, onInput, type: "search" });
  return h("div", { class: "eco-searchbox", style: width ? { width } : null }, icon("search", 14), i);
}

// ------------------------------------------------------------------ layers: menus, dialogs, toasts
let LAYER;
function layer() {
  if (!LAYER || !LAYER.isConnected) { LAYER = h("div", { class: "eco-layer" }); document.body.append(LAYER); }
  return LAYER;
}
let OPEN_MENU = null;
export function closeMenus() { if (OPEN_MENU) { OPEN_MENU(); OPEN_MENU = null; } }
/** items: [{label, icon, kbd, onSelect, danger, checked, disabled} | "-" | {header}] ; anchor: element or {x, y} */
export function menu(anchor, items, { align = "start", minWidth } = {}) {
  closeMenus();
  const list = h("div", { class: "eco-menu", role: "menu", style: minWidth ? { minWidth: minWidth + "px" } : null });
  const buttons = [];
  for (const it of items.filter(Boolean)) {
    if (it === "-") { list.append(h("div", { class: "eco-menu-sep", role: "separator" })); continue; }
    if (it.header) { list.append(h("div", { class: "eco-menu-head", text: it.header })); continue; }
    if (it.node) { list.append(it.node); continue; }
    const b = h("button", { type: "button", role: it.checked === undefined ? "menuitem" : "menuitemcheckbox", "aria-checked": it.checked === undefined ? null : String(!!it.checked),
      class: ["eco-menu-item", it.danger && "is-danger"], disabled: !!it.disabled },
    h("span", { class: "eco-menu-ic" }, it.checked ? icon("check", 14) : it.icon ? icon(it.icon, 14) : null), h("span", { class: "eco-menu-label", text: it.label }),
    it.kbd ? kbd(it.kbd) : null, it.hint ? h("span", { class: "eco-muted", text: it.hint }) : null);
    b.addEventListener("click", () => { closeMenus(); it.onSelect && it.onSelect(); });
    buttons.push(b);
    list.append(b);
  }
  layer().append(list);
  const r = anchor instanceof Element ? anchor.getBoundingClientRect() : { left: anchor.x, right: anchor.x, top: anchor.y, bottom: anchor.y, width: 0 };
  const lw = list.offsetWidth, lh = list.offsetHeight, rtl = isRTL();
  let x = (align === "end") !== rtl ? r.right - lw : r.left;
  if (x + lw > innerWidth - 6) x = innerWidth - lw - 6;
  let y = r.bottom + 4;
  if (y + lh > innerHeight - 6) y = Math.max(6, r.top - lh - 4);
  Object.assign(list.style, { left: Math.max(6, x) + "px", top: y + "px" });
  const onDoc = (ev) => { if (!list.contains(ev.target) && !(anchor instanceof Element && anchor.contains(ev.target))) closeMenus(); };
  const onKey = (ev) => {
    const i = buttons.indexOf(document.activeElement);
    if (ev.key === "Escape") { closeMenus(); anchor instanceof Element && anchor.focus(); }
    else if (ev.key === "ArrowDown") { ev.preventDefault(); (buttons[i + 1] || buttons[0])?.focus(); }
    else if (ev.key === "ArrowUp") { ev.preventDefault(); (buttons[i - 1] || buttons[buttons.length - 1])?.focus(); }
  };
  setTimeout(() => document.addEventListener("mousedown", onDoc), 0);
  document.addEventListener("keydown", onKey);
  OPEN_MENU = () => { list.remove(); document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  (buttons[0] || list).focus?.();
  return list;
}
/** A floating panel (notifications, user card) anchored to a button. */
export function popover(anchor, content, { align = "end", width = 320 } = {}) {
  return menu(anchor, [{ node: h("div", { class: "eco-popover", style: { width: width + "px" } }, content) }], { align });
}

/** actions: [{label, kind, onClick (return false to keep open; may be async), icon, kbd}] */
export function dialog({ title, subtitle, body, actions = [], width = 560, icon: ic, onClose, dismissable = true } = {}) {
  closeMenus();
  const prev = document.activeElement;
  const foot = h("footer", { class: "eco-dialog-foot" });
  const box = h("div", { class: "eco-dialog", role: "dialog", "aria-modal": "true", style: { width: `min(${width}px, calc(100vw - 32px))` } },
    h("header", { class: "eco-dialog-head" }, ic ? h("span", { class: "eco-dialog-icon" }, icon(ic, 18)) : null,
      h("div", { class: "eco-dialog-titles" }, h("h2", { text: title }), subtitle ? h("span", { class: "eco-muted", text: subtitle }) : null),
      dismissable ? button({ icon: "x", kind: "ghost", title: T("close"), onClick: () => close(false) }) : null),
    h("div", { class: "eco-dialog-body" }, body), actions.length ? foot : null);
  const shade = h("div", { class: "eco-shade" }, box);
  let done = false;
  function close(result) {
    if (done) return;
    done = true;
    shade.remove();
    document.removeEventListener("keydown", onKey, true);
    prev && prev.focus && prev.focus();
    onClose && onClose(result);
  }
  // an action closes the dialog with its `value` (default true) unless its onClick returns false
  for (const a of actions) foot.append(button({ ...a, onClick: async () => { const r = a.onClick ? await a.onClick() : undefined; if (r !== false) close(r === undefined ? (a.value ?? true) : r); } }));
  const onKey = (ev) => {
    if (ev.key === "Escape" && dismissable) { ev.stopPropagation(); close(false); }
    if (ev.key === "Tab") {  // keep the focus inside the dialog
      const f = [...box.querySelectorAll("button, input, select, textarea, [tabindex]")].filter((x) => !x.disabled && x.offsetParent !== null);
      if (!f.length) return;
      if (ev.shiftKey && document.activeElement === f[0]) { ev.preventDefault(); f[f.length - 1].focus(); }
      else if (!ev.shiftKey && document.activeElement === f[f.length - 1]) { ev.preventDefault(); f[0].focus(); }
    }
  };
  document.addEventListener("keydown", onKey, true);
  if (dismissable) shade.addEventListener("mousedown", (ev) => { if (ev.target === shade) close(false); });
  layer().append(shade);
  const first = box.querySelector(".eco-dialog-body input, .eco-dialog-body select, .eco-dialog-body textarea") || foot.querySelector(".eco-btn-primary");
  first && first.focus();
  return { close, el: box, foot };
}
export function confirm({ title, text, okLabel, danger, icon: ic } = {}) {
  return new Promise((resolve) => {
    dialog({ title, width: 440, icon: ic || (danger ? "alert" : "help"), body: h("p", { class: "eco-dialog-text", text }), onClose: (r) => resolve(r === true),
      actions: [{ label: T("cancel"), kind: "ghost", value: false }, { label: okLabel || T("ok"), kind: danger ? "danger" : "primary", value: true }] });
  });
}
/** A prompt for one value; resolves null when cancelled. */
export function promptValue({ title, label, value = "", type = "text", okLabel, hint } = {}) {
  return new Promise((resolve) => {
    const i = input({ value, type });
    let result = null;
    const d = dialog({ title, width: 420, body: field(label, i, { hint }), onClose: () => resolve(result),
      actions: [{ label: T("cancel"), kind: "ghost", value: false }, { label: okLabel || T("ok"), kind: "primary", onClick: () => { result = i.value; } }] });
    i.addEventListener("keydown", (ev) => { if (ev.key === "Enter") { result = i.value; d.close(true); } });
  });
}

let TOASTS;
const NOTES = [];
const NOTE_LISTENERS = new Set();
/** kind: ok | warn | bad | info. Also kept in the notification centre when `keep` is set. */
export function toast({ kind = "info", title, text, timeout = 4200, keep = false } = {}) {
  if (!TOASTS || !TOASTS.isConnected) { TOASTS = h("div", { class: "eco-toasts", "aria-live": "polite" }); document.body.append(TOASTS); }
  const t = h("div", { class: "eco-toast eco-toast-" + kind, role: kind === "bad" ? "alert" : "status" },
    icon({ ok: "check-circle", warn: "alert", bad: "x-octagon", info: "info" }[kind], 16),
    h("div", { class: "eco-toast-body" }, title ? h("strong", { text: title }) : null, text ? h("span", { text }) : null),
    button({ icon: "x", kind: "ghost", size: "sm", title: T("close"), onClick: () => t.remove() }));
  TOASTS.append(t);
  if (timeout) setTimeout(() => t.remove(), timeout);
  if (keep) notify({ kind, title, text });
  return t;
}
export function notify(note) {
  NOTES.unshift({ ...note, at: new Date(), read: false });
  NOTE_LISTENERS.forEach((f) => f(NOTES));
}
export const notifications = { list: () => NOTES, listen: (f) => NOTE_LISTENERS.add(f), markRead() { NOTES.forEach((n) => (n.read = true)); NOTE_LISTENERS.forEach((f) => f(NOTES)); } };

// ------------------------------------------------------------------ layout helpers: split, tabs, tree
/** Two panes with a draggable divider. direction: "row" (side by side) | "column" (stacked). The size is remembered. */
export function split(a, b, { direction = "row", key, initial = 360, min = 180, second = true } = {}) {
  const wrap = h("div", { class: ["eco-split", "eco-split-" + direction, !second && "eco-split-fixed-a"] });
  const handle = h("div", { class: "eco-split-handle", role: "separator", tabindex: "0", "aria-orientation": direction === "row" ? "vertical" : "horizontal" });
  const paneA = h("div", { class: "eco-split-a" }, a), paneB = h("div", { class: "eco-split-b" }, b);
  let size = key ? prefs.get("split:" + key, initial) : initial;
  const apply = () => { (second ? paneB : paneA).style.flexBasis = size + "px"; };
  apply();
  handle.addEventListener("pointerdown", (ev) => {
    ev.preventDefault();
    handle.setPointerCapture(ev.pointerId);
    const start = direction === "row" ? ev.clientX : ev.clientY, from = size, rtl = isRTL();
    const move = (e) => {
      let d = (direction === "row" ? e.clientX : e.clientY) - start;
      if (direction === "row" && rtl) d = -d;
      const total = direction === "row" ? wrap.clientWidth : wrap.clientHeight;
      size = Math.max(min, Math.min(total - min, second ? from - d : from + d));
      apply();
    };
    const up = () => { handle.removeEventListener("pointermove", move); handle.removeEventListener("pointerup", up); key && prefs.set("split:" + key, size); };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
  });
  wrap.append(paneA, handle, paneB);
  wrap.showSecond = (show) => { paneB.hidden = !show; handle.hidden = !show; };
  return wrap;
}

/** tabs: [{id, label, count, icon, render: () => node}] */
export function tabs(list, { value, onChange, cls } = {}) {
  const bar = h("div", { class: "eco-tabs-inner", role: "tablist" }), body = h("div", { class: "eco-tabpanel", role: "tabpanel" });
  const cache = {};
  const show = (id) => {
    clear(bar, list.map((tb) => h("button", { type: "button", role: "tab", "aria-selected": String(tb.id === id), class: tb.id === id ? "is-on" : null, onclick: () => show(tb.id) },
      tb.icon ? icon(tb.icon, 14) : null, h("span", { text: tb.label }), tb.count !== undefined ? h("span", { class: "eco-count", text: String(tb.count) }) : null)));
    const tb = list.find((x) => x.id === id) || list[0];
    cache[tb.id] = cache[tb.id] || tb.render();
    clear(body, cache[tb.id]);
    onChange && onChange(tb.id);
  };
  show(value || list[0].id);
  return h("div", { class: ["eco-tabset", cls] }, bar, body);
}

/** nodes: [{id, label, icon, badge, children, data}] */
export function tree(nodes, { onSelect, selected, expanded, key, render, dense } = {}) {
  let open = new Set(key ? prefs.get("tree:" + key, expanded || []) : expanded || []);
  let sel = selected;
  const root = h("div", { class: ["eco-tree", dense && "eco-tree-dense"], role: "tree", tabindex: "0" });
  const flat = [];
  function draw() {
    flat.length = 0;
    clear(root, nodes.map((n) => node(n, 0)));
  }
  function node(n, depth) {
    const kids = n.children && n.children.length;
    const isOpen = open.has(n.id);
    flat.push(n);
    const row = h("div", { class: ["eco-tree-row", sel === n.id && "is-sel"], role: "treeitem", "aria-expanded": kids ? String(isOpen) : null, "aria-selected": String(sel === n.id),
      style: { paddingInlineStart: 6 + depth * 16 + "px" }, "data-id": n.id },
    h("span", { class: "eco-tree-twist", onclick: (ev) => { ev.stopPropagation(); if (kids) toggle(n.id); } }, kids ? icon(isOpen ? "chev-down" : (isRTL() ? "chev-left" : "chev-right"), 13) : null),
    n.icon ? h("span", { class: "eco-tree-ic" }, icon(n.icon, 15)) : null,
    render ? render(n) : h("span", { class: "eco-tree-label", text: n.label }),
    n.badge !== undefined && n.badge !== null ? h("span", { class: "eco-tree-badge", text: String(n.badge) }) : null);
    row.addEventListener("click", () => { sel = n.id; draw(); onSelect && onSelect(n); });
    row.addEventListener("dblclick", () => { if (kids) toggle(n.id); });
    return h("div", { class: "eco-tree-node" }, row, kids && isOpen ? h("div", { role: "group" }, n.children.map((c) => node(c, depth + 1))) : null);
  }
  function toggle(id) { open.has(id) ? open.delete(id) : open.add(id); key && prefs.set("tree:" + key, [...open]); draw(); }
  root.addEventListener("keydown", (ev) => {
    const i = flat.findIndex((n) => n.id === sel);
    const cur = flat[i];
    if (ev.key === "ArrowDown" && flat[i + 1]) { sel = flat[i + 1].id; draw(); onSelect && onSelect(flat[i + 1]); }
    else if (ev.key === "ArrowUp" && i > 0) { sel = flat[i - 1].id; draw(); onSelect && onSelect(flat[i - 1]); }
    else if ((ev.key === "ArrowRight") !== isRTL() && (ev.key === "ArrowRight" || ev.key === "ArrowLeft") && cur && cur.children && !open.has(cur.id)) toggle(cur.id);
    else if ((ev.key === "ArrowLeft") !== isRTL() && (ev.key === "ArrowRight" || ev.key === "ArrowLeft") && cur && open.has(cur.id)) toggle(cur.id);
    else return;
    ev.preventDefault();
  });
  draw();
  root.expandAll = () => { const all = []; const walk = (ns) => ns.forEach((n) => { if (n.children && n.children.length) { all.push(n.id); walk(n.children); } }); walk(nodes); open = new Set(all); draw(); };
  root.collapseAll = () => { open = new Set(); draw(); };
  root.select = (id) => { sel = id; draw(); };
  return root;
}

// ------------------------------------------------------------------ the data grid
/**
 * columns: [{key, label, width, type: text|code|number|date|status|progress|custom, align, digits, frozen, hidden,
 *            total: "sum"|"count"|fn, render(row) -> node|string, value(row) -> sortable/exported value, status(row) -> st}]
 * options: {rows, rowKey, selection: single|multi|none, onSelect(rows), onOpen(row), layoutKey, totals, emptyText, rowStatus(row)}
 */
export function grid(columns, opts = {}) {
  const o = { rowKey: "id", selection: "single", totals: false, ...opts };
  const base = columns.map((c) => ({ width: 120, type: "text", ...c }));
  const saved = o.layoutKey ? prefs.get("grid:" + o.layoutKey, null) : null;
  let cols = applyLayout(base, saved);
  let rows = o.rows || [], view = [], sort = saved && saved.sort ? saved.sort : [], quick = "", selected = new Set(), cursor = -1, state = o.rows ? "ready" : "idle", stateText = "";
  // rowHeight: a grid whose cells hold more than a line (a roster, a matrix) sets its own height; the others follow the density
  const RH = () => o.rowHeight || parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--eco-row-h")) || 26;

  const scroller = h("div", { class: "eco-grid-scroll", tabindex: "0", role: "grid", "aria-multiselectable": o.selection === "multi" ? "true" : null });
  const head = h("div", { class: "eco-grid-head", role: "row" });
  const body = h("div", { class: "eco-grid-body", role: "rowgroup" });
  const foot = h("div", { class: "eco-grid-foot", role: "row" });
  const overlay = h("div", { class: "eco-grid-overlay" });
  scroller.append(head, body, foot);
  const root = h("div", { class: "eco-grid" }, scroller, overlay);

  function visible() { return cols.filter((c) => !c.hidden); }
  function template() {
    const v = visible();
    return (o.selection === "multi" ? "32px " : "") + v.map((c) => c.width + "px").join(" ") + " minmax(0, 1fr)";
  }
  function stickyOffsets() {
    const off = {}; let x = o.selection === "multi" ? 32 : 0;
    for (const c of visible()) { if (c.frozen) { off[c.key] = x; x += c.width; } }
    return off;
  }
  function valueOf(c, r) { return c.value ? c.value(r) : r[c.key]; }
  function text(c, r) {
    const v = valueOf(c, r);
    if (v === null || v === undefined) return "";
    if (c.type === "number") return fmtNumber(v, c.digits || 0);
    if (c.type === "percent") return fmtNumber(v, c.digits ?? 1) + "%";
    return String(v);
  }
  function cellContent(c, r) {
    if (c.render) { const x = c.render(r); return x instanceof Node ? x : document.createTextNode(x ?? ""); }
    if (c.type === "status") { const st = c.status ? c.status(r) : r[c.key]; return statusChip(st, c.label_of ? c.label_of(st, r) : text(c, r)); }
    if (c.type === "progress") { const v = valueOf(c, r); return progress(v, c.max ? c.max(r) : 100, { status: c.status ? c.status(r) : null }); }
    return document.createTextNode(text(c, r));
  }
  function compute() {
    const q = quick.trim().toLowerCase();
    view = q ? rows.filter((r) => cols.some((c) => text(c, r).toLowerCase().includes(q))) : rows.slice();  // hidden columns too: a hidden column must not hide a match
    if (sort.length) {
      const byKey = Object.fromEntries(cols.map((c) => [c.key, c]));
      view.sort((a, b) => {
        for (const { key, dir } of sort) {
          const c = byKey[key]; if (!c) continue;
          const x = valueOf(c, a), y = valueOf(c, b);
          const cmp = typeof x === "number" && typeof y === "number" ? x - y : String(x ?? "").localeCompare(String(y ?? ""), undefined, { numeric: true });
          if (cmp) return dir === "desc" ? -cmp : cmp;
        }
        return 0;
      });
    }
  }
  function drawHead() {
    const off = stickyOffsets(), tpl = template();
    head.style.gridTemplateColumns = tpl;
    foot.style.gridTemplateColumns = tpl;
    const cells = [];
    if (o.selection === "multi") {
      const all = h("input", { type: "checkbox", class: "eco-check", "aria-label": "all" });
      all.checked = view.length > 0 && view.every((r) => selected.has(r[o.rowKey]));
      all.indeterminate = !all.checked && view.some((r) => selected.has(r[o.rowKey]));
      all.addEventListener("change", () => { view.forEach((r) => (all.checked ? selected.add(r[o.rowKey]) : selected.delete(r[o.rowKey]))); changed(); });
      cells.push(h("div", { class: "eco-gh eco-gsel is-frozen", style: { insetInlineStart: "0px" } }, all));
    }
    for (const c of visible()) {
      const sorted = sort.find((x) => x.key === c.key);
      const hc = h("div", { class: ["eco-gh", "eco-al-" + align(c), c.frozen && "is-frozen", sorted && "is-sorted"], role: "columnheader", title: c.title || c.label,
        "aria-sort": sorted ? (sorted.dir === "asc" ? "ascending" : "descending") : null, style: c.frozen ? { insetInlineStart: off[c.key] + "px" } : null, draggable: "true" },
      h("span", { class: "eco-gh-label", text: c.label }),
      sorted ? h("span", { class: "eco-gh-sort" }, icon(sorted.dir === "asc" ? "arrow-up" : "arrow-down", 12), sort.length > 1 ? h("small", { text: String(sort.indexOf(sorted) + 1) }) : null) : null,
      h("button", { type: "button", class: "eco-gh-menu", "aria-label": T("more"), tabindex: "-1", onclick: (ev) => { ev.stopPropagation(); columnMenu(ev.currentTarget, c); } }, icon("chev-down", 12)),
      h("span", { class: "eco-gh-resize", onpointerdown: (ev) => resize(ev, c), onclick: (ev) => ev.stopPropagation() }));
      hc.addEventListener("click", (ev) => { if (ev.target.closest(".eco-gh-menu, .eco-gh-resize")) return; toggleSort(c.key, ev.shiftKey); });
      hc.addEventListener("contextmenu", (ev) => { ev.preventDefault(); columnMenu({ x: ev.clientX, y: ev.clientY }, c); });
      hc.addEventListener("dragstart", (ev) => { ev.dataTransfer.setData("text/eco-col", c.key); });
      hc.addEventListener("dragover", (ev) => ev.preventDefault());
      hc.addEventListener("drop", (ev) => { ev.preventDefault(); const from = ev.dataTransfer.getData("text/eco-col"); if (from && from !== c.key) move(from, c.key); });
      cells.push(hc);
    }
    cells.push(h("div", { class: "eco-gh eco-gfill" }));
    clear(head, cells);
    drawFoot(off);
  }
  function drawFoot(off) {
    const has = o.totals && view.length > 0 && visible().some((c) => c.total);
    foot.hidden = !has;
    if (!has) return;
    const cells = o.selection === "multi" ? [h("div", { class: "eco-gf is-frozen", style: { insetInlineStart: "0px" } })] : [];
    let first = true;
    for (const c of visible()) {
      let v = "";
      if (c.total === "sum") v = fmtNumber(view.reduce((a, r) => a + (Number(valueOf(c, r)) || 0), 0), c.digits || 0);
      else if (c.total === "count") v = fmtNumber(view.length);
      else if (typeof c.total === "function") v = c.total(view);
      else if (first) v = T("total");
      first = false;
      cells.push(h("div", { class: ["eco-gf", "eco-al-" + align(c), c.frozen && "is-frozen"], style: c.frozen ? { insetInlineStart: off[c.key] + "px" } : null, text: v }));
    }
    cells.push(h("div", { class: "eco-gf eco-gfill" }));
    clear(foot, cells);
  }
  function align(c) { return c.align || (c.type === "number" || c.type === "percent" ? "end" : c.type === "status" || c.type === "progress" ? "start" : "start"); }
  let lastRange = "";
  function drawBody(force) {
    const rh = RH(), n = view.length;
    body.style.height = n * rh + "px";
    const top = Math.max(0, scroller.scrollTop - head.offsetHeight), hgt = scroller.clientHeight || 600;
    const from = Math.max(0, Math.floor(top / rh) - 8), to = Math.min(n, Math.ceil((top + hgt) / rh) + 8);
    const range = from + ":" + to;
    if (!force && range === lastRange) return;
    lastRange = range;
    const off = stickyOffsets(), tpl = template(), out = [];
    for (let i = from; i < to; i++) {
      const r = view[i], id = r[o.rowKey], isSel = selected.has(id);
      const st = o.rowStatus ? o.rowStatus(r) : null;
      const row = h("div", { class: ["eco-gr", i % 2 && "is-alt", isSel && "is-sel", i === cursor && "is-cursor", st && "eco-row-" + st], role: "row", "aria-selected": String(isSel),
        style: { top: i * rh + "px", gridTemplateColumns: tpl, height: rh + "px", "--eco-row-h": rh + "px" }, "data-i": String(i) });
      if (o.selection === "multi") {
        const cb = h("input", { type: "checkbox", class: "eco-check", checked: isSel, tabindex: "-1" });
        cb.addEventListener("click", (ev) => { ev.stopPropagation(); cb.checked ? selected.add(id) : selected.delete(id); cursor = i; changed(); });
        row.append(h("div", { class: "eco-gc eco-gsel is-frozen", style: { insetInlineStart: "0px" } }, cb));
      }
      for (const c of visible()) {
        row.append(h("div", { class: ["eco-gc", "eco-al-" + align(c), "eco-t-" + c.type, c.frozen && "is-frozen", c.cls], role: "gridcell",
          style: c.frozen ? { insetInlineStart: off[c.key] + "px" } : null, title: c.type === "status" || c.render ? null : text(c, r) }, cellContent(c, r)));
      }
      row.append(h("div", { class: "eco-gc eco-gfill" }));
      out.push(row);
    }
    clear(body, out);
  }
  function drawOverlay() {
    overlay.hidden = !(state === "loading" || state === "idle" || state === "error" || (state === "ready" && view.length === 0));
    if (overlay.hidden) return;
    if (state === "loading") clear(overlay, h("div", { class: "eco-grid-msg" }, h("span", { class: "eco-spinner" }), h("span", { text: stateText || T("loading") })));
    else if (state === "error") clear(overlay, empty({ icon: "x-octagon", title: stateText }));
    else if (state === "idle") clear(overlay, empty({ icon: "filter", text: stateText || o.idleText || T("not_queried") }));
    else clear(overlay, empty({ icon: "search", title: quick ? T("no_data") : T("no_data"), text: quick ? T("quick_filter") + ": “" + quick + "”" : (stateText || o.emptyText || "") }));
  }
  const tell = () => root.dispatchEvent(new CustomEvent("eco-view"));
  function all(force = true) { compute(); drawHead(); drawBody(force); drawOverlay(); tell(); }
  function changed() {
    drawHead(); drawBody(true); tell();
    o.onSelect && o.onSelect(api.selected());
  }
  function persist() {
    if (!o.layoutKey) return;
    prefs.set("grid:" + o.layoutKey, { order: cols.map((c) => c.key), hidden: cols.filter((c) => c.hidden).map((c) => c.key), widths: Object.fromEntries(cols.map((c) => [c.key, c.width])),
      frozen: cols.filter((c) => c.frozen).map((c) => c.key), sort });
  }
  function toggleSort(key, add) {
    const cur = sort.find((x) => x.key === key);
    const next = !cur ? { key, dir: "asc" } : cur.dir === "asc" ? { key, dir: "desc" } : null;
    sort = add ? sort.filter((x) => x.key !== key).concat(next ? [next] : []) : next ? [next] : [];
    persist(); all();
  }
  function resize(ev, c) {
    ev.preventDefault(); ev.stopPropagation();
    const start = ev.clientX, from = c.width, rtl = isRTL(), el = ev.currentTarget;
    el.setPointerCapture(ev.pointerId);
    const move = (e) => { c.width = Math.max(44, from + (rtl ? start - e.clientX : e.clientX - start)); drawHead(); drawBody(true); };
    const up = () => { el.removeEventListener("pointermove", move); el.removeEventListener("pointerup", up); persist(); };
    el.addEventListener("pointermove", move); el.addEventListener("pointerup", up);
  }
  function move(fromKey, toKey) {
    const a = cols.findIndex((c) => c.key === fromKey), b = cols.findIndex((c) => c.key === toKey);
    const [c] = cols.splice(a, 1); cols.splice(b, 0, c); persist(); all();
  }
  function columnMenu(anchor, c) {
    menu(anchor, [
      { label: T("sort_asc"), icon: "arrow-up", onSelect: () => { sort = [{ key: c.key, dir: "asc" }]; persist(); all(); } },
      { label: T("sort_desc"), icon: "arrow-down", onSelect: () => { sort = [{ key: c.key, dir: "desc" }]; persist(); all(); } },
      sort.length ? { label: T("sort_clear"), icon: "x", onSelect: () => { sort = []; persist(); all(); } } : null, "-",
      { label: c.frozen ? T("unpin") : T("pin"), icon: "pin", onSelect: () => { c.frozen = !c.frozen; if (c.frozen) { cols = cols.filter((x) => x !== c); const k = cols.filter((x) => x.frozen).length; cols.splice(k, 0, c); } persist(); all(); } },
      { label: T("hide"), icon: "eye", disabled: visible().length <= 1, onSelect: () => { c.hidden = true; persist(); all(); } }, "-",
      { label: T("columns") + "…", icon: "columns", onSelect: () => columnsDialog() },
      { label: T("layout_reset"), icon: "refresh", onSelect: () => api.resetLayout() },
    ], { minWidth: 200 });
  }
  function columnsDialog() {
    let work = cols.map((c) => ({ ...c }));
    const list = h("div", { class: "eco-collist" });
    const draw = () => clear(list, work.map((c, i) => h("div", { class: "eco-collist-row" },
      checkbox({ label: c.label, checked: !c.hidden, onChange: (v) => { c.hidden = !v; } }),
      c.frozen ? badge(T("pin"), "info", "pin") : null, h("span", { class: "eco-grow" }),
      button({ icon: "arrow-up", kind: "ghost", size: "sm", title: T("move_up"), disabled: i === 0, onClick: () => { [work[i - 1], work[i]] = [work[i], work[i - 1]]; draw(); } }),
      button({ icon: "arrow-down", kind: "ghost", size: "sm", title: T("move_down"), disabled: i === work.length - 1, onClick: () => { [work[i + 1], work[i]] = [work[i], work[i + 1]]; draw(); } }))));
    draw();
    dialog({ title: T("columns"), icon: "columns", width: 420, body: h("div", {}, h("p", { class: "eco-muted", text: T("show_columns") }), list),
      actions: [{ label: T("layout_reset"), kind: "ghost", onClick: () => { api.resetLayout(); } }, { label: T("cancel"), kind: "ghost" },
        { label: T("apply"), kind: "primary", onClick: () => { if (!work.some((c) => !c.hidden)) return false; cols = work; persist(); all(); } }] });
  }
  scroller.addEventListener("scroll", () => drawBody(false), { passive: true });
  if (typeof ResizeObserver !== "undefined") new ResizeObserver(() => drawBody(false)).observe(scroller);
  window.addEventListener("eco-refresh", () => { if (root.isConnected) { lastRange = ""; all(); } });
  body.addEventListener("click", (ev) => {
    const row = ev.target.closest(".eco-gr"); if (!row) return;
    const i = Number(row.dataset.i), id = view[i][o.rowKey];
    if (o.selection === "none") return;
    if (o.selection === "multi" && (ev.ctrlKey || ev.metaKey)) selected.has(id) ? selected.delete(id) : selected.add(id);
    else if (o.selection === "multi" && ev.shiftKey && cursor >= 0) { const [a, b] = [Math.min(cursor, i), Math.max(cursor, i)]; for (let k = a; k <= b; k++) selected.add(view[k][o.rowKey]); }
    else { selected = new Set([id]); }
    cursor = i; scroller.focus({ preventScroll: true }); changed();
  });
  body.addEventListener("dblclick", (ev) => { const row = ev.target.closest(".eco-gr"); if (row && o.onOpen) o.onOpen(view[Number(row.dataset.i)]); });
  scroller.addEventListener("keydown", (ev) => {
    if (!view.length) return;
    const page = Math.max(1, Math.floor(scroller.clientHeight / RH()) - 1);
    const moves = { ArrowDown: 1, ArrowUp: -1, PageDown: page, PageUp: -page };
    let next = null;
    if (ev.key in moves) next = Math.max(0, Math.min(view.length - 1, (cursor < 0 ? -1 : cursor) + moves[ev.key]));
    else if (ev.key === "Home" && ev.ctrlKey) next = 0;
    else if (ev.key === "End" && ev.ctrlKey) next = view.length - 1;
    else if (ev.key === "Enter" && cursor >= 0 && o.onOpen) { ev.preventDefault(); o.onOpen(view[cursor]); return; }
    else if (ev.key === " " && cursor >= 0 && o.selection === "multi") { ev.preventDefault(); const id = view[cursor][o.rowKey]; selected.has(id) ? selected.delete(id) : selected.add(id); changed(); return; }
    else if (ev.key === "a" && (ev.ctrlKey || ev.metaKey) && o.selection === "multi") { ev.preventDefault(); view.forEach((r) => selected.add(r[o.rowKey])); changed(); return; }
    if (next === null) return;
    ev.preventDefault();
    cursor = next;
    if (o.selection !== "none" && !(o.selection === "multi" && ev.shiftKey)) selected = new Set([view[next][o.rowKey]]);
    else if (o.selection === "multi") selected.add(view[next][o.rowKey]);
    const rh = RH(), y = next * rh, top = scroller.scrollTop, vis = scroller.clientHeight - head.offsetHeight - (foot.hidden ? 0 : foot.offsetHeight);
    if (y < top) scroller.scrollTop = y; else if (y + rh > top + vis) scroller.scrollTop = y + rh - vis;
    changed();
  });

  const api = {
    el: root,
    setRows(next, { keepSelection } = {}) {
      rows = next || []; state = "ready"; stateText = "";
      if (!keepSelection) { selected = new Set(); cursor = -1; }
      else { const ids = new Set(rows.map((r) => r[o.rowKey])); selected = new Set([...selected].filter((x) => ids.has(x))); }
      all(); o.onSelect && o.onSelect(api.selected());
    },
    setLoading(text) { state = "loading"; stateText = text || ""; drawOverlay(); },
    setError(text) { state = "error"; stateText = text; rows = []; all(); },
    setIdle(text) { state = "idle"; stateText = text || ""; rows = []; all(); },
    setEmptyText(text) { stateText = text; drawOverlay(); },
    setQuickFilter(q) { quick = q || ""; all(); },
    rows: () => rows, view: () => view, count: () => rows.length, shown: () => view.length,
    selected: () => rows.filter((r) => selected.has(r[o.rowKey])),
    select(id) { selected = new Set(id === null || id === undefined ? [] : [id]); cursor = view.findIndex((r) => r[o.rowKey] === id); changed(); },
    focus: () => scroller.focus(),
    columnsDialog, layout: () => ({ order: cols.map((c) => c.key), hidden: cols.filter((c) => c.hidden).map((c) => c.key), widths: Object.fromEntries(cols.map((c) => [c.key, c.width])), frozen: cols.filter((c) => c.frozen).map((c) => c.key), sort }),
    applyLayout(l) { cols = applyLayout(base, l); sort = (l && l.sort) || []; persist(); all(); },
    resetLayout() { cols = base.map((c) => ({ ...c })); sort = []; o.layoutKey && prefs.set("grid:" + o.layoutKey, null); all(); },
    refresh: () => all(),
    /** CSV that Excel opens directly: UTF-8 with BOM, the columns and the order the person sees, the rows after filter and sort. */
    toCSV() {
      const v = visible(), esc = (x) => { const t = String(x ?? ""); return /[",\n\r;]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
      return "﻿" + [v.map((c) => esc(c.label)).join(","), ...view.map((r) => v.map((c) => esc(c.type === "number" || c.type === "percent" ? valueOf(c, r) : text(c, r))).join(","))].join("\r\n");
    },
    exportCSV(name) {
      const blob = new Blob([api.toCSV()], { type: "text/csv;charset=utf-8" });
      const a = h("a", { href: URL.createObjectURL(blob), download: (name || "export") + "-" + isoDate() + ".csv" });
      document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    },
  };
  if (!o.rows) state = "idle";
  all();
  return api;
}
function applyLayout(base, l) {
  const cols = base.map((c) => ({ ...c }));
  if (!l) return cols;
  const byKey = Object.fromEntries(cols.map((c) => [c.key, c]));
  const order = (l.order || []).filter((k) => byKey[k]).map((k) => byKey[k]);
  const rest = cols.filter((c) => !(l.order || []).includes(c.key));
  const out = order.concat(rest);
  for (const c of out) {
    if (l.hidden) c.hidden = l.hidden.includes(c.key);
    if (l.widths && l.widths[c.key]) c.width = l.widths[c.key];
    if (l.frozen) c.frozen = l.frozen.includes(c.key);
  }
  return out.filter((c) => c.frozen).concat(out.filter((c) => !c.frozen));
}

// ------------------------------------------------------------------ search conditions
/**
 * fields: [{key, label, type: text|select|date|daterange|number|toggle, options, required, default, span, placeholder, dir, presets}]
 * Required fields are marked and checked: Inquiry never runs without them (instead of silently returning nothing).
 */
export function conditionPanel(fields, { key, title, onSubmit, collapsed, extra } = {}) {
  const controls = {};
  const grid_ = h("div", { class: "eco-cond-grid" });
  for (const f of fields) {
    let c;
    if (f.type === "select") c = select({ options: f.options, value: f.default, placeholder: f.required ? undefined : (f.placeholder ?? "—") });
    else if (f.type === "daterange") {
      const a = input({ type: "date", value: f.default ? f.default[0] : "" }), b = input({ type: "date", value: f.default ? f.default[1] : "" });
      const presets = f.presets ? button({ icon: "calendar", kind: "ghost", size: "sm", title: f.presetsLabel || "", onClick: (ev) => menu(ev.currentTarget, f.presets.map(([lab, fn]) => ({ label: lab, onSelect: () => { const [x, y] = fn(); a.value = x; b.value = y; } }))) }) : null;
      c = h("div", { class: "eco-range" }, a, h("span", { class: "eco-range-sep", text: "–" }), b, presets);
      c.getValue = () => [a.value, b.value]; c.setValue = (v) => { a.value = (v || [])[0] || ""; b.value = (v || [])[1] || ""; };
      c.isEmpty = () => !a.value || !b.value;
    } else if (f.type === "toggle") {
      c = segmented({ options: f.options, value: f.default, onChange: (v) => { c.value_ = v; } });
      c.value_ = f.default; c.getValue = () => c.value_; c.setValue = (v) => { c.value_ = v; c.redraw(v); };
    }
    else c = input({ type: f.type === "number" ? "number" : f.type === "date" ? "date" : "text", value: f.default ?? "", placeholder: f.placeholder, dir: f.dir, onEnter: () => submit() });
    controls[f.key] = c;
    grid_.append(field(f.label, c, { required: f.required, span: f.span }));
  }
  const get = (f) => { const c = controls[f.key]; return c.getValue ? c.getValue() : c.value; };
  const set = (f, v) => { const c = controls[f.key]; if (c.setValue) c.setValue(v); else c.value = v ?? ""; };
  const savedKey = key ? "filters:" + key : null;
  const savedBtn = savedKey ? button({ icon: "bookmark", label: T("saved_filters"), kind: "subtle", size: "sm", onClick: (ev) => savedMenu(ev.currentTarget) }) : null;
  const toggleBtn = button({ icon: "chev-up", kind: "ghost", size: "sm", title: T("conditions"), onClick: () => setCollapsed(!panel.classList.contains("is-collapsed")) });
  const summary = h("div", { class: "eco-cond-summary" });
  const panel = h("section", { class: "eco-cond", "aria-label": title || T("conditions") },
    h("header", { class: "eco-cond-head" }, icon("filter", 14), h("strong", { text: title || T("conditions") }), summary, h("span", { class: "eco-grow" }), extra || null, savedBtn, toggleBtn),
    grid_);
  function setCollapsed(v) {
    panel.classList.toggle("is-collapsed", v);
    clear(toggleBtn, icon(v ? "chev-down" : "chev-up", 15));
    key && prefs.set("cond:" + key, v);
    drawSummary();
  }
  function values() { return Object.fromEntries(fields.map((f) => [f.key, get(f)])); }
  function missing() {
    const out = [];
    for (const f of fields) {
      const c = controls[f.key], v = get(f), emptyV = c.isEmpty ? c.isEmpty() : v === "" || v === null || v === undefined;
      c.closest(".eco-field").classList.toggle("is-invalid", !!(f.required && emptyV));
      if (f.required && emptyV) out.push(f.label);
    }
    return out;
  }
  function chips() {
    return fields.map((f) => {
      const v = get(f);
      if (v === "" || v === null || v === undefined || (Array.isArray(v) && !v[0] && !v[1])) return null;
      let shown = Array.isArray(v) ? v[0] + " → " + v[1] : v;
      if (f.options) { const opt = f.options.find((x) => String(Array.isArray(x) ? x[0] : x.value) === String(v)); if (opt) shown = Array.isArray(opt) ? opt[1] : opt.label; }
      return { key: f.key, label: f.label, value: String(shown) };
    }).filter(Boolean);
  }
  function drawSummary() {
    const collapsed_ = panel.classList.contains("is-collapsed");
    clear(summary, collapsed_ ? chips().map((c) => h("span", { class: "eco-chip" }, h("span", { class: "eco-muted", text: c.label + ": " }), h("bdi", { text: c.value }))) : null);
  }
  function submit() { onSubmit && onSubmit(); }
  function savedMenu(anchor) {
    const list = prefs.get(savedKey, []);
    menu(anchor, [
      { header: T("saved_filters") },
      ...(list.length ? list.map((sv) => ({ label: sv.name, icon: sv.default ? "star" : "bookmark", hint: sv.default ? "★" : null, onSelect: () => { api.setValues(sv.values); submit(); } })) : [{ label: T("no_saved"), disabled: true }]),
      "-",
      { label: T("save_filter"), icon: "save", onSelect: async () => {
        const name = await promptValue({ title: T("save_filter"), label: T("filter_name") });
        if (!name) return;
        prefs.set(savedKey, list.filter((x) => x.name !== name).concat([{ name, values: values() }]));
        toast({ kind: "ok", text: "“" + name + "”" });
      } },
      ...(list.length ? [{ label: T("default_filter"), icon: "star", onSelect: async () => {
        const name = await promptValue({ title: T("default_filter"), label: T("filter_name"), value: list[0].name });
        if (!name) return;
        prefs.set(savedKey, list.map((x) => ({ ...x, default: x.name === name })));
      } }] : []),
      ...list.map((sv) => ({ label: T("delete_filter", { name: sv.name }), icon: "trash", danger: true, onSelect: () => prefs.set(savedKey, list.filter((x) => x !== sv)) })),
    ], { align: "end", minWidth: 240 });
  }
  const api = {
    el: panel, values, missing, chips,
    setValues(v) { for (const f of fields) if (v && f.key in v) set(f, v[f.key]); drawSummary(); },
    reset() { for (const f of fields) set(f, f.default ?? (f.type === "daterange" ? ["", ""] : "")); panel.querySelectorAll(".is-invalid").forEach((x) => x.classList.remove("is-invalid")); drawSummary(); },
    collapse: setCollapsed, control: (k) => controls[k],
  };
  const def = savedKey ? prefs.get(savedKey, []).find((x) => x.default) : null;
  if (def) api.setValues(def.values);
  setCollapsed(collapsed ?? (key ? prefs.get("cond:" + key, false) : false));
  return api;
}

// ------------------------------------------------------------------ a screen: the one pattern learned once
/**
 * Builds the standard work screen (GMES docs/design/06 §6.2 rule 2: conditions -> Inquiry -> grid -> details):
 *   head:      breadcrumb path + title + screen code + favourite
 *   toolbar:   the screen's own actions on the start side, the standard ones (Inquiry F5, Reset, Export, Columns) on the end side
 *   conditions (optional), result bar (applied chips, row count, query time, quick filter), grid, detail panel (optional)
 */
export function screen({ code, title, path = [], toolbar = [], standard = {}, conditions, grid: g, detail, detailKey, body, shell, headExtra, note } = {}) {
  const favBtn = shell && code ? button({ icon: "star", kind: "ghost", size: "sm", title: T("favourite_add"), onClick: () => { shell.toggleFavourite(code); drawFav(); } }) : null;
  const drawFav = () => { if (!favBtn) return; const on = shell.isFavourite(code); favBtn.classList.toggle("is-fav", on); favBtn.title = on ? T("favourite_remove") : T("favourite_add"); };
  drawFav();
  const crumbs = h("nav", { class: "eco-crumbs", "aria-label": "breadcrumb" }, path.map((p) => [h("span", { text: p }), icon(isRTL() ? "chev-left" : "chev-right", 11)]), h("strong", { text: title }));
  const head = h("div", { class: "eco-screen-head" }, crumbs, h("span", { class: "eco-grow" }), headExtra || null,
    code ? h("span", { class: "eco-code", title: "Screen code" }, ltr(code)) : null, favBtn);
  const std = [];
  if (standard.inquiry) std.push(button({ label: standard.inquiryLabel || "Inquiry", icon: standard.inquiryIcon || "search", kind: "primary", kbd: "F5", onClick: standard.inquiry, cls: "eco-act-inquiry" }));
  if (standard.reset) std.push(button({ label: standard.resetLabel || T("reset"), icon: "x", kind: "default", onClick: standard.reset }));
  if (standard.export || standard.columns) std.push(sep());
  if (standard.export) std.push(button({ label: standard.exportLabel || T("export"), icon: "download", kind: "default", kbd: "Ctrl+E", onClick: standard.export, cls: "eco-act-export" }));
  if (standard.columns) std.push(button({ icon: "columns", kind: "default", title: T("columns"), onClick: standard.columns }));
  if (standard.print) std.push(button({ icon: "printer", kind: "default", title: standard.printLabel || "Print", onClick: standard.print }));
  const bar = toolbar.length || std.length ? h("div", { class: "eco-toolbar", role: "toolbar" }, h("div", { class: "eco-toolbar-start" }, toolbar), h("div", { class: "eco-toolbar-end" }, std)) : null;
  const count = h("span", { class: "eco-result-count" }), time = h("span", { class: "eco-result-time" }), applied = h("div", { class: "eco-result-applied" });
  const quick = g ? searchBox({ placeholder: T("quick_filter"), onInput: (v) => { g.setQuickFilter(v); }, width: "200px" }) : null;
  const result = g ? h("div", { class: "eco-resultbar" }, h("span", { class: "eco-muted eco-result-label", text: T("applied") + ":" }), applied, h("span", { class: "eco-grow" }), quick, count, time) : null;
  let main = body || null;
  if (g) {
    const gridWrap = h("div", { class: "eco-screen-grid" }, g.el);
    main = detail ? split(gridWrap, detail, { key: detailKey || (code ? code + ":detail" : null), initial: 380, min: 240 }) : gridWrap;
    g.el.addEventListener("eco-view", () => api.count());
  }
  const el = h("div", { class: "eco-screen", "data-code": code || "" }, head, bar, note || null, conditions ? conditions.el : null, result, h("div", { class: "eco-screen-main" }, main));
  const api = {
    el,
    /** Call after each Inquiry: shows the conditions used, the row count and when/how long it took. */
    result({ chips, ms, at = new Date() } = {}) {
      if (!g) return;
      clear(applied, (chips || []).length ? chips.map((c) => h("span", { class: "eco-chip" }, h("span", { class: "eco-muted", text: c.label + ": " }), h("bdi", { text: c.value }))) : h("span", { class: "eco-muted", text: T("none_applied") }));
      clear(time, icon("clock", 12), " ", ltr(fmtTime(at)), ms !== undefined ? h("span", { class: "eco-muted", text: " · " + T("took", { ms }) }) : null);
      api.count();
    },
    count() {
      if (!g) return;
      const n = g.count(), shown = g.shown(), sel = g.selected().length;
      clear(count, h("b", { text: shown === n ? T("rows", { n: fmtNumber(n) }) : T("of_rows", { shown: fmtNumber(shown), n: fmtNumber(n) }) }), sel > 1 ? h("span", { class: "eco-muted", text: " · " + T("selected", { n: sel }) }) : null);
    },
    showDetail(v) { const sp = el.querySelector(".eco-split"); sp && sp.showSecond(v); },
    handlers: { inquiry: standard.inquiry, export: standard.export },
  };
  if (g) { clear(applied, h("span", { class: "eco-muted", text: T("none_applied") })); api.count(); }
  el.__screen = api;
  return api;
}

// ------------------------------------------------------------------ the application shell
/**
 * opts: {
 *   product: {name, short, edition}, company: {name, code, note}, user: {name, role},
 *   menu: [{id, label, icon, children: [{code, label, icon?} | {id, label, children}]}],
 *   screens: {CODE: {title, path: [...], icon, create(ctx) -> {el, onActivate?, onClose?} }},
 *   home: CODE shown as the fixed first tab, maxTabs, searchExample,
 *   topActions: [nodes], userMenu: [menu items], onLanguage(lang), onTheme(theme), statusItems: [nodes], sampleData: text
 * }
 */
export function createShell(opts) {
  const o = { maxTabs: 12, searchExample: "", ...opts };
  const open = new Map();  // code -> {tab, view, inst}
  let active = null;
  const favKey = "favourites", recentKey = "recent";
  const navCollapsed = prefs.get("nav:collapsed", false);

  // top bar
  const navToggle = button({ icon: "menu", kind: "top", title: T("menu"), onClick: () => setNav(!app.classList.contains("nav-collapsed")) });
  const brand = h("div", { class: "eco-brand" }, h("span", { class: "eco-brand-mark", "aria-hidden": "true", text: o.product.short || o.product.name.slice(0, 2) }),
    h("span", { class: "eco-brand-name", text: o.product.name }), o.product.edition ? h("span", { class: "eco-brand-edition", text: o.product.edition }) : null);
  const company = o.company ? h("button", { type: "button", class: "eco-company", title: o.company.note || o.company.name, onclick: (ev) => o.onCompany && o.onCompany(ev.currentTarget) },
    icon("building", 14), h("span", { text: o.company.name }), o.company.code ? h("span", { class: "eco-company-code" }, ltr(o.company.code)) : null) : null;
  const searchBtn = h("button", { type: "button", class: "eco-topsearch", onclick: () => palette() },
    icon("search", 14), h("span", { text: T("search_screens") }), kbd("Ctrl K"));
  const bell = h("button", { type: "button", class: "eco-btn eco-btn-top eco-btn-icon eco-bell", title: T("notifications"), "aria-label": T("notifications"), onclick: (ev) => notesPanel(ev.currentTarget) },
    icon("bell", 16), h("span", { class: "eco-bell-count", hidden: true }));
  notifications.listen((list) => { const n = list.filter((x) => !x.read).length; const c = bell.querySelector(".eco-bell-count"); c.hidden = !n; c.textContent = String(n); });
  const userBtn = h("button", { type: "button", class: "eco-userbtn", onclick: (ev) => userMenu(ev.currentTarget) },
    avatar(o.user?.name, 26), h("span", { class: "eco-userbtn-text" }, h("span", { text: o.user?.name || "" }), o.user?.role ? h("small", { text: o.user.role }) : null), icon("chev-down", 12));
  const isDark = () => document.documentElement.dataset.theme === "dark";
  const themeBtn = button({ icon: isDark() ? "sun" : "moon", kind: "top", title: T("theme"), onClick: () => setTheme(isDark() ? "light" : "dark") });
  function setTheme(th) { o.onTheme && o.onTheme(th); clear(themeBtn, icon(isDark() ? "sun" : "moon", 15)); }
  const top = h("header", { class: "eco-top" }, navToggle, brand, company, h("div", { class: "eco-top-center" }, searchBtn), o.topActions || null,
    themeBtn,
    button({ icon: "help", kind: "top", title: T("keyboard"), onClick: () => shortcuts() }), bell, userBtn);

  // left navigation
  const navFilter = input({ placeholder: T("filter_menu"), type: "search", onInput: () => drawNav() });
  const navBody = h("div", { class: "eco-nav-body" });
  const nav = h("nav", { class: "eco-nav", "aria-label": T("menu") }, h("div", { class: "eco-nav-filter" }, icon("search", 13), navFilter), navBody,
    h("div", { class: "eco-nav-foot" }, button({ icon: isRTL() ? "chev-right" : "chev-left", kind: "ghost", size: "sm", title: T("collapse_menu"), onClick: () => setNav(true), cls: "eco-nav-collapse" })));
  let openGroups = new Set(prefs.get("nav:open", (o.menu || []).filter((g) => g.children).slice(0, 1).map((g) => g.id)));
  function leafs(nodes, path = []) { return nodes.flatMap((n) => n.children ? leafs(n.children, path.concat(n.label)) : [{ ...n, path }]); }
  function drawNav() {
    const q = navFilter.value.trim().toLowerCase();
    const favs = prefs.get(favKey, []).filter((c) => o.screens[c]);
    const parts = [];
    if (favs.length && !q) parts.push(h("div", { class: "eco-nav-group is-open" }, h("div", { class: "eco-nav-title" }, icon("star", 14), h("span", { text: T("favourites") })),
      h("div", { class: "eco-nav-items" }, favs.map((c) => navItem({ code: c, label: o.screens[c].title, icon: o.screens[c].icon }, 0)))));
    for (const g of o.menu || []) {
      const match = (n) => !q || (n.label + " " + (n.code || "")).toLowerCase().includes(q);
      const items = filterTree(g.children || [], match);
      if (q && !items.length) continue;
      const isOpen = q || openGroups.has(g.id) || groupHasActive(g);
      const titleRow = g.code
        ? navItem({ code: g.code, label: g.label, icon: g.icon }, 0, true)
        : h("button", { type: "button", class: "eco-nav-title", "aria-expanded": String(!!isOpen), title: g.label, onclick: () => {
          if (app.classList.contains("nav-collapsed")) { setNav(false); openGroups.add(g.id); }
          else { openGroups.has(g.id) ? openGroups.delete(g.id) : openGroups.add(g.id); }
          prefs.set("nav:open", [...openGroups]); drawNav();
        } }, icon(g.icon || "layers", 16), h("span", { text: g.label }), g.children ? icon(isOpen ? "chev-down" : (isRTL() ? "chev-left" : "chev-right"), 12, "eco-nav-twist") : null);
      parts.push(h("div", { class: ["eco-nav-group", isOpen && "is-open", g.children && groupHasActive(g) && "has-active"] }, titleRow,
        g.children && isOpen ? h("div", { class: "eco-nav-items" }, items.map((n) => navNode(n, 0, match))) : null));
    }
    clear(navBody, parts);
  }
  function groupHasActive(g) { return leafs(g.children || []).some((l) => l.code === active); }
  function filterTree(nodes, match) {
    return nodes.map((n) => n.children ? { ...n, children: filterTree(n.children, match) } : n).filter((n) => n.children ? n.children.length || match(n) : match(n));
  }
  function navNode(n, depth, match) {
    if (!n.children) return navItem(n, depth);
    return h("div", { class: "eco-nav-sub" }, h("div", { class: "eco-nav-subtitle", text: n.label }), n.children.map((c) => navNode(c, depth + 1, match)));
  }
  function navItem(n, depth, top_) {
    const scr = o.screens[n.code];
    return h("a", { href: "#" + n.code, class: ["eco-nav-item", top_ && "eco-nav-title", active === n.code && "is-active", !scr && "is-disabled"], title: n.label + (n.code ? " · " + n.code : ""),
      onclick: (ev) => { ev.preventDefault(); if (scr) openScreen(n.code); } },
    top_ ? icon(n.icon || "dashboard", 16) : n.icon ? icon(n.icon, 14) : null, h("span", { class: "eco-nav-label", text: n.label }),
    n.code && !top_ && !o.hideCodesInMenu ? h("span", { class: "eco-nav-code" }, ltr(n.code)) : null, n.badge ? h("span", { class: "eco-nav-badge", text: n.badge }) : null);
  }
  function setNav(collapsed) { app.classList.toggle("nav-collapsed", collapsed); prefs.set("nav:collapsed", collapsed); }

  // MDI tabs
  const tabList = h("div", { class: "eco-mdi-list", role: "tablist" });
  const tabsEnd = h("div", { class: "eco-mdi-end" }, button({ icon: "more", kind: "ghost", size: "sm", title: T("more"), onClick: (ev) => tabsMenu(ev.currentTarget) }));
  const mdi = h("div", { class: "eco-mdi" }, tabList, tabsEnd);
  const views = h("div", { class: "eco-views" });
  const status = h("footer", { class: "eco-statusbar" });
  const main = h("main", { class: "eco-main" }, mdi, views);
  const app = h("div", { class: ["eco-app", navCollapsed && "nav-collapsed"] }, top, h("div", { class: "eco-body" }, nav, main), status);

  function drawTabs() {
    clear(tabList, [...open.entries()].map(([code, t], i) => {
      const sc = o.screens[code];
      const tab = h("div", { class: ["eco-mdi-tab", code === active && "is-active"], role: "tab", "aria-selected": String(code === active), tabindex: "0", title: sc.title + " · " + code,
        onclick: () => activate(code), onauxclick: (ev) => { if (ev.button === 1 && code !== o.home) close(code); },
        oncontextmenu: (ev) => { ev.preventDefault(); tabMenu({ x: ev.clientX, y: ev.clientY }, code); },
        onkeydown: (ev) => { if (ev.key === "Enter") activate(code); } },
      sc.icon ? icon(sc.icon, 13) : null, code !== o.home ? h("span", { class: "eco-mdi-code" }, ltr(code)) : null, h("span", { class: "eco-mdi-title", text: sc.tabTitle || sc.title }),
      code !== o.home ? h("button", { type: "button", class: "eco-mdi-x", title: T("close_tab"), "aria-label": T("close_tab"), tabindex: "-1", onclick: (ev) => { ev.stopPropagation(); close(code); } }, icon("x", 12)) : null);
      if (i < 9) tab.dataset.key = String(i + 1);
      return tab;
    }));
    tabList.querySelector(".is-active")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
  function tabMenu(anchor, code) {
    menu(anchor, [code !== o.home ? { label: T("close_tab"), icon: "x", onSelect: () => close(code) } : null, { label: T("close_others"), onSelect: () => closeOthers(code) }, { label: T("close_all"), onSelect: () => closeOthers(o.home) }]);
  }
  function tabsMenu(anchor) {
    menu(anchor, [...[...open.keys()].map((c) => ({ label: c + " · " + o.screens[c].title, checked: c === active, onSelect: () => activate(c) })), "-",
      { label: T("close_all"), icon: "x", onSelect: () => closeOthers(o.home) }], { align: "end", minWidth: 260 });
  }
  function closeOthers(keep) { for (const c of [...open.keys()]) if (c !== keep && c !== o.home) close(c, true); if (keep) activate(keep); drawTabs(); }
  function openScreen(code, params) {
    const sc = o.screens[code];
    if (!sc) { toast({ kind: "warn", text: T("no_screens") + ": " + code }); return null; }
    if (!open.has(code)) {
      if (open.size >= o.maxTabs) { toast({ kind: "warn", text: T("too_many_tabs", { n: o.maxTabs }) }); return null; }
      const view = h("section", { class: "eco-view", "data-code": code, hidden: true });
      const entry = { view, inst: null };
      open.set(code, entry);
      views.append(view);
      try { entry.inst = sc.create({ shell: api, params, code }); }
      catch (e) { entry.inst = { el: empty({ icon: "x-octagon", title: String(e.message || e) }) }; }
      Promise.resolve(entry.inst).then((inst) => { entry.inst = inst; clear(view, inst.el); if (active === code) inst.onActivate && inst.onActivate(params); })
        .catch((e) => clear(view, empty({ icon: "x-octagon", title: String(e.message || e) })));
      if (code !== o.home) prefs.set(recentKey, [code].concat(prefs.get(recentKey, []).filter((c) => c !== code)).slice(0, 8));
    }
    activate(code, params);
    return open.get(code);
  }
  function activate(code, params) {
    active = code;
    for (const [c, e] of open) e.view.hidden = c !== code;
    const e = open.get(code);
    if (e && e.inst && e.inst.onActivate) e.inst.onActivate(params);
    drawTabs(); drawNav();
    if (location.hash !== "#" + code) history.replaceState(null, "", "#" + code);
    document.title = o.screens[code].title + " · " + o.product.name;
    o.onActivate && o.onActivate(code);
  }
  function close(code, quiet) {
    if (code === o.home) return;
    const e = open.get(code);
    if (!e) return;
    e.inst && e.inst.onClose && e.inst.onClose();
    e.view.remove();
    open.delete(code);
    if (active === code) { const keys = [...open.keys()]; if (keys.length) activate(keys[keys.length - 1]); else active = null; }
    if (!quiet) drawTabs();
  }

  // screen search (Ctrl+K)
  function palette() {
    const all_ = Object.entries(o.screens).filter(([, sc]) => !sc.hidden).map(([code, sc]) => ({ code, ...sc }));
    const q = input({ placeholder: T("search_hint", { example: o.searchExample }), type: "search" });
    const list = h("div", { class: "eco-palette-list", role: "listbox" });
    let items = [], idx = 0;
    const draw = () => {
      const s_ = q.value.trim().toLowerCase();
      const recent = prefs.get(recentKey, []).filter((c) => o.screens[c]);
      if (!s_) items = recent.map((c) => ({ code: c, ...o.screens[c], group: T("recent") })).concat(all_.filter((x) => !recent.includes(x.code)).map((x) => ({ ...x, group: T("all_screens") })));
      else {
        const score = (x) => x.code.toLowerCase() === s_ ? 0 : x.code.toLowerCase().startsWith(s_) ? 1 : x.title.toLowerCase().startsWith(s_) ? 2 : (x.code + " " + x.title + " " + (x.path || []).join(" ") + " " + (x.keywords || "")).toLowerCase().includes(s_) ? 3 : 9;
        items = all_.map((x) => ({ ...x, s: score(x) })).filter((x) => x.s < 9).sort((a, b) => a.s - b.s || a.code.localeCompare(b.code));
      }
      idx = Math.min(idx, Math.max(0, items.length - 1));
      let group = null;
      const nodes = [];
      items.forEach((x, i) => {
        if (x.group && x.group !== group) { group = x.group; nodes.push(h("div", { class: "eco-palette-group", text: group })); }
        nodes.push(h("div", { class: ["eco-palette-item", i === idx && "is-on"], role: "option", "aria-selected": String(i === idx), onclick: () => go(x.code), onmousemove: () => { if (idx !== i) { idx = i; draw(); } } },
          h("span", { class: "eco-palette-ic" }, icon(x.icon || "table", 15)), h("span", { class: "eco-palette-code" }, ltr(x.code)), h("span", { class: "eco-palette-title", text: x.title }),
          h("span", { class: "eco-palette-path", text: (x.path || []).join(" › ") })));
      });
      clear(list, nodes.length ? nodes : empty({ icon: "search", title: T("no_screens") }));
      list.querySelector(".is-on")?.scrollIntoView({ block: "nearest" });
    };
    const go = (code) => { d.close(); openScreen(code); };
    q.addEventListener("input", () => { idx = 0; draw(); });
    q.addEventListener("keydown", (ev) => {
      if (ev.key === "ArrowDown") { ev.preventDefault(); idx = Math.min(items.length - 1, idx + 1); draw(); }
      else if (ev.key === "ArrowUp") { ev.preventDefault(); idx = Math.max(0, idx - 1); draw(); }
      else if (ev.key === "Enter" && items[idx]) { ev.preventDefault(); go(items[idx].code); }
    });
    const d = dialog({ title: T("search_screens"), icon: "search", width: 640, body: h("div", { class: "eco-palette" }, h("div", { class: "eco-palette-input" }, icon("search", 16), q), list) });
    d.el.classList.add("eco-dialog-palette");
    draw(); q.focus();
  }
  function notesPanel(anchor) {
    const list = notifications.list();
    popover(anchor, h("div", { class: "eco-notes" }, h("header", {}, h("strong", { text: T("notifications") }), h("span", { class: "eco-grow" }),
      list.length ? button({ label: T("mark_read"), kind: "ghost", size: "sm", onClick: () => { notifications.markRead(); closeMenus(); } }) : null),
    list.length ? list.slice(0, 12).map((n) => h("div", { class: ["eco-note", !n.read && "is-unread"] }, icon({ ok: "check-circle", warn: "alert", bad: "x-octagon", info: "info" }[n.kind] || "info", 15, "eco-" + n.kind),
      h("div", {}, h("strong", { text: n.title || "" }), n.text ? h("span", { text: n.text }) : null, h("small", { class: "eco-muted", text: fmtTime(n.at) })))) : empty({ icon: "bell", title: T("no_notifications") })), { width: 340 });
  }
  function userMenu(anchor) {
    menu(anchor, [{ node: h("div", { class: "eco-usercard" }, avatar(o.user?.name, 36), h("div", {}, h("strong", { text: o.user?.name || "" }), h("span", { class: "eco-muted", text: o.user?.role || "" }), o.user?.detail ? h("small", { class: "eco-muted", text: o.user.detail }) : null)) },
      "-", { header: T("theme") },
      { label: T("light"), icon: "sun", checked: document.documentElement.dataset.theme !== "dark", onSelect: () => setTheme("light") },
      { label: T("dark"), icon: "moon", checked: document.documentElement.dataset.theme === "dark", onSelect: () => setTheme("dark") },
      { header: T("density") },
      { label: T("compact"), checked: document.documentElement.dataset.density !== "comfortable", onSelect: () => { configure({ density: "compact" }); prefs.set("density", "compact"); refreshAll(); } },
      { label: T("comfortable"), checked: document.documentElement.dataset.density === "comfortable", onSelect: () => { configure({ density: "comfortable" }); prefs.set("density", "comfortable"); refreshAll(); } },
      { header: T("language") },
      { label: "English", checked: lang() === "en", onSelect: () => o.onLanguage && o.onLanguage("en") },
      { label: "العربية", checked: lang() === "ar", onSelect: () => o.onLanguage && o.onLanguage("ar") },
      ...(o.userMenu ? ["-", ...o.userMenu] : [])], { align: "end", minWidth: 250 });
  }
  function shortcuts() {
    dialog({ title: T("keyboard"), icon: "keyboard", width: 440, body: h("table", { class: "eco-shortcuts" }, T("shortcuts").concat(o.shortcuts || []).map(([k, v]) => h("tr", {}, h("td", {}, kbd(k)), h("td", { text: v })))) });
  }
  function refreshAll() { window.dispatchEvent(new Event("eco-refresh")); }

  // keyboard: the same keys on every screen
  document.addEventListener("keydown", (ev) => {
    const inDialog = !!document.querySelector(".eco-shade");
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "k") { ev.preventDefault(); if (!inDialog) palette(); return; }
    if (inDialog) return;
    const view = active && open.get(active) && open.get(active).view;
    if (ev.key === "F5") { ev.preventDefault(); const b = view && view.querySelector(".eco-act-inquiry"); b && b.click(); return; }
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "e") { const b = view && view.querySelector(".eco-act-export"); if (b) { ev.preventDefault(); b.click(); } return; }
    if (ev.altKey && /^[1-9]$/.test(ev.key)) { const c = [...open.keys()][Number(ev.key) - 1]; if (c) { ev.preventDefault(); activate(c); } }
  });
  window.addEventListener("hashchange", () => { const c = location.hash.slice(1); if (c && c !== active && o.screens[c]) openScreen(c); });

  function setStatus(items) { clear(status, items); }
  const api = {
    el: app, open: openScreen, close, activate, active: () => active, palette, setStatus,
    isFavourite: (c) => prefs.get(favKey, []).includes(c),
    toggleFavourite(c) { const f = prefs.get(favKey, []); prefs.set(favKey, f.includes(c) ? f.filter((x) => x !== c) : f.concat([c])); drawNav(); },
    redrawNav: drawNav, screens: o.screens,
    /** Opens the home tab, then `restore` (the tabs of the last visit), then the screen named in the address. */
    start(restore = []) {
      const want = location.hash.slice(1);  // read before the home tab rewrites the address
      if (o.home) openScreen(o.home);
      for (const c of restore) if (c !== o.home && c !== want && o.screens[c]) openScreen(c);
      if (want && want !== o.home && o.screens[want]) openScreen(want);
    },
  };
  drawNav();
  setStatus(o.statusItems || []);
  return api;
}
/** A status-bar item: icon + text. */
export function statusItem(ic, text, cls) { return h("span", { class: ["eco-status-item", cls] }, ic ? icon(ic, 12) : null, typeof text === "string" ? h("span", { text }) : text); }
