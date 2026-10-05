import test from 'node:test';
import assert from 'node:assert/strict';
import { defaults, sampleStudents, generate, enabledSeats, evaluate } from '../src/engine.mjs';
import { initializeRooms, normalizeRooms, newRoom, roomState } from '../src/rooms.mjs';
import { generateWeek, applyWeeklyDay, weeklyCurrent } from '../src/weekly-planner.mjs';
import { setStudentAttendance, resetStudentAttendance, studentIsAbsent, studentExpectedOnDate, attendanceDate, attendanceStatus } from '../src/attendance.mjs';
import { setCalendarEnabled, saveCalendarAttendance, calendarAttendanceSaved, openCalendarDate, captureCalendarDay, calendarRecord } from '../src/calendar-model.mjs';
import { validState } from '../src/project-validation.mjs';
import { evaluateCrossRoomRules } from '../src/auto-distribution.mjs';
import { seatingRows } from '../src/excel-export.mjs';

function fixture() {
  const state = initializeRooms(defaults());
  state.students = sampleStudents().slice(0, 3);
  state.settings.classRulesEnabled = false;
  state.settings.yearRulesEnabled = false;
  normalizeRooms(state);
  return state;
}

test('expected attendance follows the viewed weekday without using planner exclusions or roll call', () => {
  const student = { absent: true, attendanceAbsent: true, eveningStudy: { maandag: 'Nee', dinsdag: 'Ja', donderdag: '', vrijdag: 'Ja' } };
  const before = structuredClone(student);
  assert.equal(studentExpectedOnDate(student, '2026-10-05'), false);
  assert.equal(attendanceStatus(student, '2026-10-05'), 'unexpected');
  assert.equal(studentExpectedOnDate(student, '2026-10-06'), true);
  assert.equal(attendanceStatus(student, '2026-10-06'), 'absent');
  assert.equal(studentExpectedOnDate(student, '2026-10-08'), false);
  for (const date of ['2026-10-07', '2026-10-10', '2026-10-11']) assert.equal(studentExpectedOnDate({}, date), false);
  assert.equal(attendanceStatus({}, '2026-10-05'), 'present');
  assert.deepEqual(student, before);
});

test('attendance uses the selected calendar day or real Belgian today when disabled', () => {
  const state = { calendar: { enabled: true, selectedDate: '2026-10-06' } };
  const now = new Date('2026-10-04T22:30:00Z');
  assert.equal(attendanceDate(state, now), '2026-10-06');
  state.calendar.enabled = false;
  assert.equal(attendanceDate(state, now), '2026-10-05');
  assert.equal(attendanceDate({}, now), '2026-10-05');
});

test('reset clears confirmation and restores expected pupils without changing seating or other dates',()=>{
  const state=fixture();
  state.students[0].eveningStudy={maandag:'Ja',dinsdag:'Nee',donderdag:'Ja',vrijdag:'Ja'};
  state.students[1].eveningStudy={maandag:'Nee',dinsdag:'Ja',donderdag:'Ja',vrijdag:'Ja'};
  setCalendarEnabled(state,true,'2026-10-05');saveCalendarAttendance(state);
  const monday=structuredClone(calendarRecord(state,'2026-10-05'));
  openCalendarDate(state,'2026-10-06');
  for(const student of state.students)setStudentAttendance(state,student.id,true);
  saveCalendarAttendance(state);
  const before=structuredClone(state);
  resetStudentAttendance(state);captureCalendarDay(state);
  assert.equal(calendarAttendanceSaved(state),false);
  assert.equal(state.students[0].attendanceAbsent,true);
  assert.ok(state.students.slice(1).every(student=>student.attendanceAbsent===false));
  assert.deepEqual(calendarRecord(state,'2026-10-06').absentIds,[state.students[0].id]);
  assert.deepEqual(calendarRecord(state,'2026-10-05'),monday);
  assert.deepEqual(state.rooms,before.rooms);assert.deepEqual(state.assignments,before.assignments);
  assert.deepEqual(state.locks,before.locks);assert.deepEqual(state.rules,before.rules);
  assert.equal(validState(state),true);
  const reopened=JSON.parse(JSON.stringify(state));openCalendarDate(reopened,'2026-10-05');openCalendarDate(reopened,'2026-10-06');
  assert.equal(calendarAttendanceSaved(reopened),false);assert.equal(reopened.students[1].attendanceAbsent,false);
});

