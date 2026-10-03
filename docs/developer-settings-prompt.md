# Agent prompt: project storage in developer settings

Add a compact project-storage section to the developer settings UI of Klaslokaal. Keep this task focused on settings and diagnostics; the file-storage backend is already implemented.

Read `desktop/desktop.cjs`, `desktop/preload.cjs`, `desktop/project-store.cjs`, `src/project-session.mjs` and the developer panel in `src/app.mjs` first. Production Electron saves under `projects/` in the repository root. `workspace.json` selects the project to reopen. Each project JSON contains all room tabs, students, rules, assignments, saved lists and weekly plans. `default-layout.json` stores the starting rooms for new projects. Browser preview and the explicit `KLASLOKAAL_LEGACY_STORAGE=True` fallback retain localStorage.

Show these developer-only details:

- Storage mode: project files or legacy localStorage.
- The full project-folder path and current project-file path.
- Active project ID and name; number of room tabs.
- Latest save status, time and size, with a visible pending/error state.
- The default-layout file and whether a default set is available.
- A short migration status, including the preserved legacy save. Only report a layout as recovered when it is actually present.

Use the existing `projectSession`, `developerStorage`, `window.desktop.developerInfo()` and isolated IPC bridge. Add narrowly scoped read-only metadata if needed. Keep filesystem paths chosen by the main process; never accept arbitrary renderer paths. Avoid persisting developer flags inside student/project data. Saving must remain automatic in normal mode too.

Retain the current failure behavior: write errors are shown, project switching waits for saving, and closing waits for pending saves. Keep the old localStorage data intact. Do not add buttons that silently delete saved projects or overwrite legacy data.

Use Dutch labels matching the existing app. Update the isolated Electron tests to verify real file paths, pending/success/error states, and that this section is hidden outside developer mode. Run `npm run check`, `npm test`, and `npm run test:dev`. Limit changes to the settings UI and any small metadata additions it needs.
