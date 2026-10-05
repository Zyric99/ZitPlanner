import test from 'node:test';
import assert from 'node:assert/strict';
import { defaults, sampleStudents } from '../src/engine.mjs';
import { initializeRooms, normalizeRooms } from '../src/rooms.mjs';
import { attendanceStatus, setStudentAttendance, resetStudentAttendance } from '../src/attendance.mjs';
import { setCalendarEnabled, saveCalendarAttendance, openCalendarDate, calendarSummary, calendarExportRows } from '../src/calendar-model.mjs';
import { calendarWorkbook } from '../src/calendar-export.mjs';

function fixture() {
  const state = initializeRooms(defaults());
  state.students = sampleStudents().slice(0, 5).map((student, index) => ({ ...student, eveningStudy: { maandag: ['Ja', 'Ja', 'Nee', 'Nee', ''][index], dinsdag: 'Ja', donderdag: 'Ja', vrijdag: 'Ja' } }));
  normalizeRooms(state);
  setCalendarEnabled(state, true, '2026-10-05');
  for (const index of [1, 3]) setStudentAttendance(state, state.students[index].id, true);
  saveCalendarAttendance(state);
  return state;
}

function worksheet(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), decoder = new TextDecoder();
  for (let cursor = 0; view.getUint32(cursor, true) === 0x04034b50;) {
    const size = view.getUint32(cursor + 18, true), nameLength = view.getUint16(cursor + 26, true), extraLength = view.getUint16(cursor + 28, true), start = cursor + 30 + nameLength + extraLength;
    const name = decoder.decode(bytes.subarray(cursor + 30, cursor + 30 + nameLength));
    if (name === 'xl/worksheets/sheet1.xml') return decoder.decode(bytes.subarray(start, start + size));
    cursor = start + size;
  }
  throw Error('Missing calendar worksheet');
}

test('calendar counts only expected pupils as present or absent, including unexpected absence flags', () => {
  const state = fixture(), before = structuredClone(state), summary = calendarSummary(state, '2026-10-05');
  assert.equal(summary.total, 5);
  assert.equal(summary.present, 1);
  assert.equal(summary.absent, 1);
  assert.equal(summary.unexpected, 3);
  assert.equal(summary.attendanceSaved, true);
  assert.deepEqual(state, before);
});

test('calendar Excel exports confirmed unexpected pupils neutrally and unconfirmed attendance in gray', () => {
  const state = fixture(), bytes = calendarWorkbook(state, '2026-10-05', 'day');
  const xml = worksheet(bytes), labels = [...xml.matchAll(/<c r="F\d+"[^>]*>.*?<t[^>]*>(.*?)<\/t>.*?<\/c>/g)].slice(1).map(match => match[1]);
  assert.deepEqual(labels, ['Aanwezig', 'Afwezig', 'Niet verwacht', 'Niet verwacht', 'Niet verwacht']);
  for (const [index, style] of [3, 4, 0, 0, 0].entries()) assert.match(xml, new RegExp(`r="F${index + 2}" t="inlineStr" s="${style}"`));
  resetStudentAttendance(state);
  const draftBytes = calendarWorkbook(state, '2026-10-05', 'day');
  assert.deepEqual(calendarExportRows(state, '2026-10-05', 'day').map(row => row[5]), Array(5).fill('Niet bewaard'));
  for (let row = 2; row <= 6; row++) assert.match(worksheet(draftBytes), new RegExp(`r="F${row}" t="inlineStr" s="5"`));
});

test('historical summary and export use the archived weekday schedule after later edits and reopening', () => {
  const state = fixture();
  const originalRows = calendarExportRows(state, '2026-10-05', 'day');
  openCalendarDate(state, '2026-10-06');
  for (const student of state.students) student.eveningStudy.maandag = student.eveningStudy.maandag === 'Ja' ? 'Nee' : 'Ja';
  saveCalendarAttendance(state);
  const before = structuredClone(state), summary = calendarSummary(state, '2026-10-05');
  assert.deepEqual([summary.present, summary.absent, summary.unexpected], [1, 1, 3]);
  assert.deepEqual(calendarExportRows(state, '2026-10-05', 'day'), originalRows);
  assert.deepEqual(state, before);
  const reopened = JSON.parse(JSON.stringify(state));openCalendarDate(reopened, '2026-10-05');
  assert.deepEqual(reopened.students.map(student => attendanceStatus(student, '2026-10-05')), ['present', 'absent', 'unexpected', 'unexpected', 'unexpected']);
  assert.deepEqual(calendarExportRows(reopened, '2026-10-05', 'day'), originalRows);
  const restored = calendarSummary(reopened, '2026-10-05');
  assert.deepEqual([restored.present, restored.absent, restored.unexpected], [1, 1, 3]);
});
