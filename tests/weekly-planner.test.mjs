import test from 'node:test';
import assert from 'node:assert/strict';
import { defaults, enabledSeats, evaluate, generate } from '../src/engine.mjs';
import { initializeRooms, newRoom, switchRoom, captureRoom, assignRoom, assignClassRoom, roomState, normalizeRooms } from '../src/rooms.mjs';
import { STUDY_DAYS } from '../src/student-import.mjs';
import { attendsDay, generateWeek, applyWeeklyDay, captureWeeklyDay, leaveWeeklyDay, weeklyCurrent, weeklyPlansValid, weeklyRows } from '../src/weekly-planner.mjs';

function fixture(attendance,capacities=[1,1,1,1]) {
  const s=defaults();s.settings.studentRulesEnabled=true;s.settings.yearRulesEnabled=false;s.students=attendance.map((days,i)=>({id:`s${i}`,name:`Leerling ${i}`,class:'1A',year:'1',absent:false,...(days===null?{}:{eveningStudy:Object.fromEntries(STUDY_DAYS.map((day,d)=>[day,days[d]??'']))})}));initializeRooms(s);
  const r=newRoom(s,'Studiezaal');r.layout={kind:'custom',columns:40,rows:28,benches:capacities.map((capacity,i)=>({id:`bank${i}`,code:String.fromCharCode(65+i),kind:'student',capacity,facing:'down',enabled:true,gx:i*8,gy:4}))};s.participatingRooms=[r.id];for(const p of s.students)assignRoom(s,p.id,r.id);switchRoom(s,r.id);s.distribution.reviewed=true;return s;
}
const assigned=(weekly,day,id)=>Object.entries(weekly.days[day].assignments).flatMap(([roomId,a])=>Object.entries(a).filter(([,p])=>p===id).map(([seat])=>({roomId,seat})))[0];
const options={iterations:600,random:()=>0.31};

