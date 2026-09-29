# E3) العقود المشتركة (Eco Contracts)

المصدر الوحيد للعقود: الحزمة `packages/eco-contracts` (مخططات zod) → تُولَّد منها ملفات
**JSON Schema** في `packages/eco-contracts/schemas/` لأي لغة (Python في BAMS مثلًا). اختبار يفشل
لو الملفات المولّدة قديمة.

## E3.1 قواعد عامة

| القاعدة | التفصيل |
|---|---|
| **الإصدار** | كل عقد اسمه يحمل إصداره: `eco.item.v1`. تغيير **متوافق** (حقل اختياري جديد) = نفس الإصدار. تغيير **كاسر** (حذف/تغيير معنى/جعل حقل إلزاميًا) = `v2` جديد، والمنتج يرسل الاثنين طوال فترة انتقال معلنة |
| **المستهلك متسامح** | يتجاهل الحقول التي لا يعرفها؛ يرفض (Park) فقط ما لا يستطيع تطبيقه **بدقة** |
| **الكميات** | نص عشري دقيق + كود الوحدة: `{"value": "12.5", "uom": "KG"}`. لا أرقام عائمة على السلك. كل تطبيق يحوّل لمقياسه الداخلي و**يرفض** أي قيمة لا يمثّلها بلا تقريب (ميزان والتصنيع: ×1000) |
| **المبالغ** | نص عشري + عملة ISO: `{"value": "1520.75", "currency": "EGP"}` |
| **الأوقات** | `time` = UTC بصيغة RFC 3339. **التاريخ التشغيلي** منفصل: `production_date` (YYYY-MM-DD) + `shift` |
| **المعرفات** | `id` عالمي UUID (انظر E4) + `code` بشري + `origin` {app, type, key} يدل على المفتاح المحلي عند المالك |
| **الحذف** | لا حذف على السلك: `active: false`. التاريخ يحتاج الكيان حتى بعد إيقافه |
| **اللغة** | الأسماء ثنائية دائمًا `name: {en, ar}` (ميزان يحمل الاثنين بالفعل) |

## E3.2 الظرف الموحد (متوافق مع CloudEvents 1.0 — بدون أي مكتبة)

```json
{
  "specversion": "1.0",
  "id": "0192f7c4-8a3e-7b21-9c55-3d1f2a4b6c7d",      // UUIDv7 — مفتاح منع التكرار
  "source": "eco://<company-id>/gmes/<node>",          // من أصدر الحدث
  "type": "mes.production.completed.v1",               // اسم العقد وإصداره
  "subject": "work_order/<uuid>",                      // الكيان المعني
  "time": "2026-09-27T10:42:05.120Z",
  "datacontenttype": "application/json",
  "ecoseq": 1841,                                      // ترتيب الحدث في Feed المنتج (بلا فجوات)
  "ecocorrelation": "work_order/<uuid>",               // سلسلة مرتبطة: الأحداث بنفس القيمة تُطبق بالترتيب
  "ecocausation": "<command-id>",                      // الأمر الذي ولّد الحدث
  "data": { … }                                        // جسم العقد
}
```

**ضمان التسليم:** على الأقل مرة (at-least-once) من الـFeed + منع تكرار عند المستهلك بـ`(source, id)` =
**مرة واحدة فعليًا**. **الترتيب:** مضمون داخل نفس `ecocorrelation`؛ حدث محجوز (Parked) يوقف ما بعده
**في نفس السلسلة فقط** (أمر إنتاج واحد لا يعطل المصنع كله).

## E3.3 عقود البيانات الأساسية (لقطة كاملة + إصدار متزايد من المالك)

المستهلك يطبق اللقطة فقط لو `version` أكبر مما عنده → إعادة الإرسال والترتيب العكسي آمنان.

