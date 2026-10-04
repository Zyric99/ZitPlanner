# Verification of audit fixes

Checked on 4 October 2026 against the current uncommitted working tree at base commit `c84129b`. This verifies the changes currently in the source checkout; it does not verify a rebuilt installer.

## Result

The fixes address the four algorithm/data consistency findings F3-F6. Excel import/export is improved but does not resolve every issue from the original report. Weekly default exports still omit the day, and manually corrected years are still discarded on Excel/CSV re-import. Default seating exports have a working opt-in import path rather than becoming directly importable with unchanged defaults.

No application code, existing tests, or user projects were changed during verification. Additional checks and their output are retained under `artifacts/audit-verification-2026-10-04/`.

| Original finding | Current status | Verified result |
| --- | --- | --- |
| F1: default seating Excel cannot be re-imported | Partially resolved: explicit import option works | The downloaded default file still lacks `Klas`. Ordinary import returns zero students. Enabling **Werkbladnamen als klassen gebruiken als de kolom Klas ontbreekt** imports both synthetic students correctly through the actual file-input/preview/replacement flow. |
| F2: missing room/day in scope-specific exports | Partially resolved | Multi-room defaults now include `Lokaal`, so identical A1 seat codes are distinguishable. Weekly defaults still omit `Dag`. |
| F3: waiting students excluded from seating repair | Resolved in the reproduced cases | Ordered generation and both formerly failing single-room Auto seeds seat two students with zero compulsory class-rule violations, leaving the legitimate one-student capacity shortage visible. |
| F4: same-area rule has no effect in custom rooms | Resolved | The two sections now have distinct identities `section:left` and `section:right`. The reproduced split pair receives required cost 1 and a warning. New tests also cover generation, renaming, moving/removing sections, pins, and persistence. |
| F5: special imported IDs break Auto | Resolved in the reproduced cases | `constructor`, `toString`, and `__proto__` each seat successfully with valid room membership and a valid resulting state. Added tests cover distribution modes, migration, weekly planning, and disk persistence. |
| F6: contradictory full/split names accepted silently | Resolved | The Alice Original/Bob Different fixture is rejected with a row-specific conflict message and zero students added. |
| Manual-year round-trip limitation | Unchanged | Excel exports year 3 for class 1A; Excel and CSV both re-import year 1, without errors. The existing test still explicitly enforces class-derived years. |
| Two stale desktop tests | Unchanged | Original rule and weekly scripts still fail. Their previously adapted copies pass, confirming the stale expectations/interactions remain the cause. |

## Remaining Excel issues

### Weekly export still lacks the day

The actual dialog for a two-room saved week selects `name`, `room`, and `seat`. The downloaded file contains eight data rows for two students across four days, with headers:

```
Naam | Lokaal | Plaats
```

There is no `Dag` column to identify each row's day. Both the app's reader and an independent Openpyxl reader confirm these headers.

The UI initializes every Excel column choice explicitly; only name, seat, and room in multi-room projects receive `true`. That explicit false overrides the export module's `selected: true` for the day column. Changing scope does not replace that initial choice.

**Required follow-up:** Make `Dag` selected by default for weekly scope while preserving an explicit user deselection. Ensure weekly scope also defaults to `Lokaal` in a single-room project; the current UI enables that column based on total room count rather than weekly scope.

Source: [export column initialization](../src/app.mjs#L771).

### Corrected years are still silently overwritten

The actual full-column Excel download correctly contains:

```
Student a | 1A | 3 | Standaardlokaal | A1
```

Re-importing it produces `year: '1'`, with no parse errors. The actual CSV download behaves the same way. This is not a failure to write the workbook; import still calls `inferYear(klass)` unconditionally and ignores `Leerjaar`.

**Required follow-up:** Preserve valid supplied years as manual overrides, or explicitly offer class-derived versus supplied years. If retaining the existing policy is intended, disclose the mismatch in the import preview rather than silently dropping the supplied year.

Sources: [year inference](../src/student-import.mjs#L75), [policy test](../tests/student-import.test.mjs#L35).

### Default seating import now requires an extra choice

The new option is functional and appropriately warns that worksheet names may be shortened or modified. Without the option, the downloaded default workbook is still skipped for missing `Klas`. With it, the actual preview and import return the expected two students/classes. This is an effective workaround for per-class worksheets, rather than a general lossless round trip: combined worksheets or sanitized class titles cannot reliably restore original class values.

**Follow-up for a default export/re-import contract:** Include `Klas` in default exports. Retain the opt-in fallback for external files deliberately exported without it.

Source: [new import option](../src/app.mjs#L548).

## Validation performed

- `npm test`: **510 passed**, zero failed, skipped, or cancelled. This includes the new overflow, area, ID-record, and name-conflict tests.
- `npm run check`: passed, including the new ID-record module.
- `tests/desktop-excel.cjs`: passed. Covers actual compressed-file import, preview, persistence, attendance/name edits, downloads, class tabs, column choices/order, and invalid files.
- `tests/desktop-auto-distribution.cjs`: passed. Covers the joint worker and the desktop distribution workflow.
- Independent reproductions of F3-F6: passed the expected corrected behavior.
- Additional actual downloads/imports: default all-room workbook, default week workbook, full-column workbook, CSV, and the new class-name fallback were exercised in a separate Electron profile with no renderer errors.
- Openpyxl independently read all three new XLSX files, verified ZIP checksums, and confirmed headers, data, and literal non-formula cells.
- Original `tests/desktop-rule-audit.cjs` still fails at line 39 (`1 !== 2`): multiple unplaced student warnings are grouped into one visible entry.
- Original `tests/desktop-weekly.cjs` still fails at line 37: the simulated occupied-seat/empty-seat clicks do not activate the current Move control.
- The previously adapted copies of both scripts pass, including the remaining JSON-import and weekly edit/export checks. Original repository tests were not edited.

## Evidence and scope

The reproducible checks are `core-verification.mjs`, `desktop-verification.cjs`, and `independent-read.py` under `artifacts/audit-verification-2026-10-04/`. Results are saved as `core-results.json`, `desktop-results.json`, `independent-results.json`, and test logs in the same directory. Historical audit evidence was preserved.

This follow-up verifies the original reported failures and relevant regressions. It does not certify mathematical optimality, native Microsoft Excel behavior, physical printing, or the contents of a packaged release. CSV and Excel remain roster import formats; JSON remains the full-project backup format.