test('attendance uses Ja/Nee/blank, legacy absence and manual absence',()=>{
  const s=fixture([['Ja','Nee','','Ja'],null]);assert.equal(attendsDay(s.students[0],'maandag'),true);assert.equal(attendsDay(s.students[0],'dinsdag'),false);assert.equal(attendsDay(s.students[0],'donderdag'),false);assert.equal(attendsDay(s.students[0],'maandag',true),false);assert.equal(attendsDay(s.students[1],'dinsdag'),true);s.students[1].absent=true;assert.equal(attendsDay(s.students[1],'dinsdag'),false);
});
test('week saves only present pupils and keeps exact seats across gaps by default',()=>{
  const s=fixture([['Ja','Ja','Ja','Ja'],['Ja','Nee','Ja','Nee'],['Nee','Ja','Nee','Ja']]),week=generateWeek(s,options);
  assert.deepEqual(Object.values(week.days).map(d=>d.presentIds.length),[2,2,2,2]);assert.deepEqual(assigned(week,'maandag','s0'),assigned(week,'vrijdag','s0'));assert.deepEqual(assigned(week,'maandag','s1'),assigned(week,'donderdag','s1'));assert.deepEqual(assigned(week,'dinsdag','s2'),assigned(week,'vrijdag','s2'));assert.deepEqual(week.changes,[]);assert.ok(weeklyPlansValid(week));assert.equal(week.keepSeats,true);assert.ok(Object.values(week.days).every(d=>d.unplaced.length===0));assert.equal(s.weeklyPlans,undefined);
});
test('weekly planning ignores disabled fixed and personal rules while preserving pins',()=>{
  const s=fixture([['Ja','Ja','Ja','Ja'],['Nee','Ja','Nee','Ja']]);s.settings.studentRulesEnabled=false;s.assignments={'bank2:0':'s0'};s.locks=['s0'];captureRoom(s);s.rules=[{id:'fixed',type:'fixed',students:['s1'],roomId:s.activeRoomId,seat:'bank1:0',priority:'Verplicht'},{id:'apart',type:'far',students:['s0','s1'],priority:'Verplicht'}];
  const control=structuredClone(s);control.rules=[];const actual=generateWeek(s,options),expected=generateWeek(control,options);
  assert.deepEqual(actual.days,expected.days);assert.deepEqual(actual.changes,expected.changes);for(const day of STUDY_DAYS)assert.equal(assigned(actual,day,'s0').seat,'bank2:0');assert.equal(s.rules.length,2);
});
test('applying, reopening and regenerating a Monday plan never turn Tuesday attendance into manual absence',()=>{
  const s=fixture([['Ja','Nee','Ja','Nee'],['Nee','Ja','Nee','Ja']]);s.weeklyPlans=generateWeek(s,options);applyWeeklyDay(s,'maandag');normalizeRooms(s);assert.equal(s.students[1].absent,true);assert.ok(weeklyCurrent(s));const reopened=initializeRooms(JSON.parse(JSON.stringify(s)));applyWeeklyDay(reopened,'dinsdag');assert.equal(reopened.students[0].absent,true);assert.equal(reopened.students[1].absent,false);const next=generateWeek(reopened,options);assert.deepEqual(next.days.dinsdag.presentIds,['s1']);leaveWeeklyDay(reopened);assert.ok(reopened.students.every(p=>!p.absent));assert.ok(weeklyCurrent(reopened));
});
test('manual daily seat edits persist when switching and reopening, without replacing other days',()=>{
  const s=fixture([['Ja','Ja','Ja','Ja']]);s.weeklyPlans=generateWeek(s,options);applyWeeklyDay(s,'maandag');const originalTuesday=structuredClone(s.weeklyPlans.days.dinsdag.assignments),id=s.students[0].id,alternate=enabledSeats(s.settings).find(seat=>s.assignments[seat]!==id);s.assignments={[alternate]:id};captureRoom(s);captureWeeklyDay(s);applyWeeklyDay(s,'dinsdag');assert.deepEqual(s.weeklyPlans.days.dinsdag.assignments,originalTuesday);applyWeeklyDay(s,'maandag');assert.equal(s.assignments[alternate],id);const reopened=JSON.parse(JSON.stringify(s));assert.ok(weeklyPlansValid(reopened.weeklyPlans));assert.equal(weeklyRows(reopened).length,4);assert.equal(reopened.weeklyPlans.days.maandag.assignments[s.activeRoomId][alternate],id);
});
test('capacity reuse seats otherwise unplaced pupils without duplicate seats or artificial capacity',()=>{
  const s=fixture([['Ja','Nee','Ja','Nee'],['Nee','Ja','Nee','Ja'],['Ja','Ja','Ja','Ja']],[1]);const week=generateWeek(s,options);assert.ok(Object.values(week.days).every(d=>Object.values(d.assignments).reduce((n,a)=>n+Object.keys(a).length,0)===1&&d.unplaced.length===1));assert.equal(enabledSeats(s.settings).length,1);
});
test('reference planning anticipates a fixed position for a pupil arriving Tuesday',()=>{
  const s=fixture([['Ja','Ja','Ja','Ja'],['Nee','Ja','Nee','Ja']],[1,1]);s.assignments={'bank0:0':'s0'};captureRoom(s);s.rules=[{id:'fixed',type:'fixed',priority:'Verplicht',students:['s1'],seat:'bank0:0',roomId:s.activeRoomId}];
  // Pin s0 Monday only through its ordinary existing preference. Union planning
  // moves it in advance, avoiding an unnecessary daily conflict.
  const week=generateWeek(s,options);assert.equal(assigned(week,'dinsdag','s1').seat,'bank0:0');assert.equal(assigned(week,'maandag','s0').seat,'bank1:0');assert.equal(assigned(week,'dinsdag','s0').seat,'bank1:0');assert.ok(week.days.dinsdag.warnings.every(w=>w.type!=='fixed'));
});
test('replacing a generated week while a day is active restores baseline before applying it',()=>{
  const s=fixture([['Ja','Nee','Ja','Nee'],['Nee','Ja','Nee','Ja']]);s.weeklyPlans=generateWeek(s,options);applyWeeklyDay(s,'maandag');const regenerated=generateWeek(s,{...options,keepSeats:false});s.weeklyPlans=regenerated;for(const p of s.students)p.absent=regenerated.baselineAbsent[p.id];applyWeeklyDay(s,'maandag',{capture:false});assert.equal(s.weeklyPlans.keepSeats,false);assert.equal(s.students[1].absent,true);applyWeeklyDay(s,'dinsdag');assert.equal(s.students[1].absent,false);
});
test('alternating pupils reuse a reference seat so the always-present pupil never has to move',()=>{
  const s=fixture([['Ja','Nee','Ja','Nee'],['Nee','Ja','Nee','Ja'],['Ja','Ja','Ja','Ja']],[1,1]),week=generateWeek(s,options);assert.deepEqual(week.changes,[]);assert.deepEqual(assigned(week,'maandag','s2'),assigned(week,'dinsdag','s2'));assert.deepEqual(assigned(week,'maandag','s0'),assigned(week,'dinsdag','s1'));assert.ok(Object.values(week.days).every(d=>d.unplaced.length===0));
});
test('a coattendance triangle with two seats requires a move, collected in one weekly warning list',()=>{
  const s=fixture([['Ja','Ja','Nee','Nee'],['Ja','Nee','Ja','Nee'],['Nee','Ja','Ja','Nee']],[1,1]),week=generateWeek(s,options);assert.ok(week.changes.length>=1);assert.ok(Object.values(week.days).every(d=>d.unplaced.length===0));for(const c of week.changes){assert.notDeepEqual(c.from,c.to);assert.ok(week.days[c.day].presentIds.includes(c.studentId));}
});
test('multiroom active preferences survive classesSpread distribution and class destinations stay fixed',()=>{
  const s=fixture([['Ja','Ja','Ja','Ja'],['Ja','Ja','Ja','Ja'],['Nee','Ja','Nee','Ja']],[1,1]);const b=newRoom(s,'Tweede zaal');b.layout=structuredClone(s.rooms.find(r=>r.id===s.activeRoomId).layout);s.participatingRooms.push(b.id);s.distribution.mode='classesSpread';s.assignments={'bank0:0':'s0','bank1:0':'s1'};s.locks=['s0'];captureRoom(s);assignRoom(s,'s2',b.id);s.students[2].class='2A';assignClassRoom(s,'2A',b.id);const w=generateWeek(s,options);for(const day of STUDY_DAYS){assert.equal(assigned(w,day,'s0').roomId,s.activeRoomId);assert.equal(assigned(w,day,'s0').seat,'bank0:0');}assert.equal(w.days.dinsdag.studentRooms.s2,b.id);assert.equal(w.days.maandag.presentIds.includes('s2'),false);
});
test('pin absent Monday is enforced on Tuesday and survives regeneration',()=>{
  const s=fixture([['Ja','Ja','Ja','Ja'],['Nee','Ja','Nee','Ja']],[1,1]);s.assignments={'bank0:0':'s0','bank1:0':'s1'};s.locks=['s1'];captureRoom(s);s.weeklyPlans=generateWeek(s,options);applyWeeklyDay(s,'maandag');normalizeRooms(s);s.weeklyPlans=generateWeek(s,options);assert.equal(assigned(s.weeklyPlans,'dinsdag','s1').seat,'bank1:0');
});

