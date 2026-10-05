import test from 'node:test';
import assert from 'node:assert/strict';
import { defaults, sampleStudents, enabledSeats } from '../src/engine.mjs';
import { initializeRooms, normalizeRooms, captureRoom, newRoom, roomState, switchRoom } from '../src/rooms.mjs';
import { setStudentAttendance } from '../src/attendance.mjs';
import { setCalendarEnabled, openCalendarDate, captureCalendarDay, saveCalendarPeriod, saveCalendarAttendance, calendarAttendanceSaved, calendarRecord, calendarDraft, calendarNeedsStart, calendarSummary, calendarExportRows, calendarDayState, importCalendarData, deleteCalendarDay, previousCalendarDate } from '../src/calendar-model.mjs';
import { todayKey } from '../src/calendar-dates.mjs';
import { calendarBackup } from '../src/calendar-export.mjs';
import { validState } from '../src/project-validation.mjs';
import { emptyProjectState } from '../src/project-session.mjs';
import { generateWeek, applyWeeklyDay } from '../src/weekly-planner.mjs';
import { packGridRoom, unpackGridRoom } from '../src/grid-room.mjs';

function fixture(count = 4) {
  const state = initializeRooms(defaults());
  state.students = sampleStudents().slice(0, count);
  state.settings.classRulesEnabled = false;
  state.settings.yearRulesEnabled = false;
  normalizeRooms(state);
  const seats = enabledSeats(state.settings);
  state.assignments = Object.fromEntries(state.students.map((student, i) => [seats[i], student.id]));
  state.locks = [state.students[0].id];
  captureRoom(state);
  return state;
}

test('attendance requires its own save and is invalidated by roll call or roster changes',()=>{
  const state=fixture();setCalendarEnabled(state,true,'2026-10-05');
  const seats=structuredClone(state.assignments),pins=structuredClone(state.locks);
  saveCalendarPeriod(state,'2026-10-05','day');
  assert.equal(calendarAttendanceSaved(state),false);
  saveCalendarAttendance(state);
  assert.equal(calendarAttendanceSaved(state),true);
  assert.deepEqual(state.assignments,seats);assert.deepEqual(state.locks,pins);
  assert.equal(calendarRecord(state,'2026-10-05').attendanceSaved,true);
  // Seating and names are independent of the confirmed roll call.
  state.students[0].name='Nieuwe naam';state.students[1].absent=true;captureCalendarDay(state);
  assert.equal(calendarAttendanceSaved(state),true);
  setStudentAttendance(state,state.students[0].id,true);
  assert.equal(calendarAttendanceSaved(state),false);
  captureCalendarDay(state);assert.equal(calendarRecord(state,'2026-10-05').attendanceSaved,false);
  saveCalendarAttendance(state);assert.equal(calendarAttendanceSaved(state),true);
  const reopened=JSON.parse(JSON.stringify(state));assert.equal(calendarAttendanceSaved(reopened),true);
  reopened.students.push({id:'new',name:'Nieuwe leerling',class:'3A',year:'3',absent:false});normalizeRooms(reopened);
  assert.equal(calendarAttendanceSaved(reopened),false);
  captureCalendarDay(reopened);assert.equal(calendarRecord(reopened,'2026-10-05').attendanceSaved,false);
});

test('confirming a reopened concept removes its cached draft and retains confirmation on import',()=>{
  const state=fixture();setCalendarEnabled(state,true,'2026-10-05');
  setStudentAttendance(state,state.students[0].id,true);setCalendarEnabled(state,false);
  assert.ok(calendarDraft(state,'2026-10-05'));
  setCalendarEnabled(state,true,'2026-10-05');saveCalendarAttendance(state);
  assert.equal(calendarDraft(state,'2026-10-05'),undefined);assert.equal(calendarAttendanceSaved(state),true);
  const target=fixture();setCalendarEnabled(target,true,'2026-10-05');
  importCalendarData(target,calendarBackup(state,'2026-10-05','day'),validState);
  assert.equal(calendarAttendanceSaved(target),true);assert.equal(target.students[0].attendanceAbsent,true);
});