test('reset works without enabling the calendar and does not create a recorded concept',()=>{
  const state=fixture();setStudentAttendance(state,state.students[0].id,true);
  saveCalendarAttendance(state,'2026-10-05');resetStudentAttendance(state,'2026-10-05');
  assert.equal(state.calendar.enabled,false);assert.equal(calendarAttendanceSaved(state,'2026-10-05'),false);
  setCalendarEnabled(state,true,'2026-10-05');assert.equal(state.students[0].attendanceAbsent,false);
  openCalendarDate(state,'2026-10-06');setStudentAttendance(state,state.students[0].id,true);
  resetStudentAttendance(state);
  assert.equal(calendarRecord(state,'2026-10-06'),undefined);assert.equal(state.students[0].attendanceAbsent,false);
  const before=structuredClone(state);assert.throws(()=>resetStudentAttendance(state,'2026-10-07'),/schooldagen/);assert.deepEqual(state,before);
});

test('attendance preserves seats, pins, rules, planning warnings and exports across rooms', () => {
  const state = fixture(), id = state.students[0].id;
  const other = newRoom(state, 'Tweede lokaal', 'classroom');
  state.studentRooms[id] = other.id;
  other.assignments = { [enabledSeats(roomState(state, other.id).settings)[0]]: id };
  other.locks = [id];
  state.rules = [{ id: 'fixed', type: 'fixed', students: [id], roomId: other.id, priority: 'Verplicht' }];
  normalizeRooms(state);
  assert.equal(Object.values(other.assignments).includes(id), true);
  const before = structuredClone(state), warnings = evaluate(state).warnings;
  const crossRoom = evaluateCrossRoomRules(state, true), rows = seatingRows(state, { allRooms: true });
  const plan = generate(roomState(state, other.id), { iterations: 10, random: () => 0.5 }).assignments;
  setStudentAttendance(state, id, true);
  normalizeRooms(state);
  assert.equal(studentIsAbsent(state.students[0]), true);
  assert.equal(state.students[0].absent, false);
  assert.deepEqual(state.rooms, before.rooms);
  assert.deepEqual(state.assignments, before.assignments);
  assert.deepEqual(state.studentRooms, before.studentRooms);
  assert.deepEqual(state.rules, before.rules);
  assert.deepEqual(evaluate(state).warnings, warnings);
  assert.deepEqual(evaluateCrossRoomRules(state, true), crossRoom);
  assert.deepEqual(seatingRows(state, { allRooms: true }), rows);
  assert.equal(validState(state), true);
  assert.deepEqual(generate(roomState(state, other.id), { iterations: 10, random: () => 0.5 }).assignments, plan);
  setStudentAttendance(state, id, false);
  normalizeRooms(state);
  assert.equal(studentIsAbsent(state.students[0]), false);
  assert.deepEqual(state.rooms, before.rooms);
  assert.equal(validState(state), true);
});

test('roll-call attendance leaves saved days and their planner attendance unchanged', () => {
  const state = fixture();
  state.students[0].eveningStudy = { maandag: 'Ja', dinsdag: 'Ja', donderdag: 'Ja', vrijdag: 'Ja' };
  state.students[1].eveningStudy = { maandag: 'Nee', dinsdag: 'Ja', donderdag: 'Nee', vrijdag: 'Ja' };
  state.weeklyPlans = generateWeek(state, { iterations: 10, random: () => 0.5 });
  applyWeeklyDay(state, 'maandag');
  normalizeRooms(state);
  assert.equal(state.students[1].absent, true);
  const before = structuredClone(state);
  setStudentAttendance(state, state.students[0].id, true);
  normalizeRooms(state);
  assert.equal(studentIsAbsent(state.students[0]), true);
  assert.equal(state.students[0].absent, false);
  assert.equal(state.students[1].absent, true);
  assert.deepEqual(state.rooms, before.rooms);
  assert.deepEqual(state.weeklyPlans, before.weeklyPlans);
  assert.equal(weeklyCurrent(state), true);
  assert.equal(validState(state), true);
});

test('new students start present and invalid attendance edits preserve the project', () => {
  const state = fixture(), before = structuredClone(state);
  assert.ok(state.students.every(p => !studentIsAbsent(p)));
  setStudentAttendance(state, 'unknown', true);
  setStudentAttendance(state, state.students[0].id, 'true');
  assert.deepEqual(state, before);
});

test('attendance survives project serialization and validates its optional field', () => {
  const state = fixture();
  assert.equal(validState(state), true);
  setStudentAttendance(state, state.students[0].id, true);
  const reopened = initializeRooms(JSON.parse(JSON.stringify(state)));
  normalizeRooms(reopened);
  assert.equal(studentIsAbsent(reopened.students[0]), true);
  assert.equal(validState(reopened), true);
  reopened.attendanceColorsEnabled = true;
  assert.equal(validState(reopened), true);
  reopened.attendanceColorsEnabled = 'true';
  assert.equal(validState(reopened), false);
  delete reopened.attendanceColorsEnabled;
  reopened.students[0].attendanceAbsent = 'true';
  assert.equal(validState(reopened), false);
});
