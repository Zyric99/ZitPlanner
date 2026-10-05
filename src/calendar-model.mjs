import { ownValue } from './id-record.mjs';
import { captureRoom, initializeRooms } from './rooms.mjs';
import { validDateKey, todayKey, periodDates, dateLabel, isSchoolDay, shiftSchoolDay } from './calendar-dates.mjs';
import { seatCode } from './engine.mjs';
import { leaveWeeklyDay } from './weekly-planner.mjs';
import { attendanceStatus, attendanceLabel } from './attendance-status.mjs';

const clone = value => structuredClone(value);
const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
const localKeys = ['layout', 'sections', 'rows', 'disabled', 'disabledSeats', 'placementMode', 'ordered'];
const planningKeys = ['rooms', 'roomTemplates', 'rules', 'studentRooms', 'studentRoomPins', 'classRooms', 'participatingRooms', 'distribution', 'weeklyPlans'];
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!object(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
}
const signature = value => JSON.stringify(canonical(value));

export function ensureCalendar(state) {
  return state.calendar ??= { version: 1, enabled: false, selectedDate: todayKey(), days: {}, rosters: {}, layouts: {}, baseline: null };
}

function intern(records, value, prefix) {
  const key = signature(value);
  const existing = Object.keys(records).find(id => signature(records[id]) === key);
  if (existing) return existing;
  const id = `${prefix}-${crypto.randomUUID()}`;
  records[id] = clone(value);
  return id;
}

function snapshot(state) {
  captureRoom(state);
  const calendar = ensureCalendar(state);
  const students = state.students.map(({ attendanceAbsent, ...student }) => student);
  const settings = Object.fromEntries(Object.entries(state.settings).filter(([key]) => !localKeys.includes(key)));
  const layout = { settings, ...Object.fromEntries(planningKeys.filter(key => state[key] !== undefined).map(key => [key, state[key]])) };
  return {
    rosterId: intern(calendar.rosters, students, 'roster'),
    layoutId: intern(calendar.layouts, layout, 'layout'),
    absentIds: state.students.filter(student => student.attendanceAbsent === true).map(student => student.id).sort()
  };
}

export function calendarRecord(state, date) {
  return ownValue(state.calendar?.days, date);
}

export function calendarDraft(state, date) {
  return ownValue(state.calendar?.drafts, date);
}

export function calendarNeedsStart(state, date) {
  return state.calendar?.pendingDates?.includes(date) === true;
}

// Confirmation follows the pupil list and study schedule, independently of seating.
const attendanceRoster = students => signature(students.map(({ id, eveningStudy }) => ({ id, eveningStudy })).sort((a, b) => a.id.localeCompare(b.id)));
const absentIds = students => students.filter(student => student.attendanceAbsent === true).map(student => student.id).sort();
function attendanceMatches(state, reference) {
  return attendanceRoster(state.students) === attendanceRoster(ownValue(state.calendar.rosters, reference.rosterId) ?? []) && signature(absentIds(state.students)) === signature([...reference.absentIds].sort());
}
export function calendarAttendanceSaved(state, date = state.calendar?.enabled ? state.calendar.selectedDate : todayKey()) {
  const reference = calendarRecord(state, date);
  if (reference?.attendanceSaved !== true) return false;
  const activeDate = state.calendar?.enabled ? state.calendar.selectedDate : todayKey();
  return date !== activeDate || attendanceMatches(state, reference);
}

export function saveCalendarAttendance(state, date = state.calendar?.enabled ? state.calendar.selectedDate : todayKey()) {
  if (!isSchoolDay(date)) throw Error('Aanwezigheden kunnen alleen op schooldagen bewaard worden.');
  if (calendarNeedsStart(state, date)) throw Error('Kies eerst hoe je deze dag wilt starten.');
  const reference = snapshot(state);
  state.calendar.days[date] = { ...reference, attendanceSaved: true, updated: new Date().toISOString() };
  if (state.calendar.drafts) delete state.calendar.drafts[date];
  collectCalendarRecords(state.calendar);
}

