// SAMPLE DATA for the visual shell (UX phase). Invented, deterministic (seeded), and labelled as sample on every
// screen that shows it. Nothing here comes from a real plant, from Samsung G-MES, or from any customer.
// Screens read through `source`, so wiring a screen to the real server later replaces this file, not the screen.
"use strict";

function rng(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const R = rng(20260928);
const pick = (xs) => xs[Math.floor(R() * xs.length)];
const int = (a, b) => a + Math.floor(R() * (b - a + 1));
const pad = (n, w = 2) => String(n).padStart(w, "0");
const day = (offset) => { const d = new Date(2026, 8, 28); d.setDate(d.getDate() + offset); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); };
export const TODAY = day(0);

// ------------------------------------------------------------------ factory structure
const AREAS = [
  { code: "INJ", en: "Injection Molding", ar: "الحقن", lines: 4, stations: [["M", "Molding machine", "ماكينة حقن"]], equip: ["Press 450T", "Press 350T", "Robot picker", "Dryer", "Chiller"] },
  { code: "ASM", en: "Assembly", ar: "التجميع", lines: 3, stations: [["ST10", "Sub-assembly", "تجميع فرعي"], ["ST20", "Screwing", "ربط"], ["ST30", "Leak test", "اختبار تسريب"], ["ST40", "Final inspection", "فحص نهائي"]], equip: ["Torque tool", "Leak tester", "Fixture", "Vision camera"] },
  { code: "PKG", en: "Packing", ar: "التعبئة", lines: 2, stations: [["PK10", "Labeling", "لصق الملصقات"], ["PK20", "Cartoning", "التعبئة في كراتين"], ["PK30", "Palletizing", "التحميل على البالتات"]], equip: ["Label printer", "Carton sealer", "Scale"] },
];
const STATES = ["run", "run", "run", "run", "idle", "setup", "down"];
export const factory = (() => {
  const plant = { id: "P1", code: "P1", type: "plant", en: "Plant 1 — 10th of Ramadan", ar: "المصنع 1 — العاشر من رمضان", status: "active", children: [] };
  for (const a of AREAS) {
    const area = { id: plant.id + "/" + a.code, code: a.code, type: "area", en: a.en, ar: a.ar, status: "active", children: [] };
    for (let l = 1; l <= a.lines; l++) {
      const lc = a.code + "-" + pad(l);
      const line = { id: area.id + "/" + lc, code: lc, type: "line", en: a.en + " line " + l, ar: "خط " + a.ar + " " + l, status: "active", state: pick(STATES), shift: "A",
        capacity: a.code === "INJ" ? int(900, 1400) : int(600, 900), children: [] };
      const stations = a.code === "INJ" ? [["M" + pad(l * 2 - 1), "Molding machine", "ماكينة حقن"], ["M" + pad(l * 2), "Molding machine", "ماكينة حقن"]] : a.stations;
      for (const [sc, en, ar] of stations) {
        const st = { id: line.id + "/" + sc, code: lc + "-" + sc, type: "station", en: en + " " + sc, ar: ar + " " + sc, status: R() < 0.06 ? "inactive" : "active", state: pick(STATES), children: [] };
        const n = int(1, 2);
        for (let e = 1; e <= n; e++) {
          const eq = pick(a.equip);
          st.children.push({ id: st.id + "/E" + e, code: "EQ-" + lc.replace("-", "") + sc + "-" + e, type: "equipment", en: eq, ar: eq, status: "active", state: pick(STATES),
            serial: "SN" + int(100000, 999999), vendor: pick(["Vendor A", "Vendor B", "Vendor C"]), installed: day(-int(120, 1800)) });
        }
        line.children.push(st);
      }
      area.children.push(line);
    }
    plant.children.push(area);
  }
  return [plant];
})();
export function lines() {
  const out = [];
  const walk = (n) => { if (n.type === "line") out.push(n); (n.children || []).forEach(walk); };
  factory.forEach(walk);
  return out;
}

// ------------------------------------------------------------------ items and work orders
export const items = [
  ["FG-10400", "Storage box 40 L", "INJ"], ["FG-10200", "Bucket 20 L", "INJ"], ["FG-10640", "Crate 600×400", "INJ"], ["FG-10120", "Lid 12 L", "INJ"],
  ["FG-20310", "Washer tub assembly", "ASM"], ["FG-20160", "Fan blade 16 in", "INJ"], ["FG-20455", "Front housing assembly", "ASM"], ["FG-20720", "Control panel assembly", "ASM"],
  ["FG-30100", "Box 40 L, carton of 6", "PKG"], ["FG-30220", "Crate, pallet of 48", "PKG"],
].map(([code, name, area]) => ({ code, name, area }));

