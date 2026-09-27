# 1) البحث والمقارنة

تاريخ البحث: 2026-09-27. المصادر في آخر الملف.

---

## 1.1 المعيار المرجعي: ISA-95 (IEC 62264)

ISA-95 هو "اللغة المشتركة" بين المصنع وأنظمة الشركة. مش هنطبقه حرفيًا (تطبيقه
الحرفي هو اللي بيخلي أنظمة MES تقيلة ومعقدة)، لكن هنستخدم **مفاهيمه وأسماءه**
عشان أي تكامل مستقبلي مع ERP يبقى سهل.

| جزء المعيار | الفكرة | هناخد منه إيه |
|---|---|---|
| **Part 1 — Equipment hierarchy** | Enterprise → Site → Area → Work Center (Line) → Work Unit (Station/Machine) | هيكل المصنع في النواة بالظبط كده |
| **Part 2 — Object models** | Material / Equipment / Personnel / Process Segment / Product Definition / Operations Schedule / Performance | أسماء الكيانات في نموذج البيانات |
| **Part 2 (2017) — Operations Event Model** | كل حدث تشغيلي رسالة واحدة فيها كل سياقها (مين، فين، إمتى، على أنهي أمر/مادة) | **ده قلب تصميمنا:** دفتر الحركات (Transaction Ledger) |
| **Part 3 — Activity models (MOM)** | 4 مجالات: Production، Quality، Maintenance، Inventory — وكل مجال فيه: تعريف، موارد، جدولة، إرسال، تنفيذ، جمع بيانات، تتبع، تحليل | تقسيم الوحدات (Modules) |
| **Part 4 — Job Control / Work Master** | Work Master (الوصفة/المسار) ← Job Order (الأمر الفعلي) | Routing Template ← Work Order |
| **B2MML** (تمثيل XML لـ Part 2) | صيغة تبادل مع ERP | تصدير/استيراد في وحدة التكامل لاحقًا |
| **ISO 22400** | تعريفات KPI القياسية (OEE, Availability, Performance, Quality…) | معادلات OEE والتقارير بالظبط زي التعريف القياسي عشان الأرقام تتقارن |

**الخلاصة:** أسماء ISA-95، بساطة أنظمة المصانع الصغيرة.

---

## 1.2 سامسونج Nexplant و G-MES4 — إيه اللي بيخليهم أقوياء

Nexplant هو منصة Samsung SDS (MES + EES معدات + APS جدولة + FDC + SPC + YMS تحليل عائد).
G-MES4 هو التطبيق الداخلي لسامسونج (واجهة Nexacro). من المصادر العامة ومن خبرتنا
المباشرة في مشروع `opening-nerp-tcode` (أتمتة G-MES4 — 89 ملاحظة موثقة في
`GMES_SKILL.md`)، دي الأفكار اللي تستاهل تتنقل:

### أفكار معمارية تستاهل النقل
1. **Lot + Lot History (نموذج الحركات):** كل تغيير على اللوت/القطعة حركة مسجلة
   (Track-In, Track-Out, Hold, Release, Split, Merge, Scrap, Rework). الحالة =
   آخر حركة. ده سبب إن التتبع عندهم كامل. **هنبني عليه النواة.**
2. **Workflow-driven execution:** النظام هو اللي بيقول "القطعة دي عليها تروح فين
   بعد كده" بناءً على المسار، مش العامل. ده بيمنع تخطي خطوة فحص.
3. **Dispatching حسب الأولوية وأحداث الماكينة.**
4. **الترقية من غير توقف (zero-downtime upgrade)** — في حجمنا: ترقية في دقايق
   مع رجوع آمن (rollback) مضمون.

