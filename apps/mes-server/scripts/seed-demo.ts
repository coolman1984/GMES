/**
 * Builds a DEMONSTRATION installation: a television plant with SMD, injection, panel-module (LCM) and main-assembly lines,
 * people, items, and 14 production days of work orders, output, scrap, material and stoppages up to this minute.
 *
 *   node --import tsx scripts/seed-demo.ts <data folder>        (refuses a folder that already holds a database)
 *
 * Everything is INVENTED (names, models, figures). Nothing comes from a real plant or company. Every fact goes through the
 * server's own routes (commands, ledger, conservation, idempotency) with a controlled clock, so the demo is also a load test:
 * a rule the server enforces cannot be bypassed by the demo data.
 * The logins are written to <data folder>/DEMO-LOGINS.txt (the data folder is never committed).
 */
import { randomBytes, randomInt } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { uuidv7 } from '@eco/contracts';
import { buildApp } from '../src/app.js';
import { productionDate } from '../src/kernel/clock.js';
import { addKey } from '../src/modules/system/index.js';

const DIR = resolve(process.argv[2] ?? '');
if (!process.argv[2]) { console.error('usage: seed-demo.ts <data folder>'); process.exit(2); }
const DB = join(DIR, 'gmes.db');
if (existsSync(DB)) { console.error(`${DB} exists: the demo is built only into an empty folder`); process.exit(2); }

export const DEMO_COMPANY = '0192f7c4-0000-7000-8000-00000000d3e0';
const TZ = 'Africa/Cairo';
const DAYS = 14;

// ------------------------------------------------------------------ a deterministic "random" (the same demo every time)
let seed = 20260928;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;
const between = (a: number, b: number) => a + rnd() * (b - a);
const weighted = <T>(list: [T, number][]): T => { let x = rnd() * list.reduce((a, [, w]) => a + w, 0); for (const [v, w] of list) if ((x -= w) < 0) return v; return list[0]![0]; };

// ------------------------------------------------------------------ the clock the server runs on while seeding
let now = new Date();
const REAL_NOW = new Date();
const clock = { now: () => new Date(now), newId: () => uuidv7(now.getTime(), randomBytes(10)) };

// ------------------------------------------------------------------ the plant
type Area = { code: string; en: string; ar: string; lines: { code: string; en: string; ar: string; cap: number; shifts: string[] }[];
  stations: [string, string, string, string][]; scrap: [number, number]; reasons: [string, number][] };
