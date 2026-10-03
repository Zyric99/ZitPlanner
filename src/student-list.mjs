import { leaveWeeklyDay } from './weekly-planner.mjs';

// Return to manual attendance before changing the roster. A saved week refers
// to the old roster, even when a replacement reuses the same student IDs.
export function updateStudentList(state, students, { replace = false } = {}) {
  if (state.weeklyPlans) leaveWeeklyDay(state);
  delete state.weeklyPlans;
  if (replace) {
    state.rules = [];
    state.assignments = {};
    state.locks = [];
    state.benchLocks = [];
    state.hiddenWarnings = [];
    state.studentRooms = {};
    state.studentRoomPins = {};
    for (const room of state.rooms ?? []) {
      room.assignments = {};
      room.locks = [];
      room.hiddenWarnings = [];
    }
  }
  state.students = replace ? [...students] : [...state.students, ...students];
  if (state.distribution) state.distribution.reviewed = false;
}
