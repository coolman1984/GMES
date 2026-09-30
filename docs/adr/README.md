# سجل القرارات المعمارية (ADR)

كل قرار له: **السياق → القرار → البدائل المرفوضة → العواقب**. القرار ميتعدلش بصمت؛
تغييره = ADR جديد بيقول "يلغي ADR-00X".

| # | القرار | الحالة |
|---|---|---|
| [001](#adr-001) | Python + FastAPI + SQLAlchemy Core كأساس | **ملغى** بـADR-014 |
| [002](#adr-002) | SQLite (WAL) افتراضي + PostgreSQL مدعوم من اليوم الأول، والاختبار على الاتنين | مقترح — S1/S2 |
| [003](#adr-003) | نموذج الكاتب الواحد لكل أوامر الكتابة | مقترح — S1/S4 |
| [004](#adr-004) | دفتر حركات append-only بسلسلة Hash ومرساة يومية خارجية | مقترح |
| [005](#adr-005) | Modular Monolith بعقد وحدات صارم بدل Microservices | مقبول؛ الشكل التنفيذي عدّله ADR-020 |
| [006](#adr-006) | الكميات أعداد صحيحة بمضاعف 10⁶، ولا float | **ملغى جزئيًا** بـADR-018 (المقياس ×1000؛ مبدأ "لا float" باقٍ) |
| [007](#adr-007) | UUIDv7 للمفاتيح + كود بشري منفصل | مقترح |
| [008](#adr-008) | React + TypeScript + AG Grid Community + ECharts، كلها مضمنة بدون CDN | مقترح — S5 |
| [009](#adr-009) | SSE للتحديث اللحظي بدل WebSocket | مقترح |
| [010](#adr-010) | الماكينات عبر Edge Gateway منفصل يستخدم نفس الـAPI، لا كتابة مباشرة في القاعدة | مقترح |
| [011](#adr-011) | ترخيص بملف موقّع Ed25519 يتحقق offline | مقترح |
| [012](#adr-012) | يوم الإنتاج والوردية يتحسبوا ويتخزنوا في كل حركة | مقترح |
| [013](#adr-013) | منع مكتبات GPL/AGPL في المنتج، فحص آلي | مقترح |
| [014](#adr-014) | TypeScript على Node 22 (نفس ميزان والثري دي) بدل Python | **مقبول** — مُنفَّذ |
| [015](#adr-015) | لا مزامنة متعددة الكتّاب لحركات الإنتاج؛ سيرفر مصنع مرجعي واحد | **مقبول** — مُختبر |
| [016](#adr-016) | التكامل: Feed بمؤشر عند المالك + Inbox يمنع التكرار + Acks + ظرف متوافق مع CloudEvents | **مقبول** — مُنفَّذ ومُختبر |
| [017](#adr-017) | الهوية: UUID عالمي من المالك؛ UUIDv5 حتمي للمالك ذي المفاتيح الرقمية | **مقبول** — مُنفَّذ |
| [018](#adr-018) | الكميات ×1000 داخليًا ونص عشري على السلك، ورفض أي تقريب | **مقبول** — مُنفَّذ |
| [019](#adr-019) | تكلفة الإنتاج v1 عبر تسويات ميزان وحساب WIP (أصل متداول) | **مقبول مؤقتًا** — مُختبر |
| [020](#adr-020) | عقد الموديول بشكل `AppModule` في ميزان | **مقبول** — مُنفَّذ |
| [021](#adr-021) | HR-System (مستودع وتطبيق مستقل، Python) مالك القوى العاملة؛ التصنيع مرآة للقراءة ولا يملك أشخاصًا | **مقبول** — مُنفَّذ ومُختبر مع HR الحقيقي |
| [022](#adr-022) | الرواتب: HR يحسب، ميزان يقيد — لا حقيقتين | **مقبول** (العقد مسودة) |
| [023](#adr-023) | عقود القوى العاملة: `eco.employee.v1` بلا بيانات شخصية + `eco.attendance_day.v1`، هوية UUIDv5 من رقم الموظف | **مقبول** — مُنفَّذ |
| [024](#adr-024) | أساس بنية مشترك = مواصفات + متجهات اختبار + تطبيقان مرجعيان (Python/TS)، لا خدمة مركزية ولا نسخ كود BAMS | **مقبول** |
| [025](#adr-025) | مشكلتان وحلّان: نسخ داخل التطبيق (نمط BAMS) وتسليم بين التطبيقات (eco) — لا حل ثالث | **مقبول** |
| [026](#adr-026) | صيغة سجل موحدة: canonical JSON v1 + `SHA-256(domain⏎canonical)` + `prev` + توقيع جهاز Ed25519 | **مقبول** — المتجهات مُنفَّذة ومختبرة في اللغتين؛ HR أول مستخدم |
| [027](#adr-027) | حقائق الإنتاج لا تُدمج متعددة الكتّاب؛ الأوفلاين الآمن الوحيد = Escrow بحصص مسبقة (مؤجل) | **مقبول** — برهان قابل للتشغيل |
| [028](#adr-028) | النسخ الاحتياطي بنموذج BAMS + اختبار استعادة آلي دوري (جديد للجميع) | **مقبول** — التنفيذ في F2/F3 |

---

### ADR-001
> **ملغى 2026-09-27 بـADR-014.** محفوظ كسجل.

**السياق:** نظام تجاري لعشرات المصانع، فريق صغير، تكامل صناعي مستقبلي.
**القرار:** Python 3.12+، FastAPI، Pydantic v2، SQLAlchemy 2 Core، Alembic.
**مرفوض:** Node/NestJS (مكتبات صناعية أضعف)، .NET (توزيع/تكلفة)، Go (سرعة بناء المنطق)، Laravel (جانب الماكينات)، Low-code (تبعية مورد).
**العواقب:** أداء Python كفاية لأن عنق الزجاجة هو القاعدة؛ الحسابات التقيلة (تقارير) خارج مسار الكتابة.

### ADR-002
**السياق:** تثبيت سهل للمصنع الصغير مقابل تزامن حقيقي للمتوسط.
**القرار:** SQLite WAL افتراضي (`synchronous=NORMAL`, `foreign_keys=ON`, `busy_timeout=5000`, `BEGIN IMMEDIATE`)، PostgreSQL 16+ خيار مدعوم كامل. كل اختبار على الاتنين في كل commit. قواعد النقل P1–P10 في وثيقة 4.
**مرفوض:** PostgreSQL فقط (تثبيت أتقل)، SQLite فقط (سقف مسدود)، "PostgreSQL لاحقًا" (تسرب كود خاص بـSQLite).
**العواقب:** تكلفة CI أعلى شوية؛ مقابل ضمان إن التحول مجرد إعداد.

### ADR-003
**السياق:** SQLite كاتب واحد في اللحظة؛ الترقية من قفل قراءة لكتابة بتدي "locked".
**القرار:** طابور أوامر واحد + خيط كاتب واحد + اتصال كتابة واحد؛ ميزانية < 50ms لكل أمر. على PostgreSQL نفس الواجهة مع إمكانية عدة كتّاب.
**العواقب:** ترتيب محدد للدفتر؛ لازم أي عمل تقيل يطلع برا الكاتب؛ السيرفر عملية واحدة (مش عدة workers).

### ADR-004
**القرار:** `exe_ledger_txn` إضافة فقط؛ تصحيح = حركة عكسية؛ `hash = SHA256(prev_hash ‖ canonical(row))`؛ trigger يرفض UPDATE/DELETE؛ تحقق يومي وعلى كل نسخة احتياطية؛ مرساة يومية خارج القاعدة.
**العواقب:** الحالة الحالية projections قابلة لإعادة البناء؛ نسوّق النظام كـ"يكشف التلاعب" مش "يستحيل فيه".

### ADR-005
**القرار:** برنامج واحد، وحدات كحزم Python بملف `module.yaml`، كل وحدة تملك جداولها، التواصل بخدمات النواة المعلنة + أحداث + hooks قبل الأوامر؛ import-linter يمنع الاستيراد المتبادل.
**مرفوض:** Microservices (تشغيل معقد، معاملات موزعة).

### ADR-006
> **ملغى جزئيًا بـADR-018:** المقياس صار ×1000.

**القرار:** `BIGINT` × 10⁶ لكل كمية وقياس؛ Decimal في الـAPI.
**مرفوض:** `NUMERIC` (بيبقى float في SQLite)، float (أخطاء تقريب في الإجماليات).

### ADR-007
**القرار:** `id` = UUIDv7، + `code` بشري فريد لكل كيان.
**العواقب:** دمج مصانع واستيراد بدون تعارض، فهارس مرتبة زمنيًا.

### ADR-008
**القرار:** SPA بـReact + TypeScript + Vite؛ AG Grid Community (MIT) للجدول؛ ECharts؛ i18next؛ كل الأصول والخطوط مضمنة.
**يتأكد في:** S5 (50 ألف صف + RTL). لو فشل: نقيم TanStack Table + Virtual أو RevoGrid.

### ADR-009
**القرار:** SSE (سيرفر → شاشات)؛ الأوامر عبر REST عادي.
**مرفوض:** WebSocket (تعقيد أكبر بدون فايدة لاتجاه واحد).

### ADR-010
**القرار:** عملية Edge منفصلة (OPC UA / MQTT-Sparkplug B / Modbus / I/O)، بتلخص وتبعت أحداث لنفس الـAPI كمستخدم آلي بصلاحيات.
**العواقب:** النواة محمية من فيضان القراءات؛ مكتبات LGPL/EPL معزولة في عملية منفصلة (تراجع قانونيًا).

### ADR-011
**القرار:** ملف ترخيص JSON موقّع Ed25519 (المصنع، بصمة الجهاز اختياريًا، الوحدات، عدد المحطات، تاريخ الانتهاء)، تحقق offline. انتهاء الترخيص = قراءة فقط للوحدة، **مفيش فقد بيانات**.

### ADR-012
**القرار:** `production_date` و`shift_code` يتحسبوا من إعدادات الوردية لحظة الحركة ويتخزنوا في الدفتر؛ التقارير بتفلتر بيهم.
**السبب:** وردية الليل وتصدير "اليوم الغلط" (درس مشروع الأتمتة).

### ADR-013
**القرار:** قائمة تراخيص مسموحة (MIT, BSD, Apache-2.0, ISC, PSF, MPL-2.0 بحذر)؛ الـCI يرفض الباقي في المنتج.

---

### ADR-014 — TypeScript على Node 22 بدل Python
**السياق:** دراسة المنظومة (E1): ميزان والثري دي TypeScript/Node بـSQLite محلي وReact؛ BAMS ومشروع الأتمتة Python.
التصنيع لازم "يحس" إنه نفس المنتج، ويستعمل نفس المكونات (DataGrid، Shell، ثنائية اللغة، عقد الموديول، Editions).
**القرار:** Node 22 LTS + TypeScript + Fastify + zod + `node:sqlite` + `node:test` — نفس اختيارات ميزان.
**مرفوض:** Python/FastAPI (يعزل التصنيع عن مكونات المنظومة ويضاعف الواجهات)؛ Go/.NET (نفس السبب + فريق).
**العواقب:** مكتبات الماكينات تُختار لـNode (node-opcua MIT، mqtt.js MIT) أو يبقى الـEdge Python كعملية منفصلة.
القرار اتخذ **قبل** أي كود Python، فتكلفة التغيير كانت صفرًا.

### ADR-015 — لا دمج متعدد الكتّاب لحركات الإنتاج
**السياق:** BAMS يدمج تغييرات أجهزة كتير بقواعد عامة، ومنها دمج العدادات (+5 و−2 = +3). مناسب لمستلزمات استراحة؛
**خطر** على الإنتاج: مسح واحد على جهازين = قطعتين، واستهلاك يُدمج بلا تحقق من المسار أو الحجز.
**القرار:** سيرفر تصنيع **واحد مرجعي لكل مصنع** يكتب كل حركات الإنتاج في دفتر مرتب بسلسلة Hash. المحطات عملاء.
أي تشغيل أوفلاين مستقبلي = **أوامر مؤجلة** بـ`command_id` تُرسل وتُتحقق في السيرفر وقد تُرفض (والعامل يُبلَّغ)،
**لا** حالة تُدمج. البيانات الأساسية تأتي من مالك واحد فلا تعارض دمج أصلًا.
**مرفوض:** نقل محرك BAMS كما هو؛ CRDT عام؛ Raft (يحتاج أغلبية).
**الإثبات:** اختبارات: نفس `command_id` مرتين = حركة واحدة؛ حفظ الكمية بعد سيناريوهات عشوائية؛ الأحداث مرة واحدة في ميزان.

### ADR-016 — طبقة التكامل: Feed + Inbox + Acks
**القرار:** المنتج يكتب أحداثه في `eco_outbox` داخل نفس معاملة الحركة، ويعرضها `GET /eco/v1/feed?after=seq`.
المستهلك يسحب بمؤشر لا يتقدم إلا بعد التطبيق، ويمنع التكرار بـ`(source, id)`، ويرسل Ack (applied/parked + مرجع).
الترتيب مضمون داخل `ecocorrelation`؛ الحدث المحجوز يوقف سلسلته فقط. الظرف متوافق مع CloudEvents 1.0 (بلا مكتبة).
**مرفوض:** قاعدة بيانات مشتركة؛ وسيط رسائل (Kafka/RabbitMQ/NATS) — تشغيل وصيانة فوق طاقة مصنع صغير؛
Push فقط — المنتج يضطر يعرف المستهلكين ويعيد المحاولة؛ مزامنة ملفات قواعد البيانات — ممنوعة (BAMS).
**العواقب:** تأخير ثوانٍ (مؤشر + فترة سحب)؛ ممكن "نكزة" لاحقًا. لا مكون مركزي يقع فيقع كل شيء.

### ADR-017 — الهويات العالمية
**القرار:** المالك يصنع `id` عالمي UUID. التصنيع: UUIDv7. المالك ذو المفاتيح الرقمية (ميزان) يُمثَّل بـ
`UUIDv5(namespace = company_id, "mizan:<type>:<id>")` — حتمي، لا يحتاج جدول ربط ولا تعديل في ميزان،
والموديول الأصلي المستقبلي في ميزان يستخدم نفس المعادلة. + `origin` و`code` على كل كيان.
**مرفوض:** استخدام مفاتيح ميزان الرقمية مباشرة (تتصادم بين شركات، وتربط التصنيع بتفاصيل ميزان الداخلية)؛
جدول ربط في الموصل (يضيع = هويات جديدة = تكرار).

### ADR-018 — مقياس الكميات
**القرار:** داخل التصنيع ×1000 (مثل ميزان) كأعداد صحيحة؛ على السلك نص عشري + وحدة؛ التحويل يرفض أي قيمة
لا تُمثل بدقة (مثلًا 0.0005) بدل التقريب.
**السبب:** رحلة ذهاب وعودة بلا فقد مع المالك المالي أهم من دقة الميكرو؛ القياسات الهندسية (QMS) لها مقياسها.

### ADR-019 — تكلفة الإنتاج في الشريحة الأولى (مؤقت)
**السياق:** ميزان لا يملك مستندات إنتاج ولا WIP؛ ولا نعدّل ميزان بدون فهم واختبار وموافقة.
**القرار:** `link-mizan` يطبق: الاستهلاك = تسوية مخزون سالبة بمتوسط التكلفة وحساب مقابل **WIP (نوعه `current_asset`
لا `inventory`)**؛ الاكتمال = تسوية موجبة بتكلفة وحدة = (رصيد WIP للأمر × الكمية ÷ المتبقي من المخطط)، والاكتمال
الأخير ياخد كل الباقي. الفاقد يُسجل في التصنيع ولا يُرحّل (يُحمّل على الجيد = فاقد طبيعي). المرجع `eco:<event-id>`.
**حدود معلنة:** سعر الوحدة في ميزان رقم صحيح → فرق تقريب صغير يفضل في WIP ويُعلن في Ack؛ المستندات تظهر كتسويات.
**الخروج:** موديول `production` أصلي في ميزان (صرف للإنتاج، استلام إنتاج، فاقد، انحرافات) بقرار ومراجعة في مستودعه.

### ADR-020 — شكل عقد الموديول
**القرار:** نفس `AppModule` في ميزان (id, dependsOn, migrations, permissions, routes, health) + اختبار حدود.
**السبب:** مطوّر المنظومة يتعلم نمطًا واحدًا؛ نقل موديول أو فكرة بين التطبيقين مباشر.

### ADR-021 — HR-System يملك القوى العاملة
**السياق:** الموظف والوردية والحضور بلا مالك (E6 #1). المالك أشار لنظام HR قديم؛ الفحص وجده في `Department-automation`.
**القرار:** ترحيله بتاريخه الكامل إلى مستودع مستقل `HR-System` (لا مجلد داخل GMES، ولا قاعدة مشتركة، ولا إعادة كتابة).
HR ينشر لقطات بإصدارات عبر صندوق صادر؛ التصنيع يحتفظ **بمرآة للقراءة** (`mdm_employee`, `mdm_attendance_day`)
ويتحقق من كل أمر يذكر شخصًا (`person.unknown` / `person.inactive`) حين `ownership.person = 'hr'`.
**مرفوض:** سجل مشغلين دائم داخل التصنيع (حقيقة ثانية)؛ جعل BAMS نظام موارد بشرية (منتج مختلف)؛ قراءة `history.db` لـHR مباشرة؛
إعادة كتابة HR بـTypeScript أثناء الترحيل (السلوك أولًا).
**الرجوع الآمن:** `ownership.person = 'none'` يعيد السلوك السابق حرفيًا (مرجع بلا تحقق) — مختبر؛ لم يُحذف شيء.
**ملاحظة صادقة:** لم يكن في التصنيع "سجل عمال مؤقت" مُنفَّذ؛ كان فقط مرجع `person` حر في الأوامر، وهو ما صار الآن خاضعًا للتحقق.

### ADR-022 — الرواتب: حقيقة واحدة
**القرار:** HR-System يملك بيانات وحساب الرواتب (أساسي، بدلات، خصومات، إضافي، إجمالي/صافي). ميزان يملك القيد والدفاتر:
يستقبل قيدًا واحدًا لكل فترة بإجماليات لكل مركز تكلفة وحساب، بلا تفاصيل موظفين. ميزان لا يخزن موظفين ولا يحسب رواتب؛ HR لا يرحّل قيودًا.
**أثر على ميزان (اقتراح لمستودعه):** بند "Payroll (basic): employees" يتحول إلى "Payroll posting from HR".

### ADR-023 — عقود القوى العاملة
**القرار:** `eco.employee.v1` (رقم الموظف، حالة التوظيف، نشط؟، تواريخ، أكواد إدارة/وظيفة/مصنع) **بلا بيانات شخصية** — الحقول غير المعروفة تُسقط.
`eco.attendance_day.v1` لكل يوم حضور. الهوية `UUIDv5(company, "hr:<type>:<code>")`، نفس القيمة في Python وTypeScript (اختبار).
المخططات تُولد هنا فقط؛ HR يحمل نسخة ويتحقق بمدقق من المكتبة القياسية يرفض أي كلمة لا يفهمها؛ اختبار يقارن النسختين بايت ببايت.
**مرفوض:** نموذج موظف ثانٍ (`eco.person.v1` المسودة تُلغى قبل أن تُنفذ)؛ مكتبة JSON Schema خارجية في HR (قاعدة: مكتبة قياسية فقط).

### ADR-024 — الأساس المشترك
**السياق:** BAMS فيه بنية ناضجة (هوية أجهزة، سجل موقّع، مزامنة، صلاحيات، نسخ متحقق). التطبيقات الأخرى بلغات مختلفة.
**القرار:** نستخرج **الأنماط والعقود** (E8 F1…F9) كمواصفات مكتوبة + متجهات اختبار، وتطبيقين مرجعيين (Python من HR-System، TS في `packages/eco-*`).
**مرفوض:** نسخ كود BAMS في كل مستودع (يتباعد، ويجر منطق مجال الاستراحات)؛ خدمة هوية/مزامنة مركزية (نقطة فشل واحدة وتشغيل فوق طاقة مصنع صغير)؛ إعادة كتابة كل التطبيقات بلغة واحدة.

### ADR-025 — لا حل ثالث للمزامنة
**القرار:** النسخ **داخل** التطبيق بين أجهزته = نمط BAMS (journal + fold حتمي + version vectors) للبيانات القابلة للتعديل فقط.
التسليم **بين** التطبيقات = eco (outbox/feed/inbox/acks). يتقابلان في نقطة واحدة: سجل التطبيق مصدر الـoutbox.
**مرفوض:** استخدام fold BAMS بين التطبيقات (يفترض نفس المخطط ونفس السلطة)؛ استخدام eco للنسخ داخل التطبيق (لا يحل التعديل المتزامن).

### ADR-026 — صيغة السجل الموحدة
**القرار:** canonical JSON v1 (مفاتيح مرتبة بنقطة الكود، بلا مسافات، أعداد صحيحة فقط، غير ASCII كما هو) = سلوك BAMS الحالي.
`hash = SHA-256(domain + "\n" + canonical(line))`، والسطر يحمل `prev`. التوقيع Ed25519 بمفتاح الجهاز على الـhash.
المتجهات `packages/eco-contracts/vectors/canonical-v1.json` (مولدة من Python) تمر في TS وفي HR-System.
**لماذا BAMS لا GMES:** الـdomain يمنع خلط سجلات تطبيقات مختلفة، والتوقيع يكشف تلاعب من يملك الملف دون المفتاح؛ صيغة GMES الحالية (`prev|stable`) بلا الاثنين.
**الترحيل:** دفتر GMES الحالي يبقى صالحًا ومفحوصًا؛ v2 يبدأ بسطر مرساة يحمل آخر hash قديم (F3).

### ADR-027 — حقائق الإنتاج والأوفلاين
**القرار:** لا دمج متعدد الكتّاب (عداد/LWW) لأي اكتمال/استهلاك/فاقد/سيريال/حركة مخزون. البرهان قابل للتشغيل: `apps/mes-server/test/offline-merge-proof.test.ts`
(نفس السيريال على جهازين = قطعتان؛ LWW يمحو حقيقة؛ كل جهاز أوفلاين يملأ الخطة فيتجاوز المجموع).
الأوفلاين الآمن الوحيد: **Escrow** — حصص كمية ونطاقات سيريال تُحجز من السلطة قبل الانقطاع، وأوامر بـ`command_id` تُتحقق عند الرجوع. مؤجل حتى يُبنى ويُختبر بنفس الصرامة.

### ADR-028 — النسخ الاحتياطي
**القرار:** نموذج BAMS (Online backup API، `integrity_check` قبل الحفظ، قرص ثانٍ، رفض الأقراص الشبكية، السجل الدائم خارج الاستعادة، الاستعادة = تغيير تعويضي) **+ اختبار استعادة آلي دوري** (استعادة في مكان مؤقت + فحص السلسلة + مقارنة الأعداد) لأنه غير موجود حتى في BAMS.


### ADR-029 — مجموعة واجهة واحدة للمنظومة (eco-ui) وهيكل التطبيق قبل الوحدات
**السياق:** الخلفية قوية لكن المنتجات لا تبدو برامج تجارية. المالك أوقف تطوير الوظائف حتى يُعتمد هيكل الواجهة (مرحلة UX)،
وطلب نظام تصميم واحد لا صفحات مصممة واحدة واحدة، بفلسفة تشغيل الأنظمة المؤسسية (شروط ← استعلام ← جدول ← تفاصيل، أكواد شاشات، تابات MDI).
**القرار:**
- `packages/eco-ui/src` = **مصدر واحد** للتوكنز (`tokens.css`: فاتح/داكن، كثافة، لون مميز لكل منتج عبر `data-product`) والمكونات
  (`eco-ui.css`) ومكتبة JavaScript بلا أي مكتبة خارجية ولا خطوة بناء (`eco-ui.js`: الهيكل، القائمة الشجرية، بحث الشاشات Ctrl+K،
  تابات MDI، الشاشة القياسية، لوحة الشروط والفلاتر المحفوظة، الجدول الكثيف، النوافذ، الإشعارات). النصوص تُكتب نصًا فقط (لا HTML).
- `apps/mes-web` = هيكل GMES وأربع شاشات قوالب (EXE3010، MDM1010، SYS9010، EXE2020) + لوحة الخط DSH5010 لوضع اللوحة، يقدمها
  `mes-server` نفسه (`src/web.ts`: قائمة ملفات ثابتة، سياسة CSP صارمة) — عنوان واحد ومصدر واحد مع الـAPI.
- الشاشات تعرض **بيانات تجريبية مُعلَنة** (`data.js`، شارة "بيانات تجريبية" إلزامية باختبار) حتى تُوصل بالخادم بعد اعتماد الشكل.
- HR-System ينسخ `packages/eco-ui/src` **بدون تعديل** إلى `hr_core/web/eco-ui/` مع بصمة SHA-256 يفحصها اختباره (نفس نمط `eco_schemas/`).
**مرفوض:** AG Grid/ECharts (اعتماد ثقيل، ترخيص للمزايا المؤسسية، وخطوة بناء لا تناسب منتج HR المثبت بالمكتبة القياسية)؛
React أو إطار واجهة (خطوة بناء في كل منتج)؛ تصميم كل شاشة بأسلوبها؛ نسخ شكل أو أي أصل من نظام تجاري آخر (قانونيًا ممنوع — §6.1).
**أثر:** أي شاشة جديدة تُبنى من `screen()` و`grid()` و`conditionPanel()`؛ تغيير التوكنز يغير كل الشاشات في المنتجين.
الألوان ما زالت مؤقتة حتى تصل صور المرجع (§6.6).

### ADR-030 — الخطة والمؤهلات من HR، ومتطلبات المحطة للتصنيع
**السياق:** بأمر المالك (2026-09-28) بُنيت الورديات (المرحلة 3) والمهارات (المرحلة 5) في HR-System.
**القرار:** HR **يحسب** اليوم المخطط لكل شخص (تكليف أساسي/مؤقت، تقويم، تغيير يوم، الليلية يوم عمل واحد) وينشره
`eco.schedule_day.v1` لـ14 يومًا للأمام، وينشر كل مؤهل `eco.qualification.v1` (المسحوب = `active: false`). التصنيع يحتفظ
**بمرآة للقراءة** ويعرض عمرها (`/api/workforce/status`)؛ ويملك **متطلبات المحطة** (مهارة × أدنى مستوى)، ويرفض
`person.not_qualified` لأي أمر يذكر محطة لها متطلبات وشخصًا بلا مؤهل ساري بالمستوى في يوم الإنتاج. بدون محطة أو بمحطة
بلا متطلبات = نفس السلوك السابق.
**مرفوض:** نشر التكليفات والورديات ليحسب التصنيع الخطة بنفسه (حقيقتان لنفس اليوم)؛ أن يخزن HR متطلبات المحطات (المحطة ملك التصنيع)؛
إيقاف المصنع عند غياب HR (المرآة الأخيرة تكفي وعمرها ظاهر).

### ADR-031 — One-click start, PowerShell-only tooling, standalone by default
**Context:** the owner works on Windows and wants to start the product with one click, and never wants bash. The repository
shipped `.sh` helpers and its suite had only run on Linux.
**Decision:** `Start-Itqan.bat` is a two-line wrapper (Windows does not run `.ps1` on double-click); all logic is in
`scripts/*.ps1` (Windows PowerShell 5.1 and PowerShell 7, ASCII only). Configuration lives in `data/config.json`
(created on the first run, never committed): company id (generated UUID), port, host, plant name, time zone, production-day
start, `itemOwner`, `personOwner`. Defaults are a **standalone plant**: `itemOwner: "gmes"` so items and warehouses can be
created without Mizan (`docs/ecosystem/02-truth-ownership.md` keeps Mizan as the owner when it is installed; the switch is one word), and
`host: "127.0.0.1"` so nothing is reachable from the network until the owner opts in. No key is created automatically:
keys are shown once and stored as hashes, so `scripts/new-key.ps1` makes them on request. `.sh` scripts are removed; CI runs
the `.ps1` files with `shell: pwsh`. `.gitattributes` pins LF for text and CRLF for `.bat`/`.ps1`.
**Rejected:** a service/installer now (V1 scope item, needs signing and update design); auto-creating an admin key in a
plaintext file (breaks "shown once"); binding `0.0.0.0` by default (the screens have no login yet); keeping both `.sh` and
`.ps1` (two implementations drift).

### ADR-032 — People sign in; the plant model and downtime belong to manufacturing; boards read only the ledger
**Context:** the owner accepted the shell and asked for the screens to work for real. The API knew only machine keys.
**Decision:** local accounts in `sys_user` (scrypt, one role each; `ROLE_SCOPES` maps roles to the same scopes the keys use,
so the server checks one way for both), sessions as a SHA-256 of a random token in an HttpOnly SameSite=Strict cookie; the
first administrator is created from the screen while no account exists (no default password). The plant model is a single
self-referencing table with a fixed parent type per level. Stoppages are append-only START/END facts (`oee_event`), one open
per line/station. Boards and the start page compute only from the ledger and those facts; a figure that needs data the
system does not hold yet (OEE, an hourly plan without capacity) is shown as "—", never estimated.
**Rejected:** SSO/LDAP now (V2, design doc 07); a default admin/admin account; storing stoppages as a row updated at the end
(a fact would be overwritten); keeping sample data beside real data "for the look" (a screen must never mix them).

### ADR-033 — Mizan's look and grid ideas enter the kit as an opt-in "modern" look
**Context:** the owner asked for HR-System to take Mizan's design, look and good ideas. Mizan is React + Vite; HR-System is
standard-library Python with no build step and copies this kit unchanged (ADR-029), so the React code cannot be moved.
**Decision:** the ideas enter `packages/eco-ui` once, for every product: a second look `data-look="modern"` (Mizan's tokens:
white canvas, hairline borders, pill buttons, 8/16/22 px corners, layered shadows, a light translucent top bar, sun/moon pill,
Inter + IBM Plex Sans Arabic carried in `src/fonts/` under the SIL OFL, so nothing is downloaded at run time), chosen per product
and switchable per person (user menu, Ctrl+K). The grid gains Mizan's DataGrid features: a filter on every column (values, number
range, date range), grouping with counts and sums, presets, filter chips with one-click removal. New parts: `donut`, `kpiStrip`,
`healthBanner`, `steps`, `advice` (a finding with reason, what to do and its rule). `screen()` takes an optional subtitle and help;
the screen search also runs actions (the product's `commands`, theme, look, language). The classic look stays the default:
**GMES keeps classic**; HR-System defaults to modern.
**Rejected:** copying Mizan's React front end into HR (breaks ADR-029, adds a Node build to a Python installer, splits the
ecosystem's look); styling HR alone in `hr.css` (HR and GMES would drift); making modern the default for everyone now (the
owner approved the dense enterprise-MES philosophy for the shop floor).

### ADR-034 — Engineering revisions are frozen; serial units follow their routing with their own hash-chained history
**Context:** the owner asked for the rest of the product with a realistic television plant: every TV has a serial, passes a
sequence of stations (panel loading, main board, function test, packing), fails and is repaired, and must be traceable to its
parts and material lots. The production ledger (`exe_ledger`) holds QUANTITIES, which accounting receives; nothing held units.
**Decision:**
1. A new `eng` module owns the manufacturing facet of an item (ownership table: "BOM, routing, cycle time: manufacturing"):
   routings and bills of materials as revisions. A draft is edited; approving freezes it (the server refuses, and database
   triggers refuse, any change to its lines) and makes the previous approved revision obsolete. A work order stores the ids of
   the approved revisions it was released with: a frozen revision IS the snapshot, no copy is kept. The plant's production
   shifts and calendar live here too (the plant's working time; people's rosters stay HR-System's).
2. An operation is performed on a line at the station named `<line code>-<operation code>`: routing and plant model meet by
   code, never by a copied list of stations.
3. A new `trk` module keeps serial units: `trk_event`, append-only and hash-chained (shared helper `kernel/chain.ts`), is the
   unit history; `trk_unit`, `trk_genealogy` and the load counters are its projections. The route is enforced on the server
   (first operation creates the unit; skipping a required operation, moving a held unit, scanning a unit in repair, a unit that
   already passed, and starting more units than planned are refused). A FAIL goes to repair and returns to the SAME test.
4. The two histories stay separate but are joined in the same transaction: a unit's last operation books ONE `COMPLETE` of
   quantity 1 (lot = serial) in the production ledger; a scrapped unit ONE `SCRAP`. A health check proves units == ledger per
   order. Consumption is booked before the order's final unit (lots used from station loads, and backflushed material that no
   station scans), because accounting relies on consumption preceding the final completion.
5. Key parts are scanned where the BOM says (`scan: serial`): a unit made here becomes `consumed` into its parent; a bought-in
   serial is accepted once and marked not verified. Material lots are loaded on stations (`scan: lot`); a lot nobody registered
   is accepted and marked not verified (ownership: supplier lots belong to accounting when it is connected).
**Rejected:** adding unit transaction types to `exe_ledger` (SQLite cannot change its CHECK without rebuilding the audited
ledger table, and adding fields would change the hash of every old line; accounting does not need unit moves); copying the
routing into each order (a frozen revision is already immutable); one row per unit updated in place without history (a
changed status would erase what happened); per-unit consumption lines (a million ledger lines a month for screws);
multi-line routings with station lists (a code rule is simpler and cannot drift).

### ADR-035 — Quality: signed-off inspections, holds that stop units anywhere, releases signed by a person
**Context:** a television plant tests every set (function, hi-pot, white balance), repairs the failures, inspects lots
before they leave (OQC by AQL sampling) and must stop suspect units at once — including every set that contains a suspect
material lot — and release them only on a quality decision.
**Decision:** a `qms` module. Defect codes and repair cause / action codes are the plant's lists (an empty list accepts any
code, so a plant can start before writing them). An inspection is an append-only, hash-chained record: measurements are
checked against the plan's limits on the server (exact decimals, ADR-018); a sampled inspection (IQC / OQC) takes its
sample and acceptance number from ISO 2859-1 (single, normal; the diagonal structure of table II-A is coded and tested
against published rows). A failed OQC holds the lot in the same transaction. A hold resolves its target to units (a unit, a
list, a work order, a pallet, or every finished product whose genealogy contains a lot or part) and increments each unit's
hold count, so a unit under two holds stays stopped until both are released; units already shipped are counted as the
recall list, never "held". A release is a person's electronic signature (their password, checked by the system module;
machine keys cannot sign) with a disposition; rework and scrap apply only to units still in production — a finished unit
is never silently taken back out of the production ledger. A repair can replace a key part: the old genealogy row is kept
and marked removed by the repair fact.
**Rejected:** a boolean "held" flag (a second hold's release would free a unit the first still holds); holding shipped units
(a physical impossibility that would hide the recall); scrapping finished units from a hold (it would need a reversal in the
production ledger and a contract for accounting: EXE2040); deleting a replaced part's genealogy row (the history of what was
in the unit is the point of traceability); a PIN or "are you sure?" as signature (anyone at the keyboard can click it).

### ADR-036 — Shipping: pallets, shipping orders and containers in manufacturing; the sale stays in accounting
**Context:** a television plant ships in containers: finished sets are palletized, pallets pass an outgoing inspection, and
a container is loaded for a shipping order and sealed. The owner asked for "container loading and every detail". The
ownership table gives customers and sales to accounting; nothing covered the physical shipment.
**Decision:** a `shp` module owns the physical side: packing specifications per product (units per pallet, pallets per
container type), palletizing (one product per pallet, closed when full), shipping orders (customer as a NAME until
`eco.party` exists; products and quantities), containers identified by ISO 6346 numbers with a checked check digit, and
loading checks enforced on the server: only closed pallets, of an ordered product, never more than ordered, never more than
the container holds (mixed products use fractions of each product's capacity), no unit on hold, and a PASSED outgoing
inspection when the plant has an OQC plan for the product. Sealing dispatches: units and pallets become shipped and one
`mes.shipment.dispatched.v1` (new additive contract, lines per product and warehouse, serials of serialised products) goes
to accounting through the feed. Every fact is in a hash-chained shipping history.
**Rejected:** creating customers in manufacturing (another app's master data); booking stock relief or an invoice here
(accounting's decision and value); letting a container take any pallet and checking afterwards (the check at the door is
the whole point); allowing mixed-product pallets (a TV plant ships one model per pallet; mixing breaks OQC lots).

### ADR-037 — OEE from facts, reports computed on request, labels as ZPL, backups rehearsed before they count
**Context:** the owner asked for "every remaining part and screen" of the MES. The efficiency, report, label and system
entries of the menu were still greyed; the line board showed OEE as "—" and the stop reasons were a fixed list in code.
**Decision:**
- **OEE (ISO 22400)** is computed when asked, never stored: planned time = the production shifts the line WORKED (a work
  order planned for the shift, or output booked inside its window) up to now, minus the shift's break share; planned stops
  (reasons marked planned, e.g. a break) are removed from the busy time; unplanned downtime is the UNION of the line's and
  its stations' stoppages (overlaps counted once, a planned stop wins over an unplanned one at the same moment); the ideal
  cycle is the slowest operation of the routing (the line's pace), else the line's capacity per 480 minutes; quality from
  the ledger. A part that cannot be known is `null` ("—"), never guessed. Stop reasons become the plant's own table
  (`oee_reason`, SYS9040), each in a loss category; never deleted, only switched off.
- **Reports** (`rpt`) are views over other modules' facts plus the one thing people write there: shift handover notes,
  append-only (a correction is a new note pointing to the old one), and a receipt confirmed once by the next shift.
- **Labels** (`lbl`): templates in ZPL — the language of the thermal printers plants already own — with {variables} checked
  against what the label is for (a unit, a pallet, nothing) and filled from the facts; values carrying ZPL control
  characters (^ ~) are refused. Printers are reached by raw TCP 9100. The first label of a thing is a print; any later one is
  a REPRINT with its own permission (supervisor, quality) and a reason — a second serial label is how a set ships twice.
  The print is recorded inside the command (so a retry never prints twice) and sent after the commit; whether the printer
  took it is a second fact. The screens preview the label (a small ZPL renderer and Code 128 in the browser).
- **Backups** (`ops.ts`, whole installation): `VACUUM INTO` on the reader connection (a consistent committed copy while the
  plant runs), then a REHEARSAL on the copy, opened read-only: `integrity_check`, every module's own health checks (hash
  chains, units against the ledger) and row counts written beside it. "Verify" repeats it and compares the counts. Restore is
  a documented offline procedure (SYS9070), never a web action; nothing deletes a backup.
- **Keys** of devices and links get a screen (SYS9030): shown once, listed without secret or hash, revoked at once.
**Rejected:** storing OEE per shift (a figure that can drift from the facts it came from); summing overlapping stops (a
station stop inside a line stop would count the same minutes twice); a proprietary label designer or PDF labels (plants run
Zebra-compatible printers; ZPL is what they accept); restoring from a browser (a click that replaces the plant's database is
not an operation to leave one confirmation away); scheduled backups inside the server (Windows Task Scheduler calls the same
API; the server stays one process that serves).
**Still planned (menu entries left greyed, honestly):** EXE2030 split/merge/move, EXE2040 reversals (both need a
correction model agreed with accounting first), SYS9050 numbering, SYS9120 import from Excel.

### ADR-038 — Planning lives in manufacturing and is a pure function over mirrors; its outputs are stable, versioned facts
**Context:** the ecosystem plan (`complete-company/plan`) needs a sales order and an approved demand plan from accounting to become planned
orders, purchase requisitions and crew needs without retyping, and manufacturing may hold no money.
**Decision:** module `pln` reads only the mirrors of accounting's commercial truth (parties, sales orders, demand plans, stock, purchase
orders, item planning fields) and the engineering data it owns (BOM, routing, plant, shifts). `engine.ts` is a pure function (`today` is an
input, no clock, no database): forecast consumption by firm orders, netting with lot rules and safety stock, explosion by low-level code with
exact decimals (nothing is rounded), pegging, backward capacity loading with shift proposals, crew per line × shift × day. Requisitions and
crew rows have stable ids (`uuidv5(company, "gmes:pr:<item>:<week>")`), so a later run updates instead of duplicating, and what disappears is
published as cancelled. Inside the frozen fence the engine creates nothing new and changes no firmed order: it raises an exception. Stock held
in quality quarantine is not counted (setting `planning_warehouses`). A nightly loop runs the plan; tests call it explicitly.
**Rejected:** MRP in accounting (it would need a second BOM truth); recalculating pegging on read (the answer to "why was this ordered?" must
be the one recorded at the run); an engine that reads the database (untestable with hand-calculated cases).

### ADR-039 — The pusher: manufacturing's outbox goes to each peer's inbox; keys are sealed; one bad event never blocks the feed
**Decision:** for every configured peer (`eco_peer`: url, sealed key, types, cursor) the pusher posts batches read after the cursor, filtered by
type; `applied | unchanged | stale | duplicate` move the cursor, `rejected` is recorded as parked (visible in `/api/integration/events`) and the
cursor still moves; a network error or 5xx stops the pass without moving it. Keys are sealed with DPAPI on Windows (`kernel/secrets.ts`),
encoded elsewhere and with `GMES_SECRETS=plain` in tests. **Rejected:** pull only (the consumer would need to reach us and poll); webhooks
without an outbox (a lost call is a lost fact).

### ADR-040 — Receiving from accounting, inspection decisions, shipping from sales order lines
**Decision:** a goods receipt becomes material lots (`pending_iqc` when an inspection plan exists for the item, else `accepted`); a lot that is
not released cannot be loaded on a station (`lot.not_released`); the decision (accepted, rejected, partly accepted, hold, release) is published
as `mes.lot_decision.v1` and accounting moves rejected stock to its quarantine warehouse. Shipping orders are made from mirrored sales order
lines, the open quantity is the limit, and the dispatch event names the customer and each sales order line. **Rejected:** letting a shipment exist
without an order (accounting could not deliver or bill it).

### ADR-041 — Labour facts, plant export, layout snapshots and the live station stream
**Decision:** `mes.labor_day.v1` splits a person's day minutes by their bookings with the largest-remainder method (no minute is lost or
invented) and is published as a versioned snapshot, closed once the day is over; HR compares it with the plan, GMES never reads pay. The plant tree
is exported as `eco.plant_node.v1` and a layout snapshot from Space Planner gives tagged nodes a position. `GET /eco/v1/live` is a server-sent-events
stream for the BROWSER page of Space Planner: read-only key in the address (an EventSource cannot send headers), origin allow-list
(`GMES_LIVE_ORIGINS`), states running / stopped with the reason / starved, and the day's output per line. **Rejected:** WebSockets and UI polling;
a write scope on the key that travels in an address.
