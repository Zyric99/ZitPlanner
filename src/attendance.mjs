import { isSchoolDay } from './calendar-dates.mjs';
import { calendarAttendanceSaved, calendarNeedsStart, clearCalendarAttendance } from './calendar-model.mjs';
import { studentIsAbsent, attendanceDate, studentExpectedOnDate, attendanceStatus, attendanceLabel } from './attendance-status.mjs';
export { studentIsAbsent, attendanceDate, studentExpectedOnDate, attendanceStatus, attendanceLabel } from './attendance-status.mjs';

export function setStudentAttendance(state, id, absent) {
  const student = state.students.find(p => p.id === id);
  if (!student || typeof absent !== 'boolean') return;
  student.attendanceAbsent = absent;
}

export function resetStudentAttendance(state, date = attendanceDate(state)) {
  if (!isSchoolDay(date)) throw Error('Aanwezigheden kunnen alleen op schooldagen gewijzigd worden.');
  if (calendarNeedsStart(state, date)) throw Error('Kies eerst hoe je deze dag wilt starten.');
  for (const student of state.students) if (studentExpectedOnDate(student, date)) student.attendanceAbsent = false;
  clearCalendarAttendance(state, date);
}

export function createAttendanceUI({ getState, esc, setColors, saveAttendance, resetAttendance, calendarControls = () => '' }) {
  let query = '', status = 'today';
  function render(container) {
    const dateBar = container.querySelector('#attendance-calendar-date');
    const state = getState(), { students } = state, date = attendanceDate(state);
    const saved = calendarAttendanceSaved(state, date), canSave = students.length && isSchoolDay(date) && !calendarNeedsStart(state, date);
    const expected = students.filter(p => studentExpectedOnDate(p, date));
    const absent = expected.filter(studentIsAbsent).length;
    container.innerHTML = `<div class="task-heading"><div><h2>Aanwezigheden</h2><p>${saved ? `${expected.length - absent} aanwezig · ${absent} afwezig` : `Niet bewaard · ${expected.length} verwacht`} · ${students.length - expected.length} niet verwacht · ${students.length} leerlingen</p></div><div class="attendance-heading-actions"><label class="attendance-color-toggle"><span>Kleuren op zitplaatsen</span><input id="attendance-seat-colors" type="checkbox" role="switch" ${state.attendanceColorsEnabled ? 'checked' : ''}></label>${calendarControls(state)}</div></div>
      <div id="attendance-calendar-date" class="calendar-date-slide"></div>
      <div class="student-filters attendance-filters"><label>Zoeken<input id="attendance-search" placeholder="Naam, klas of leerjaar…" value="${esc(query)}" autocomplete="off"></label><div class="attendance-controls"><div class="attendance-actions"><button id="attendance-save" class="button ${saved ? '' : 'primary'}" ${saved || !canSave ? 'disabled' : ''}>${saved ? '✓ Bewaard' : 'Aanwezigheden bewaren'}</button><button id="attendance-reset" class="button" title="Bevestiging wissen en verwachte leerlingen aanwezig zetten" ${!canSave ? 'disabled' : ''}>↺ Resetten</button></div><label class="attendance-status-filter">Status<select id="attendance-status"><option value="all">Alle leerlingen</option><option value="today">Leerlingen van vandaag</option><option value="present">Aanwezig</option><option value="absent">Afwezig</option><option value="unexpected">Niet-verwachte leerlingen</option></select></label></div><span id="attendance-filter-count" role="status"></span></div>
      <div class="attendance-grid">${students.map(p => {
        const kind = attendanceStatus(p, date), label = attendanceLabel(kind), unrecorded = !saved && kind !== 'unexpected';
        return `<button class="attendance-card is-${kind} ${unrecorded ? 'is-unrecorded' : ''}" data-attendance="${esc(p.id)}" aria-pressed="${!studentIsAbsent(p)}" aria-label="${esc(p.name)}, ${esc(p.class)}, ${label}${unrecorded ? ', niet bewaard' : ''}; markeer als ${studentIsAbsent(p) ? 'aanwezig' : 'afwezig'}"><strong>${esc(p.name)}</strong><small>${esc(p.class)} · leerjaar ${esc(p.year)}</small><span class="attendance-badge">${kind === 'present' ? '✓' : '−'} ${label}${unrecorded ? ' · niet bewaard' : ''}</span></button>`;
      }).join('')}</div>
      <p id="attendance-empty" class="muted" hidden></p>`;
    if (dateBar) container.querySelector('#attendance-calendar-date').replaceWith(dateBar);
    container.querySelector('#attendance-status').value = status;
    container.querySelector('#attendance-seat-colors').onchange = event => setColors(event.target.checked);
    container.querySelector('#attendance-save').onclick = () => saveAttendance();
    container.querySelector('#attendance-reset').onclick = () => resetAttendance();
    const filter = () => {
      const search = query.trim().toLocaleLowerCase('nl');
      const people = new Map(getState().students.map(p => [p.id, p]));
      let visible = 0;
      container.querySelectorAll('[data-attendance]').forEach(card => {
        const p = people.get(card.dataset.attendance);
        const kind = attendanceStatus(p, date);
        card.hidden = ![p.name, p.class, p.year].some(value => String(value).toLocaleLowerCase('nl').includes(search)) || (status === 'today' ? kind === 'unexpected' : status !== 'all' && kind !== status);
        if (!card.hidden) visible++;
      });
      container.querySelector('#attendance-filter-count').textContent = `${visible} van ${people.size} leerlingen`;
      const empty = container.querySelector('#attendance-empty');
      empty.hidden = visible > 0;
      empty.textContent = people.size ? 'Geen leerlingen gevonden met deze zoekopdracht en status.' : 'Geen leerlingen. Voeg leerlingen toe via Leerlingen.';
    };
    container.querySelector('#attendance-search').oninput = event => { query = event.target.value; filter(); };
    container.querySelector('#attendance-status').onchange = event => { status = event.target.value; filter(); };
    filter();
  }
  return { render };
}