test('day switching, copies and bulk layout saves never confirm attendance',()=>{
  const state=fixture();setCalendarEnabled(state,true,'2026-10-05');saveCalendarAttendance(state);
  openCalendarDate(state,'2026-10-06',{sourceDate:'2026-10-05'});
  assert.equal(calendarAttendanceSaved(state),false);
  openCalendarDate(state,'2026-10-08');
  assert.equal(calendarRecord(state,'2026-10-06').attendanceSaved,false);
  saveCalendarPeriod(state,'2026-10-05','month');
  assert.equal(calendarAttendanceSaved(state,'2026-10-05'),true);
  assert.ok(Object.entries(state.calendar.days).filter(([date])=>date!=='2026-10-05').every(([,day])=>day.attendanceSaved===false));
  openCalendarDate(state,'2026-10-05');assert.equal(calendarAttendanceSaved(state),true);
  deleteCalendarDay(state,'2026-10-05');assert.equal(calendarAttendanceSaved(state),false);
  assert.throws(()=>saveCalendarAttendance(state),/starten/);
});

test('saving attendance with the calendar disabled records today without enabling it',()=>{
  const state=fixture();setStudentAttendance(state,state.students[0].id,true);
  saveCalendarAttendance(state);
  assert.equal(state.calendar.enabled,false);assert.equal(calendarAttendanceSaved(state,todayKey()),true);
  assert.deepEqual(calendarRecord(state,todayKey()).absentIds,[state.students[0].id]);
  setStudentAttendance(state,state.students[1].id,true);assert.equal(calendarAttendanceSaved(state),false);
  saveCalendarAttendance(state);assert.equal(calendarAttendanceSaved(state),true);
  const before=structuredClone(state);
  assert.throws(()=>saveCalendarAttendance(state,'2026-10-07'),/schooldagen/);assert.deepEqual(state,before);
});

test('backups retain explicit confirmation, while legacy or malformed flags cannot confirm attendance',()=>{
  const source=fixture();setCalendarEnabled(source,true,'2026-10-05');saveCalendarAttendance(source);
  const data=calendarBackup(source,'2026-10-05','day'),target=fixture();
  importCalendarData(target,data,validState);assert.equal(calendarAttendanceSaved(target,'2026-10-05'),true);
  const legacy=structuredClone(source);delete legacy.calendar.days['2026-10-05'].attendanceSaved;
  assert.equal(validState(legacy),true);assert.equal(calendarAttendanceSaved(legacy),false);
  const bad=structuredClone(data);bad.days['2026-10-05'].attendanceSaved='true';
  const before=structuredClone(target);assert.throws(()=>importCalendarData(target,bad,validState),/ongeldige/);assert.deepEqual(target,before);
});

test('a month shares one roster and layout, and stores attendance as exceptions', () => {
  const state = fixture(48);
  setCalendarEnabled(state, true, '2026-10-05');saveCalendarPeriod(state, '2026-10-05', 'day');
  const monday = calendarRecord(state, '2026-10-05');
  const created = saveCalendarPeriod(state, '2026-10-05', 'month');
  assert.equal(created, 17);
  assert.equal(Object.keys(state.calendar.days).length, 18);
  assert.equal(Object.keys(state.calendar.rosters).length, 1);
  assert.equal(Object.keys(state.calendar.layouts).length, 1);
  assert.ok(Object.values(state.calendar.days).every(day => day.rosterId === monday.rosterId && day.layoutId === monday.layoutId && day.absentIds.length === 0 && day.students === undefined && day.rooms === undefined));
  setStudentAttendance(state, state.students[0].id, true);
  captureCalendarDay(state);
  assert.deepEqual(calendarRecord(state, '2026-10-05').absentIds, [state.students[0].id]);
  assert.equal(Object.keys(state.calendar.rosters).length, 1);
  assert.equal(Object.keys(state.calendar.layouts).length, 1);
  assert.equal(saveCalendarPeriod(state, '2026-10-05', 'month'), 0);
  assert.deepEqual(calendarRecord(state, '2026-10-05').absentIds, [state.students[0].id]);
  assert.equal(calendarSummary(state, '2026-10-06').absent, 0);
  assert.equal(validState(state), true);
  const fullPerDay = JSON.stringify(calendarDayState(state.calendar, monday)).length * 31;
  assert.ok(JSON.stringify(state.calendar).length < fullPerDay / 10);
});

