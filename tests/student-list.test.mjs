import test from 'node:test';
import assert from 'node:assert/strict';
import { defaults } from '../src/engine.mjs';
import { initializeRooms, newRoom, normalizeRooms, switchRoom } from '../src/rooms.mjs';
import { generateWeek, applyWeeklyDay } from '../src/weekly-planner.mjs';
import { updateStudentList } from '../src/student-list.mjs';
import { validState } from '../src/project-validation.mjs';

const pupil = (id, eveningStudy) => ({ id, name: id, class: '1A', year: '1', absent: false, ...(eveningStudy ? { eveningStudy } : {}) });

test('replacing a saved roster clears placements and pins in every room, even for reused IDs', () => {
  const state = initializeRooms(defaults());
  const first = state.activeRoomId, second = newRoom(state, 'Second', 'classroom').id;
  state.students = [pupil('a'), pupil('b')];
  state.participatingRooms = [first, second];
  state.studentRooms = { a: first, b: second };
  state.assignments = { 'g-A-1:0': 'a' };
  state.locks = ['a'];
  state.rooms.find(r => r.id === second).assignments = { 'g-A-1:0': 'b' };
  state.rooms.find(r => r.id === second).locks = ['b'];
  state.rooms.forEach(r => r.hiddenWarnings = ['old']);
  state.hiddenWarnings = ['old'];
  state.rules = [{ id: 'pin', type: 'fixed', students: ['b'], priority: 'Verplicht', roomId: second }];
  state.studentRoomPins = { b: second };
  updateStudentList(state, [pupil('a'), pupil('b')], { replace: true });
  normalizeRooms(state);
  assert.deepEqual(state.assignments, {});
  for (const room of state.rooms) {
    assert.deepEqual(room.assignments, {});
    assert.deepEqual(room.locks, []);
    assert.deepEqual(room.hiddenWarnings, []);
  }
  assert.deepEqual(state.rules, []);
  assert.deepEqual(state.studentRoomPins, {});
  assert.deepEqual(state.studentRooms, { a: null, b: null });
  switchRoom(state, second);
  assert.deepEqual(state.assignments, {});
  assert.equal(validState(state), true);
});

test('adding students during a weekly day restores manual attendance and discards the obsolete week', () => {
  const state = initializeRooms(defaults());
  state.settings.classRulesEnabled = false;
  state.settings.yearRulesEnabled = false;
  state.students = [pupil('a', { maandag: 'Nee', dinsdag: 'Ja', donderdag: 'Ja', vrijdag: 'Ja' })];
  normalizeRooms(state);
  state.weeklyPlans = generateWeek(state, { iterations: 30 });
  applyWeeklyDay(state, 'maandag');
  assert.equal(state.students[0].absent, true);
  updateStudentList(state, [pupil('b')]);
  normalizeRooms(state);
  assert.equal(state.students[0].absent, false);
  assert.equal(state.students[1].absent, false);
  assert.equal(state.weeklyPlans, undefined);
  assert.equal(state.distribution.reviewed, false);
  assert.equal(validState(state), true);
});
