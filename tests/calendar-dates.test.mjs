import test from 'node:test';
import assert from 'node:assert/strict';
import { validDateKey, todayKey, shiftDate, periodDates, monthGrid, shiftMonth, isSchoolDay, shiftSchoolDay } from '../src/calendar-dates.mjs';

test('calendar accepts real dates and handles leap days', () => {
  assert.equal(validDateKey('2028-02-29'), true);
  assert.equal(validDateKey('2026-02-29'), false);
  assert.equal(validDateKey('2026-04-31'), false);
  assert.equal(validDateKey('2026-1-05'), false);
  assert.equal(periodDates('2028-02-10', 'month').length, 29);
  assert.equal(periodDates('2026-02-10', 'month').length, 28);
  assert.equal(shiftMonth('2026-12-31', 1), '2027-01-01');
});

test('weeks start Monday, cross years and include weekends', () => {
  assert.deepEqual(periodDates('2027-01-01', 'week'), ['2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02', '2027-01-03']);
  const grid = monthGrid('2026-10-05');
  assert.equal(grid.length, 42);
  assert.equal(grid[0], '2026-09-28');
  assert.ok(grid.includes('2026-10-31'));
});

test('Brussels dates respect midnight and daylight saving transitions', () => {
  assert.equal(todayKey(new Date('2026-10-04T22:30:00Z')), '2026-10-05');
  assert.equal(todayKey(new Date('2026-12-31T23:30:00Z')), '2027-01-01');
  assert.equal(shiftDate('2026-03-28', 1), '2026-03-29');
  assert.equal(shiftDate('2026-10-25', 1), '2026-10-26');
});


test('school day navigation skips Wednesdays and both weekend days across months and years', () => {
  assert.equal(isSchoolDay('2026-10-07'), false);
  assert.equal(shiftSchoolDay('2026-10-06'), '2026-10-08');
  assert.equal(shiftSchoolDay('2026-10-08', -1), '2026-10-06');
  assert.equal(isSchoolDay('2026-10-09'), true);
  assert.equal(isSchoolDay('2026-10-10'), false);
  assert.equal(isSchoolDay('2026-10-11'), false);
  assert.equal(shiftSchoolDay('2026-10-09'), '2026-10-12');
  assert.equal(shiftSchoolDay('2026-10-12', -1), '2026-10-09');
  assert.equal(shiftSchoolDay('2027-01-01'), '2027-01-04');
});