test('dates independently reopen attendance, seats, pins and historical rosters after serialization', () => {
  const state = fixture(), original = structuredClone(state);
  setCalendarEnabled(state, true, '2026-10-05');saveCalendarPeriod(state, '2026-10-05', 'day');
  setStudentAttendance(state, state.students[0].id, true);
  captureCalendarDay(state);
  openCalendarDate(state, '2026-10-06');saveCalendarPeriod(state, '2026-10-06', 'day');
  assert.ok(state.students.every(student => !student.attendanceAbsent));
  assert.deepEqual(state.assignments, original.assignments);
  const seats = enabledSeats(state.settings), id = state.students[0].id;
  delete state.assignments[seats[0]];
  state.assignments[seats[8]] = id;
  state.students.push({ id: 'new', name: 'Nieuwe leerling', class: '3C', year: '3', absent: false });
  normalizeRooms(state);captureCalendarDay(state);
  const tuesday = structuredClone(state), oldRef = calendarRecord(state, '2026-10-05'), newRef = calendarRecord(state, '2026-10-06');
  assert.notEqual(oldRef.rosterId, newRef.rosterId);
  assert.notEqual(oldRef.layoutId, newRef.layoutId);
  openCalendarDate(state, '2026-10-05');
  assert.equal(state.students.length, original.students.length);
  assert.equal(state.students[0].attendanceAbsent, true);
  assert.deepEqual(state.assignments, original.assignments);
  assert.deepEqual(state.locks, original.locks);
  const reopened = initializeRooms(JSON.parse(JSON.stringify(state)));
  assert.equal(validState(reopened), true);
  openCalendarDate(reopened, '2026-10-06');
  assert.deepEqual(reopened.assignments, tuesday.assignments);
  assert.equal(reopened.students.length, 5);
  assert.equal(validState(reopened), true);
  setCalendarEnabled(reopened, false);
  assert.deepEqual(reopened.students.map(({ attendanceAbsent, ...p }) => p), original.students);
  assert.deepEqual(reopened.assignments, original.assignments);
  assert.equal(Object.keys(reopened.calendar.days).length, 2);
  assert.equal(validState(reopened), true);
});

test('changing the active room does not create another shared layout; seats in all rooms reopen', () => {
  const state = fixture(), first = state.activeRoomId, id = state.students[1].id;
  const second = newRoom(state, 'Tweede lokaal', 'classroom');
  const seat = enabledSeats(roomState(state, second.id).settings)[0];
  state.studentRooms[id] = second.id;
  second.assignments = { [seat]: id };
  normalizeRooms(state);
  setCalendarEnabled(state, true, '2026-10-05');saveCalendarPeriod(state, '2026-10-05', 'day');
  switchRoom(state, second.id);captureCalendarDay(state);
  assert.equal(Object.keys(state.calendar.layouts).length, 1);
  openCalendarDate(state, '2026-10-06');saveCalendarPeriod(state, '2026-10-06', 'day');
  state.assignments = {};state.locks = [];
  captureCalendarDay(state);
  openCalendarDate(state, '2026-10-05');
  assert.equal(state.activeRoomId, second.id);
  assert.equal(state.assignments[seat], id);
  switchRoom(state, first);
  assert.equal(Object.values(state.assignments).length, 3);
  assert.equal(validState(state), true);
});

test('week saving never overwrites prior dates and exports archived roster names and places', () => {
  const state = fixture();
  setCalendarEnabled(state, true, '2026-10-05');saveCalendarPeriod(state, '2026-10-05', 'day');
  setStudentAttendance(state, state.students[0].id, true);captureCalendarDay(state);
  assert.equal(saveCalendarPeriod(state, '2026-10-05', 'week'), 3);
  const before = structuredClone(calendarRecord(state, '2026-10-05'));
  state.students[0].name = 'Nieuwe naam';captureCalendarDay(state);
  assert.equal(saveCalendarPeriod(state, '2026-10-05', 'week'), 0);
  assert.equal(calendarRecord(state, '2026-10-06').rosterId, before.rosterId);
  const rows = calendarExportRows(state, '2026-10-05', 'week');
  assert.equal(rows.length, 16);
  assert.equal(rows[0][2], 'Nieuwe naam');
  assert.equal(rows[0][5], 'Niet bewaard');
  assert.notEqual(rows[0][7], 'Nog niet geplaatst');
  assert.equal(rows[4][2], 'Emma Peeters');
  assert.equal(rows[4][5], 'Niet bewaard');
});