const AREAS: Area[] = [
  { code: 'SMD', en: 'Surface mount (SMD)', ar: 'التركيب السطحي SMD', scrap: [0.002, 0.009], reasons: [['solder', 5], ['component', 4], ['function', 2], ['other', 1]],
    lines: [1, 2, 3, 4].map((n) => ({ code: `SMD-0${n}`, en: `SMD line ${n}`, ar: `خط SMD ${n}`, cap: 1400, shifts: ['A', 'B', 'C'] })),
    stations: [['LD', 'Magazine loader', 'محمّل المجلات', 'Loader'], ['SP', 'Solder paste printer', 'طابعة معجون اللحام', 'Stencil printer'], ['SPI', 'Solder paste inspection', 'فحص معجون اللحام', '3D SPI'],
      ['MT1', 'Chip mounter 1', 'ماكينة تركيب 1', 'High-speed mounter'], ['MT2', 'Chip mounter 2', 'ماكينة تركيب 2', 'High-speed mounter'], ['MT3', 'IC mounter', 'ماكينة تركيب الدوائر', 'Multi-function mounter'],
      ['RF', 'Reflow oven', 'فرن إعادة الصهر', '10-zone reflow oven'], ['AOI', 'Optical inspection (AOI)', 'الفحص البصري الآلي', 'AOI system'], ['ICT', 'In-circuit test', 'اختبار الدائرة', 'ICT tester'], ['UL', 'Unloader', 'مفرّغ المجلات', 'Unloader']] },
  { code: 'INJ', en: 'Injection molding', ar: 'الحقن', scrap: [0.008, 0.028], reasons: [['short_shot', 5], ['surface', 5], ['dimension', 3], ['contamination', 2], ['other', 1]],
    lines: [['INJ-01', 'Large parts (1300T)', 'قطع كبيرة (1300 طن)'], ['INJ-02', 'Medium parts (850T)', 'قطع متوسطة (850 طن)'], ['INJ-03', 'Small parts (450T)', 'قطع صغيرة (450 طن)']]
      .map(([code, en, ar]) => ({ code: code!, en: 'Injection — ' + en, ar: 'الحقن — ' + ar, cap: code === 'INJ-03' ? 1600 : 900, shifts: ['A', 'B', 'C'] })),
    stations: [['M01', 'Molding machine 1', 'ماكينة حقن 1', 'Injection press'], ['M02', 'Molding machine 2', 'ماكينة حقن 2', 'Injection press'], ['M03', 'Molding machine 3', 'ماكينة حقن 3', 'Injection press'],
      ['M04', 'Molding machine 4', 'ماكينة حقن 4', 'Injection press'], ['DRY', 'Resin dryer', 'مجفف الخامة', 'Hopper dryer'], ['QC', 'Visual check', 'فحص بصري', 'Inspection table']] },
  { code: 'LCM', en: 'Panel module (LCM)', ar: 'وحدة الشاشة LCM', scrap: [0.004, 0.018], reasons: [['panel', 5], ['cosmetic', 3], ['function', 2], ['contamination', 2], ['other', 1]],
    lines: [1, 2, 3].map((n) => ({ code: `LCM-0${n}`, en: `LCM line ${n}`, ar: `خط LCM ${n}`, cap: 700, shifts: ['A', 'B'] })),
    stations: [['CL', 'Open-cell loading', 'تحميل الخلية', 'Clean-room loader'], ['BL', 'Backlight assembly', 'تجميع الإضاءة الخلفية', 'LED bar station'], ['OF', 'Optical films', 'تركيب الأفلام الضوئية', 'Film laminator'],
      ['BD', 'Frame bonding', 'ربط الإطار', 'Bonding press'], ['LT', 'Lighting test', 'اختبار الإضاءة', 'Pattern generator'], ['AG', 'Aging', 'التعتيق الحراري', 'Aging rack']] },
  { code: 'MAIN', en: 'Main assembly', ar: 'التجميع الرئيسي', scrap: [0.001, 0.006], reasons: [['function', 4], ['cosmetic', 4], ['assembly', 3], ['panel', 2], ['other', 1]],
    lines: [1, 2, 3, 4, 5].map((n) => ({ code: `MA-0${n}`, en: `Main assembly line ${n}`, ar: `خط التجميع الرئيسي ${n}`, cap: n <= 2 ? 850 : 700, shifts: ['A', 'B'] })),
    stations: [['PL', 'Panel loading', 'تحميل الشاشة', 'Vacuum lifter'], ['MB', 'Main board mounting', 'تركيب اللوحة الرئيسية', 'Torque driver'], ['PW', 'Power board mounting', 'تركيب لوحة الطاقة', 'Torque driver'],
      ['CB', 'Cabling', 'التوصيلات', 'Cable tester'], ['BC', 'Back cover screwing', 'ربط الغطاء الخلفي', 'Auto screwing robot'], ['WB', 'White balance', 'ضبط الألوان', 'Color analyser'],
      ['FT', 'Function test', 'الاختبار الوظيفي', 'Signal generator'], ['HP', 'Hi-pot test', 'اختبار العزل', 'Hi-pot tester'], ['FI', 'Final inspection', 'الفحص النهائي', 'Inspection booth'], ['PK', 'Packing', 'التعبئة', 'Carton sealer']] },
];
const VENDORS = ['Vendor A', 'Vendor B', 'Vendor C', 'Vendor D'];

