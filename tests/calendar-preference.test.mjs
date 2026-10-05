import test from 'node:test';
import assert from 'node:assert/strict';
import { createCalendarPreference, CALENDAR_PREFERENCE_KEY } from '../src/calendar-preference.mjs';
import { defaults } from '../src/engine.mjs';
import { initializeRooms } from '../src/rooms.mjs';
import { setCalendarEnabled, saveCalendarPeriod } from '../src/calendar-model.mjs';
import { validState } from '../src/project-validation.mjs';

function storage() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}

test('calendar starts disabled once and remembers both subsequent choices across restarts', () => {
  const data = storage();
  const first = createCalendarPreference(data);
  assert.equal(first.enabled, false);
  assert.equal(data.getItem(CALENDAR_PREFERENCE_KEY), 'false');
  first.setEnabled(true);
  const reopened = createCalendarPreference(data);
  assert.equal(reopened.enabled, true);
  reopened.setEnabled(false);
  assert.equal(createCalendarPreference(data, true).enabled, false);
});

test('the calendar preference applies across projects without creating saved days', () => {
  const preference = createCalendarPreference(storage());
  const first = initializeRooms(defaults()), second = initializeRooms(defaults());
  preference.apply(first);
  assert.equal(first.calendar, undefined);
  preference.setEnabled(true);
  for (const state of [first, second]) {
    preference.apply(state);
    assert.equal(state.calendar.enabled, true);
    assert.deepEqual(state.calendar.days, {});
    assert.equal(validState(state), true);
  }
  preference.setEnabled(false);
  preference.apply(first);preference.apply(second);
  assert.equal(first.calendar.enabled, false);
  assert.equal(second.calendar.enabled, false);
  assert.equal(validState(first), true);
});

test('existing enabled choices migrate once and disabling keeps saved history', () => {
  const data = storage(), preference = createCalendarPreference(data, true);
  assert.equal(preference.enabled, true);
  const state = initializeRooms(defaults());
  setCalendarEnabled(state, true, '2026-10-05');saveCalendarPeriod(state, '2026-10-05', 'day');
  const day = structuredClone(state.calendar.days['2026-10-05']);
  preference.setEnabled(false);preference.apply(state);
  assert.deepEqual(state.calendar.days['2026-10-05'], day);
  assert.equal(state.calendar.enabled, false);
  assert.equal(createCalendarPreference(data, true).enabled, false);
  assert.equal(validState(state), true);
});
