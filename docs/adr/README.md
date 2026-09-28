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
**السياق:** دراسة المنظومة (E1): ميزان والثري دي TypeScript/Node بـSQLite محلي وReact؛ BAMS وأتمتة G-MES Python.
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
وطلب نظام تصميم واحد لا صفحات مصممة واحدة واحدة، بفلسفة تشغيل G-MES (شروط ← استعلام ← جدول ← تفاصيل، أكواد شاشات، تابات MDI).
**القرار:**
- `packages/eco-ui/src` = **مصدر واحد** للتوكنز (`tokens.css`: فاتح/داكن، كثافة، لون مميز لكل منتج عبر `data-product`) والمكونات
  (`eco-ui.css`) ومكتبة JavaScript بلا أي مكتبة خارجية ولا خطوة بناء (`eco-ui.js`: الهيكل، القائمة الشجرية، بحث الشاشات Ctrl+K،
  تابات MDI، الشاشة القياسية، لوحة الشروط والفلاتر المحفوظة، الجدول الكثيف، النوافذ، الإشعارات). النصوص تُكتب نصًا فقط (لا HTML).
- `apps/mes-web` = هيكل GMES وأربع شاشات قوالب (EXE3010، MDM1010، SYS9010، EXE2020) + لوحة الخط DSH5010 لوضع اللوحة، يقدمها
  `mes-server` نفسه (`src/web.ts`: قائمة ملفات ثابتة، سياسة CSP صارمة) — عنوان واحد ومصدر واحد مع الـAPI.
- الشاشات تعرض **بيانات تجريبية مُعلَنة** (`data.js`، شارة "بيانات تجريبية" إلزامية باختبار) حتى تُوصل بالخادم بعد اعتماد الشكل.
- HR-System ينسخ `packages/eco-ui/src` **بدون تعديل** إلى `hr_core/web/eco-ui/` مع بصمة SHA-256 يفحصها اختباره (نفس نمط `eco_schemas/`).
**مرفوض:** AG Grid/ECharts (اعتماد ثقيل، ترخيص للمزايا المؤسسية، وخطوة بناء لا تناسب منتج HR المثبت بالمكتبة القياسية)؛
React أو إطار واجهة (خطوة بناء في كل منتج)؛ تصميم كل شاشة بأسلوبها؛ نسخ شكل Nexacro أو أي أصل من G-MES (قانونيًا ممنوع — §6.1).
**أثر:** أي شاشة جديدة تُبنى من `screen()` و`grid()` و`conditionPanel()`؛ تغيير التوكنز يغير كل الشاشات في المنتجين.
الألوان ما زالت مؤقتة حتى تصل صور G-MES الحقيقية (§6.6).

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
**Decision:** `Start-GMES.bat` is a two-line wrapper (Windows does not run `.ps1` on double-click); all logic is in
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
owner approved the dense G-MES philosophy for the shop floor).
