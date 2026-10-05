# Sorting, seating and import/export verification

Verified on 6 October 2026 against the current working tree. No application code or existing tests were changed. New verification scripts and generated files are in the ignored `artifacts/` directory.

## Conclusion

One sorting round-trip defect was reproduced. The surname comparator behaves consistently in the tested cases, and the tested seating plans satisfy structural and pin/capacity invariants. However, full-name-only exports discard explicit first/surname fields, so re-importing can change the surname used for sorting.

This verification does not establish that every possible project or seating-rule combination is bug-free. The seating solver uses bounded improvement/search; passing these checks does not establish a globally optimal solution for every large constraint set.

## S1 — P2: Full-name-only Excel/CSV round trips change surname sorting

Sources: `src/student-import.mjs:88`, `src/student-import.mjs:118`, `src/excel-export.mjs:12`, `src/app.mjs:921`.

Importing explicit Voornaam/Achternaam stores those fields. Export with only Naam, Klas and Leerjaar omits them. Re-import creates pupils without the explicit split fields; `studentNameParts` then assumes the first word is the first name and every subsequent word belongs to the surname. Compound first names consequently change the sorting key.

Reproduced with:

| Voornaam | Achternaam | Full name |
| --- | --- | --- |
| Anne Marie | Zulu | Anne Marie Zulu |
| Bob | Taylor | Bob Taylor |

Original order is **Bob Taylor, Anne Marie Zulu**. After either an Excel or CSV round trip, order becomes **Anne Marie Zulu, Bob Taylor**, because the re-imported surname is inferred as **Marie Zulu**. The displayed full names are unchanged, so this metadata loss can go unnoticed.

The supplemental Electron test generated a real workbook, parsed it through the app's XLSX reader and student importer, and compared the before/after order. It also reproduced the CSV branch's current quoting/schema and parsed that output. Results are retained in `artifacts/import-export-verification-results.json`.

### Recommendation and current workaround

Preserve explicit first/surname columns when exporting a roster for re-import, or make the full-name-only export's loss of structured names clear. Arbitrary compound names cannot be reliably split from a full name alone.

The existing Excel column picker already supports **Voornaam + Achternaam + Klas**, with Leerjaar and schedule columns as needed. Those explicit-name exports passed the round-trip checks. This recommendation does not require the separate extra Excel format intentionally omitted by the user. Full-project JSON preserves structured names and remains the appropriate complete project backup. CSV currently offers no split-name column choice.

## Verification performed

### Name comparison and text import

- 6,400 comparator pairs: antisymmetry checks passed.
- 10,000 sampled triples: transitivity checks passed.
- Existing unit cases for accents, compound surnames, first-name tie-breaking, mononyms, numeric name components, per-class grouping and weekly day order passed.
- 100 text round-trip fixtures, each containing 12 pupils: explicit name fields, semicolons, quotes, embedded line breaks, manual years and Ja/Nee/empty schedules were preserved after the importer's normal trimming.

These checks establish consistent comparison behavior for the supplied names; they cannot resolve missing surname metadata in S1.

### Seating generation

120 additional varied fixtures passed for random and ordered generation. Cases varied pupil counts, capacity, planning absences, directions, seat side, class restrictions, and a special `__proto__` pupil ID.

Assertions checked:

- No duplicate pupil placements or foreign/absent pupils.
- Only enabled valid seats used.
- Maximum available seating cardinality in the supplied fixtures.
- Existing pupil pin preserved.
- Ordered generation repeatable.
- Generation did not mutate the input state.
- Generated room/project state passed validation.
- Ordered seat enumeration covered exactly the enabled seats.
- Export did not mutate the source or lose active roster rows in the supplied all-room fixtures.

The ordinary regression suite additionally covers personal rules, overflow repair, exact small searches, fixed positions, disabled seats, multi-room constraints and weekly preferences. The desktop Auto and weekly tests passed their actual worker/day-switch/download flows.

### XLSX round trips and independent verification

24 additional workbook cases round-tripped 600 pupil records using explicit name columns. Variants covered combined/per-class sheets, alternate column layouts, manual year overrides, schedules, accented/Chinese/emoji text, quotes, semicolons, line breaks and XML-sensitive characters. Class labels included invalid worksheet characters, colliding sanitized names and names longer than Excel's worksheet-name limit.

Checks confirmed preserved fields, unique pupil counts, sorted data rows, valid worksheet reads and no source mutation.

An independent Openpyxl reader verified both a combined workbook and a six-sheet workbook with 25 pupils. ZIP CRCs passed; names, split fields, class, year and schedules matched the source. The combined file was also checked for literal non-formula cells. The six-sheet file had tables and unique valid worksheet names, including separate sanitized collision names `3A B` and `3A B (2)`.

This independent reader check complements the app's own writer/reader tests. It does not substitute for Microsoft Excel's own UI/rendering.

### Existing suites rerun

- `npm test`: **560 passed**, zero failed/skipped/cancelled.
- `npm run check`: passed.
- Desktop Auto distribution, weekly planning, Excel and export suites: passed.
- Electron test processes used `--disable-gpu --no-sandbox`; source sandbox configuration was unchanged.

## Calendar status and test reliability

The previously reported Niet verwacht issue has been fixed in the code present during this verification. A direct reproduction now returns one present pupil and one unexpected pupil; calendar export labels them Aanwezig and Niet verwacht respectively. The full suite now includes expected-attendance regression tests.

The unmodified calendar desktop test was also attempted after the local date changed to 6 October. It fails at `tests/desktop-calendar.cjs:44` because it expects the real Today badge to be **2026-10-05**, while the app correctly shows **2026-10-06**. This is a brittle test-clock assumption, not evidence that the app has selected the wrong current date. A copy under `artifacts/calendar-frozen-verification.cjs`, with the initial renderer clock frozen to the fixture date and its own profile, passed the full calendar suite. Its later explicit simulated midnight/date changes remained active. Existing test source was not edited. A test using fixed fixture dates should freeze its initial clock or assert a dynamically derived current date.

## Retained supplemental artifacts

- `artifacts/sorting-seating-verification.mjs`: comparator, text-import and seating checks.
- `artifacts/import-export-verification.cjs`: browser-runtime XLSX round trips and S1 reproduction.
- `artifacts/import-export-verification-results.json`: counts and changed sorting order.
- `artifacts/verification-independent.xlsx` and matching expected JSON: final six-sheet independent-reader fixture.

The extra complete-roster Excel format remains intentionally out of scope. Importing a pupil roster is not a lossless replacement for full-project JSON: student IDs, seating, pins, historical attendance and rules require the complete project format. None of the checks claim an exhaustive guarantee for arbitrary input sizes, corrupted archives, or all solver configurations.