// what each area makes: [code, en, ar, uom, tracking]
const PRODUCTS: Record<string, [string, string, string, string, 'none' | 'lot' | 'serial'][]> = {
  SMD: [['PBA-MAIN-U7', 'Main board, UHD series 7', 'اللوحة الرئيسية UHD فئة 7', 'PCS', 'lot'], ['PBA-MAIN-Q8', 'Main board, QLED series 8', 'اللوحة الرئيسية QLED فئة 8', 'PCS', 'lot'],
    ['PBA-PWR-55', 'Power board 43–55"', 'لوحة الطاقة 43–55 بوصة', 'PCS', 'lot'], ['PBA-PWR-75', 'Power board 65–85"', 'لوحة الطاقة 65–85 بوصة', 'PCS', 'lot'], ['PBA-TCON-4K', 'T-CON board 4K', 'لوحة T-CON دقة 4K', 'PCS', 'lot']],
  INJ: [['BC-43', 'Back cover 43"', 'الغطاء الخلفي 43 بوصة', 'PCS', 'none'], ['BC-55', 'Back cover 55"', 'الغطاء الخلفي 55 بوصة', 'PCS', 'none'], ['BC-65', 'Back cover 65"', 'الغطاء الخلفي 65 بوصة', 'PCS', 'none'],
    ['STD-55', 'Stand 43–55"', 'القاعدة 43–55 بوصة', 'PCS', 'none'], ['BZ-55', 'Front bezel 55"', 'الإطار الأمامي 55 بوصة', 'PCS', 'none'], ['KEY-BTN', 'Control key set', 'طقم أزرار التحكم', 'PCS', 'none']],
  LCM: [['LCM-43U', 'Panel module 43" UHD', 'وحدة شاشة 43 بوصة UHD', 'PCS', 'lot'], ['LCM-55U', 'Panel module 55" UHD', 'وحدة شاشة 55 بوصة UHD', 'PCS', 'lot'],
    ['LCM-55Q', 'Panel module 55" QLED', 'وحدة شاشة 55 بوصة QLED', 'PCS', 'lot'], ['LCM-65Q', 'Panel module 65" QLED', 'وحدة شاشة 65 بوصة QLED', 'PCS', 'lot']],
  MAIN: [['TV-43U7', 'TV 43" UHD 4K Smart', 'تلفزيون 43 بوصة UHD 4K ذكي', 'PCS', 'none'], ['TV-50U7', 'TV 50" UHD 4K Smart', 'تلفزيون 50 بوصة UHD 4K ذكي', 'PCS', 'none'],
    ['TV-55U8', 'TV 55" UHD 4K Crystal', 'تلفزيون 55 بوصة UHD 4K', 'PCS', 'none'], ['TV-55Q8', 'TV 55" QLED 4K', 'تلفزيون 55 بوصة QLED 4K', 'PCS', 'none'],
    ['TV-65Q8', 'TV 65" QLED 4K', 'تلفزيون 65 بوصة QLED 4K', 'PCS', 'none'], ['TV-75Q9', 'TV 75" QLED 4K', 'تلفزيون 75 بوصة QLED 4K', 'PCS', 'none'], ['TV-32H5', 'TV 32" HD', 'تلفزيون 32 بوصة HD', 'PCS', 'none']],
};
// what each area consumes: [code, en, ar, uom, qty per piece]
const MATERIALS: Record<string, [string, string, string, string, number]> = {
  SMD: ['RM-PCB-BARE', 'Bare PCB panel', 'لوح دوائر خام', 'PCS', 1],
  INJ: ['RM-RESIN-ABS', 'ABS resin, black', 'خامة ABS سوداء', 'KG', 0.62],
  LCM: ['RM-OPEN-CELL', 'Open-cell panel', 'خلية شاشة مفتوحة', 'PCS', 1],
  MAIN: ['RM-CARTON', 'Printed carton set', 'طقم كرتون مطبوع', 'PCS', 1],
};
const SHIFT_START: Record<string, number> = { A: 7, B: 15, C: 23 };