export function clearCalendarAttendance(state, date) {
  const pupils = new Map(state.students.map(student => [student.id, student]));
  for (const records of [state.calendar?.days, state.calendar?.drafts]) {
    const reference = ownValue(records, date);
    if (!reference) continue;
    const previousAbsent = new Set(reference.absentIds);
    const roster = ownValue(state.calendar.rosters, reference.rosterId);
    records[date] = { ...reference, attendanceSaved: false, absentIds: roster.filter(student => pupils.has(student.id) ? pupils.get(student.id).attendanceAbsent === true : previousAbsent.has(student.id)).map(student => student.id).sort(), updated: new Date().toISOString() };
  }
}

function finishDayStart(calendar, date) {
  if (calendar.pendingDates) calendar.pendingDates = calendar.pendingDates.filter(key => key !== date);
}

function preserveOpenDay(state) {
  const calendar = state.calendar;
  if (!calendar?.enabled || !isSchoolDay(calendar.selectedDate) || calendarNeedsStart(state, calendar.selectedDate)) return;
  if (calendarRecord(state, calendar.selectedDate)) { captureCalendarDay(state); return; }
  calendar.drafts ??= {};
  calendar.drafts[calendar.selectedDate] = { ...snapshot(state), updated: new Date().toISOString() };
  collectCalendarRecords(calendar);
}

// Materialize one shared roster/layout without sharing mutable objects between dates.
export function calendarDayState(calendar, reference, preferredRoomId) {
  const students = clone(ownValue(calendar.rosters, reference.rosterId));
  const layout = clone(ownValue(calendar.layouts, reference.layoutId));
  if (!students || !layout?.rooms?.length) throw Error('De kalenderdag bevat ongeldige gegevens.');
  const absent = new Set(reference.absentIds);
  for (const student of students) student.attendanceAbsent = absent.has(student.id);
  const room = layout.rooms.find(value => value.id === preferredRoomId) ?? layout.rooms[0];
  return {
    ...layout, name: 'Kalenderdag', students, activeRoomId: room.id,
    settings: { ...layout.settings, ...clone(room.settings), ...(room.layout.kind === 'custom' ? { layout: clone(room.layout) } : {}) },
    assignments: clone(room.assignments), locks: [...room.locks], hiddenWarnings: [...room.hiddenWarnings], benchLocks: []
  };
}

function restore(state, reference) {
  const day = calendarDayState(state.calendar, reference, state.activeRoomId);
  for (const key of planningKeys) {
    if (day[key] === undefined) delete state[key];
    else state[key] = day[key];
  }
  for (const key of ['students', 'settings', 'activeRoomId', 'assignments', 'locks', 'hiddenWarnings', 'benchLocks']) state[key] = day[key];
  initializeRooms(state);
}

export function collectCalendarRecords(calendar) {
  const references = [...Object.values(calendar.days), ...Object.values(calendar.drafts ?? {}), ...(calendar.baseline ? [calendar.baseline] : [])];
  const rosterIds = new Set(references.map(day => day.rosterId)), layoutIds = new Set(references.map(day => day.layoutId));
  for (const id of Object.keys(calendar.rosters)) if (!rosterIds.has(id)) delete calendar.rosters[id];
  for (const id of Object.keys(calendar.layouts)) if (!layoutIds.has(id)) delete calendar.layouts[id];
}

export function captureCalendarDay(state) {
  const calendar = state.calendar;
  if (!calendar?.enabled || !isSchoolDay(calendar.selectedDate) || !calendarRecord(state, calendar.selectedDate)) return false;
  const reference = snapshot(state), previous = calendarRecord(state, calendar.selectedDate);
  if (previous && signature(reference) === signature({ rosterId: previous.rosterId, layoutId: previous.layoutId, absentIds: previous.absentIds })) return false;
  calendar.days[calendar.selectedDate] = { ...reference, attendanceSaved: previous.attendanceSaved === true && attendanceMatches(state, previous), updated: new Date().toISOString() };
  collectCalendarRecords(calendar);
  return true;
}

