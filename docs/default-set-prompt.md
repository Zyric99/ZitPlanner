# Agent prompt: reusable default classroom set and reset

Design and implement a clear default-set feature for Klaslokaal. The user edits and duplicates classroom tabs and wants to save a reusable starting set that they can always reset to. Preserve the existing app styling and focus changes on this workflow.

Read the project-storage modules and the room/editor code first. There is already a separate `projects/default-layout.json` file. `emptyProjectState()` in `src/project-session.mjs` produces a starting state containing room layouts/settings but no students, personal rules, seating, pins or weekly plans. `projectSession.getDefaultLayout()` returns a copy; `projectSession.setDefaultLayout(state)` saves a clean default set through the existing isolated IPC bridge. New projects already use that template.

Add a “Standaardset” section with these actions:

1. **Huidige lokalen als standaard bewaren**: preview which tabs and room settings will become the default, then save them through `setDefaultLayout`. Explain that students and their placements are excluded. Replacing this template must not change the current project or other saved projects.
2. **Standaardset herstellen**: show which current tabs will be replaced. After the user's confirmation, restore the saved room set into the active project as one undoable operation. Retain the student roster and reusable student lists. Preserve valid seats, pins and room/class membership where their stable references still exist; explicitly show how invalid references will be cleared or left traceable as warnings. Do not automatically generate seats. Clear or invalidate weekly plans as appropriate. Autosave the result, and allow Undo to restore the complete prior project.
3. **Oorspronkelijke standaardset herstellen**: offer the built-in factory classroom separately from the user's saved default. Explain the replacement before applying it. Do not silently replace the saved default file.

Keep the custom default file separate from autosaved project files and legacy localStorage. Do not seed the default by guessing or duplicating a missing room. Allow the user to verify the migrated layout before selecting and saving the default room set.

Expose technical default-file details in developer settings using the separate developer-settings prompt. Ordinary users should see classroom names and the effect of each action, without technical storage jargon. Support every existing room tab, geometry, chair capacity, orientation, spacing, stable identity and room-specific placement setting.

Test saving/reopening a custom default with two different rooms; starting a new project from it; resetting an edited project; preservation of students; cleanup of invalid seating references; Undo/Redo; and write failures leaving the previous default intact. Run syntax checks, unit tests and focused Electron tests. Do not change the seating engine, unrelated imports/exports or general navigation.
