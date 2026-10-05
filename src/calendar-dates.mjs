export function validDateKey(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function dateObject(value) {
  if (!validDateKey(value)) throw Error('Kies een geldige kalenderdatum.');
  return new Date(`${value}T12:00:00Z`);
}

export function todayKey(now = new Date()) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export function shiftDate(value, days) {
  const date = dateObject(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function periodDates(value, scope = 'day') {
  const date = dateObject(value);
  if (scope === 'day') return [value];
  if (scope === 'week') {
    const start = shiftDate(value, -((date.getUTCDay() + 6) % 7));
    return Array.from({ length: 7 }, (_, index) => shiftDate(start, index));
  }
  if (scope === 'month') {
    const start = value.slice(0, 8) + '01';
    const end = new Date(date.getTime());
    end.setUTCMonth(end.getUTCMonth() + 1, 0);
    return Array.from({ length: end.getUTCDate() }, (_, index) => shiftDate(start, index));
  }
  throw Error('Kies Dag, Week of Maand.');
}

export function isSchoolDay(value) {
  const day = dateObject(value).getUTCDay();
  return day !== 0 && day !== 3 && day !== 6;
}

export function shiftSchoolDay(value, direction = 1) {
  const step = direction < 0 ? -1 : 1;
  let next = shiftDate(value, step);
  while (!isSchoolDay(next)) next = shiftDate(next, step);
  return next;
}

export function dateLabel(value, options = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) {
  return new Intl.DateTimeFormat('nl-BE', { ...options, timeZone: 'UTC' }).format(dateObject(value));
}

export function monthGrid(value) {
  const first = value.slice(0, 8) + '01';
  const start = periodDates(first, 'week')[0];
  return Array.from({ length: 42 }, (_, index) => shiftDate(start, index));
}

export function shiftMonth(value, amount) {
  const date = dateObject(value.slice(0, 8) + '01');
  date.setUTCMonth(date.getUTCMonth() + amount);
  return date.toISOString().slice(0, 10);
}
