import { ownValue } from './id-record.mjs';
import { defaults, validSeat, seatCode } from './engine.mjs';
import { initializeRooms, captureRoom, normalizeRooms, roomSystemValid } from './rooms.mjs';
import { leaveWeeklyDay } from './weekly-planner.mjs';
import { emptyProjectState } from './project-session.mjs';

const clone=value=>structuredClone(value);
function loadActive(state) {
  const room=state.rooms.find(r=>r.id===state.activeRoomId);
  state.settings={...state.settings,...clone(room.settings),layout:clone(room.layout)};
  state.assignments=clone(room.assignments);state.locks=[...room.locks];
  state.hiddenWarnings=[...room.hiddenWarnings];state.benchLocks=[];
}
export function validDefaultSet(state) {
  return !!(state&&Array.isArray(state.rooms)&&state.settings&&typeof state.name==='string'
    &&Array.isArray(state.students)&&!state.students.length&&Array.isArray(state.rules)&&!state.rules.length
    &&state.assignments&&typeof state.assignments==='object'&&!Object.keys(state.assignments).length
    &&Array.isArray(state.locks)&&!state.locks.length&&Array.isArray(state.benchLocks)&&!state.benchLocks.length
    &&!state.weeklyPlans&&roomSystemValid(state)
    &&state.rooms.every(room=>!Object.keys(room.assignments).length&&!room.locks.length));
}
export function selectDefaultRooms(source,ids=source.rooms.map(r=>r.id)) {
  if(!Array.isArray(ids)||!ids.length||new Set(ids).size!==ids.length||ids.some(id=>!source.rooms.some(r=>r.id===id)))throw Error('Selecteer minstens één bestaand lokaal.');
  const state=emptyProjectState(source);
  state.rooms=state.rooms.filter(r=>ids.includes(r.id));
  state.participatingRooms=state.participatingRooms.filter(id=>ids.includes(id));
  if(!ids.includes(state.activeRoomId))state.activeRoomId=state.rooms[0].id;
  loadActive(state);
  if(!validDefaultSet(state))throw Error('Deze lokalen vormen geen geldige standaardset.');
  return state;
}
export function factoryDefaultSet() {return emptyProjectState(initializeRooms(defaults()));}

// Prepare the exact reset and its impact on a copy, before the user confirms it.
export function restoreDefaultSet(source,template) {
  if(!validDefaultSet(template))throw Error('De bewaarde standaardset bevat ongeldige gegevens.');
  const state=clone(source);
  const hadWeek=!!state.weeklyPlans;
  if(hadWeek)leaveWeeklyDay(state);
  delete state.weeklyPlans;captureRoom(state);
  const oldRooms=clone(state.rooms),oldMembership=clone(state.studentRooms),oldClasses=clone(state.classRooms);
  const beforeSeats=oldRooms.reduce((n,r)=>n+Object.keys(r.assignments).length,0);
  const beforePins=oldRooms.reduce((n,r)=>n+r.locks.length,0);
  const oldActive=state.activeRoomId;
  state.rooms=clone(template.rooms);
  const ids=new Set(state.rooms.map(r=>r.id));
  state.studentRooms=Object.fromEntries(state.students.map(p=>[p.id,ids.has(oldMembership[p.id])?oldMembership[p.id]:null]));
  state.classRooms=Object.fromEntries(Object.entries(oldClasses).filter(([,id])=>ids.has(id)));
  state.studentRoomPins=Object.fromEntries(Object.entries(state.studentRoomPins??{}).filter(([,id])=>ids.has(id)));
  state.participatingRooms=template.participatingRooms.filter(id=>ids.has(id));
  for(const room of state.rooms) {
    const old=oldRooms.find(r=>r.id===room.id),settings={...state.settings,...room.settings,layout:room.layout};
    room.assignments=Object.fromEntries(Object.entries(old?.assignments??{}).filter(([seat,id])=>ownValue(state.studentRooms,id)===room.id&&validSeat(seat,settings)));
    room.locks=(old?.locks??[]).filter(id=>Object.values(room.assignments).includes(id));
    room.hiddenWarnings=clone(old?.hiddenWarnings??[]);
  }
  state.activeRoomId=ids.has(oldActive)?oldActive:template.activeRoomId;
  state.distribution.reviewed=false;
  loadActive(state);normalizeRooms(state);
  // Keep removed fixed-position references identifiable in the normal warning UI.
  for(const rule of state.rules.filter(r=>r.type==='fixed')) {
    const oldRoom=oldRooms.find(r=>r.id===rule.roomId);
    if(oldRoom&&rule.seat&&!rule.positionCode)rule.positionCode=seatCode(rule.seat,{...source.settings,...oldRoom.settings,layout:oldRoom.layout});
  }
  const keptSeats=state.rooms.reduce((n,r)=>n+Object.keys(r.assignments).length,0);
  const keptPins=state.rooms.reduce((n,r)=>n+r.locks.length,0);
  const unavailableFixed=state.rules.filter(rule=>{
    if(rule.type!=='fixed')return false;
    const room=state.rooms.find(r=>r.id===rule.roomId);
    return !room||!!rule.seat&&!validSeat(rule.seat,{...state.settings,...room.settings,layout:room.layout});
  }).length;
  return {state,summary:{
    currentRooms:oldRooms.map(r=>r.name),targetRooms:state.rooms.map(r=>r.name),
    keptSeats,removedSeats:beforeSeats-keptSeats,keptPins,removedPins:beforePins-keptPins,
    removedMemberships:state.students.filter(p=>oldMembership[p.id]&&!ids.has(oldMembership[p.id])).length,
    removedClassBindings:Object.entries(oldClasses).filter(([,id])=>!ids.has(id)).map(([name])=>name),
    unavailableFixed,clearedWeek:hadWeek,
  }};
}
