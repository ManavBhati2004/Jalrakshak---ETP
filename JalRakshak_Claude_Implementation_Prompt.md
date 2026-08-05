# Claude Code Prompt — JalRakshak ETP Portal Updates

You are a senior full-stack engineer working inside the **existing JalRakshak ETP Portal repository**.

## Primary objective

Implement the requirements in the attached document:

- **File:** `JalRakshak Required Updates Fateh Enterprises.pdf`
- **Document No.:** `FE/CR/JALRAKSHAK/001`
- **Revision:** `R2`
- **Main route to update:** `/dashboard/etp-entry`
- **Dependent registration route:** locate the existing first-time unit-registration route/component, currently exposed publicly as `/register`
- **Live reference:** `https://jalrakshak-etp-psi.vercel.app`

The main daily form must be updated without breaking or unnecessarily changing its current business logic, navigation, authentication, role permissions, save/edit behaviour, visual language, or existing data.

## Non-negotiable interpretation rule

Preserve every existing behaviour that is not explicitly replaced or extended by the PDF.

Where the PDF intentionally changes an existing behaviour, the PDF is authoritative. In particular:

- The existing single water value per stream is intentionally replaced by **Initial Reading + Final Reading + Total**.
- The existing `Sludge sent to TSDF (KL)` input is intentionally removed from the new-entry UI and replaced by kilogram-based stock ledgers.
- Energy entry is intentionally added as a new section.
- The operator must still use **one daily entry screen**, not several separate routes.

Do not use “preserve current logic” as a reason to ignore these explicit changes. Conversely, do not use this update as an opportunity for a general rewrite.

---

# 1. Mandatory audit before editing

First inspect the repository and trace the current feature end to end. Do not assume the framework, database, form library, validation library, or PDF library.

Locate and document:

1. The page/route and component tree for `/dashboard/etp-entry`.
2. The current date-selection and daily-entry workflow.
3. Current water-stream field identifiers, labels, default values, calculations, validation, and save/edit behaviour.
4. The existing `Sludge sent to TSDF (KL)` field and every place where it is stored, read, displayed, exported, or reported.
5. The registration form, validation schema, API/server action, database model, and authentication flow.
6. API routes/server actions, request/response types, database tables/collections, migrations, and report queries involved in ETP entries.
7. Existing print/PDF generation code and any RSPCB-oriented reports.
8. Existing tests, fixtures, seed users, demo data, and browser-testing setup.

Before changing code, create a concise implementation plan containing:

- Current behaviour that must remain unchanged.
- PDF-required behaviour that must replace or extend it.
- Files/components/schema objects to be changed.
- Database migration strategy.
- Backward-compatibility risks.
- Testing plan.

Then implement the work. Do not stop after the plan unless a destructive migration or a truly unresolved regulatory requirement makes implementation unsafe.

## Characterisation tests

Before refactoring existing logic, add or preserve tests that characterise the current valid behaviour of the daily-entry form. Use those tests as non-regression protection. Modify expectations only where the PDF explicitly changes the behaviour.

---

# 2. Global non-regression constraints

Do **not** change any of the following unless strictly required for this specification:

- Existing route URLs.
- Authentication/session logic.
- User roles or permissions.
- Dashboard navigation/sidebar structure.
- Unit ownership and tenant scoping.
- Existing date/time-zone handling.
- Existing save, edit, loading, error, toast, and success patterns.
- Unrelated dashboard cards, analytics, alerts, pages, or APIs.
- Existing design system, component library, typography, spacing, and colour language.
- Existing API response fields used elsewhere.

Prefer additive, localised changes over a broad re-architecture. Reuse existing components and coding conventions.

Do not hard-code a unit ID, user ID, date, demo credential, database record ID, or environment-specific URL.

Do not write test data into the production deployment. Use the local environment, test database, seeded fixtures, or a preview deployment.

---

# 3. Registration form updates

The registration changes are required because the sludge-warning logic depends on the registered hazardous-waste authorisation quantity.

Add the following sections and reproduce the required field labels **verbatim** in the user interface and regulator-facing output.

## A. Unit details

- `Name of unit`
- `Address`
- `Tehsil`
- `District`
- `MIS ID` — mandatory
- `Email`
- `Mobile`

### Existing-field compatibility

- If the current code uses fields such as `Company Name`, `Owner Name`, `Area / Location`, or `Consent Number`, do not destructively rename or delete stored data.
- Map the existing company/unit-name field to the required display label `Name of unit` while preserving the current underlying identifier wherever practical.
- Keep existing internal fields such as owner name or area/location only when current logic depends on them. Do not include them in the prescribed regulatory output unless required elsewhere.
- Do not alter password creation or registration-to-login behaviour.

