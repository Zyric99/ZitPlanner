import { ownValue, setOwnValue } from './id-record.mjs';
import { STUDY_DAYS } from './student-import.mjs';
import { enabledSeats, evaluate, generate, seatCode, studentRulesFor, validSeat } from './engine.mjs';
import { initializeRooms, captureRoom, roomState, switchRoom, participatingRoomIds, distributeRooms, classRoomId } from './rooms.mjs';
import { autoDistributeRooms, evaluateCrossRoomRules } from './auto-distribution.mjs';

const clone=value=>structuredClone(value);
export const dayLabel=day=>day[0].toUpperCase()+day.slice(1);
export function attendsDay(student,day,baselineAbsent=student.absent) {
  return !baselineAbsent&&(!student.eveningStudy||student.eveningStudy[day]==='Ja');
}
function inputSignature(state) {
  const copy=clone(state);captureRoom(copy);
  const {layout,sections,rows,disabled,placementMode,ordered,...settings}=copy.settings;
  const baseline=copy.weeklyPlans?.activeDay?copy.weeklyPlans.baselineAbsent:Object.fromEntries(copy.students.map(p=>[p.id,p.absent]));
  return JSON.stringify({students:copy.students.map(({id,name,class:klass,year,eveningStudy})=>({id,name,klass,year,eveningStudy})),baseline,settings,rules:copy.rules,rooms:copy.rooms.map(({id,layout,settings})=>({id,layout,settings})),classRooms:copy.classRooms,...(Object.keys(copy.studentRoomPins??{}).length?{studentRoomPins:copy.studentRoomPins}:{}),participatingRooms:copy.participatingRooms});
}
export const weeklyCurrent=state=>!!state.weeklyPlans&&state.weeklyPlans.signature===inputSignature(state);
function positions(state) {
  const result={};captureRoom(state);
  for(const room of state.rooms)for(const [seat,id] of Object.entries(room.assignments))setOwnValue(result,id,{roomId:room.id,seat});
  return result;
}
function prepareDistribution(state,preferences,pins) {
  captureRoom(state);
  const ids=participatingRoomIds(state),counts=new Map(ids.map(id=>[id,0]));
  const active=state.students.filter(p=>!p.absent),mandatory=new Set();
  for(const p of active){const fixed=studentRulesFor(state).find(r=>r.type==='fixed'&&r.students[0]===p.id&&ids.includes(r.roomId));const target=ownValue(state.studentRoomPins,p.id)||classRoomId(state,p.class)||ownValue(pins,p.id)?.roomId||fixed?.roomId;if(target&&ids.includes(target)){mandatory.add(p.id);setOwnValue(state.studentRooms,p.id,target);counts.set(target,counts.get(target)+1);}}
  const temporary=new Map(state.rooms.map(room=>[room.id,[...room.locks]]));
  for(const p of active){if(mandatory.has(p.id))continue;const id=ownValue(preferences,p.id)?.roomId;if(!ids.includes(id))continue;const room=state.rooms.find(r=>r.id===id),capacity=enabledSeats(roomState(state,id).settings).length;if(counts.get(id)>=capacity)continue;counts.set(id,counts.get(id)+1);setOwnValue(state.studentRooms,p.id,id);room.locks.push(p.id);}
  // The room distributor keeps these preferred memberships, while class
  // destinations and real pins retain their ordinary precedence.
  state.locks=[...state.rooms.find(r=>r.id===state.activeRoomId).locks];
  distributeRooms(state,state.distribution.mode,{keepFixed:true});
  for(const room of state.rooms)room.locks=temporary.get(room.id).filter(id=>ownValue(state.studentRooms,id)===room.id);
  state.locks=[...state.rooms.find(r=>r.id===state.activeRoomId).locks];
  state.distribution.reviewed=true;
}
function seatRooms(state,preferences,options) {
  const warnings=[];
  for(const id of participatingRoomIds(state)) {
    const view=roomState(state,id),preferredSeats=Object.fromEntries(Object.entries(preferences).filter(([,p])=>p.roomId===id).map(([student,p])=>[student,p.seat]));
    const result=generate(view,{...options,preferredSeats:Object.keys(preferredSeats).length?preferredSeats:null});
    state.rooms.find(r=>r.id===id).assignments=result.assignments;
    warnings.push(...result.warnings.map(w=>({...w,roomId:id})));
  }
  state.assignments=clone(state.rooms.find(r=>r.id===state.activeRoomId).assignments);
  warnings.push(...evaluateCrossRoomRules(state).warnings);
  if(warnings.length&&participatingRoomIds(state).length>1) {
    const improved=autoDistributeRooms(state,{...options,attempts:2,preferredPositions:preferences});
    // The joint search starts from a fresh placement, so retain the original
    // unless it improves rule priorities or seats more pupils.
    const originalScore=[state.students.filter(p=>!p.absent&&!state.rooms.some(r=>Object.values(r.assignments).includes(p.id))).length,...['Verplicht','Voorkeur','Zachte voorkeur'].map(priority=>warnings.filter(w=>w.priority===priority).length)];
    const originalCosts=evaluateCrossRoomRules(state,false).score;
    for(const id of participatingRoomIds(state)){const costs=evaluate(roomState(state,id),undefined,false).score;for(let i=0;i<3;i++)originalCosts[i]+=costs[i];}
    originalScore.splice(1,3,...originalCosts);
    const difference=originalScore.findIndex((value,i)=>Math.abs(improved.score[i]-value)>1e-8);
    if(difference>=0&&improved.score[difference]<originalScore[difference]) {
      state.rooms=improved.state.rooms;state.studentRooms=improved.state.studentRooms;state.assignments=improved.state.assignments;state.locks=improved.state.locks;
      return improved.warnings;
    }
  }
  return warnings;
}
function sharedWeekReference(state,baselineAbsent,pins,existing,generated) {
  const roomIds=participatingRoomIds(state),preferred={},loads=new Map(roomIds.map(id=>[id,STUDY_DAYS.map(()=>0)])),occupied=new Map(roomIds.map(id=>[id,new Map()]));
  const days=new Map(state.students.map(p=>[p.id,STUDY_DAYS.map(day=>attendsDay(p,day,ownValue(baselineAbsent,p.id)))]));
  const overlaps=(a,b)=>days.get(a).some((present,i)=>present&&days.get(b)[i]);
  const active=state.students.filter(p=>days.get(p.id).some(Boolean));
  const fixedFor=p=>studentRulesFor(state).find(r=>r.type==='fixed'&&r.students[0]===p.id&&roomIds.includes(r.roomId));
  // Pupils who attend often claim a stable place before occasional pupils.
  // Non-overlapping pupils may then share that reference place all week.
  active.sort((a,b)=>Number(!!(ownValue(pins,b.id)||fixedFor(b)))-Number(!!(ownValue(pins,a.id)||fixedFor(a)))||days.get(b.id).filter(Boolean).length-days.get(a.id).filter(Boolean).length||active.filter(p=>overlaps(b.id,p.id)).length-active.filter(p=>overlaps(a.id,p.id)).length||a.id.localeCompare(b.id));
  for(const p of active) {
    const fixed=fixedFor(p),mandatory=ownValue(state.studentRoomPins,p.id)||classRoomId(state,p.class)||ownValue(pins,p.id)?.roomId||fixed?.roomId;
    const candidates=mandatory?[mandatory]:[ownValue(generated,p.id)?.roomId,ownValue(existing,p.id)?.roomId,...roomIds].filter((id,i,all)=>id&&roomIds.includes(id)&&all.indexOf(id)===i);
    let chosen=null;
    for(const roomId of candidates) {
      const seats=enabledSeats(roomState(state,roomId).settings),load=loads.get(roomId);
      if(!load||!seats.length||!mandatory&&days.get(p.id).some((present,d)=>present&&load[d]>=seats.length))continue;
      const seatsUsed=occupied.get(roomId),hard=ownValue(pins,p.id)?.roomId===roomId?ownValue(pins,p.id).seat:fixed?.roomId===roomId?fixed.seat:null;
      const seed=ownValue(existing,p.id)?.roomId===roomId?ownValue(existing,p.id).seat:ownValue(generated,p.id)?.roomId===roomId?ownValue(generated,p.id).seat:null;
      const order=[seed,...seats].filter((seat,i,all)=>seats.includes(seat)&&all.indexOf(seat)===i);
      const compatible=seat=>(seatsUsed.get(seat)??[]).every(id=>!overlaps(p.id,id));
      const seat=hard??order.find(compatible)??order[0];
      if(!seat)continue;
      chosen={roomId,seat};if(!seatsUsed.has(seat))seatsUsed.set(seat,[]);seatsUsed.get(seat).push(p.id);days.get(p.id).forEach((present,d)=>{if(present)load[d]++;});break;
    }
    if(chosen)setOwnValue(preferred,p.id,chosen);
  }
  return preferred;
}
export function generateWeek(source,{keepSeats=true,iterations=1800,random=Math.random,onProgress=()=>{}}={}) {
  const base=initializeRooms(clone(source));captureRoom(base);
  const baselineAbsent=Object.fromEntries(base.students.map(p=>[p.id,source.weeklyPlans?.activeDay?(ownValue(source.weeklyPlans.baselineAbsent,p.id)??p.absent):p.absent]));
  for(const p of base.students)p.absent=ownValue(baselineAbsent,p.id);
  if(source.weeklyPlans?.activeDay)for(const room of base.rooms){room.locks=[...new Set([...room.locks,...(source.weeklyPlans.baselineLocks[room.id]??[])])];for(const [seat,id] of Object.entries(source.weeklyPlans.baselineAssignments?.[room.id]??{}))if(room.locks.includes(id)&&!Object.values(room.assignments).includes(id)&&!room.assignments[seat])room.assignments[seat]=id;}
  base.assignments=clone(base.rooms.find(r=>r.id===base.activeRoomId).assignments);base.locks=[...base.rooms.find(r=>r.id===base.activeRoomId).locks];
  const baselineLocks=Object.fromEntries(base.rooms.map(room=>[room.id,[...room.locks]])),baselineAssignments=Object.fromEntries(base.rooms.map(room=>[room.id,clone(room.assignments)]));
  const existing=positions(base),pins=Object.fromEntries(Object.entries(existing).filter(([id,p])=>baselineLocks[p.roomId].includes(id)));
  const reference=clone(base);
  for(const p of reference.students)p.absent=!STUDY_DAYS.some(day=>attendsDay(p,day,ownValue(baselineAbsent,p.id)));
  const initial=keepSeats?existing:{};
  prepareDistribution(reference,initial,pins);seatRooms(reference,initial,{iterations,random});
  const preferred=keepSeats?sharedWeekReference(base,baselineAbsent,pins,existing,positions(reference)):{};
  const weekly={keepSeats,baselineAbsent,baselineLocks,baselineAssignments,signature:inputSignature(base),activeDay:null,days:{},changes:[],created:new Date().toISOString()};
  for(const day of STUDY_DAYS) {
    const current=clone(base);
    for(const p of current.students)p.absent=!attendsDay(p,day,ownValue(baselineAbsent,p.id));
    prepareDistribution(current,preferred,pins);
    const warnings=seatRooms(current,preferred,{iterations,random}),actual=positions(current),presentIds=current.students.filter(p=>!p.absent).map(p=>p.id);
    for(const id of presentIds) {
      if(keepSeats&&ownValue(preferred,id)&&ownValue(actual,id)&&(ownValue(actual,id).roomId!==ownValue(preferred,id).roomId||ownValue(actual,id).seat!==ownValue(preferred,id).seat))weekly.changes.push({day,studentId:id,from:clone(ownValue(preferred,id)),to:clone(ownValue(actual,id))});
      if(keepSeats&&ownValue(actual,id)&&!ownValue(preferred,id))setOwnValue(preferred,id,clone(ownValue(actual,id)));
    }
    weekly.days[day]={presentIds,studentRooms:clone(current.studentRooms),assignments:Object.fromEntries(current.rooms.map(r=>[r.id,clone(r.assignments)])),unplaced:presentIds.filter(id=>!ownValue(actual,id)),warnings};
    onProgress(Object.keys(weekly.days).length,STUDY_DAYS.length);
  }
  return weekly;
}
export function captureWeeklyDay(state) {
  if(!weeklyCurrent(state)||!state.weeklyPlans.activeDay)return;
  captureRoom(state);const daily=state.weeklyPlans.days[state.weeklyPlans.activeDay];
  daily.assignments=Object.fromEntries(state.rooms.map(r=>[r.id,clone(r.assignments)]));daily.studentRooms=clone(state.studentRooms);
  const seated=new Set(state.rooms.flatMap(r=>Object.values(r.assignments)));daily.unplaced=daily.presentIds.filter(id=>!seated.has(id));
  daily.warnings=participatingRoomIds(state).flatMap(id=>evaluate(roomState(state,id)).warnings.map(w=>({...w,roomId:id}))).concat(evaluateCrossRoomRules(state).warnings);
}
export function applyWeeklyDay(state,day,{capture=true}={}) {
  if(!weeklyCurrent(state))throw Error('Leerlingen, aanwezigheden, lokalen of regels zijn gewijzigd. Maak de week opnieuw.');
  if(!weeklyPlansValid(state.weeklyPlans,state))throw Error('De opgeslagen weekindeling bevat ongeldige leerlingen, lokalen of zitplaatsen. Maak de week opnieuw.');
  const daily=state.weeklyPlans.days[day];if(!daily)throw Error('Deze studiedag bestaat niet.');
  if(capture)captureWeeklyDay(state);
  const present=new Set(daily.presentIds);
  for(const p of state.students)p.absent=!present.has(p.id);
  state.studentRooms=clone(daily.studentRooms);
  for(const room of state.rooms){room.assignments=clone(daily.assignments[room.id]??{});room.locks=(state.weeklyPlans.baselineLocks[room.id]??[]).filter(id=>Object.values(room.assignments).includes(id));}
  const current=state.rooms.find(r=>r.id===state.activeRoomId);state.assignments=clone(current.assignments);state.locks=[...current.locks];
  switchRoom(state,state.activeRoomId);state.distribution.reviewed=true;state.weeklyPlans.activeDay=day;
}
export function leaveWeeklyDay(state,{restorePins=true}={}) {
  if(!state.weeklyPlans)return;
  captureWeeklyDay(state);
  for(const p of state.students)p.absent=ownValue(state.weeklyPlans.baselineAbsent,p.id)??p.absent;
  // A day removes absent pupils' temporary locks from the room view. Exiting
  // that day must recover their original pins before a new plan is generated.
  captureRoom(state);
  for(const room of restorePins?state.rooms:[]) {
    const savedLocks=state.weeklyPlans.baselineLocks[room.id]??[],saved=state.weeklyPlans.baselineAssignments?.[room.id]??{};
    for(const id of savedLocks) {
      if(!state.students.some(p=>p.id===id&&!p.absent)||ownValue(state.studentRooms,id)!==room.id)continue;
      if(!Object.values(room.assignments).includes(id)) {
        const seat=Object.keys(saved).find(seat=>saved[seat]===id);
        if(seat&&enabledSeats(roomState(state,room.id).settings).includes(seat))room.assignments[seat]=id;
      }
      if(Object.values(room.assignments).includes(id)&&!room.locks.includes(id))room.locks.push(id);
    }
  }
  const active=state.rooms.find(room=>room.id===state.activeRoomId);state.assignments=clone(active.assignments);state.locks=[...active.locks];
  state.weeklyPlans.activeDay=null;
}
export function weeklyPlansValid(weekly,state) {
  if(weekly===undefined)return true;
  const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
  const idList=value=>Array.isArray(value)&&value.every(id=>typeof id==='string')&&new Set(value).size===value.length;
  const assignmentsValid=value=>object(value)&&Object.values(value).every(a=>object(a)&&Object.entries(a).every(([seat,id])=>/^[a-zA-Z0-9_-]+:\d+$/.test(seat)&&typeof id==='string'));
  const warningValid=w=>object(w)&&typeof w.type==='string'&&['Verplicht','Voorkeur','Zachte voorkeur'].includes(w.priority)&&typeof w.message==='string'&&idList(w.students)&&idList(w.benches)&&(w.ruleId===undefined||typeof w.ruleId==='string');
  if(!(object(weekly)&&typeof weekly.keepSeats==='boolean'&&typeof weekly.signature==='string'&&(weekly.activeDay===null||STUDY_DAYS.includes(weekly.activeDay))&&object(weekly.baselineAbsent)&&Object.values(weekly.baselineAbsent).every(v=>typeof v==='boolean')&&object(weekly.baselineLocks)&&Object.values(weekly.baselineLocks).every(idList)&&(weekly.baselineAssignments===undefined||assignmentsValid(weekly.baselineAssignments))&&Array.isArray(weekly.changes)&&weekly.changes.every(c=>object(c)&&STUDY_DAYS.includes(c.day)&&typeof c.studentId==='string'&&[c.from,c.to].every(p=>object(p)&&typeof p.roomId==='string'&&typeof p.seat==='string'))&&object(weekly.days)))return false;
  const baselineIds=new Set(Object.keys(weekly.baselineAbsent));
  if(Object.values(weekly.baselineLocks).some(ids=>ids.some(id=>!baselineIds.has(id))))return false;
  for(const day of STUDY_DAYS) {
    const d=weekly.days[day];
    if(!(object(d)&&idList(d.presentIds)&&idList(d.unplaced)&&Array.isArray(d.warnings)&&d.warnings.every(warningValid)&&object(d.studentRooms)&&Object.entries(d.studentRooms).every(([id,roomId])=>baselineIds.has(id)&&(roomId===null||typeof roomId==='string'))&&assignmentsValid(d.assignments)))return false;
    const present=new Set(d.presentIds),placed=new Set();
    if(d.presentIds.some(id=>!baselineIds.has(id)||ownValue(weekly.baselineAbsent,id)))return false;
    for(const [roomId,seats] of Object.entries(d.assignments))for(const id of Object.values(seats)) {
      if(!present.has(id)||placed.has(id)||ownValue(d.studentRooms,id)!==roomId)return false;
      placed.add(id);
    }
    if(d.unplaced.length!==d.presentIds.length-placed.size||d.unplaced.some(id=>!present.has(id)||placed.has(id)))return false;
    if(d.warnings.some(w=>w.students.some(id=>!baselineIds.has(id))))return false;
  }
  if(weekly.changes.some(c=>!weekly.days[c.day].presentIds.includes(c.studentId)))return false;
  // A stale week can remain in a saved project, but a current week must refer
  // to actual students, rooms, attendance and chairs before it can be applied.
  if(state&&weekly.signature===inputSignature(state)) {
    const people=new Map(state.students.map(p=>[p.id,p])),rooms=new Set(state.rooms.map(room=>room.id));
    if(Object.keys(weekly.baselineAbsent).length!==people.size||Object.keys(weekly.baselineAbsent).some(id=>!people.has(id)))return false;
    for(const day of STUDY_DAYS) {
      const d=weekly.days[day],expected=state.students.filter(p=>attendsDay(p,day,ownValue(weekly.baselineAbsent,p.id))).map(p=>p.id);
      if(expected.length!==d.presentIds.length||expected.some(id=>!d.presentIds.includes(id)))return false;
      if(Object.values(d.studentRooms).some(id=>id!==null&&!rooms.has(id)))return false;
      for(const [roomId,seats] of Object.entries(d.assignments)) {
        if(!rooms.has(roomId))return false;
        const settings=roomState(state,roomId).settings;
        if(Object.keys(seats).some(seat=>!validSeat(seat,settings)))return false;
      }
    }
  }
  return true;
}
export function weeklyRecords(state) {
  if(!weeklyCurrent(state))throw Error('Maak eerst een actuele weekindeling.');captureWeeklyDay(state);
  if(!weeklyPlansValid(state.weeklyPlans,state))throw Error('De opgeslagen weekindeling is ongeldig. Maak de week opnieuw.');
  return STUDY_DAYS.flatMap(day=>{const daily=state.weeklyPlans.days[day],lookup=new Map();for(const [roomId,assignments] of Object.entries(daily.assignments))for(const [seat,id] of Object.entries(assignments))lookup.set(id,{roomId,seat});return daily.presentIds.map(id=>{const student=state.students.find(p=>p.id===id),pos=lookup.get(id),roomId=pos?.roomId??ownValue(daily.studentRooms,id);return {student,day:dayLabel(day),room:state.rooms.find(r=>r.id===roomId)?.name??'Nog geen lokaal',seat:pos?seatCode(pos.seat,roomState(state,roomId).settings):'Nog niet geplaatst'};});});
}
export function weeklyRows(state) {return weeklyRecords(state).map(({student:p,day,room,seat})=>[day,p.name,p.class,p.year,room,seat]);}