const WO_STATUS = [["planned", 14], ["released", 12], ["run", 22], ["hold", 3], ["done", 30], ["closed", 19]];
function weighted(list) { const total = list.reduce((a, [, w]) => a + w, 0); let x = R() * total; for (const [v, w] of list) { if ((x -= w) < 0) return v; } return list[0][0]; }
export const workOrders = (() => {
  const all = lines(), out = [];
  for (let i = 1; i <= 486; i++) {
    const item = pick(items), line = pick(all.filter((l) => l.code.startsWith(item.area))), offset = -int(0, 13);
    let status = weighted(WO_STATUS);
    if (offset < -3 && (status === "planned" || status === "released")) status = "done";
    if (offset > -1 && status === "closed") status = "run";
    const planned = pick([200, 240, 300, 360, 400, 480, 500, 600, 720, 800, 960, 1200]);
    const ratio = status === "planned" || status === "released" ? 0 : status === "done" || status === "closed" ? 1 : R() * 0.9 + 0.05;
    const scrap = ratio ? Math.round(planned * ratio * (R() * 0.035)) : 0, rework = ratio ? Math.round(planned * ratio * (R() * 0.02)) : 0;
    const good = Math.min(planned - scrap, Math.round(planned * ratio) - scrap);
    const shift = pick(["A", "B", "C"]);
    const startH = { A: 7, B: 15, C: 23 }[shift] + int(0, 3);
    out.push({
      id: "wo" + i, code: "WO-" + day(offset).slice(2, 4) + day(offset).slice(5, 7) + "-" + pad(i, 4), item: item.code, itemName: item.name, area: item.area, line: line.code, lineId: line.id,
      shift, day: day(offset), status, planned, good: Math.max(0, good), scrap, rework, remaining: Math.max(0, planned - Math.max(0, good) - scrap),
      progress: planned ? Math.round((Math.max(0, good) / planned) * 1000) / 10 : 0, priority: pick([1, 2, 2, 3, 3, 3]),
      start: status === "planned" ? "" : day(offset) + " " + pad(startH % 24) + ":" + pad(int(0, 59)), end: status === "done" || status === "closed" ? day(offset) + " " + pad((startH + int(3, 7)) % 24) + ":" + pad(int(0, 59)) : "",
      routing: item.area === "ASM" ? "R-ASM-4" : item.area === "PKG" ? "R-PKG-3" : "R-INJ-1", unit: "pcs", planner: pick(["m.adel", "s.hassan", "a.farouk"]),
    });
  }
  return out.sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : a.code.localeCompare(b.code)));
})();
export function woHistory(wo) {
  const ev = [["created", "m.adel"]];
  if (wo.status !== "planned") ev.push(["released", "supervisor.l2"]);
  if (["run", "hold", "done", "closed"].includes(wo.status)) ev.push(["started", "op.ahmed"], ["completed_qty", "op.ahmed"]);
  if (wo.scrap) ev.push(["scrapped", "op.ahmed"]);
  if (wo.status === "hold") ev.push(["held", "q.nour"]);
  if (["done", "closed"].includes(wo.status)) ev.push(["completed", "op.ahmed"]);
  if (wo.status === "closed") ev.push(["closed", "supervisor.l2"]);
  return ev.map(([kind, by], i) => ({ kind, by, at: (wo.start || wo.day + " 06:30").slice(0, 11) + pad(7 + i * 2) + ":" + pad((i * 17) % 60) }));
}
export function woOperations(wo) {
  const steps = { "R-INJ-1": ["Molding", "Trim & inspect"], "R-ASM-4": ["Sub-assembly", "Screwing", "Leak test", "Final inspection"], "R-PKG-3": ["Labeling", "Cartoning", "Palletizing"] }[wo.routing];
  return steps.map((s, i) => {
    const done = wo.status === "planned" || wo.status === "released" ? 0 : Math.min(wo.planned, Math.round((wo.good + wo.scrap) * (1 + (steps.length - i - 1) * 0.04)));
    return { id: wo.id + "-" + i, seq: (i + 1) * 10, name: s, station: wo.line + "-" + (i + 1) * 10, good: Math.min(done, wo.planned) - (i === 0 ? wo.scrap : 0), scrap: i === 0 ? wo.scrap : 0,
      state: done >= wo.planned ? "done" : done > 0 ? "run" : "planned" };
  });
}