test('validation rejects broken references, foreign absences and malformed dates; new projects clear history', () => {
  const state = fixture();
  setCalendarEnabled(state, true, '2026-10-05');saveCalendarPeriod(state, '2026-10-05', 'day');
  assert.equal(validState(state), true);
  for (const corrupt of [
    s => { s.calendar.days['2026-10-05'].rosterId = 'missing'; },
    s => { s.calendar.days['2026-10-05'].layoutId = 'missing'; },
    s => { s.calendar.days['2026-10-05'].absentIds = ['foreign']; },
    s => { s.calendar.selectedDate = '2026-02-30'; },
    s => { const day = s.calendar.days['2026-10-05'];s.calendar.days['2026-02-30'] = day; },
    s => { const ref = s.calendar.days['2026-10-05'];s.calendar.rosters[ref.rosterId][0].absent = 'invalid'; },
    s => { const ref = s.calendar.days['2026-10-05'];s.calendar.layouts[ref.layoutId].rooms[0].assignments = { 'bad:0': 'foreign' }; }
  ]) {
    const broken = structuredClone(state);corrupt(broken);assert.equal(validState(broken), false);
  }
  const fresh = emptyProjectState(state, 'Nieuw');
  assert.equal(fresh.calendar, undefined);
  assert.equal(validState(fresh), true);
});

test('calendar dates retain legacy weekly plans without mixing day filters and roll-call absence', () => {
  const state = fixture(2);
  state.students[0].eveningStudy = { maandag: 'Ja', dinsdag: 'Ja', donderdag: 'Ja', vrijdag: 'Ja' };
  state.students[1].eveningStudy = { maandag: 'Nee', dinsdag: 'Ja', donderdag: 'Nee', vrijdag: 'Ja' };
  state.weeklyPlans = generateWeek(state, { iterations: 10, random: () => 0.5 });
  applyWeeklyDay(state, 'maandag');normalizeRooms(state);
  setCalendarEnabled(state, true, '2026-10-05');saveCalendarPeriod(state, '2026-10-05', 'day');
  setStudentAttendance(state, state.students[0].id, true);captureCalendarDay(state);
  openCalendarDate(state, '2026-10-06');saveCalendarPeriod(state, '2026-10-06', 'day');
  openCalendarDate(state, '2026-10-05');
  assert.equal(state.students[0].attendanceAbsent, true);
  assert.equal(state.students[1].absent, true);
  assert.equal(state.weeklyPlans.activeDay, 'maandag');
  assert.equal(validState(state), true);
});

test('compact project serialization preserves shared IDs and archived room layouts', () => {
  const state = fixture();
  setCalendarEnabled(state, true, '2026-10-05');saveCalendarPeriod(state, '2026-10-05', 'day');saveCalendarPeriod(state, '2026-10-05', 'month');
  const packed = JSON.stringify(state, (_key, value) => packGridRoom(value));
  const reopened = initializeRooms(JSON.parse(packed, (_key, value) => unpackGridRoom(value)));
  assert.equal(validState(reopened), true);
  openCalendarDate(reopened, '2026-10-12');
  assert.deepEqual(reopened.assignments, state.assignments);
  assert.equal(Object.keys(reopened.calendar.layouts).length, 1);
  assert.equal(Object.keys(reopened.calendar.rosters).length, 1);
});