## B. Consent details

- `Consent Order No.`
- `Consent order date`
- `Consent validity` with a from date and a to date

Validate that the validity-to date is not earlier than the validity-from date, using the project’s existing validation style.

## C. Hazardous waste details — new section

- `HWM Authorization No.`
- `Authorization order date`
- `Authorization validity` with a from date and a to date
- `Authorised quantity (kg)`
- `TSDF name and full address`

### Authorised-quantity handling

- Store the canonical quantity in kilograms.
- Support certificates stated in either kg or MT using the least disruptive UI consistent with the current form, such as a small source-unit selector.
- When MT is selected, convert to kg using `kg = MT × 1000` before persistence.
- Display the converted kilogram value clearly before submission.
- Do not store an ambiguous quantity without its canonical unit.

Validate that the authorisation-validity-to date is not earlier than the authorisation-validity-from date.

## D. Authorised signatory

- `Name of authorised signatory`
- `Designation`

## E. Plant capacity — all in KLD

- `ETP capacity`
- `Maximum effluent generation`
- `RO Stage I`
- `RO Stage II`
- `RO Stage III`
- `RO Stage IV`
- `MEE capacity`

Reuse and map the existing capacity fields rather than creating duplicate storage where the same data already exists.

---

# 4. `/dashboard/etp-entry`: retain one daily entry screen

Water, electricity, ETP sludge, and MEE salt must be entered on the **same route and same daily workflow**.

Do not create separate routes such as `/water-entry`, `/energy-entry`, or `/sludge-entry`.

It is acceptable to use cards, accordions, or clearly separated sections within the existing form, provided that:

- The operator remains on `/dashboard/etp-entry`.
- All sections share the same selected unit/date context.
- The existing submit/save workflow remains coherent.
- Required validation prevents an invalid complete submission.

Extend the current form rather than replacing it with an unrelated new implementation.

---

# 5. Daily water entry

Each water meter must contain:

- `Initial Reading`
- `Final Reading`
- `Total`

Use `M3` as the displayed unit required by the brief.

## Exact water-meter labels

Keep these labels exactly as written:

1. `Raw Fresh Water / Fresh Water Input`
2. `ETP inlet Section-Total of all stream`
3. `ETP Treated directly Reuse`
4. `Tertiary Treated Section-Total`
5. `RO Section Total Feed`
6. `Total RO permeate Common Meter`
7. `RO Reject Section-Total`
8. `MEE Feed Section Total`
9. `Total MEE Condensate / MEE Condensate Reuse`
10. `MEE Reject Section Total`

Meters 1, 2, 3, 5, 6, and 7 are existing streams. Preserve their current internal identifiers and historical data wherever possible.

Meters 4, 8, 9, and 10 are new. Add stable internal keys for them without using the long display labels as database identifiers.

## Water calculation and validation rules

For every meter:

- `Total = Final Reading - Initial Reading`.
- Total must update automatically as the operator types.
- Total is read-only and must not be directly editable.
- On a new date, the previous day’s saved `Final Reading` must automatically populate the current day’s `Initial Reading` for the same unit and meter.
- Do not overwrite an already saved Initial Reading while editing an existing record.
- If no prior entry exists, preserve the application’s current first-entry/default behaviour; do not invent a historical reading.
- If Final Reading is less than Initial Reading, show an inline validation error and prevent saving.
- Preserve the current numeric precision unless the existing specification already defines it.
- Reject invalid non-numeric or non-finite values using the project’s existing validation pattern.

## Water grand total

Add a read-only `Grand Total` that automatically sums the ten meter totals for the selected day.

Keep the calculation centralised in a pure helper/function and cover it with unit tests.

## Water remark

Add a daily `Remark` field after the Grand Total so the operator can record entries such as shutdown, meter out of order, power failure, maintenance, or no production.

The remark must be stored and must appear in printed and PDF output.

---

# 6. Daily electricity/energy entry — new section

Add an energy section to the same `/dashboard/etp-entry` screen.

Each energy meter must use the same structure and behaviour as the water readings:

- `Initial Reading`
- `Final Reading`
- `Total`
- Automatic total calculation.
- Read-only Total.
- Previous-day Final Reading carried to the next day’s Initial Reading.
- Saving blocked when Final Reading is less than Initial Reading.
- Existing-entry edit protection so a stored Initial Reading is not unexpectedly overwritten.

Use kWh as the canonical unit. The regulator-facing table in the PDF writes the unit as `Kwh`; do not silently change regulator-facing text if the existing print template expects that exact spelling.

## Exact energy-meter labels

1. `ETP inlet Section-Total of all stream`
2. `RO Reject Section-Total`
3. `MEE Reject Section Total`

