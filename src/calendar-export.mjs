import { periodDates } from './calendar-dates.mjs';
import { calendarRecord, calendarExportRows } from './calendar-model.mjs';
import { tableWorkbook } from './excel-export.mjs';

export function calendarWorkbook(state, date, scope) {
  const rows = calendarExportRows(state, date, scope);
  const headers = ['Datum', 'Dag', 'Naam', 'Klas', 'Leerjaar', 'Aanwezigheid', 'Lokaal', 'Plaats'];
  const cellStyles = rows.map(row => row.map((_, index) => index === 5 ? row[5] === 'Afwezig' ? 4 : row[5] === 'Aanwezig' ? 3 : row[5] === 'Niet verwacht' ? 0 : 5 : 0));
  return tableWorkbook(headers, rows, { sheetName: 'Kalender', tableName: 'Kalender', cellStyles });
}

export function calendarBackup(state, date, scope) {
  const calendar = state.calendar;
  const days = Object.fromEntries(periodDates(date, scope).filter(key => calendarRecord(state, key)).map(key => [key, calendar.days[key]]));
  const rosterIds = new Set(Object.values(days).map(day => day.rosterId)), layoutIds = new Set(Object.values(days).map(day => day.layoutId));
  return { version: 1, days, rosters: Object.fromEntries([...rosterIds].map(id => [id, calendar.rosters[id]])), layouts: Object.fromEntries([...layoutIds].map(id => [id, calendar.layouts[id]])) };
}
