# HISTORY

كل bug أو اكتشاف أو تغيير في قرار يتسجل هنا بالشكل: **Symptom / Cause / Fix / Lesson**.

## Phase 0 — Design (2026-09-27)
- **What:** أول نسخة من وثائق التصميم (`docs/design/01..08`) وسجل القرارات (`docs/adr`).
- **Why:** قرار المالك: لا كود قبل البحث والتصميم.
- **Open:** كل الـADRs "مقترحة" لحد ما تجارب المرحلة 0 (S1–S8) تثبتها بالأرقام.

## Phase E0 — The manufacturing core becomes part of an ecosystem (2026-09-27)
- **Symptom (design gap):** the first design treated manufacturing as a standalone program. The owner's
  other systems (Mizan accounting, Space Planner 3D, BAMS, G-MES automation) would each keep their own copy
  of items, warehouses, people and stations.
- **Discovery:** studied every branch of the four repositories. `Mr.Ayman-HR` is BAMS (break-area
  management), not HR: nobody owns people/shifts/attendance today. Mizan and Space Planner are TypeScript
  on Node with local SQLite. Space Planner's server accepts 127.0.0.1 only, on purpose. Mizan already
  exposes everything a first integration needs (stock adjustments with a counter account and a reference).
- **Fix:** ecosystem documents E1–E7 (ownership, contracts, identity, scenarios, risks, reuse); ADR-014..020
  (TypeScript; no multi-writer merge for production; feed/inbox/acks; global ids; ×1000 quantities;
  interim costing through Mizan adjustments; Mizan's AppModule shape). Design docs 01/03/04/08 amended in place.
- **Lesson:** read the neighbours before designing a piece: the real names, stacks and gaps of the other
  systems changed the language, the id scheme, the quantity scale and the integration style.