export function setCalendarEnabled(state, enabled, date = state.calendar?.selectedDate ?? todayKey()) {
  if (typeof enabled !== 'boolean' || !validDateKey(date)) throw Error('Kies een geldige kalenderdatum.');
  const calendar = ensureCalendar(state);
  if (calendar.enabled === enabled) return;
  if (enabled) {
    if (!isSchoolDay(date)) date = shiftSchoolDay(date);
    calendar.baseline = snapshot(state);
    calendar.enabled = true;
    calendar.selectedDate = date;
    const existing = calendarRecord(state, date) ?? calendarDraft(state, date);
    if (existing) restore(state, existing);
    else if (calendarNeedsStart(state, date)) clearDaySeating(state);
  } else {
    preserveOpenDay(state);
    if (calendar.baseline) restore(state, calendar.baseline);
    calendar.enabled = false;
    calendar.baseline = null;
    collectCalendarRecords(calendar);
  }
}

export function previousCalendarDate(state, date) {
  const dates = Object.keys(state.calendar?.days ?? {});
  if (state.calendar?.enabled && !calendarNeedsStart(state, state.calendar.selectedDate)) dates.push(state.calendar.selectedDate);
  return dates.filter(key => key < date && isSchoolDay(key)).sort().at(-1) ?? null;
}

function clearDaySeating(state) {
  leaveWeeklyDay(state);
  delete state.weeklyPlans;
  // Keep room restrictions and other rules; chair-specific pins belong to the
  // seating scheme being cleared, so retain only their room restriction.
  state.rules = state.rules.flatMap(rule => {
    if (rule.type !== 'fixed' || !rule.seat) return [rule];
    if (!rule.roomId) return [];
    const { seat, ...roomRule } = rule;
    return [roomRule];
  });
  for (const room of state.rooms) {
    room.assignments = {};
    room.locks = [];
    room.hiddenWarnings = [];
  }
  state.assignments = {};
  state.locks = [];
  state.hiddenWarnings = [];
  state.benchLocks = [];
  for (const student of state.students) student.attendanceAbsent = false;
  captureRoom(state);
}

export function openCalendarDate(state, date, { fresh = false, sourceDate } = {}) {
  if (!validDateKey(date)) throw Error('Kies een geldige kalenderdatum.');
  if (!isSchoolDay(date)) throw Error('Woensdag, zaterdag en zondag zijn geen schooldagen.');
  const openSource = state.calendar?.enabled && sourceDate === state.calendar.selectedDate && sourceDate !== date && !calendarNeedsStart(state, sourceDate);
  if (sourceDate !== undefined && (!validDateKey(sourceDate) || !isSchoolDay(sourceDate) || !calendarRecord(state, sourceDate) && !openSource)) throw Error('Kies een bewaarde schooldag om te kopiëren.');
  const calendar = ensureCalendar(state);
  const needsStart = calendarNeedsStart(state, date);
  if (needsStart && !fresh && !sourceDate) throw Error('Kies eerst hoe je deze dag wilt starten.');
  const existing = calendarRecord(state, date) ?? calendarDraft(state, date);
  if (!calendar.enabled) {
    setCalendarEnabled(state, true, date);
    if (existing) return;
    if (sourceDate) restore(state, { ...calendarRecord(state, sourceDate), absentIds: [] });
    else if (fresh) clearDaySeating(state);
    finishDayStart(calendar, date);
    return;
  }
  if (calendar.selectedDate === date && !fresh && !sourceDate) return;
  if (calendar.selectedDate !== date && isSchoolDay(calendar.selectedDate) && !calendarNeedsStart(state, calendar.selectedDate)) saveCalendarPeriod(state, calendar.selectedDate, 'day');
  calendar.selectedDate = date;
  if (existing) restore(state, existing);
  else if (sourceDate) restore(state, { ...calendarRecord(state, sourceDate), absentIds: [] });
  else if (fresh) clearDaySeating(state);
  else restore(state, { ...calendar.baseline, absentIds: [] });
  finishDayStart(calendar, date);
}

