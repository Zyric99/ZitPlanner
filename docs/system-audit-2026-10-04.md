# Seating algorithm and import/export audit

Date: 4 October 2026. Reviewed the current working tree at commit `c84129b`, including the existing uncommitted changes in `src/app.mjs`, `src/auto-distribution.mjs`, and their two modified tests.

This was an audit. Application code, existing tests, and saved user projects were not changed. Synthetic test files and temporary adapted tests are in `artifacts/audit-2026-10-04/`. The observations below describe this working tree, not necessarily the packaged release.

## Overall assessment

Ordinary planning and the main Excel machinery work well in the exercised cases. All 458 unit tests and the syntax checks pass. The bundled standard project with 180 students seats everyone exactly once with no warnings, and both supplied Excel examples import successfully.

The review nevertheless found important gaps in the default Excel workflow and several algorithm edge cases. Default seating exports cannot be re-imported, default all-room/week exports omit necessary context, and manually corrected years are lost on Excel/CSV re-import. The algorithm also excludes waiting students from seating repair, and the same-area rule has no effect within custom layouts. Valid externally supplied student IDs can break automatic planning.

Priority labels below indicate recommended repair order, not a claim that all normal projects are affected.

## Confirmed findings

### F1. Default seating Excel export cannot be re-imported

**Priority: high.** Affects the default Excel seating workflow.

The real export dialog initially selects only `Naam` and `Plaats`. The student importer requires `Klas` when it sees a name header. Class-based worksheet names do not supply that missing column.

**Reproduction:** Export two students in classes `1A` and `2B` using the unchanged dialog defaults. Re-import the downloaded file. Both worksheets are skipped with `Ontbrekende kolommen: Klas`, and zero students are imported. This was tested through an actual download, not just a direct call to the export module.

**Cause:** The UI's defaults differ from the export module's defaults. Module tests exercising `seatingWorkbook(state)` get four columns, whereas users get two.

**Recommendation:** Default to `Naam`, `Klas`, `Leerjaar`, and `Plaats`; retain optional column removal for presentation exports. Explicitly warn when a chosen export lacks fields needed for re-import. Do not automatically trust a worksheet title as a class because titles are sanitized, truncated, and made unique.