test('calendar backups import independent shared records, preserve existing dates and reject invalid data atomically', () => {
  const source = fixture();
  const target = structuredClone(source);
  setCalendarEnabled(source, true, '2026-10-05');saveCalendarPeriod(source, '2026-10-05', 'week');
  const data = structuredClone({ version: 1, days: source.calendar.days, rosters: source.calendar.rosters, layouts: source.calendar.layouts });
  setCalendarEnabled(target, true, '2026-10-05');saveCalendarPeriod(target, '2026-10-05', 'day');
  setStudentAttendance(target, target.students[0].id, true);captureCalendarDay(target);
  const saved = structuredClone(calendarRecord(target, '2026-10-05'));
  assert.deepEqual(importCalendarData(target, data, validState), { added: 3, skipped: 1 });
  assert.deepEqual(calendarRecord(target, '2026-10-05'), saved);
  assert.equal(Object.keys(target.calendar.rosters).length, 1);
  assert.equal(Object.keys(target.calendar.layouts).length, 1);
  data.days['2026-10-06'].absentIds.push('foreign');
  const before = structuredClone(target);
  assert.throws(() => importCalendarData(target, data, validState), /ongeldige/);
  assert.deepEqual(target, before);
  openCalendarDate(target, '2026-10-06');
  assert.ok(target.students.every(student => !student.attendanceAbsent));
  assert.equal(validState(target), true);
});

test('calendar import rejects Wednesdays and weekends before adding any dates or shared records', () => {
  const source=fixture();setCalendarEnabled(source,true,'2026-10-05');saveCalendarPeriod(source,'2026-10-05','day');
  const reference=structuredClone(calendarRecord(source,'2026-10-05'));
  for(const date of ['2026-10-07','2026-10-10','2026-10-11']) {
    const data=structuredClone({version:1,days:{'2026-10-05':reference,[date]:reference},rosters:source.calendar.rosters,layouts:source.calendar.layouts});
    for(const target of [fixture(),structuredClone(source)]) {
      const before=structuredClone(target),incomingBefore=structuredClone(data);
      assert.throws(()=>importCalendarData(target,data,validState),error=>{
        assert.match(error.message,/Woensdag, zaterdag en zondag kunnen niet geïmporteerd worden/);
        assert.match(error.message,new RegExp(date.slice(-2).replace(/^0/,'')));
        return true;
      });
      assert.deepEqual(target,before);assert.deepEqual(data,incomingBefore);
    }
  }
  // Older project history stays loadable; stricter archive import must not discard it.
  source.calendar.days['2026-10-07']=structuredClone(reference);
  assert.equal(validState(source),true);
});


test('new dates remain concepts until saved explicitly or when switching away', () => {
  const state = fixture();
  setCalendarEnabled(state, true, '2026-10-05');
  assert.equal(calendarRecord(state, '2026-10-05'), undefined);
  assert.equal(validState(state), true);
  setStudentAttendance(state, state.students[0].id, true);
  state.students[0].name = 'Draft name';
  delete state.assignments[Object.keys(state.assignments)[0]];
  assert.equal(captureCalendarDay(state), false);
  assert.deepEqual(Object.keys(state.calendar.days), []);
  const reopened = initializeRooms(JSON.parse(JSON.stringify(state)));
  assert.equal(validState(reopened), true);
  assert.equal(reopened.students[0].attendanceAbsent, true);
  openCalendarDate(reopened, '2026-10-05');
  assert.equal(reopened.students[0].name, 'Draft name');
  saveCalendarPeriod(reopened, '2026-10-05', 'day');
  assert.deepEqual(calendarRecord(reopened, '2026-10-05').absentIds, [reopened.students[0].id]);
  setStudentAttendance(reopened, reopened.students[1].id, true);
  assert.equal(captureCalendarDay(reopened), true);
  assert.equal(calendarSummary(reopened, '2026-10-05').absent, 2);
  openCalendarDate(reopened, '2026-10-06');
  setStudentAttendance(reopened, reopened.students[2].id, true);
  captureCalendarDay(reopened);
  openCalendarDate(reopened, '2026-10-08');
  assert.deepEqual(calendarRecord(reopened, '2026-10-06').absentIds, [reopened.students[2].id]);
  assert.ok(reopened.students.every(student => !student.attendanceAbsent));
});

