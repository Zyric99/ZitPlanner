import { todayKey, periodDates, monthGrid, shiftDate, shiftMonth, dateLabel, dateObject, isSchoolDay, shiftSchoolDay } from './calendar-dates.mjs';
import { calendarRecord, calendarDraft, calendarNeedsStart, calendarSummary, deleteCalendarDay, previousCalendarDate, openCalendarDate, saveCalendarPeriod, setCalendarEnabled, importCalendarData } from './calendar-model.mjs';

const $ = selector => document.querySelector(selector);
const calendarIcon = '<svg class="calendar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 10h18M7 14h2m2 0h2m2 0h2M7 17h2m2 0h2"/></svg>';

export function calendarControlsMarkup(state) {
  return `<div class="calendar-controls"><label class="attendance-color-toggle calendar-enable"><span>Kalender</span><input type="checkbox" role="switch" aria-label="Kalender inschakelen" data-calendar-enabled ${state.calendar?.enabled ? 'checked' : ''}></label>${state.calendar?.enabled ? `<button class="button calendar-open-button" data-calendar-open title="Kalender openen">${calendarIcon}<span>Kalender</span></button>` : ''}</div>`;
}

export function calendarDateMarkup(state) {
  if (!state.calendar?.enabled) return '';
  const saved = calendarRecord(state, state.calendar.selectedDate);
  const needsStart = calendarNeedsStart(state, state.calendar.selectedDate);
  return `<div class="calendar-date-bar"><span class="calendar-date-label">${calendarIcon} Dagplanning</span><button class="icon-button" data-calendar-step="-1" aria-label="Vorige dag">‹</button><button class="button calendar-active-date" data-calendar-open>${dateLabel(state.calendar.selectedDate)}</button><button class="icon-button" data-calendar-step="1" aria-label="Volgende dag">›</button><span class="calendar-auto-note">${saved ? 'Automatisch opgeslagen' : needsStart ? 'Kies hoe je deze dag wilt starten' : 'Concept · wordt bewaard bij dagwissel'}</span>${!saved ? `<button class="button small primary" data-calendar-save-current>${needsStart ? 'Dag starten' : 'Dag bewaren'}</button>` : ''}</div>`;
}