### أفكار في الواجهة تستاهل النقل (من G-MES4 مباشرة)
| سلوك G-MES4 | ليه مفيد | عندنا |
|---|---|---|
| **كود لكل شاشة** (`P1112UM00`) و **menuId** (`PPM0219`) + صندوق بحث بالكود | المستخدم الخبير يفتح أي شاشة في ثانية | كود ثابت لكل شاشة + بحث أعلى الشاشة |
| **Breadcrumb** بيعرض المسار والكود | المستخدم عارف هو فين | نفس الفكرة |
| **MDI Tabs** — كذا شاشة مفتوحة في تابات | شغل متوازي | نفس الفكرة |
| **منطقة شروط بحث فوق + زر Inquiry + جدول كثيف تحت + Excel** | نمط واحد يتعلم مرة واحدة | القالب الأساسي لكل شاشات الاستعلام |
| **My Menu / مفضلة** | اختصار | نفس الفكرة |
| **شجرة المنظمة (Org/Division)** كفلتر | عرض حسب القسم | فلتر Site/Area/Line موحد |

### دروس من عيوب G-MES4 (اتعلمناها بالطريقة الصعبة في مشروع الأتمتة)
| المشكلة اللي شفناها | الدرس لتصميمنا |
|---|---|
| **غياب فلتر الـDivision = صفر نتايج بدون أي رسالة** (gotcha #12) | الفلاتر الإلزامية لازم تبان كإلزامية، والنتيجة الفاضية تقول *ليه* فاضية |
| **الـDataset بيتصفر لحظة الضغط على Inquiry** فمش باين إمتى الاستعلام خلص (gotcha #14) | كل استعلام يرجع حالة صريحة (loading / done: N rows / error) |
| **الشاشة اللي ورا التاب بتقبل فلاتر** فتستعلم شاشة وتصدّر غيرها (gotcha #25) | كل تاب معزول، والتصدير بياخد نفس الفلاتر اللي اتعرضت بالظبط ومكتوبة في الملف |
| **الجريد بيعرض الصفوف الظاهرة بس**، والقراءة من الشاشة بتقص النتايج (gotcha #9) | Virtual scrolling + عدد إجمالي ظاهر دايمًا + التصدير من السيرفر مش من الشاشة |
| **صفوف إجماليات فرعية (LINE SUM / PROC SUM) مخلوطة بالبيانات** فالعدد مش مطابق (gotcha #18, #28) | الإجماليات تتحسب في السيرفر، مفيش صفوف وهمية |
| **نتيجة قديمة شكلها زي الجديدة** وتصدير اليوم الغلط (gotcha #19) | كل نتيجة مختومة بوقت الاستعلام وفلاتره، ومفهوم **Production Date** صريح مربوط بالوردية، منفصل عن تاريخ الساعة |
| **الفلاتر بتفضل محفوظة على الشاشة وتتورث بصمت** (gotcha #34) | كل نتيجة معروض فوقها "الفلاتر المطبقة" بوضوح، وزر مسح واحد |
| **Tokens حساسة جوه datasets عادية** (gotcha #26) | الأسرار عمرها ما تنزل للمتصفح في بيانات الشاشات |
| الواجهة معتمدة على Nexacro (runtime مغلق) | واجهة ويب قياسية، بدون runtime خاص |

---

## 1.3 أنظمة MES التجارية (المرجع من فوق)

| النظام | القوة | ليه مش مناسب لعميلنا |
|---|---|---|
| Samsung Nexplant | عمق هائل، أشباه موصلات، 10 PPM | تكلفة ومشروع تنفيذ بالسنين |
| Siemens Opcenter, Rockwell Plex/FactoryTalk, GE Proficy, Critical Manufacturing, Dassault Apriso | معايير، تكامل | ترخيص + تنفيذ بمئات الآلاف من الدولارات |
| Tulip, Ignition (Inductive Automation) + Sepasoft MES | مرونة، low-code، Ignition بيرخص بالسيرفر مش بالمستخدم | Tulip سحابي بالاشتراك؛ Ignition محتاج مهندس تكامل لكل مصنع |

**الفجوة اللي هنستهدفها:** مصنع 30–500 عامل، 1–10 خطوط، محتاج تتبع وجودة و OEE
**الأسبوع ده** مش بعد سنة، ومفيش عنده فريق IT. محتاج "منتج جاهز" مش "منصة تتبرمج".

---

## 1.4 المشاريع المفتوحة (GitHub) — إيه اللي نتعلمه

| المشروع | التقنية | الفكرة الجيدة | الملاحظة |
|---|---|---|---|
| **FactorySemantics MES** | Python 3.12, FastAPI, SQLite افتراضي أو PostgreSQL 16+, OPC UA, موصل ERPNext, Apache-2.0 | **نواة + وحدات اختيارية** — نفس فكرتنا بالظبط، و"Shadow mode" يشتغل جنب MES قديم | Pre-alpha (v0.2، سبتمبر 2026)، محاكاة بس. **يثبت إن الاختيار التقني بتاعنا منطقي**، لكن مش أساس نبني عليه |
| **OpenMES** | Laravel 12, PostgreSQL 17, Livewire, Reverb WebSocket, Docker | Operator PWA يشتغل offline، سجل تدقيق immutable، Hooks للأحداث، Issue → Block تلقائي | AGPL (copyleft) — **ممنوع ناخد منه كود** لمنتج تجاري مغلق، ناخد أفكار بس |
| **qcadoo MES** | Java/Spring | موجه للمصانع الصغيرة، مكتمل وظيفيًا | تقيل ومعماريته قديمة |
| **Libre MES** | مبني فوق أدوات مفتوحة (Grafana وغيره) | OEE و downtime بسرعة | نطاق محدود |
| **ERPNext (Frappe)** | Python | BOM، Work Orders، Batch/Serial، Quality Inspection | **ERP مش MES**: مفيش تنفيذ لحظي على مستوى المحطة. **ممتاز كشريك تكامل** (Apache/GPL حسب الجزء) |
| **Odoo MRP** | Python | Work center، Shop floor app | نفس الملاحظة + Enterprise مدفوع |

**تحذير ترخيص (قرار تجاري مهم):** أي كود هنستخدمه لازم يكون MIT / BSD / Apache-2.0.
**ممنوع** GPL / AGPL في المنتج نفسه لأننا هنبيعه مغلق المصدر. ده بيتفحص تلقائيًا في
الـCI (شوف خطة الاختبار).

---

## 1.5 السؤال المحوري: هل Python + FastAPI + SQLite (WAL) أساس صح؟

> **تحديث 2026-09-27 (ADR-014):** بعد دراسة باقي المنظومة (ميزان والثري دي مكتوبين TypeScript/Node بـ`node:sqlite`)
> اتغير اختيار اللغة إلى **TypeScript على Node 22**. كل ما يخص SQLite (WAL، كاتب واحد، BEGIN IMMEDIATE، الكميات الصحيحة، PostgreSQL كمسار نمو)
> يظل صحيحًا كما هو. التحليل أدناه محفوظ كسجل لسبب القرار الأول. انظر [E1](../ecosystem/01-landscape-and-integration-map.md).

### الإجابة المختصرة: **أيوه، بشرط تصميم محدد — ومع PostgreSQL كخيار مدعوم من اليوم الأول، مش "لاحقًا".**

### الحقائق
- **SQLite في WAL:** القراءة والكتابة يشتغلوا مع بعض، **لكن كاتب واحد في نفس اللحظة**.
  أي كتابة تانية بتستنى (`busy_timeout`) أو ترجع `SQLITE_BUSY`.
- عملية الكتابة في MES (مسح باركود، تسجيل كمية) بتاخد **ملّي ثواني**. يعني حتى
  100 عملية في الثانية ممكنة بسهولة لو المعاملات قصيرة.
- **عشرات المستخدمين** (مثلًا 50 شاشة + 30 محطة مسح) = في أسوأ الأحوال بضع
  كتابات في الثانية. SQLite يستحمل ده بهامش كبير.
- **المشاكل الحقيقية مع SQLite** مش السرعة، هي:
  1. معاملة بتبدأ قراءة وبعدين تحاول تكتب → "database is locked" حتى مع busy_timeout
     (upgrade من read lock لـwrite lock). الحل: **`BEGIN IMMEDIATE` لأي معاملة كتابة**.
  2. تقرير تقيل طويل بيمنع الـcheckpoint فملف الـWAL بيكبر.
  3. SQLite مفيهاش `NUMERIC` حقيقي (بيبقى float) — كارثة للكميات. الحل في §4.
  4. مفيش تشغيل على أكتر من سيرفر (لا HA ولا replication مدمج).
  5. **لازم عملية واحدة (process) هي اللي تكتب** — لو شغلنا 4 workers لـuvicorn هيتخانقوا على القفل.

### القرار (ADR-001، ADR-002)
| الطبقة | الاختيار | السبب |
|---|---|---|
| اللغة | **Python 3.12+** | سرعة تطوير، مكتبات صناعية ممتازة (asyncua لـOPC UA، pymodbus، paho-mqtt)، سهل التوظيف |
| الـAPI | **FastAPI** + Pydantic v2 | عقود API مكتوبة ومولدة (OpenAPI) = أساس التكامل والوحدات |
| الوصول للبيانات | **SQLAlchemy 2.0 (Core أساسًا)** + **Alembic** للترحيل | نفس الكود يشتغل على SQLite و PostgreSQL |
| قاعدة البيانات — نسخة صغيرة | **SQLite 3.45+** WAL, `synchronous=NORMAL`, `foreign_keys=ON`, `busy_timeout=5000`, كل كتابة `BEGIN IMMEDIATE` | ملف واحد، تثبيت صفري، نسخ احتياطي سهل |
| قاعدة البيانات — نسخة متوسطة | **PostgreSQL 16+** | >~60 مستخدم متزامن، ربط ماكينات كثيف، أو طلب HA |
| نموذج الكتابة | **كاتب واحد داخل التطبيق** (single-writer queue) | يلغي تمامًا مشكلة القفل على SQLite، ومش بيضر على PostgreSQL |

**الشرط اللي بيخلي القرار ده آمن:** كل اختبارات النظام تشتغل على **القاعدتين** في
كل commit من أول يوم. لو اتأجل PostgreSQL "لبعدين"، هيتسرب كود معتمد على SQLite
وهنكتشفه عند أول عميل كبير. (ده بالظبط نوع القرار اللي بنتجنب نندم عليه.)

### البدائل اللي اتدرست واترفضت
| البديل | ليه لأ |
|---|---|
| PostgreSQL بس من الأول | تثبيت وصيانة أتقل على مصنع صغير مفيهوش IT؛ خسارة ميزة "ملف واحد" |
| Node.js / NestJS | ممتاز للـAPI لكن مكتبات الصناعة والتحليل في Python أقوى |
| .NET | قوي على ويندوز، لكن أتقل في التوزيع على لينكس وأغلى في الأدوات |
| Go | أداء ممتاز، لكن سرعة بناء منطق الأعمال أبطأ وفريق أصعب |
| Laravel/PHP (زي OpenMES) | ممكن، لكن أضعف في جانب الماكينات والبيانات |
| Low-code (Ignition/Tulip) | تبعية لمورد، وتكلفة ترخيص على كل عميل |
| SQLite + Litestream/LiteFS للتوزيع | Litestream ممتاز **كنسخ احتياطي مستمر** (هنستخدمه اختياريًا)، مش بديل لـPostgreSQL |

---

## 1.6 الاتصال بالماكينات (للمستقبل، لكن التصميم من دلوقتي)

| المعيار | دوره | عندنا |
|---|---|---|
| **OPC UA** | "قاموس" الماكينة الحديثة، قراءة tags منظمة، أمان مدمج | موصل OPC UA (مكتبة `asyncua`) |
| **MQTT + Sparkplug B** | نقل خفيف pub/sub، Birth/Death certificates، أساس الـUnified Namespace | Broker محلي (Mosquitto) + موصل Sparkplug |
| **Modbus TCP/RTU** | الماكينات والعدادات القديمة، أرخص حساس | موصل Modbus (`pymodbus`) |
| **I/O بسيط** (عداد نبضات، إشارة تشغيل/توقف) عبر بوابة رخيصة | 80% من ماكينات المصانع الصغيرة ملهاش OPC UA | "Edge box" بيحول النبضات لأحداث |
| **PackML (ISA-TR88)** | حالات ماكينة التعبئة القياسية | خريطة الحالات في وحدة OEE |
| **MTConnect** | ماكينات CNC | موصل اختياري لاحقًا |

**قاعدة معمارية:** الماكينات **مش بتكتب في قاعدة البيانات مباشرة أبدًا**. في عملية
منفصلة اسمها **Edge Gateway** بتقرا الإشارات، بتلخصها (مثلًا: عداد كل 10 ثواني
بدل كل نبضة، وحالة تشغيل/توقف عند التغير بس)، وبتبعتها للنواة كـ**أحداث** عبر
نفس الـAPI اللي الإنسان بيستخدمه. كده الماكينة = "مشغّل آلي" بيتحاسب بنفس القواعد،
والنواة مش بتغرق في آلاف القراءات في الثانية.

---

## المصادر
- [Samsung SDS — Nexplant MES](https://www.samsungsds.com/global/en/solutions/off/mes/nexplant_mes.html)
- [Samsung SDS — Samsung Nexplant (Intelligent factory)](https://www.samsungsds.com/global/en/solutions/off/np/Samsung_Nexplant.html)
- [Gartner Peer Insights — Critical Manufacturing vs Nexplant](https://www.gartner.com/reviews/market/manufacturing-execution-systems/compare/product/critical-manufacturing-mes-vs-samsung-sds-nexplant)
- [ISA — Advancements in ISA-95 (Operations Event Model)](https://www.isa.org/intech-home/2017/january-february/features/advancements-in-isa-95)
- [ISA — ISA-95 evolves to support smart manufacturing and IIoT](https://www.isa.org/intech-home/2017/november-december/features/isa-95-to-support-smart-manufacturing-iiot)
- [OPC Foundation — OPC UA for ISA-95 Part 4: Job Control](https://reference.opcfoundation.org/ISA95JOBCONTROL/v200/docs/4)
- [Wikipedia — ANSI/ISA-95](https://en.wikipedia.org/wiki/ANSI/ISA-95)
- [GitHub — factorysemantics-mes](https://github.com/factorysemantics/factorysemantics-mes)
- [GitHub — OpenMES](https://github.com/Mes-Open/OpenMes)
- [GitHub topic — mes](https://github.com/topics/mes)
- [MDCplus — Top Free & Open-Source MES 2026](https://mdcplus.fi/blog/top-free-mes-systems-manufacturing-execution/)
- [ERP Focus — open-source manufacturing software comparison](https://www.erpfocus.com/open-source-manufacturing-software-comparison.html)
- [Bugsink — Single-writer architecture with SQLite](https://www.bugsink.com/blog/database-transactions/)
- [SQLite concurrent writes and "database is locked"](https://tenthousandmeters.com/blog/sqlite-concurrent-writes-and-database-is-locked-errors/)
- [Oldmoe — Concurrent write transactions in SQLite](https://oldmoe.blog/2024/07/08/the-write-stuff-concurrent-write-transactions-in-sqlite/)
- [HiveMQ — OPC UA vs MQTT Sparkplug](https://www.hivemq.com/blog/iiot-protocols-opcua-vs-mqtt-sparkplug-digital-transformation/)
- [FlowFuse — MQTT vs OPC UA (2026)](https://flowfuse.com/blog/2026/01/opcua-vs-mqtt/)
- خبرة مباشرة: `coolman1984/opening-nerp-tcode` — `GMES_SKILL.md` و `HISTORY.md`