// Saving a period fills missing dates; it never overwrites recorded attendance.
export function saveCalendarPeriod(state, date, scope) {
  const dates = periodDates(date, scope).filter(isSchoolDay);
  if (scope === 'day' && !dates.length) throw Error('Woensdag, zaterdag en zondag zijn geen schooldagen.');
  if (scope === 'day' && calendarNeedsStart(state, date)) throw Error('Kies eerst hoe je deze dag wilt starten.');
  captureCalendarDay(state);
  const calendar = ensureCalendar(state), reference = snapshot(state);
  let created = 0;
  for (const key of dates) if (!calendarRecord(state, key) && !calendarNeedsStart(state, key)) {
    const draft = calendarDraft(state, key);
    const dayReference = draft && (!calendar.enabled || calendar.selectedDate !== key) ? draft : reference;
    calendar.days[key] = { ...clone(dayReference), absentIds: draft || scope === 'day' || calendar.enabled && key === calendar.selectedDate ? [...dayReference.absentIds] : [], attendanceSaved: false, updated: new Date().toISOString() };
    if (calendar.drafts) delete calendar.drafts[key];
    created++;
  }
  collectCalendarRecords(calendar);
  return created;
}

export function calendarSummary(state, date) {
  const day = calendarRecord(state, date);
  if (!day) return null;
  const roster = ownValue(state.calendar.rosters, day.rosterId);
  const absentIds = new Set(day.absentIds), counts = { present: 0, absent: 0, unexpected: 0 };
  for (const student of roster) counts[attendanceStatus({ ...student, attendanceAbsent: absentIds.has(student.id) }, date)]++;
  return { total: roster.length, ...counts, rosterId: day.rosterId, layoutId: day.layoutId, attendanceSaved: calendarAttendanceSaved(state, date) };
}

export function deleteCalendarDay(state, date) {
  const calendar = state.calendar;
  const activeConcept = calendar?.enabled && calendar.selectedDate === date && !calendarNeedsStart(state, date);
  if (!calendarRecord(state, date) && !calendarDraft(state, date) && !activeConcept) return false;
  delete state.calendar.days[date];
  if (state.calendar.drafts) delete state.calendar.drafts[date];
  if (isSchoolDay(date)) {
    calendar.pendingDates = [...new Set([...(calendar.pendingDates ?? []), date])];
    if (calendar.enabled && calendar.selectedDate === date) clearDaySeating(state);
  }
  collectCalendarRecords(state.calendar);
  return true;
}

export function calendarExportRows(state, date, scope) {
  const rows = [];
  for (const key of periodDates(date, scope)) {
    const reference = calendarRecord(state, key);
    if (!reference) continue;
    const day = calendarDayState(state.calendar, reference);
    const attendanceSaved = calendarAttendanceSaved(state, key);
    const places = new Map();
    for (const room of day.rooms) for (const [seat, id] of Object.entries(room.assignments)) {
      places.set(id, { room: room.name, seat: seatCode(seat, { ...day.settings, ...room.settings, layout: room.layout.kind === 'custom' ? room.layout : undefined }) });
    }
    for (const student of day.students) {
      const place = places.get(student.id);
      rows.push([key, dateLabel(key, { weekday: 'long' }), student.name, student.class, student.year ?? '', attendanceSaved ? attendanceLabel(attendanceStatus(student, key)) : 'Niet bewaard', place?.room ?? day.rooms.find(room => room.id === ownValue(day.studentRooms, student.id))?.name ?? 'Nog geen lokaal', place?.seat ?? 'Nog niet geplaatst']);
    }
  }
  return rows;
}

