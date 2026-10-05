# Aanwezigheden, Export and calendar audit

Audited on 5 October 2026 against the current working tree, including uncommitted and untracked feature files. No application code or existing tests were edited. This report concerns the source checkout, not a rebuilt installer.

## Results

Three reproducible correctness issues and one export functionality gap were found. No independent defect was found in the normal Aanwezigheden workflow. Existing tests pass, but do not establish that every export is complete or can be re-imported without losing information.

### F1 — P2: Weekly Excel exports omit the day by default

Source: `src/app.mjs:789`; `src/excel-export.mjs:31`.

The export UI explicitly initializes the `day` checkbox to false. This overrides the export module's default selection of Dag for a weekly export. Selecting Hele week therefore exports repeated rows for each pupil with Naam and Plaats, and Lokaal in multi-room projects, but no way to identify which weekday belongs to a row. Alphabetical sorting does not solve this when pupils attend different subsets of the week.

Reproduction: generate a week, open Export, select Hele week, and export without changing column selections. Dag is absent. Independently evaluating the current checkbox initialization confirms `day` is false. This also remains an unresolved finding from the earlier audit.

Fix: default Dag to selected when entering weekly scope, while preserving an explicit user deselection. Add an assertion for the actual default downloaded weekly headers.

### F2 — P2: Exported manual years are silently lost on re-import

Source: `src/student-import.mjs:76`; `src/app.mjs:917`.

CSV writes Leerjaar, and Excel can include it, but import unconditionally derives the year from Klas and ignores the supplied Leerjaar. A pupil in class 1A with a manually corrected year 3 exports correctly and re-imports as year 1 without an error. That changes year-based planning rules after replacing the roster.

Reproduction: `parseStudentRows([['Naam','Klas','Leerjaar'],['Audit Synthetic','1A','3']])` returns year `1` and an empty errors array. This is a pre-existing round-trip issue that still affects the new Export workflow.

Fix: validate and preserve a supplied year as an override, or make the choice explicit in the import preview. Verify both Excel and CSV round trips.

### F3 — P2: Calendar import accepts days the calendar cannot reopen

Source: `src/calendar-model.mjs:253`; `src/calendar-model.mjs:153`; `src/calendar-ui.mjs:47`.

Calendar validation checks that keys are real dates, but does not require school days. Importing a structurally valid backup with a Wednesday, Saturday or Sunday key succeeds. The calendar then treats that date as a closed day: opening, saving and selecting it as a copy source are disabled, and the grid suppresses its attendance counts behind the closed-day label. Export can still include the record, so import and normal calendar behavior disagree.

Reproduction: create a valid 2026-10-05 day backup, change only its day key to Wednesday 2026-10-07, and import it. Result: `{ added: 1, skipped: 0 }`, the record exists, and `validState` returns true. `openCalendarDate` rejects that same Wednesday.

Fix: reject non-school-day entries during archive validation with a useful message, or consistently support viewing those imported records. This requires a modified/external archive; the normal save flow already excludes these dates.

### F4 — Export functionality gap: No complete Avondstudie roster export

Source: `src/app.mjs:786`, `src/app.mjs:913`; `src/excel-export.mjs:52`, `src/excel-export.mjs:119`.

The new export panel offers Avondstudie columns through the seating workbook. Its records exclude pupils with planner `absent: true`; room scope also restricts the roster. The separate `studyWorkbook` implementation includes everyone, but has no entry in the current format picker. CSV includes everyone but exports only Naam, Klas and Leerjaar, so it cannot substitute for a complete schedule export.

Reproduction: use a two-pupil roster, set one pupil's planner absence to true, and call the same seating rows path used by the UI with all rooms and Avondstudie columns. It returns one row. In an active weekly day this can omit pupils scheduled for other weekdays from a file containing all four schedule columns.

This is a gap if Avondstudie is intended to export the full expected schedule; filtering absences remains appropriate for a seating-only export. It is separate from Aanwezigheden's `attendanceAbsent`, which correctly leaves pupils in seating exports.

Fix: expose a complete leerlingen/Avondstudie workbook using `studyWorkbook`, or provide an explicit include-all-pupils option.

## Aanwezigheden and calendar checks that passed

- Attendance changes preserve seating, pins, room membership, planner rules and weekly plans.
- Search, present/absent filters, context controls, seat colours, undo/redo, persistence, empty rosters and small-window layouts passed the attendance desktop suite.
- Calendar saved dates restore independent attendance, seating and historical rosters. Draft return, copying with reset attendance, deletion/undo, restart, import/export and school-day restrictions passed the calendar desktop suite.
- Today uses the Brussels date, including the tested midnight/year transition. The global calendar preference persists across projects.
- Export downloads for XLSX, CSV, JSON, SVG and PNG passed the export desktop suite. Column order, option retention and archived attendance colours also passed.

## Personal-information scan

The scan used the current non-ignored working tree, including hidden non-ignored files. The `.gitignore` exclusions were respected: `node_modules/`, `.npm-cache/`, `artifacts/`, `*.bundle`, `ImportLayoutExample.xlsx`, `dist/`, `*.log`, `projects/`, `.env` and `.env.*`, with the `.env.example` exception retained. Git internals/history were not scanned. `git ls-files -ci --exclude-standard` returned no tracked files matching ignore rules.

Student names were treated as fictitious as requested. Source, docs, tests, defaults and configuration were searched for identifying contact information, local user paths, credentials and common token/private-key patterns. Both non-ignored example XLSX archives were inspected internally, including XML and relationship entries; neither contained document-property metadata entries or the searched identifying patterns. The PNG assets were viewed and their binary text checked for likely identifying metadata; the screenshot shows synthetic Learling labels.

Findings:

- **Public author identity:** `Zyric99` in `package.json:38`, plus GitHub repository/release links in `README.md:51`, `README.md:64` and `docs/technische-handleiding.md:7`. This connects the project to a public account. Keep it if intentional.
- **Third-party contact information:** `i@izs.me` in `package-lock.json:1909` is part of a dependency deprecation notice, not an apparent personal contact for the project owner.
- **No other likely sensitive personal information found:** no obvious owner email/phone/address, hardcoded local user path, private key or API credential in the scanned content. Generic `%APPDATA%` paths are not identifying.

This is a scoped scan, not proof that ignored files or Git history are free of personal information. Full-project JSON exports include saved lists, plans and calendar history; removing a pupil from the current roster does not remove that pupil from historical records. That is expected archival behavior and matters if real pupils are used later.

## Validation and limits

- `npm test`: 542 passed, zero failed/skipped/cancelled.
- `npm run check`: passed.
- `tests/desktop-attendance.cjs`, `tests/desktop-export.cjs`, and `tests/desktop-calendar.cjs`: passed using `electron --disable-gpu --no-sandbox`. The ordinary launch initially failed before loading the app with Electron GPU/Windows startup errors; the workaround was only for these test processes.
- Additional direct model reproductions confirmed the lost manual year, omitted schedule pupil and accepted Wednesday archive; source inspection confirmed weekly checkbox defaults.
- PDF/physical printing, a rebuilt installer, every other desktop suite, and real Microsoft Excel rendering were not independently exercised in this audit. Privacy exclusions were not bypassed.

Recommended order: correct weekly default headers and manual-year round trips, decide the full-roster export behavior, then close the calendar import validation gap.