const PEOPLE: [string, string, string, string | null][] = [
  // [login, name, role, area]
  ['plan.mahmoud', 'Mahmoud Fathy', 'PLANNER', null], ['plan.sara', 'Sara Nabil', 'PLANNER', null], ['plan.omar', 'Omar Kamal', 'PLANNER', null],
  ['sup.smd.hassan', 'Hassan Ibrahim', 'SUPERVISOR', 'SMD'], ['sup.smd.dina', 'Dina Samir', 'SUPERVISOR', 'SMD'], ['sup.inj.tarek', 'Tarek Mansour', 'SUPERVISOR', 'INJ'],
  ['sup.inj.amr', 'Amr Saleh', 'SUPERVISOR', 'INJ'], ['sup.lcm.heba', 'Heba Zaki', 'SUPERVISOR', 'LCM'], ['sup.lcm.karim', 'Karim Ragab', 'SUPERVISOR', 'LCM'],
  ['sup.ma.youssef', 'Youssef Adel', 'SUPERVISOR', 'MAIN'], ['sup.ma.mona', 'Mona Hamdy', 'SUPERVISOR', 'MAIN'],
  ['qa.nour', 'Nour Shawky', 'QUALITY', null], ['qa.reem', 'Reem Farouk', 'QUALITY', null], ['qa.salma', 'Salma Hassan', 'QUALITY', null],
  ['mnt.mostafa', 'Mostafa Nabil', 'MAINT', null], ['mnt.ahmed', 'Ahmed Samir', 'MAINT', null], ['mnt.laila', 'Laila Ibrahim', 'MAINT', null],
  ['viewer.gm', 'Plant manager', 'VIEWER', null], ['viewer.finance', 'Finance controller', 'VIEWER', null],
];
const OPERATOR_NAMES = ['Ahmed Mansour', 'Mohamed Saleh', 'Mahmoud Kamal', 'Omar Fathy', 'Youssef Ragab', 'Karim Zaki', 'Hassan Adel', 'Mostafa Hamdy', 'Tarek Samir', 'Amr Nabil',
  'Aya Ibrahim', 'Yasmin Farouk', 'Mona Shawky', 'Heba Hassan', 'Salma Kamal', 'Ali Mansour', 'Ibrahim Saleh', 'Khaled Fathy', 'Sherif Adel', 'Walid Ragab',
  'Hany Zaki', 'Essam Nabil', 'Ashraf Samir', 'Magdy Hamdy', 'Reda Ibrahim', 'Ramy Farouk', 'Sameh Kamal', 'Nader Hassan'];