test('leaving a daily plan restores baseline seat pins for pupils absent on that day',()=>{
  const s=fixture([['Ja','Ja','Ja','Ja'],['Nee','Ja','Nee','Ja']],[1,1]);s.assignments={'bank0:0':'s0','bank1:0':'s1'};s.locks=['s1'];captureRoom(s);s.weeklyPlans=generateWeek(s,options);applyWeeklyDay(s,'maandag');
  assert.ok(!s.locks.includes('s1'));leaveWeeklyDay(s);assert.ok(s.locks.includes('s1'));assert.equal(s.assignments['bank1:0'],'s1');
  const regenerated=generateWeek(s,options);assert.equal(assigned(regenerated,'dinsdag','s1').seat,'bank1:0');
});

test('leaving a daily plan can retain an explicit unlock when invalidating the week',()=>{
  const s=fixture([null],[1]);s.assignments={'bank0:0':'s0'};s.locks=['s0'];captureRoom(s);s.weeklyPlans=generateWeek(s,options);applyWeeklyDay(s,'maandag');s.locks=[];
  leaveWeeklyDay(s,{restorePins:false});assert.deepEqual(s.locks,[]);assert.deepEqual(s.rooms.find(room=>room.id===s.activeRoomId).locks,[]);
});

test('a pinned disabled chair stays applicable and exportable with its availability warning',()=>{
  const s=fixture([null],[1]);s.assignments={'bank0:0':'s0'};s.locks=['s0'];s.settings.disabled=['bank0'];captureRoom(s);s.weeklyPlans=generateWeek(s,options);
  assert.ok(weeklyPlansValid(s.weeklyPlans,s));applyWeeklyDay(s,'maandag');assert.equal(s.assignments['bank0:0'],'s0');assert.ok(s.weeklyPlans.days.maandag.warnings.some(w=>w.type==='unavailable'));assert.equal(weeklyRows(s).length,4);
});
test('disabling preservation records no movement warning and still obeys pins and attendance',()=>{
  const s=fixture([['Ja','Ja','Ja','Ja']]);s.assignments={'bank2:0':'s0'};s.locks=['s0'];captureRoom(s);const week=generateWeek(s,{...options,keepSeats:false});assert.equal(week.keepSeats,false);assert.deepEqual(week.changes,[]);for(const day of STUDY_DAYS)assert.equal(assigned(week,day,'s0').seat,'bank2:0');
});
test('changed attendance and room capacity invalidate saved days; malformed weekly data rejected',()=>{
  const s=fixture([['Ja','Ja','Ja','Ja']]);s.weeklyPlans=generateWeek(s,options);assert.ok(weeklyCurrent(s));s.students[0].eveningStudy.maandag='Nee';assert.equal(weeklyCurrent(s),false);assert.throws(()=>applyWeeklyDay(s,'maandag'));assert.equal(weeklyPlansValid({...s.weeklyPlans,days:{}}),false);assert.equal(weeklyPlansValid(null),false);assert.equal(weeklyPlansValid({}),false);
});
test('engine prioritizes explicit rules over preferred seats but preserves a valid arbitrary seat side',()=>{
  const s=fixture([null,null],[2,1]);const a=generate(s,{...options,preferredSeats:{s0:'bank0:1',s1:'bank1:0'}});assert.equal(a.assignments['bank0:1'],'s0');s.rules=[{id:'same',type:'together',priority:'Verplicht',students:['s0','s1']}];const b=generate(s,{...options,preferredSeats:{s0:'bank0:1',s1:'bank1:0'}});assert.equal(evaluate(s,b.assignments).score[0],0);assert.equal(b.assignments['bank0:1'],'s0');assert.equal(b.assignments['bank0:0'],'s1');
});

