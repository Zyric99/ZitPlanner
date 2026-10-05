import { dateObject, isSchoolDay, todayKey } from './calendar-dates.mjs';

// Roll-call attendance is independent of the planner's absence/day filter.
export const studentIsAbsent = student => student.attendanceAbsent === true;
export const attendanceDate = (state, now = new Date()) => state.calendar?.enabled ? state.calendar.selectedDate : todayKey(now);

export function studentExpectedOnDate(student, date) {
  const day = ['zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag'][dateObject(date).getUTCDay()];
  // Lists without a study schedule retain their ordinary school-day roll call.
  return isSchoolDay(date) && (!student.eveningStudy || student.eveningStudy[day] === 'Ja');
}

export const attendanceStatus = (student, date) => !studentExpectedOnDate(student, date) ? 'unexpected' : studentIsAbsent(student) ? 'absent' : 'present';
export const attendanceLabel = status => ({ present: 'Aanwezig', absent: 'Afwezig', unexpected: 'Niet verwacht' })[status];