// ------------------------------------------------------------------ users and roles
export const roles = [
  ["ADMIN", "Administrator"], ["PLANNER", "Planner"], ["SUPERVISOR", "Line supervisor"], ["OPERATOR", "Operator"], ["QUALITY", "Quality"], ["MAINT", "Maintenance"], ["VIEWER", "Viewer"],
];
const FIRST = ["Ahmed", "Mohamed", "Mahmoud", "Omar", "Youssef", "Karim", "Hassan", "Mostafa", "Tarek", "Amr", "Sara", "Nour", "Mona", "Aya", "Heba", "Reem", "Dina", "Salma", "Laila", "Yasmin"];
const LAST = ["Adel", "Hassan", "Farouk", "Mansour", "Saleh", "Ibrahim", "Fathy", "Nabil", "Kamal", "Samir", "Zaki", "Ragab", "Shawky", "Hamdy"];
export const users = (() => {
  const out = [], seen = new Set();
  for (let i = 1; i <= 64; i++) {
    const first = pick(FIRST), last = pick(LAST);
    const role = i === 1 ? "ADMIN" : weighted([["OPERATOR", 30], ["SUPERVISOR", 8], ["QUALITY", 6], ["MAINT", 6], ["PLANNER", 4], ["VIEWER", 6], ["ADMIN", 1]]);
    const status = weighted([["active", 52], ["locked", 3], ["inactive", 5]]);
    let login = (first[0] + "." + last).toLowerCase();
    if (seen.has(login)) login += i;
    seen.add(login);
    out.push({ id: "u" + i, login, name: first + " " + last, role, badge: "B" + pad(10000 + i * 37, 5),
      area: role === "OPERATOR" || role === "SUPERVISOR" ? pick(["INJ", "ASM", "PKG"]) : "—", status, language: pick(["ar", "ar", "en"]),
      lastSignIn: status === "inactive" ? day(-int(40, 200)) + " " + pad(int(6, 22)) + ":" + pad(int(0, 59)) : day(-int(0, 6)) + " " + pad(int(6, 22)) + ":" + pad(int(0, 59)),
      created: day(-int(60, 900)), mfa: role === "ADMIN" || R() < 0.3, source: role === "OPERATOR" || role === "SUPERVISOR" ? "hr" : "local" });
  }
  return out;
})();

// ------------------------------------------------------------------ the line board and the station
export function hourly(lineCode) {
  const r = rng(lineCode.split("").reduce((a, c) => a + c.charCodeAt(0), 0));
  const hours = ["07", "08", "09", "10", "11", "12", "13", "14"];
  const plan = hours.map(() => 120);
  const actual = hours.map((_, i) => (i < 6 ? Math.round(95 + r() * 32) - (i === 3 ? 48 : 0) : i === 6 ? Math.round(40 + r() * 20) : 0));
  return { hours, plan, actual };
}
export const stoppages = [
  { at: "13:42", minutes: 7, reason: "material", station: "ASM-02-ST20", open: true },
  { at: "11:05", minutes: 18, reason: "changeover", station: "ASM-02-ST10", open: false },
  { at: "09:48", minutes: 4, reason: "quality", station: "ASM-02-ST30", open: false },
  { at: "08:12", minutes: 11, reason: "breakdown", station: "ASM-02-ST20", open: false },
];

/** The screens call these, as they will call the server later. */
export const source = {
  sample: true,
  async workOrders(q) {
    await new Promise((r) => setTimeout(r, 160 + Math.random() * 180));
    return workOrders.filter((w) => (!q.area || w.area === q.area) && (!q.line || w.line === q.line) && (!q.status || w.status === q.status) &&
      (!q.shift || q.shift === "all" || w.shift === q.shift) && (!q.from || w.day >= q.from) && (!q.to || w.day <= q.to) &&
      (!q.item || (w.item + " " + w.itemName).toLowerCase().includes(q.item.toLowerCase())) && (!q.wo || w.code.toLowerCase().includes(q.wo.toLowerCase())));
  },
  async users(q) {
    await new Promise((r) => setTimeout(r, 120));
    return users.filter((u) => (!q.text || (u.login + " " + u.name + " " + u.badge).toLowerCase().includes(q.text.toLowerCase())) && (!q.role || u.role === q.role) && (!q.status || u.status === q.status) && (!q.area || u.area === q.area));
  },
};