| العقد | الحقول | المالك | الحالة |
|---|---|---|---|
| `eco.company.v1` | id, code, name{en,ar}, base_currency, money_scale, fiscal_year_start, version | المحاسبة | مسودة |
| `eco.site.v1` | id, code, name, timezone, production_day_start, version, active | التصنيع | مسودة |
| **`eco.employee.v1`** | id (UUIDv5 من رقم الموظف), code, display_name?, employment_status, active, hire/termination_date?, department/position/plant_code?, version, origin — **بلا بيانات شخصية** | **HR-System** | **مُنفَّذ** (يحل محل مسودة `eco.person.v1` التي لم تُنفَّذ أبدًا) |
| **`eco.attendance_day.v1`** | id, code (Attendance_ID), employee ref, work_date, status, scheduled_shift_code?, roster?, leave?, worked_minutes?, version, origin | **HR-System** | **مُنفَّذ** |
| **`eco.schedule_day.v1`** | id (hr:schedule:<emp>:<date>), employee ref, work_date, status (work/rest/holiday/unscheduled), shift_code?, start?, end? (وقت محلي؛ الليلية يوم عمل واحد)، paid_minutes، source?, version, origin | **HR-System** | **مُنفَّذ** |
| **`eco.qualification.v1`** | id (hr:qualification:<emp>-<skill>), employee ref, skill_code, skill_name?, level 1–4, certified_on, expires_on?, active, version, origin | **HR-System** | **مُنفَّذ** |
| `eco.shift.v1` | id, code, start, end, break_minutes, crosses_midnight, version (من `SCH_01_ShiftDefinitions`) | HR-System | مسودة (تحل محل `eco.shift_pattern.v1`) |
| `eco.skill.v1` / `eco.employee_skill.v1` | كتالوج المهارات ومستوى كل موظف وصلاحيته (`SKL_*`) | HR-System | مسودة |
| `hr.payroll_period.v1` | period, إجماليات لكل مركز تكلفة وحساب (رواتب، مساهمات، استقطاعات، صافي مستحق) — **بلا تفاصيل موظف** | HR-System → ميزان | مسودة |
| **`eco.item.v1`** | id, code (SKU), name{en,ar}, kind (product/service), stock_tracked, tracking (none/lot/serial), base_uom, units[{code, factor}], active, version, origin | المحاسبة | **مُنفَّذ** |
| **`eco.warehouse.v1`** | id, code, name{en,ar}, active, is_default, version, origin | المحاسبة | **مُنفَّذ** |
| `eco.storage_location.v1` | id, warehouse_id, address (bay/level/position), layout_ref, version | الثري دي | مسودة |
| `eco.line.v1` / `eco.station.v1` / `eco.equipment.v1` | id, code, name, parent_id, kind, active, version, spatial_ref? {layout_id, item_id} | التصنيع | مسودة |
| `eco.material_lot.v1` | id, item_id, lot_no, expiry?, supplier_lot?, version | المحاسبة | مسودة |
| `eco.party.v1` | id, code, name, kind (customer/supplier), active, version | المحاسبة | مسودة |
| `eco.layout.snapshot.v1` | layout_id, revision, site_id?, items[{item_id, name, category, position, rotation, size, eco_ref?}] | الثري دي | مسودة |

## E3.4 عقود الأحداث التشغيلية (حقائق، إضافة فقط)

| العقد | الجسم (مختصر) | المنتج | المستهلك | الحالة |
|---|---|---|---|---|
| `mes.work_order.released.v1` | work_order{id, code, item_id, planned_qty, line_id}, production_date | التصنيع | المحاسبة (اختياري) | مسودة |
| **`mes.material.consumed.v1`** | work_order{id, code, item_id, planned_qty}, item{id, code}, qty, warehouse{id, code}, lot_no?, station?, performed_by{user, person?}, production_date, shift?, ledger_seq | التصنيع | المحاسبة → صرف للإنتاج بمتوسط التكلفة (مدين WIP / دائن المخزون) | **مُنفَّذ** |
| **`mes.production.completed.v1`** | work_order{…, completed_qty_after, is_final}, item, qty, warehouse, lot_no?, station?, performed_by, production_date, shift?, ledger_seq | التصنيع | المحاسبة → استلام منتج تام بتكلفة WIP الفعلية (مدين المخزون / دائن WIP) | **مُنفَّذ** |
| `mes.production.scrapped.v1` | work_order, qty, reason_code, op_seq, station? | التصنيع | المحاسبة (لاحقًا: تحميل الفاقد) | مُسجَّل في التصنيع، **غير مُرحّل** في v1 (الفاقد الطبيعي يُحمّل على الوحدات الجيدة — ADR-019) |
| **`mes.work_order.closed.v1`** | work_order{…, completed_qty, scrapped_qty}, station?, performed_by, production_date, ledger_seq | التصنيع | المحاسبة → ما تبقى في WIP للأمر (فاقد متأخر، فروق تقريب) يُرحّل لحساب انحرافات الإنتاج بقيد يومية | **مُنفَّذ** |
| **`mes.shipment.dispatched.v1`** | shipment{id, code, customer, destination?}, container{id, number (ISO 6346), seal, type}, lines[{item, qty, uom, warehouse, pallets, serials?}], dispatched_at, production_date, performed_by, shipping_seq | التصنيع (SHP2030 عند ختم الحاوية) | المحاسبة → تخفيض مخزون المنتج التام وتسليم للعميل (القرار والقيمة والفاتورة للمحاسبة). `link-mizan` اليوم **يتجاهله** (`eco.not_consumed`) حتى يُقترح التطبيق في ميزان | **مُنتَج** (2026-09-28، ADR-036)؛ المستهلك مُخطط |
| `mes.quality.hold.v1` / `.released.v1` | target (unit/lot/wo), reason, disposition | التصنيع | المحاسبة (حجز رصيد)، الثري دي (لون) | مسودة |
| `mes.equipment.state.v1` | equipment_id, state (run/idle/down/setup/planned), since, reason? | التصنيع | الثري دي (عرض حي) | مسودة |
| `acc.production.costed.v1` | work_order_id, value_consumed, value_relieved, unit_cost | المحاسبة | التصنيع (عرض) | مسودة |

## E3.5 عقد الإقرار (Ack)

```json
{ "event_id": "…", "source": "eco://…", "consumer": "link-mizan",
  "status": "applied" | "parked" | "skipped_duplicate",
  "detail": { "code": "stock.insufficient", "message": "…", "target_ref": "ADJ-00012" } }
```
المنتج يعرض لكل حدث: مَن طبّقه، ومتى، وأين (رقم المستند في النظام الآخر)، أو لماذا هو محجوز.