export function createCalendarUI({ getState, getBusy, commit, modal, closeModal, toast, esc, clearSelection, validateDay, setEnabled }) {
  let selected = todayKey(), scope = 'month', pendingNew = null, copyRequest = null, modalView = null;
  const scopeLabels = { day: 'Dag', week: 'Week', month: 'Maand' };

  function renderControls() {
    const state = getState(), enabled = state.calendar?.enabled === true;
    $('#seating-calendar-controls').innerHTML = calendarControlsMarkup(state);
    for (const slot of document.querySelectorAll('#seating-calendar-date, #attendance-calendar-date')) {
      slot.hidden = false;
      slot.classList.add('calendar-date-slide');
      if (enabled) slot.innerHTML = `<div class="calendar-date-clip">${calendarDateMarkup(state)}</div>`;
      else for (const button of slot.querySelectorAll('button')) {
        button.disabled = true;
        for (const name of [...button.getAttributeNames()].filter(name => name.startsWith('data-calendar-'))) button.removeAttribute(name);
      }
      slot.classList.toggle('is-open', enabled);
      slot.inert = !enabled;
      slot.setAttribute('aria-hidden', String(!enabled));
    }
  }

  function draw() {
    const state = getState(), saved = calendarSummary(state, selected), schoolDay = isSchoolDay(selected), copying = !!copyRequest;
    const today = todayKey();
    const hasData = !!saved || !!calendarDraft(state, selected) || state.calendar?.enabled && state.calendar.selectedDate === selected && !calendarNeedsStart(state, selected);
    modalView = copying ? 'copy' : 'calendar';
    const dates = scope === 'month' ? monthGrid(selected) : periodDates(selected, scope);
    const range = periodDates(selected, scope), schoolDates = range.filter(isSchoolDay), recorded = schoolDates.filter(date => calendarRecord(state, date)).length;
    const title = scope === 'month' ? dateLabel(selected, { month: 'long', year: 'numeric' }) : scope === 'week' ? `${dateLabel(range[0], { day: 'numeric', month: 'short' })} – ${dateLabel(range.at(-1), { day: 'numeric', month: 'short', year: 'numeric' })}` : dateLabel(selected);
    const cells = dates.map(date => {
      const weekend = !isSchoolDay(date), closedLabel = dateObject(date).getUTCDay() === 3 ? 'Woensdag' : 'Weekend', summary = calendarSummary(state, date), draft = !!calendarDraft(state, date) || !summary && state.calendar?.enabled && state.calendar.selectedDate === date && !calendarNeedsStart(state, date), current = state.calendar?.enabled && state.calendar.selectedDate === date;
      const outside = scope === 'month' && date.slice(0, 7) !== selected.slice(0, 7);
      return `<button class="calendar-day ${weekend ? 'weekend' : ''} ${outside ? 'outside-month' : ''} ${date === selected ? 'chosen' : ''} ${date === today ? 'today' : ''} ${summary ? 'recorded' : ''}" data-calendar-date="${date}" ${copying && (weekend || !summary) ? 'disabled' : ''} aria-pressed="${date === selected}" aria-label="${esc(dateLabel(date))}${date === today ? ", Vandaag" : ""}, ${weekend ? `${closedLabel} · geen schooldag` : summary ? summary.attendanceSaved ? `${summary.present} aanwezig, ${summary.absent} afwezig, ${summary.unexpected} niet verwacht` : 'Indeling bewaard, aanwezigheden niet bewaard' : draft ? 'Concept' : 'Nog niet bewaard'}"><span class="calendar-day-number">${Number(date.slice(-2))}${current ? '<i class="calendar-current-dot" title="Geopende dag"></i>' : ''}</span>${date === today ? '<span class="calendar-today-badge"><span aria-hidden="true">●</span> Vandaag</span>' : ''}${weekend ? `<span class="calendar-day-empty">${closedLabel}</span>` : summary ? `${summary.attendanceSaved ? `<span class="calendar-day-count present">${summary.present} aanwezig</span><span class="calendar-day-count ${summary.absent ? 'absent' : 'quiet'}">${summary.absent} afwezig</span>${summary.unexpected ? `<span class="calendar-day-count quiet">${summary.unexpected} niet verwacht</span>` : ''}` : '<span class="calendar-day-empty">Aanwezigheden niet bewaard</span>'}<span class="calendar-day-saved">✓ Indeling bewaard</span>` : `<span class="calendar-day-empty">${draft ? 'Concept' : 'Nog niet bewaard'}</span>`}</button>`;
    }).join('');
    modal(copying ? `Kopieer naar ${esc(dateLabel(copyRequest.date, { day: 'numeric', month: 'long' }))}` : 'Kalender', `<div class="calendar-topbar"><div class="calendar-navigation"><button class="icon-button" data-calendar-action="previous" aria-label="Vorige ${scopeLabels[scope].toLowerCase()}">‹</button><h3>${esc(title)}</h3><button class="icon-button" data-calendar-action="next" aria-label="Volgende ${scopeLabels[scope].toLowerCase()}">›</button><button class="button small" data-calendar-action="today">Vandaag</button></div><div class="calendar-view-switch" role="group" aria-label="Kalenderweergave">${Object.entries(scopeLabels).map(([value, label]) => `<button class="button ${scope === value ? 'primary' : ''}" data-calendar-view="${value}" aria-pressed="${scope === value}">${label}</button>`).join('')}</div></div>
      <div class="calendar-layout"><div class="calendar-page"><div class="calendar-weekdays ${scope === 'day' ? 'single-day' : ''}">${(scope === 'day' ? [dateLabel(selected, { weekday: 'long' })] : ['Ma', 'Di', 'Wo', 'Do', 'Vr', 'Za', 'Zo']).map(day => `<span>${day}</span>`).join('')}</div><div class="calendar-grid ${scope === 'day' ? 'single-day' : ''}">${cells}</div></div><aside class="calendar-detail"><div class="eyebrow">GESELECTEERDE DAG</div><h3>${esc(dateLabel(selected, { weekday: 'long', day: 'numeric', month: 'long' }))}</h3>${!schoolDay ? '<p>Geen schooldag</p>' : saved ? saved.attendanceSaved ? `<div class="calendar-detail-counts"><strong>${saved.present}<small>Aanwezig</small></strong><strong class="absent">${saved.absent}<small>Afwezig</small></strong>${saved.unexpected ? `<strong class="unexpected">${saved.unexpected}<small>Niet verwacht</small></strong>` : ''}</div>` : '<p>Aanwezigheden niet bewaard</p>' : '<p>Nog niet bewaard</p>'}${copying ? `<button class="button primary full" data-calendar-action="copy" ${!schoolDay || !saved ? 'disabled' : ''}>Deze dag kopiëren</button><p>Iedereen start aanwezig.</p>` : `<button class="button primary full" data-calendar-action="open" ${!schoolDay ? 'disabled' : ''}>${saved ? 'Dag heropenen' : 'Dag openen'} →</button><div class="calendar-period-save"><strong>${recorded} / ${schoolDates.length} schooldagen bewaard</strong><button class="button full" data-calendar-action="save" ${!schoolDay ? 'disabled' : ''}>Dag bewaren</button></div>${hasData ? '<div class="calendar-day-delete"><button class="button danger full" data-calendar-action="delete">Daggegevens verwijderen</button></div>' : ''}`}</aside></div>`, copying ? '<button class="button" data-calendar-action="copy-back">Terug</button><button class="button" data-calendar-action="cancel-new">Annuleren</button>' : '<button class="button" data-close>Sluiten</button>');
    $('#modal').classList.add('calendar-modal');
    if (copying) return;
    const importLabel = document.createElement('label');
    importLabel.className = 'button calendar-import-button';
    importLabel.textContent = '↗ Kalender importeren';
    const fileInput = document.createElement('input');
    fileInput.type = 'file';fileInput.accept = '.json';fileInput.id = 'calendar-import-file';fileInput.hidden = true;
    importLabel.append(fileInput);$('#modal-content .modal-actions').prepend(importLabel);
    fileInput.onchange = async () => {
      const file = fileInput.files[0];if (!file) return;
      try {
        const data = JSON.parse(await file.text());
        let result;
        if (!edit(state => { result = importCalendarData(state, data, validateDay); })) return;
        toast(`${result.added} dagen geïmporteerd; ${result.skipped} bestaande dagen behouden.`);
        if (result.added) selected = Object.keys(data.days).sort()[0];
        draw();
      } catch (error) { toast(error.message); }
    };
  }

  function open() {
    if (!getState().calendar?.enabled) return;
    pendingNew = null;copyRequest = null;
    selected = getState().calendar?.selectedDate ?? todayKey();
    draw();
  }

  function edit(change) {
    if (getBusy()) { toast('Wacht tot de planner klaar is.'); return false; }
    commit(() => { change(getState()); clearSelection(); });
    return true;
  }

  function finishOpen(date, initialization = {}, { stayOpen = false, saveAfter = false } = {}) {
    if (!edit(state => {
      openCalendarDate(state, date, initialization);
      if (saveAfter) saveCalendarPeriod(state, date, 'day');
    })) return;
    pendingNew = null;copyRequest = null;selected = date;
    if (stayOpen) draw();
    else { modalView = null;closeModal(); }
  }

  function drawNewChoices() {
    modalView = 'new';
    const previous = previousCalendarDate(getState(), pendingNew.date);
    modal('Nieuwe dag', `<div class="calendar-new-day"><h3>${esc(dateLabel(pendingNew.date))}</h3><div class="calendar-start-choices"><button class="button" data-calendar-start="fresh"><strong>Leeg beginnen</strong><small>Zonder zitindeling</small></button><button class="button" data-calendar-start="previous" ${!previous ? 'disabled' : ''}><strong>Vorige dag kopiëren</strong><small>${previous ? esc(dateLabel(previous, { weekday: 'long', day: 'numeric', month: 'long' })) : 'Geen eerdere dag bewaard'}</small></button><button class="button calendar-choose-day" data-calendar-start="choose">${calendarIcon}<span>Andere dag kiezen</span></button></div></div>`, '<button class="button" data-calendar-action="cancel-new">Annuleren</button>');
    $('[data-calendar-start=fresh]').focus();
  }

  function requestOpen(date, options = {}) {
    if (getBusy()) return toast('Wacht tot de planner klaar is.');
    if (!isSchoolDay(date)) return toast('Geen schooldag.');
    const state = getState();
    if (!calendarNeedsStart(state, date) && (calendarRecord(state, date) || calendarDraft(state, date) || state.calendar?.enabled && state.calendar.selectedDate === date)) return finishOpen(date, {}, options);
    pendingNew = { date, ...options };copyRequest = null;selected = date;
    drawNewChoices();
  }

  function cancelNew() {
    pendingNew = null;copyRequest = null;
    modalView = null;
    closeModal();renderControls();
  }

  $('#modal').addEventListener('close', () => {
    if ($('#modal').open) return;
    const wasCalendar = modalView === 'calendar' && $('#modal').classList.contains('calendar-modal');
    modalView = null;
    const state = getState();
    if (wasCalendar && state.calendar?.enabled && calendarNeedsStart(state, state.calendar.selectedDate)) {
      pendingNew = { date: state.calendar.selectedDate };copyRequest = null;
      drawNewChoices();
    }
  });

  document.addEventListener('change', event => {
    if (!event.target.matches('[data-calendar-enabled]')) return;
    const enabled = event.target.checked;
    if (getBusy()) { event.target.checked = getState().calendar?.enabled === true;return toast('Wacht tot de planner klaar is.'); }
    const before = new Map([...document.querySelectorAll('.calendar-date-slide')].map(slot => {
      const style = getComputedStyle(slot);
      return [slot.id, { height: `${slot.getBoundingClientRect().height}px`, opacity: style.opacity, transform: style.transform }];
    }));
    setEnabled(enabled);
    edit(state => setCalendarEnabled(state, enabled));
    for (const slot of document.querySelectorAll('.calendar-date-slide')) {
      const start = before.get(slot.id);
      if (!start || !slot.getClientRects().length) continue;
      for (const animation of slot.getAnimations()) animation.cancel();
      const end = { height: `${slot.getBoundingClientRect().height}px`, opacity: enabled ? '1' : '0', transform: enabled ? 'translateY(0)' : 'translateY(-8px)' };
      slot.animate([{ ...start, gridTemplateRows: '1fr' }, { ...end, gridTemplateRows: '1fr' }], { duration: 300, easing: 'ease' });
    }
  });
  document.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button) return;
    try {
      if (button.hasAttribute('data-close')) { pendingNew = null;copyRequest = null;return; }
      if (button.hasAttribute('data-calendar-open')) return open();
      if (button.hasAttribute('data-calendar-step')) return requestOpen(shiftSchoolDay(getState().calendar.selectedDate, Number(button.dataset.calendarStep)));
      if (button.hasAttribute('data-calendar-save-current')) {
        const state = getState(), date = state.calendar.selectedDate;
        if (calendarNeedsStart(state, date)) return requestOpen(date);
        return edit(state => saveCalendarPeriod(state, date, 'day'));
      }
      if (button.dataset.calendarStart && pendingNew) {
        const start = button.dataset.calendarStart, request = pendingNew;
        if (start === 'fresh') return finishOpen(request.date, { fresh: true }, request);
        if (start === 'previous') {
          const sourceDate = previousCalendarDate(getState(), request.date);
          if (sourceDate) finishOpen(request.date, { sourceDate }, request);
          return;
        }
        if (start === 'choose') {
          copyRequest = request;
          selected = previousCalendarDate(getState(), request.date) ?? request.date;
          scope = 'month';return draw();
        }
      }
      if (button.dataset.calendarDate) { selected = button.dataset.calendarDate; return draw(); }
      if (button.dataset.calendarView) { scope = button.dataset.calendarView; return draw(); }
      const action = button.dataset.calendarAction;
      if (!action) return;
      if (action === 'cancel-new') return cancelNew();
      if (action === 'copy-back' && copyRequest) { copyRequest = null;return drawNewChoices(); }
      if (action === 'copy' && copyRequest) return finishOpen(copyRequest.date, { sourceDate: selected }, copyRequest);
      if (action === 'today') {
        const actualToday = todayKey(new Date());
        pendingNew = null;copyRequest = null;
        selected = actualToday;
        if (isSchoolDay(actualToday)) {
          if (calendarNeedsStart(getState(), actualToday)) requestOpen(actualToday);
          else finishOpen(actualToday);
        }
        else draw();
        return;
      }
      if (['previous', 'next'].includes(action)) {
        const delta = action === 'next' ? 1 : -1;
        selected = scope === 'month' ? shiftMonth(selected, delta) : shiftDate(selected, delta * (scope === 'week' ? 7 : 1));
      }
      if (action === 'open') return requestOpen(selected);
      if (action === 'save') {
        const state = getState();
        if (calendarNeedsStart(state, selected) || !calendarRecord(state, selected) && (!state.calendar?.enabled || state.calendar.selectedDate !== selected)) return requestOpen(selected, { stayOpen: true, saveAfter: true });
        if (!edit(state => saveCalendarPeriod(state, selected, 'day'))) return;
        toast('Dag bewaard.');
      }
      if (action === 'delete') {
        if (!edit(state => deleteCalendarDay(state, selected))) return;
        toast('Daggegevens verwijderd. Ongedaan maken met ↶.');
      }
      draw();
    } catch (error) { toast(error.message); }
  });
  return { renderControls, open };
}