**Code:** [Dialog defaults](../src/app.mjs#L748), [required import columns](../src/student-import.mjs#L61).

### F2. All-room and weekly Excel defaults omit room/day context

**Priority: high for weekly exports; medium for all-room exports.**

Changing the export scope preserves the same default `Naam`/`Plaats` selection. `Lokaal` and `Dag` stay unchecked.

**Reproduction:** Place one student at `A1` in each of two rooms and export all rooms. Both rows say `A1`, without identifying their rooms. Export an existing week for these students. The result contains eight rows, but no day column; repeated rows cannot be assigned reliably to Monday, Tuesday, Thursday, or Friday. Sorting by student compounds the ambiguity when attendance differs between students.

**Recommendation:** Select `Lokaal` by default for all-room scope, and both `Dag` and `Lokaal` for weekly scope. Track an explicit user decision to deselect them separately from the initial defaults. An optional confirmation or inline warning is appropriate when these identifying fields are deliberately omitted.

**Code:** [Scope and column choices](../src/app.mjs#L748), [module column definitions](../src/excel-export.mjs#L18).

### F3. Over-capacity planning cannot improve which students receive seats

**Priority: medium.** Affects single-room generation and the single-room Auto path.

When capacity is insufficient, generation selects a subset of students, then moves and swaps only students already placed. Waiting students never enter the repair search. Even the small exhaustive search derives its student IDs exclusively from current assignments.

**Reproduction:** One two-seat bank; students A and B are in class `1A`, and C is in `2B`. Enable the compulsory class rule `Niet aan dezelfde bank`. Ordered generation seats A and B together and leaves C waiting, with compulsory cost 1. Seating A and C instead still places two students and leaves one waiting, but compulsory cost becomes 0. The algorithm cannot make that substitution. Single-room Auto also reproduced the worse result with seeded random inputs 100000 and 1000000.

This is stronger evidence than an arbitrary heuristic miss: the useful move is absent from the candidate set. The capacity warning itself is legitimate and remains visible.

**Recommendation:** Include waiting-to-seated replacements in the neighborhood search, while retaining the first objective of seating as many students as possible. Apply the same priority comparison after student substitutions, preserve mandatory locations, and establish a clear policy for which students remain waiting. Review unresolved personal-rule scoring as well: missing members currently produce detailed warnings without a corresponding relationship cost, so the optimizer and warning list do not fully align in overflow cases.

**Code:** [Initial subset](../src/engine.mjs#L362), [repair search IDs](../src/engine.mjs#L412), [single-room Auto skips room search](../src/auto-distribution.mjs#L145).

### F4. Same-area rule is ineffective within custom layouts

**Priority: medium.** This is a functional gap in the rule exposed as `In hetzelfde gebied`.

Every custom-layout bench is assigned `area: 'Lokaal'`. The area rule compares only that property, so any two students in one custom room satisfy it, even when their tables belong to separate named sections.

**Reproduction:** Create sections `Extra` and `Computers`, place one student in each, and add a compulsory same-area rule. Both benches report `Lokaal`, required cost is zero, and there is no warning. The constructed layout passes layout validation.

The cross-room part of this rule does work: splitting students between rooms produces a warning. The missing behavior is any distinction between areas inside a custom room. Existing grid sections are otherwise described as visual, so the desired meaning should be made explicit.

**Recommendation:** Either give the rule genuine region identities, with a documented mapping from tables to regions, or rename/document it as a same-room rule. If named sections are intended to be areas, use section IDs rather than names and decide the region for ordinary grid tables.

**Code:** [Custom bench areas](../src/layout.mjs#L26), [area comparison](../src/engine.mjs#L203).

### F5. Accepted external student IDs can crash Auto or leave students unplaced

**Priority: medium; uncommon with app-created data.** Affects externally constructed JSON projects. Excel imports generate UUIDs and do not normally encounter this problem.

Student IDs `constructor`, `toString`, and `__proto__` pass project validation. Some room/pin/distribution lookups still use ordinary objects without checking whether the requested property is an own property.

**Reproduction:** A valid one-student project with available seats and no rules:

| Student ID | Auto outcome |
| --- | --- |
| `constructor` | Throws: `function Object() { [native code] } could not be cloned.` |
| `toString` | Throws: `function toString() { [native code] } could not be cloned.` |
| `__proto__` | Returns zero seated students despite ample capacity. |

Inherited values are mistakenly treated as room pins or existing assignments. The engine's Map-based student evaluation protects a different part of the system; it does not solve these room lookups.

**Recommendation:** Use Maps, null-prototype objects, or `Object.hasOwn` consistently for ID-indexed records. Test imported IDs through normalization, distribution, Auto, weekly planning, and persistence, rather than only through seat evaluation.

**Code:** [Auto pin lookup](../src/auto-distribution.mjs#L93), [location lookup](../src/rooms.mjs#L32), [distribution records](../src/rooms.mjs#L151).

### F6. Conflicting full/split name columns create inconsistent student records

**Priority: low.** Affects externally edited Excel/CSV data containing both forms of a name.

The importer accepts `Naam`, `Achternaam`, and `Voornaam` together without checking their consistency. It keeps `Naam` as the displayed identity and also stores the other two values. Sorting and evening-study export later use the stored split names.

**Reproduction:** Import `Naam=Alice Original`, `Voornaam=Bob`, `Achternaam=Different`, `Klas=1A`. No error is reported. The student's displayed name is Alice Original, but split-name/attendance exports identify Bob Different.

**Recommendation:** Choose and document one authoritative name representation, derive the other, or show an import conflict that the user can resolve. Avoid storing contradictory representations silently.

**Code:** [Name parsing and stored fields](../src/student-import.mjs#L69).

## Excel/CSV round-trip limitations and intentional behavior

### Manually corrected years are lost

This behavior is explicitly enforced by the existing test `every import format uses the first class number instead of a supplied year`. It is an existing product policy, not evidence of an accidental recent regression. It nevertheless makes exports unsuitable for faithfully recovering a roster with corrected years.

**Verified example:** A student in class `1A` with manually corrected year `3` exports as `3`. The seating Excel file and CSV both re-import as year `1`, with no warning. For a class without a number, even an exported valid year is ignored and manual correction is requested again. The evening-study format has no year column at all.

**Recommendation:** Preserve valid supplied years as class-scoped manual overrides, or offer an explicit choice between imported years and class-derived years. If class-derived years must remain mandatory, make the loss visible during import. JSON export/import already preserves the correction and is the appropriate backup route today.

**Code:** [Year inference during import](../src/student-import.mjs#L71), [policy regression test](../tests/student-import.test.mjs#L35).

### Excel import restores a roster, not a seating project

Even when `Klas`, `Leerjaar`, `Lokaal`, and `Plaats` are present, student import creates new IDs and does not restore memberships, seats, rules, layouts, or pins. Replacing a roster deliberately clears existing placements and student rules. Ordinary seating Excel export excludes absent students; evening-study export includes the roster and attendance fields. Manual absence flags are not restored by roster import.

Weekly Excel with all identifying columns imports only the unique student roster: additional day rows are reported as duplicates. It does not reconstruct attendance or the saved week.

These are format-scope limitations rather than malformed XLSX files. Explain them in the export/import UI. A future seating import would need stable student identifiers, explicit room/seat mapping, and validation before application; names alone are insufficient.

### Compatibility boundaries

The picker supports `.xlsx`, `.csv`, `.tsv`, and `.txt`, not old binary `.xls`. The XLSX reader has a 32 MB compressed and declared expanded-data limit and a 100,000-row per-sheet limit. Formula cells require a saved cached value; Excel error cells reject the affected worksheet. The reader does not evaluate formulas or apply Excel display formatting to raw numeric values. Class identifiers should therefore be stored as text in source workbooks.

One malformed worksheet can be skipped while valid worksheets import, with a report naming the skipped sheet. Re-import is therefore not necessarily an all-or-nothing operation; users should review the preview before replacing a roster.

## What passed

| Area | Evidence and result |
| --- | --- |
| Unit regression suite | `npm test`: 458 passed, zero failed/skipped. |
| Syntax | `npm run check`: passed. |
| Standard project | 180 students, one room, zero personal rules; all seated exactly once, zero warnings, valid result, input unmodified. About 8.3 seconds in this environment. This is not a constrained worst-case benchmark. |
| Existing desktop Excel suite | Passed compressed input, actual file selection, previews, persistence, name/attendance edits, attendance round trips, optional class tabs, column selection/order, downloads, and invalid-file handling. |
| Excel examples | Both provided workbooks import: exactly 100 and 180 students, zero parse or year errors. |
| Independent XLSX reader | Openpyxl reads all six seating/study/week audit workbooks; ZIP checksums pass, tables and worksheets are present, and exported cells contain literal text rather than formulas. This complements, rather than substitutes for, native Excel testing. |
| Excel escaping and structure | Existing tests cover accents, XML escaping, leading-zero text, formula-like names stored literally, empty rosters, unique sanitized sheet names, and readable seat codes. |
| Desktop Auto | Existing suite passed the joint worker, visible conflicts, location rules, class locations, search, active tab, autosave/restart, undo, and redo. |
| Desktop UI | Existing suite passed worker generation, single-room isolation, cancelled generation dialog, editing/filtering, menus, and room actions. |
| CSV | Actual file download and roster re-import pass for the audit fixture; manual-year loss is described above. |
| JSON | Actual full-project download validates and imports through the legacy file picker, preserving two rooms, the saved week, and the manual year correction. |
| SVG/PNG | Actual downloads pass: SVG parses without XML errors and includes the student name; PNG is a valid 7488 x 2080 image. The PNG was visually inspected. |
| PDF/print | Actual export-dialog print preparation succeeds. Electron `printToPDF` with the native handler's settings produces a readable one-page A3 landscape PDF containing the student. A rendered page was visually inspected. Native save/print dialogs were stubbed in this test; their interaction and a physical printer were not exercised. |

## Regression test maintenance

Two original desktop tests fail on the current tree, but the failures are stale expectations/interactions rather than confirmed application defects:

1. `tests/desktop-rule-audit.cjs:39` expects two visible warnings after roster replacement. The UI now aggregates multiple unplaced students into one entry. A temporary copy expecting one visible entry passes the remainder of the audit, including compact JSON import, invalid backup rejection, and attendance restoration.
2. `tests/desktop-weekly.cjs:37` expects clicking an occupied seat and then an empty seat to move a student. Current behavior requires `Verplaatsen / wisselen` or dragging. A temporary copy that activates the Move control passes weekly edits, day switching, reload, weekly XLSX download, and attendance checks.

The original tests were left unchanged. Update their expectations/actions and keep direct assertions on underlying student warnings and placement data. Add regression tests for F1-F6 and manual-year round trips. In particular, test the actual dialog defaults, because the current module defaults conceal F1/F2.

Electron initially could not load under the restricted sandbox because runtime processes failed. Retrying the isolated tests outside that sandbox succeeded. That initial runtime failure is not being reported as an application bug.

## Recommended improvements

1. **Repair Excel defaults first:** include class, and scope-specific room/day columns. Separate a presentation export from a roster intended for re-import, with clear descriptions of what each preserves.
2. **Define the round-trip contract:** keep JSON as the full backup format. Decide whether supplied years and existing placements should be importable, and report every intentional loss before application.
3. **Improve the solver's candidate set:** allow waiting-student substitutions, keep priorities lexicographic, and align missing-rule diagnostics with scoring. Add small exhaustive reference cases that compare the solver to a known best result, including overflow.
4. **Clarify areas and harden ID lookup:** give region rules a concrete definition and use safe records consistently across the room pipeline.
5. **Make diagnostics more useful:** show rule/seat conflicts and capacity shortages separately, and keep the language as "best found" unless infeasibility has been proved. The current bounded repair (four passes, finite candidate budget, and small exact search only up to six movable students/twelve seats/50,000 nodes) cannot certify general optimality.
6. **Improve reproducibility and performance evidence:** retain an optional random seed and search statistics with diagnostic exports. Measure realistic constrained 100/180-student, multi-room cases. Consider caching per-student pair costs and incrementally updating scores for moves; repeated full pair evaluation is an obvious profiling target, but a rewrite should be driven by measurements.
7. **Broaden format robustness tests:** cover shuffled headers, mixed sheet formats, contradictory name fields, displayed-vs-raw numeric identifiers, and externally generated workbooks. Consider an import column-mapping preview for unfamiliar school exports.

## Evidence files and limits

Reproductions and machine-readable results are retained in `artifacts/audit-2026-10-04/`: `core-audit.mjs`, `core-findings.json`, `extended-audit.mjs`, `extended-findings.json`, `desktop-audit.cjs`, `desktop-findings.json`, and `independent-findings.json`. Synthetic downloaded workbooks and image/PDF/JSON/CSV files are there as well. Existing suites may also write their usual isolated profiles/screenshots under `artifacts/`.

The audit did not open a user's real project for modification, run Microsoft Excel itself, exercise physical printing/native save-dialog interactions, rebuild/install the packaged application, or prove mathematical optimality for arbitrary constraints. Passing tests demonstrate the exercised paths; the confirmed exceptions above mean import/export and all rule combinations cannot yet be described as universally correct.