Add a daily `Remark` field and include it in storage, print, and PDF output.

Do not add an energy grand total unless an existing report/template already requires it; the supplied brief does not explicitly request one.

---

# 7. Daily ETP sludge ledger — replace the current KL input

Remove the existing `Sludge sent to TSDF (KL)` field from the new-entry user interface.

Do not destructively drop its historical database data during this change. A volume in KL cannot be converted to kg without a verified density/conversion basis. Retain the legacy field/data for audit or backward compatibility, but do not fabricate kilogram values from it.

Create a day-wise ledger for ETP sludge with these exact columns:

1. `Opening Balance in kg`
2. `Sludge Generation in kg`
3. `Date of disposal`
4. `Sludge Dispatch / Disposal in kg`
5. `Manifest No.`
6. `Closing Balance in kg`
7. `Remark`

## Sludge rules

- `Closing Balance = Opening Balance + Sludge Generation - Sludge Dispatch / Disposal`.
- Opening Balance is automatically carried from the previous day’s Closing Balance.
- The next month’s first entry carries the previous month’s final Closing Balance.
- Closing Balance is read-only and automatically calculated.
- Store/display quantities in kg to one decimal place.
- When dispatch is greater than zero, both `Manifest No.` and `Date of disposal` are mandatory.
- If either required disposal field is missing, show an inline error and prevent saving.
- Preserve existing non-negative/value validation conventions. Do not introduce unrelated regulatory rules that are not in the brief.
- Do not overwrite an already saved Opening Balance while editing an existing entry.

## Authorised-quantity warning

Calculate cumulative dispatch against the registered `Authorised quantity (kg)` and display a clear, non-blocking warning when the configured warning threshold is reached.

Prefer the active HWM authorisation validity period when determining the cumulative period, unless the existing domain model already defines another period.

The PDF uses the word “approaches” but does not define a percentage. Therefore:

1. First search the repository/configuration for an existing compliance-warning threshold.
2. If one exists, reuse it.
3. If none exists, introduce one named central configuration value, for example `AUTHORISED_QUANTITY_WARNING_PERCENT`.
4. Use **80% only as a temporary, clearly documented default**, not as an unlabelled magic number.
5. Report this assumption prominently in the completion summary so the product owner can confirm or change it.
6. At or above 100%, show a stronger warning, but do not block save unless existing business rules already do so.

---

# 8. MEE salt ledger — new second ledger

Under the sludge section, add an identical seven-column ledger with the exact heading:

`ATFD Salt (MEE Section) / PAN Salt (MEE)`

Use the same columns, formula, carry-forward behaviour, one-decimal precision, disposal validation, edit protection, storage, and print/PDF support as the ETP sludge ledger.

Do not invent a second authorised-quantity field unless the existing domain model or registration documents already support a separate limit. Document whether the warning is applied per stream or against a combined authorised quantity.

---

# 9. Carry-forward implementation requirements

Carry-forward logic must be scoped by the correct industry/unit and meter/ledger type.

For a newly created daily record:

- Water Initial Reading comes from the corresponding previous saved Final Reading.
- Energy Initial Reading comes from the corresponding previous saved Final Reading.
- Sludge Opening Balance comes from the previous saved Closing Balance.
- MEE salt Opening Balance comes from the previous saved Closing Balance.

Do not carry values across different units/tenants.

Use the existing previous-entry/date-resolution convention. If the repository has no such convention, use the most recent prior saved entry for the same unit and stream, and document this behaviour. Never fabricate a carry-forward value when no prior record exists.

Ensure carry-forward works across month and year boundaries.

If an earlier historical entry is edited, do not silently rewrite all subsequent records unless the current application already supports cascade recalculation. Detect and surface continuity mismatches rather than performing an undocumented bulk mutation.

---

# 10. Data model and migration safety

Use the project’s existing database and migration conventions.

Requirements:

- Make migrations additive, reversible where practical, and safe for existing production records.
- Preserve current primary keys, unit relationships, tenant scoping, timestamps, and audit metadata.
- Prefer nullable/default-safe new columns for historical rows, while enforcing the new required rules for new submissions at the application layer and, where safe, at the database layer.
- Keep existing API fields available if other pages depend on them.
- Extend request/response types rather than silently breaking consumers.
- Use canonical units in storage: water in M3, energy in kWh, sludge/salt in kg, authorised quantity in kg.
- Keep display labels separate from stable internal keys.
- Prevent duplicate daily records according to the application’s current unit/date uniqueness logic.
- Preserve transaction/atomicity behaviour. Do not create a state where water saves but energy/sludge silently fails if the existing form is intended to save as one daily submission.

## Historical water data

Do not fabricate Initial and Final readings for old records that only contain a single total/value.