// ------------------------------------------------------------------ helpers over the real routes
const app = await buildApp({
  dbFile: DB, clock,
  config: { companyId: DEMO_COMPANY, node: 'eg-tv-demo', timeZone: TZ, productionDayStart: '07:00', ownership: { item: 'gmes', warehouse: 'gmes', person: 'none' } },
});
const seedKey = await addKey(app.ctx, 'demo-seed', ['*']);
let calls = 0;
async function call<T = any>(method: 'GET' | 'POST' | 'PATCH' | 'PUT', url: string, body?: unknown, key = seedKey): Promise<T> {
  calls++;
  const r = await app.http.inject({ method, url, payload: body as object, headers: { 'x-eco-key': key } });
  if (r.statusCode >= 400) throw new Error(`${method} ${url} -> ${r.statusCode} ${r.body}`);
  return (r.body ? JSON.parse(r.body) : null) as T;
}
let cmdN = 0;
const cmd = () => `demo-${(++cmdN).toString(36)}-${randomBytes(4).toString('hex')}`;
/** A Cairo wall-clock moment (production day + hour offset) as a Date. */
function cairo(day: string, hour: number, minute = 0): Date {
  // Cairo's UTC offset on that day (DST aware), read from the wall-clock PARTS of a probe instant. (Parsing a formatted
  // string with new Date() would read it in THIS computer's zone: on a Cairo machine the offset came out 0.)
  const probe = new Date(`${day}T12:00:00Z`);
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(probe).map((x) => [x.type, x.value]));
  const wall = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute));
  const offsetMin = Math.round((wall - probe.getTime()) / 60000);
  return new Date(Date.parse(`${day}T00:00:00Z`) + (hour * 60 + minute - offsetMin) * 60000);
}
if (cairo('2026-09-28', 7).toISOString() !== '2026-09-28T04:00:00.000Z') throw new Error('cairo(): 07:00 in Cairo must be 04:00 UTC on 2026-09-28 (summer time)');
const addDays = (day: string, n: number) => { const d = new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

// ------------------------------------------------------------------ 1. people
const today = productionDate(REAL_NOW, TZ, '07:00');
now = cairo(addDays(today, -DAYS - 3), 9);
const adminPassword = 'Demo-' + randomBytes(4).toString('hex');
const peoplePassword = 'Plant-' + randomBytes(4).toString('hex');
await app.http.inject({ method: 'POST', url: '/api/setup', payload: { login: 'admin', name: 'Demo administrator', password: adminPassword, language: 'ar' } });
for (const [login, name, role, area] of PEOPLE) await call('POST', '/api/users', { login, name, role, area, language: 'ar', password: peoplePassword });
const operators: string[] = [];
OPERATOR_NAMES.forEach((name, i) => {
  const area = AREAS[i % AREAS.length]!.code;
  operators.push(`op.${area.toLowerCase()}.${name.split(' ')[0]!.toLowerCase()}`);
});
for (let i = 0; i < OPERATOR_NAMES.length; i++) await call('POST', '/api/users', { login: operators[i], name: OPERATOR_NAMES[i], role: 'OPERATOR', area: AREAS[i % AREAS.length]!.code, language: 'ar', password: peoplePassword });
await app.ctx.db.run('UPDATE sys_user SET must_change = 0');  // a demo: nobody is asked to change the shared password
console.log(`people: ${PEOPLE.length + OPERATOR_NAMES.length + 1}`);

// ------------------------------------------------------------------ 2. plant model
const plant = await call('POST', '/api/plant', { code: 'EG-TV1', type: 'plant', nameEn: 'TV plant — 10th of Ramadan (demo)', nameAr: 'مصنع الشاشات — العاشر من رمضان (عرض)' });
let nodes = 1;
for (const a of AREAS) {
  const area = await call('POST', '/api/plant', { code: a.code, type: 'area', parentId: plant.id, nameEn: a.en, nameAr: a.ar }); nodes++;
  for (const l of a.lines) {
    const line = await call('POST', '/api/plant', { code: l.code, type: 'line', parentId: area.id, nameEn: l.en, nameAr: l.ar, capacityPerShift: l.cap }); nodes++;
    for (const [sc, en, ar, eq] of a.stations) {
      const st = await call('POST', '/api/plant', { code: `${l.code}-${sc}`, type: 'station', parentId: line.id, nameEn: en, nameAr: ar }); nodes++;
      const eqs = sc.startsWith('M0') ? [eq, 'Pick-up robot'] : [eq];
      for (let i = 0; i < eqs.length; i++) {
        await call('POST', '/api/plant', { code: `EQ-${l.code}-${sc}-${i + 1}`.replace(/--/g, '-'), type: 'equipment', parentId: st.id, nameEn: eqs[i], nameAr: eqs[i],
          serial: 'SN' + randomInt(100000, 999999), vendor: pick(VENDORS), installedOn: addDays(today, -randomInt(200, 2400)) });
        nodes++;
      }
    }
  }
}
console.log(`plant model: ${nodes} nodes`);

// ------------------------------------------------------------------ 3. items and warehouses
const itemId: Record<string, string> = {};
for (const [area, list] of Object.entries(PRODUCTS)) for (const [code, en, ar, uom, tracking] of list) {
  itemId[code] = (await call('POST', '/api/items', { code, nameEn: en, nameAr: ar, kind: 'product', tracking, baseUom: uom })).id; void area;
}
for (const [code, en, ar, uom] of Object.values(MATERIALS)) itemId[code] = (await call('POST', '/api/items', { code, nameEn: en, nameAr: ar, kind: 'product', tracking: 'none', baseUom: uom })).id;
const wh: Record<string, string> = {};
for (const [code, en, ar] of [['RM', 'Raw materials store', 'مخزن الخامات'], ['WIP', 'Work-in-process store', 'مخزن الإنتاج تحت التشغيل'], ['FG', 'Finished goods store', 'مخزن المنتج التام']]) {
  wh[code!] = (await call('POST', '/api/warehouses', { code, nameEn: en, nameAr: ar })).id;
}
console.log(`items: ${Object.keys(itemId).length}, warehouses: 3`);

// ------------------------------------------------------------------ 4. fourteen production days, replayed in time order
type Ev = { at: number; run: () => Promise<void> };
const events: Ev[] = [];
const woIds = new Map<string, string>();
const openAt = REAL_NOW.getTime();
const at = (d: Date, run: () => Promise<void>) => { if (d.getTime() <= openAt) events.push({ at: d.getTime(), run }); };
const round = (n: number) => Math.max(0, Math.round(n));
let orders = 0;
let refusedStops = 0;

for (let back = DAYS - 1; back >= 0; back--) {
  const day = addDays(today, -back);
  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
  if (weekday === 5) continue;  // Friday: the plant rests
  for (const a of AREAS) for (const l of a.lines) for (const shift of l.shifts) {
    const start = cairo(day, SHIFT_START[shift]!);
    const product = pick(PRODUCTS[a.code]!);
    const planned = Math.round((l.cap * between(0.85, 1.0)) / 10) * 10;
    const code = `WO-${day.slice(2).replace(/-/g, '')}-${l.code}-${shift}`;
    const operator = pick(operators.filter((o) => o.includes('.' + a.code.toLowerCase() + '.')));
    const eff = between(0.78, 1.05);  // this shift's pace against the plan
    const ref = code;
    orders++;
    // the planner releases the order an hour before the shift
    at(new Date(start.getTime() - 3600_000), async () => {
      const r = await call('POST', '/api/work-orders', { commandId: cmd(), code, itemId: itemId[product[0]], plannedQty: String(planned), warehouseId: wh[a.code === 'MAIN' ? 'FG' : 'WIP'],
        line: l.code, shift, priority: weighted([[1, 2], [2, 6], [3, 2]]), productionDate: day });
      woIds.set(ref, r.id);
    });
    // material issued at the start of the shift
    const mat = MATERIALS[a.code]!;
    at(new Date(start.getTime() + 5 * 60_000), async () => {
      const id = woIds.get(ref); if (!id) return;
      const q = (planned * mat[4] * between(1.0, 1.04)).toFixed(mat[3] === 'KG' ? 1 : 0);
      await call('POST', `/api/work-orders/${id}/consume`, { commandId: cmd(), itemId: itemId[mat[0]], qty: q, warehouseId: wh.RM, productionDate: day, shift });
    });
    // stoppages of this shift
    const stops: { from: number; to: number }[] = [];
    const nStops = weighted([[0, 3], [1, 5], [2, 3], [3, 1]]);
    for (let s = 0; s < nStops; s++) {
      const from = start.getTime() + between(0.3, 7.2) * 3600_000;
      const reason = weighted([['material', 4], ['breakdown', 3], ['changeover', 3], ['quality', 2], ['other', 1]] as [string, number][]);
      const minutes = reason === 'changeover' ? between(15, 40) : reason === 'breakdown' ? between(8, 55) : between(4, 25);
      const to = from + minutes * 60_000;
      if (stops.some((x) => from < x.to + 10 * 60_000 && to > x.from - 10 * 60_000)) continue;
      stops.push({ from, to });
      const station = rnd() < 0.6 ? `${l.code}-${pick(a.stations)[0]}` : null;
      let stopId = '';
      at(new Date(from), async () => {
        // the server refuses a second open stoppage on the same station (a stop running over from the shift before): skip it
        try { stopId = (await call('POST', '/api/stoppages', { commandId: cmd(), line: l.code, station, reason })).id; }
        catch (e) { if (!String(e).includes('stop.already_open')) throw e; refusedStops++; }
      });
      at(new Date(to), async () => { if (stopId) await call('POST', `/api/stoppages/${stopId}/end`, { commandId: cmd() }); });
    }
    // hourly reporting: good output (batch per hour), scrap by reason
    let made = 0;
    const scrapRate = between(a.scrap[0], a.scrap[1]);
    for (let h = 0; h < 8; h++) {
      const hourStart = start.getTime() + h * 3600_000;
      const lost = stops.reduce((m, s) => m + Math.max(0, Math.min(s.to, hourStart + 3600_000) - Math.max(s.from, hourStart)), 0) / 3600_000;
      const warm = h === 0 ? 0.8 : h === 7 ? 1.1 : 1;
      let good = round((planned / 8) * eff * warm * (1 - lost) * between(0.9, 1.08));
      let scrap = round(good * scrapRate * between(0.4, 1.8));
      const room = planned - made;
      if (h === 7 && eff > 0.95) good = Math.max(good, room - scrap);  // a good shift finishes its order
      scrap = Math.min(scrap, Math.max(0, room));
      good = Math.min(good, Math.max(0, room - scrap));
      made += good + scrap;
      const lot = `L${day.slice(2).replace(/-/g, '')}${l.code.replace('-', '')}${shift}${String(h + 1).padStart(2, '0')}`;
      const reportAt = new Date(hourStart + 3600_000 - between(2, 9) * 60_000);
      if (good > 0) at(reportAt, async () => {
        const id = woIds.get(ref); if (!id) return;
        await call('POST', `/api/work-orders/${id}/complete`, { commandId: cmd(), qty: String(good), productionDate: day, shift, station: `${l.code}-${a.stations[a.stations.length - 1]![0]}`,
          ...(product[4] !== 'none' ? { lotNo: lot } : {}) });
      });
      if (scrap > 0) at(new Date(reportAt.getTime() + 60_000), async () => {
        const id = woIds.get(ref); if (!id) return;
        await call('POST', `/api/work-orders/${id}/scrap`, { commandId: cmd(), qty: String(scrap), reasonCode: weighted(a.reasons), productionDate: day, shift });
      });
    }
    // orders of past days are closed by the supervisor the next morning
    if (back >= 2) at(cairo(addDays(day, 1), 8, randomInt(0, 50)), async () => {
      const id = woIds.get(ref); if (!id) return;
      await call('POST', `/api/work-orders/${id}/close`, { commandId: cmd() });
    });
    void operator;
  }
}
events.sort((x, y) => x.at - y.at);
console.log(`work orders: ${orders}; replaying ${events.length} facts in time order…`);
let done = 0;
for (const e of events) {
  now = new Date(e.at);
  await e.run();
  if (++done % 2000 === 0) console.log(`  ${done} / ${events.length}`);
}

// ------------------------------------------------------------------ 5. the show: two lines stopped right now
now = new Date(REAL_NOW.getTime() - 11 * 60_000);
const open = await call<any[]>('GET', '/api/stoppages?open=1');
if (!open.some((s) => s.line === 'INJ-02')) await call('POST', '/api/stoppages', { commandId: cmd(), line: 'INJ-02', station: 'INJ-02-M03', reason: 'changeover' });
now = new Date(REAL_NOW.getTime() - 4 * 60_000);
if (!open.some((s) => s.line === 'MA-04')) await call('POST', '/api/stoppages', { commandId: cmd(), line: 'MA-04', station: null, reason: 'material' });

const health = await call('GET', '/api/system/health');
const ok = Object.values(health as Record<string, { ok: boolean }[]>).flat().every((c) => c.ok);
await app.ctx.db.run(`UPDATE sys_key SET active = 0 WHERE name = 'demo-seed'`);
await app.close();

writeFileSync(join(DIR, 'DEMO-LOGINS.txt'), [
  'GMES demonstration plant — logins (invented people; this file stays in the data folder, never in git)',
  '',
  `Administrator:  admin / ${adminPassword}`,
  `Everyone else:  <login> / ${peoplePassword}`,
  '',
  ...PEOPLE.map(([l, n, r, a]) => `  ${l.padEnd(20)} ${r.padEnd(11)} ${(a ?? '').padEnd(5)} ${n}`),
  ...operators.map((l, i) => `  ${l.padEnd(20)} OPERATOR    ${AREAS[i % AREAS.length]!.code.padEnd(5)} ${OPERATOR_NAMES[i]}`),
  '',
].join('\r\n'));
console.log(`done: ${calls} requests (${refusedStops} overlapping stops refused by the server, as they should be), health ${ok ? 'OK' : 'NOT OK'}; logins in ${join(DIR, 'DEMO-LOGINS.txt')}`);
process.exit(ok ? 0 : 1);