export function importCalendarData(state, data, validateDay) {
  if (!object(data)) throw Error('Ongeldig kalenderbestand.');
  const incoming = { ...data, enabled: false, selectedDate: Object.keys(data.days ?? {})[0] ?? todayKey(), baseline: null };
  if (!calendarValid(incoming, validateDay)) throw Error('Het kalenderbestand bevat ongeldige dagen, leerlingen of opstellingen.');
  const closedDates = Object.keys(incoming.days).filter(date => !isSchoolDay(date));
  if (closedDates.length) {
    const dates = closedDates.sort().slice(0, 3).map(date => dateLabel(date)).join(', ');
    throw Error(`Kalenderbestand bevat dagen die niet geopend kunnen worden: ${dates}${closedDates.length > 3 ? ', …' : ''}. Woensdag, zaterdag en zondag kunnen niet geïmporteerd worden.`);
  }
  const calendar = ensureCalendar(state);
  const activeDraft = calendar.enabled && !calendarRecord(state, calendar.selectedDate);
  let added = 0, skipped = 0;
  for (const [date, reference] of Object.entries(incoming.days)) {
    if (calendarRecord(state, date)) { skipped++; continue; }
    const rosterId = intern(calendar.rosters, ownValue(incoming.rosters, reference.rosterId), 'roster');
    const layoutId = intern(calendar.layouts, ownValue(incoming.layouts, reference.layoutId), 'layout');
    calendar.days[date] = { rosterId, layoutId, absentIds: [...reference.absentIds], attendanceSaved: reference.attendanceSaved === true, updated: reference.updated };
    if (calendar.drafts) delete calendar.drafts[date];
    finishDayStart(calendar, date);
    added++;
  }
  // An imported saved day replaces its open draft before the normal commit
  // captures changes; otherwise that draft would overwrite the archive.
  if (activeDraft && calendarRecord(state, calendar.selectedDate) && isSchoolDay(calendar.selectedDate)) restore(state, calendarRecord(state, calendar.selectedDate));
  collectCalendarRecords(calendar);
  return { added, skipped };
}

export function calendarValid(calendar, validateDay) {
  try {
    if (calendar === undefined) return true;
    if (!object(calendar) || calendar.version !== 1 || typeof calendar.enabled !== 'boolean' || !validDateKey(calendar.selectedDate) || !['days', 'rosters', 'layouts'].every(key => object(calendar[key]))) return false;
    if (calendar.drafts !== undefined && !object(calendar.drafts)) return false;
    if (calendar.pendingDates !== undefined && (!Array.isArray(calendar.pendingDates) || new Set(calendar.pendingDates).size !== calendar.pendingDates.length || calendar.pendingDates.some(date => !validDateKey(date) || !isSchoolDay(date) || ownValue(calendar.days, date) || ownValue(calendar.drafts, date)))) return false;
    if (calendar.enabled && !calendar.baseline) return false;
    const references = [...[...Object.entries(calendar.days), ...Object.entries(calendar.drafts ?? {})].map(([date, day]) => {
      if (!validDateKey(date) || !object(day) || typeof day.updated !== 'string' || !Number.isFinite(Date.parse(day.updated))) throw Error('Ongeldige kalenderdag.');
      return day;
    }), ...(calendar.baseline ? [calendar.baseline] : [])];
    const checked = new Set();
    for (const reference of references) {
      if (!object(reference) || typeof reference.rosterId !== 'string' || typeof reference.layoutId !== 'string' || !Array.isArray(reference.absentIds)) return false;
      if (reference.attendanceSaved !== undefined && typeof reference.attendanceSaved !== 'boolean') return false;
      const roster = ownValue(calendar.rosters, reference.rosterId), layout = ownValue(calendar.layouts, reference.layoutId);
      if (!Array.isArray(roster) || !object(layout)) return false;
      const ids = new Set(roster.map(student => student?.id));
      if (new Set(reference.absentIds).size !== reference.absentIds.length || reference.absentIds.some(id => typeof id !== 'string' || !ids.has(id))) return false;
      const pair = JSON.stringify([reference.rosterId, reference.layoutId]);
      if (!checked.has(pair) && !validateDay(calendarDayState(calendar, reference))) return false;
      checked.add(pair);
    }
    return true;
  } catch { return false; }
}