Preserve the legacy value as historical total data or in the existing legacy field. Update readers/reports so historical records remain viewable without pretending that unavailable meter readings existed.

## Historical KL sludge data

Retain it as legacy volume data. Do not convert KL to kg without an approved density/conversion rule.

---

# 11. UI/UX requirements

Preserve the current JalRakshak visual design and existing component system.

The form must remain practical for an ETP operator:

- Clear section headings for Water, Electricity/Energy, ETP Sludge, and MEE Salt.
- Exact regulator-required labels.
- Read-only calculated fields visually distinguishable from editable fields.
- Inline validation close to the relevant input.
- Clear units beside fields.
- Responsive behaviour for desktop/tablet and usable horizontal scrolling where a table cannot fit.
- Existing loading, disabled-submit, success, and error behaviour retained.
- Keyboard navigation and accessible labels retained or improved.

Do not redesign the whole dashboard.

---

# 12. Printed output and PDF

Keep a single daily entry screen, but update the existing print/PDF output to produce separate regulator-facing sheets:

- **Two water sheets**.
- **One energy sheet**.
- **One sludge sheet**, containing both the ETP sludge ledger and the `ATFD Salt (MEE Section) / PAN Salt (MEE)` ledger.

Requirements:

- Reproduce all prescribed labels verbatim.
- Show the correct units.
- Include the Water Remark and Energy Remark.
- Include sludge and salt remarks, disposal dates, manifest numbers, opening balances, and closing balances.
- Preserve page headers, unit identity, MIS ID, reporting period, and existing report metadata where already implemented.
- Ensure tables do not clip, overlap, or omit fields in print/PDF.
- Do not implement unrelated monthly-compliance calculations whose specification has not yet been supplied.

## Water-sheet grouping assumption

The supplied PDF requires two water sheets but does not state how the ten meters are split.

1. First inspect existing report templates or RSPCB reference assets in the repository.
2. If a grouping exists, use it.
3. If none exists, use meters 1–5 on Water Sheet 1 and meters 6–10 on Water Sheet 2 as a **temporary, centrally configured and clearly documented assumption**.
4. Report this assumption in the final completion summary.

---

# 13. Validation and calculation test cases

At minimum, add automated tests for the following:

## Water

- Previous Final = 125.4; new Final = 130.2; calculated Total = 4.8.
- Total cannot be typed into directly.
- Final below Initial blocks save.
- New day receives previous saved Final as Initial.
- Editing an existing day does not overwrite its stored Initial.
- Grand Total equals the sum of all ten water totals.
- All four new meters persist and reload correctly.
- Remark persists and appears in print/PDF data.

## Energy

- Same calculation, read-only, validation, carry-forward, persistence, and edit-protection tests.
- All three energy meters and the remark persist and reload.

## ETP sludge

- Opening 100.0 + Generation 20.5 - Dispatch 5.0 = Closing 115.5.
- Closing is read-only.
- Dispatch greater than zero without Manifest No. blocks save.
- Dispatch greater than zero without Date of disposal blocks save.
- Next day and next month receive previous Closing Balance.
- Quantities round/display to one decimal place without corrupting stored values.
- Authorised-quantity warning appears at the configured threshold.

## MEE salt

- Same formula, carry-forward, validation, persistence, and edit-protection tests as sludge.

## Registration

- MIS ID is mandatory.
- Consent and authorisation date ranges validate correctly.
- 1.25 MT is stored as 1250 kg.
- Existing unit/capacity data remains readable after migration.

## Non-regression

- Existing login and role access still work.
- Existing ETP entries remain viewable.
- Existing valid form submission behaviour not explicitly changed by the PDF remains intact.
- Build, type-check, lint, unit tests, integration tests, and any existing E2E suite pass.

---

# 14. Completion requirements

Do not claim completion until you have:

1. Implemented the UI changes.
2. Implemented schema/database migrations.
3. Updated validation and calculations.
4. Updated save/load/edit APIs or server actions.
5. Added carry-forward logic.
6. Updated print/PDF output.
7. Added/updated tests.
8. Run the project’s build, type-check, lint, and test commands.
9. Visually tested `/dashboard/etp-entry` locally or in a preview deployment.
10. Verified that no production data was modified during testing.

At the end, provide:

- A concise before/after behaviour matrix.
- Exact files changed.
- Migration names and rollback notes.
- Tests added and command results.
- Any unresolved requirement.
- The two explicit implementation assumptions, if they were needed:
  - Authorised-quantity warning threshold.
  - Grouping of ten meters across two water sheets.
- A short manual QA checklist for the product owner.

Do not provide only sample code or high-level advice. Make the actual repository changes while keeping the scope tightly limited to this specification.
