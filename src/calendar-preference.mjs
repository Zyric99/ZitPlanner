import { setCalendarEnabled } from './calendar-model.mjs';

export const CALENDAR_PREFERENCE_KEY = 'zitplanner-calendar-enabled';

export function createCalendarPreference(storage, previousChoice = false) {
  const stored = storage.getItem(CALENDAR_PREFERENCE_KEY);
  let enabled = stored === null ? previousChoice === true : stored === 'true';
  storage.setItem(CALENDAR_PREFERENCE_KEY, String(enabled));
  return {
    get enabled() { return enabled; },
    setEnabled(value) {
      if (typeof value !== 'boolean') throw Error('Ongeldige kalenderinstelling.');
      storage.setItem(CALENDAR_PREFERENCE_KEY, String(value));
      enabled = value;
    },
    apply(state) {
      if (enabled !== (state.calendar?.enabled === true)) setCalendarEnabled(state, enabled);
      return state;
    }
  };
}