test('weekly planning repairs avoidable cross-room relationships and keeps unavoidable violations visible',()=>{
  const s=fixture([null,null],[2]),a=s.rooms.find(r=>r.id===s.activeRoomId),b=newRoom(s,'Tweede');b.layout=structuredClone(a.layout);s.participatingRooms=[a.id,b.id];s.distribution.mode='classesSpread';
  s.rules=[{id:'pair',type:'together',students:['s0','s1'],priority:'Verplicht'}];
  let seed=3;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  const week=generateWeek(s,{iterations:600,random});
  for(const d of Object.values(week.days)){assert.equal(d.studentRooms.s0,d.studentRooms.s1);assert.ok(!d.warnings.some(w=>w.ruleId==='pair'));}
  s.classRooms={'1A':a.id};s.students[1].class='2A';s.classRooms['2A']=b.id;
  const impossible=generateWeek(s,{iterations:600,random});
  for(const d of Object.values(impossible.days))assert.ok(d.warnings.some(w=>w.ruleId==='pair'&&w.crossRoom));
});

test('saving edited daily seats recomputes warnings instead of exporting stale generated warnings',()=>{
  const s=fixture([null,null],[2,2]);s.rules=[{id:'pair',type:'together',students:['s0','s1'],priority:'Verplicht'}];s.weeklyPlans=generateWeek(s,options);applyWeeklyDay(s,'maandag');
  s.assignments={'bank0:0':'s0','bank1:0':'s1'};captureWeeklyDay(s);
  assert.ok(s.weeklyPlans.days.maandag.warnings.some(w=>w.ruleId==='pair'));
  s.assignments={'bank0:0':'s0','bank0:1':'s1'};captureWeeklyDay(s);
  assert.ok(!s.weeklyPlans.days.maandag.warnings.some(w=>w.ruleId==='pair'));
});

test('weekly validation rejects duplicate pupils, foreign rooms and malformed warnings before apply or export',()=>{
  const s=fixture([null,null],[2]);s.weeklyPlans=generateWeek(s,options);
  for(const corrupt of [
    w=>w.days.maandag.presentIds.push('s0'),
    w=>w.days.maandag.assignments[s.activeRoomId]['bank0:2']='s0',
    w=>{w.days.maandag.assignments[s.activeRoomId]={'missing:0':'s0','bank0:1':'s1'};},
    w=>{w.days.maandag.studentRooms.s0='missing';},
    w=>w.days.maandag.warnings.push({type:'together'}),
    w=>w.days.maandag.unplaced.push('s0')
  ]) {
    const data=structuredClone(s);corrupt(data.weeklyPlans);
    assert.equal(weeklyPlansValid(data.weeklyPlans,data),false);assert.throws(()=>applyWeeklyDay(data,'maandag'));assert.throws(()=>weeklyRows(data));
  }
  const stale=structuredClone(s);stale.students[0].name='Changed';assert.ok(weeklyPlansValid(stale.weeklyPlans,stale));assert.equal(weeklyCurrent(stale),false);
});