test('Wednesdays and weekends cannot open or save and bulk saving only records school days', () => {
  const state = fixture();
  setCalendarEnabled(state, true, '2026-10-10');
  assert.equal(state.calendar.selectedDate, '2026-10-12');
  const before = structuredClone(state);
  for (const date of ['2026-10-07', '2026-10-10', '2026-10-11']) {
    assert.throws(() => openCalendarDate(state, date), /geen schooldagen/);
    assert.throws(() => saveCalendarPeriod(state, date, 'day'), /geen schooldagen/);
    assert.deepEqual(state, before);
  }
  assert.equal(saveCalendarPeriod(state, '2026-10-05', 'month'), 18);
  assert.equal(calendarRecord(state, '2026-10-10'), undefined);
  assert.equal(calendarRecord(state, '2026-10-11'), undefined);
  // Old archives remain readable and deletable, but cannot autosave on weekends.
  state.calendar.days['2026-10-10'] = structuredClone(calendarRecord(state, '2026-10-12'));
  state.calendar.selectedDate = '2026-10-10';
  assert.equal(validState(state), true);
  assert.equal(captureCalendarDay(state), false);
  assert.equal(deleteCalendarDay(state, '2026-10-10'), true);
});

test('deleting one day stops autosave and preserves shared records for other dates', () => {
  const state = fixture();
  setCalendarEnabled(state, true, '2026-10-05');
  saveCalendarPeriod(state, '2026-10-05', 'month');
  const tuesday = structuredClone(calendarRecord(state, '2026-10-06'));
  setStudentAttendance(state, state.students[0].id, true);captureCalendarDay(state);
  state.calendar.drafts = { '2026-10-05': structuredClone(calendarRecord(state, '2026-10-05')) };
  assert.equal(deleteCalendarDay(state, '2026-10-05'), true);
  assert.equal(calendarDraft(state, '2026-10-05'), undefined);
  assert.equal(captureCalendarDay(state), false);
  assert.equal(calendarRecord(state, '2026-10-05'), undefined);
  assert.deepEqual(calendarRecord(state, '2026-10-06'), tuesday);
  assert.equal(Object.keys(state.calendar.rosters).length, 1);
  assert.equal(Object.keys(state.calendar.layouts).length, 1);
  assert.equal(validState(state), true);
  const reloaded = initializeRooms(JSON.parse(JSON.stringify(state)));
  assert.equal(captureCalendarDay(reloaded), false);
  assert.equal(calendarNeedsStart(reloaded,'2026-10-05'),true);
  assert.throws(()=>saveCalendarPeriod(reloaded,'2026-10-05','day'),/Kies eerst/);
  openCalendarDate(reloaded,'2026-10-05',{fresh:true});
  saveCalendarPeriod(reloaded, '2026-10-05', 'day');
  assert.equal(calendarSummary(reloaded, '2026-10-05').absent, 0);
  openCalendarDate(reloaded, '2026-10-06');
  assert.equal(calendarSummary(reloaded, '2026-10-06').absent, 0);
});


test('importing an open unsaved day restores the archive before autosave can overwrite it', () => {
  const source = fixture(), target = structuredClone(source);
  setCalendarEnabled(source, true, '2026-10-05');
  setStudentAttendance(source, source.students[0].id, true);
  source.students[0].name = 'Archived name';
  saveCalendarPeriod(source, '2026-10-05', 'day');
  setCalendarEnabled(target, true, '2026-10-05');
  target.students[0].name = 'Unsaved draft';
  const backup = structuredClone({ version: 1, days: source.calendar.days, rosters: source.calendar.rosters, layouts: source.calendar.layouts });
  assert.deepEqual(importCalendarData(target, backup, validState), { added: 1, skipped: 0 });
  assert.equal(target.students[0].name, 'Archived name');
  assert.equal(target.students[0].attendanceAbsent, true);
  assert.equal(captureCalendarDay(target), false);
  assert.equal(calendarSummary(target, '2026-10-05').absent, 1);
  assert.equal(validState(target), true);
});


