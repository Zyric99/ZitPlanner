import { STUDY_DAYS } from './student-import.mjs';
import { dayLabel, weeklyCurrent, applyWeeklyDay, leaveWeeklyDay } from './weekly-planner.mjs';
import { roomState } from './rooms.mjs';
import { seatCode } from './engine.mjs';
const $=selector=>document.querySelector(selector),esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function createWeeklyUI({getState,commit,toast,clearSelection}) {
  const bar=$('#weekly-bar');
  function render() {
    const state=getState(),week=state.weeklyPlans,current=weeklyCurrent(state);
    bar.hidden=!week;
    $('#weekly-day').innerHTML=`<option value="">Zonder dagfilter</option>${STUDY_DAYS.map(day=>`<option value="${day}" ${week?.activeDay===day?'selected':''}>${dayLabel(day)}${current?` · ${week.days[day].presentIds.length} aanwezig`:''}</option>`).join('')}`;
    $('#weekly-day').disabled=!current;
    const warning=$('#weekly-warning');warning.hidden=!current||!week.changes.length;
    if(!warning.hidden) {
      const label=position=>{const room=state.rooms.find(r=>r.id===position.roomId);return `${room?.name??'Lokaal'} · ${seatCode(position.seat,roomState(state,position.roomId).settings)}`;};
      warning.innerHTML=`<summary>⚠ ${week.changes.length} ${week.changes.length===1?'plaatswijziging':'plaatswijzigingen'} in deze week</summary><ul>${week.changes.map(c=>`<li>${dayLabel(c.day)}: ${esc(state.students.find(p=>p.id===c.studentId)?.name)} · ${esc(label(c.from))} → ${esc(label(c.to))}</li>`).join('')}</ul>`;
    }
    $('#weekly-note').hidden=!(week&&!current);
    $('#weekly-note').textContent=week&&!current?'Deze bewaarde weekindeling is verouderd. Maak een nieuwe indeling voor de huidige leerlingen.':'';
    bar.dataset.current=String(current);
  }
  $('#weekly-day').onchange=event=>{
    try{commit(()=>{const state=getState();if(event.target.value)applyWeeklyDay(state,event.target.value);else leaveWeeklyDay(state);clearSelection();});toast(event.target.value?`${dayLabel(event.target.value)} geopend.`:'Dagfilter uitgezet.');}catch(error){toast(error.message);render();}
  };
  return {render};
}