test('fresh days clear seating across rooms and chair pins without changing the saved source', () => {
  const state = fixture(), second = newRoom(state, 'Tweede lokaal', 'classroom');
  const id = state.students[1].id, seat = enabledSeats(roomState(state, second.id).settings)[0];
  state.studentRooms[id] = second.id;second.assignments = { [seat]: id };normalizeRooms(state);
  state.rules.push({id:'pin',type:'fixed',students:[state.students[0].id],roomId:state.activeRoomId,seat:Object.keys(state.assignments)[0],priority:'Verplicht'});
  setCalendarEnabled(state,true,'2026-10-05');setStudentAttendance(state,id,true);
  saveCalendarPeriod(state,'2026-10-05','day');
  const source=structuredClone(calendarRecord(state,'2026-10-05')), rooms=state.rooms.map(r=>structuredClone(r.layout)), roster=state.students.map(p=>p.id);
  openCalendarDate(state,'2026-10-06',{fresh:true});normalizeRooms(state);
  assert.deepEqual(state.assignments,{});assert.ok(state.rooms.every(r=>!Object.keys(r.assignments).length&&!r.locks.length));
  assert.ok(state.students.every(p=>!p.attendanceAbsent));assert.deepEqual(state.students.map(p=>p.id),roster);
  assert.deepEqual(state.rooms.map(r=>r.layout),rooms);assert.equal(state.rules[0].seat,undefined);
  assert.equal(state.rules[0].roomId,state.activeRoomId);assert.equal(calendarRecord(state,'2026-10-06'),undefined);
  assert.equal(captureCalendarDay(state),false);assert.deepEqual(calendarRecord(state,'2026-10-05'),source);
  assert.equal(validState(state),true);
  openCalendarDate(state,'2026-10-05');assert.ok(Object.keys(state.assignments).length);assert.equal(state.students[1].attendanceAbsent,true);
});

test('copying an archived day restores its roster and seating, resets attendance, and stays a draft', () => {
  const state=fixture();setCalendarEnabled(state,true,'2026-10-02');
  setStudentAttendance(state,state.students[0].id,true);saveCalendarPeriod(state,'2026-10-02','day');
  const source=structuredClone(calendarRecord(state,'2026-10-02')), assignments=structuredClone(state.assignments);
  openCalendarDate(state,'2026-10-05',{sourceDate:'2026-10-02'});
  state.students.push({id:'new',name:'Later toegevoegd',class:'3A',year:'3',absent:false});normalizeRooms(state);
  saveCalendarPeriod(state,'2026-10-05','day');
  assert.equal(previousCalendarDate(state,'2026-10-06'),'2026-10-05');
  assert.equal(previousCalendarDate(state,'2026-10-05'),'2026-10-02');
  assert.equal(previousCalendarDate(state,'2026-10-01'),null);
  openCalendarDate(state,'2026-10-08',{sourceDate:'2026-10-02'});
  assert.equal(state.students.length,4);assert.deepEqual(state.assignments,assignments);assert.ok(state.students.every(p=>!p.attendanceAbsent));
  assert.equal(calendarRecord(state,'2026-10-08'),undefined);assert.equal(captureCalendarDay(state),false);
  saveCalendarPeriod(state,'2026-10-08','day');assert.equal(calendarRecord(state,'2026-10-08').rosterId,source.rosterId);
  assert.equal(calendarRecord(state,'2026-10-08').layoutId,source.layoutId);
  state.students[0].name='Dag gewijzigd';delete state.assignments[Object.keys(state.assignments)[0]];captureCalendarDay(state);
  assert.deepEqual(calendarRecord(state,'2026-10-02'),source);assert.equal(validState(state),true);
  const before=structuredClone(state);
  assert.throws(()=>openCalendarDate(state,'2026-10-08',{sourceDate:'2026-10-09'}),/bewaarde/);assert.deepEqual(state,before);
});


test('switching away automatically records the previous concept and reopens attendance and seats',()=>{
  const state=fixture();setCalendarEnabled(state,true,'2026-10-05');
  setStudentAttendance(state,state.students[0].id,true);
  state.students[0].name='Conceptnaam';
  const seats=enabledSeats(state.settings),id=state.students[0].id;
  delete state.assignments[seats[0]];state.assignments[seats[8]]=id;
  const assignments=structuredClone(state.assignments);
  openCalendarDate(state,'2026-10-06',{fresh:true});
  assert.equal(calendarDraft(state,'2026-10-05'),undefined);
  assert.ok(calendarRecord(state,'2026-10-05'));
  assert.equal(calendarExportRows(state,'2026-10-05','week').length,state.students.length);
  const reloaded=initializeRooms(JSON.parse(JSON.stringify(state)));
  assert.equal(validState(reloaded),true);
  openCalendarDate(reloaded,'2026-10-05');
  assert.deepEqual(reloaded.assignments,assignments);
  assert.equal(reloaded.students[0].name,'Conceptnaam');assert.equal(reloaded.students[0].attendanceAbsent,true);
  assert.equal(captureCalendarDay(reloaded),false);
  setCalendarEnabled(reloaded,false);setCalendarEnabled(reloaded,true);
  assert.deepEqual(reloaded.assignments,assignments);assert.equal(reloaded.students[0].attendanceAbsent,true);
  saveCalendarPeriod(reloaded,'2026-10-05','day');
  assert.equal(calendarDraft(reloaded,'2026-10-05'),undefined);
  assert.equal(calendarSummary(reloaded,'2026-10-05').absent,1);
  const invalid=structuredClone(reloaded);invalid.calendar.days['2026-10-06'].rosterId='missing';
  assert.equal(validState(invalid),false);
});

test('discarded open and cached concepts stay deleted across date switches, toggles and reload',()=>{
  const state=fixture();setCalendarEnabled(state,true,'2026-10-05');
  setStudentAttendance(state,state.students[0].id,true);
  assert.equal(deleteCalendarDay(state,'2026-10-05'),true);
  assert.equal(calendarNeedsStart(state,'2026-10-05'),true);
  assert.deepEqual(state.assignments,{});assert.ok(state.students.every(p=>!p.attendanceAbsent));
  assert.equal(deleteCalendarDay(state,'2026-10-05'),false);
  assert.throws(()=>saveCalendarPeriod(state,'2026-10-05','day'),/Kies eerst/);
  assert.throws(()=>openCalendarDate(state,'2026-10-05'),/Kies eerst/);
  openCalendarDate(state,'2026-10-06',{fresh:true});
  assert.equal(calendarRecord(state,'2026-10-05'),undefined);
  assert.equal(calendarDraft(state,'2026-10-05'),undefined);
  setCalendarEnabled(state,false);
  assert.ok(calendarDraft(state,'2026-10-06'));
  assert.equal(deleteCalendarDay(state,'2026-10-06'),true);
  assert.equal(calendarDraft(state,'2026-10-06'),undefined);
  const reopened=initializeRooms(JSON.parse(JSON.stringify(state)));
  assert.equal(validState(reopened),true);
  setCalendarEnabled(reopened,true);setCalendarEnabled(reopened,false);setCalendarEnabled(reopened,true);
  assert.deepEqual(reopened.calendar.days,{});assert.deepEqual(reopened.calendar.drafts,{});
  const source=fixture();setCalendarEnabled(source,true,'2026-10-02');saveCalendarPeriod(source,'2026-10-02','day');
  importCalendarData(reopened,{version:1,days:source.calendar.days,rosters:source.calendar.rosters,layouts:source.calendar.layouts},validState);
  openCalendarDate(reopened,'2026-10-05',{sourceDate:'2026-10-02'});
  assert.equal(calendarNeedsStart(reopened,'2026-10-05'),false);
  assert.deepEqual(reopened.assignments,source.assignments);
  openCalendarDate(reopened,'2026-10-06',{fresh:true});
  assert.ok(calendarRecord(reopened,'2026-10-05'));
  assert.equal(calendarNeedsStart(reopened,'2026-10-06'),false);
  assert.equal(calendarRecord(reopened,'2026-10-06'),undefined);
  for(const pendingDates of [['bad'],['2026-10-07'],['2026-10-08','2026-10-08'],['2026-10-05']]) {
    const invalid=structuredClone(reopened);invalid.calendar.pendingDates=pendingDates;
    assert.equal(validState(invalid),false);
  }
});

test('previous-day copying can use the concept that is saved while switching',()=>{
  const state=fixture();setCalendarEnabled(state,true,'2026-10-05');
  setStudentAttendance(state,state.students[0].id,true);
  state.students[0].name='Wijziging in concept';
  const assignments=structuredClone(state.assignments);
  assert.equal(previousCalendarDate(state,'2026-10-06'),'2026-10-05');
  openCalendarDate(state,'2026-10-06',{sourceDate:'2026-10-05'});
  assert.deepEqual(calendarRecord(state,'2026-10-05').absentIds,[state.students[0].id]);
  assert.deepEqual(state.assignments,assignments);
  assert.equal(state.students[0].name,'Wijziging in concept');
  assert.ok(state.students.every(p=>!p.attendanceAbsent));
  assert.equal(calendarRecord(state,'2026-10-06'),undefined);
});
