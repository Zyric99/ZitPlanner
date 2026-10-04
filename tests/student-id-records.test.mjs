import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { defaults, migrateState } from '../src/engine.mjs';
import { emptyGridRoom, generateGrid } from '../src/grid-room.mjs';
import { initializeRooms, normalizeRooms, newRoom, assignRoom, captureRoom, studentLocationRoomId, DISTRIBUTION_MODES, distributeRooms, roomSystemValid } from '../src/rooms.mjs';
import { autoDistributeRooms } from '../src/auto-distribution.mjs';
import { generateWeek, applyWeeklyDay, leaveWeeklyDay, weeklyPlansValid, weeklyRows } from '../src/weekly-planner.mjs';
import { STUDY_DAYS } from '../src/student-import.mjs';
import { validState, validProjectBackup } from '../src/project-validation.mjs';
import { createProjectSession } from '../src/project-session.mjs';

const {ProjectStore}=createRequire(import.meta.url)('../desktop/project-store.cjs');
const auditIds=['constructor','toString','__proto__'];
const ids=[...auditIds,'hasOwnProperty','isPrototypeOf','valueOf','__defineGetter__','__lookupGetter__'];
const options={attempts:2,iterations:300,random:()=>0.31};
const roundtrip=value=>JSON.parse(JSON.stringify(value));
const seated=state=>state.rooms.flatMap(room=>Object.values(room.assignments));
function fixture(studentIds=ids,roomCount=1) {
  const state=defaults();state.settings.studentRulesEnabled=true;state.settings.classRulesEnabled=false;state.settings.yearRulesEnabled=false;
  state.students=studentIds.map((id,i)=>({id,name:`Leerling ${i}`,class:i%2?'2B':'1A',year:i%2?'2':'1',absent:false}));
  initializeRooms(state);
  for(let i=1;i<roomCount;i++)newRoom(state,`Lokaal ${i+1}`);
  for(const room of state.rooms)room.layout=generateGrid(emptyGridRoom(),{from:'A',to:'D',rows:1});
  state.settings.layout=structuredClone(state.rooms[0].layout);state.participatingRooms=state.rooms.map(room=>room.id);
  return roundtrip(state); // The external JSON project path, including own __proto__ keys.
}
function assertAllSeated(state,expected=ids) {
  assert.deepEqual([...seated(state)].sort(),[...expected].sort());
  assert.ok(roomSystemValid(state));assert.ok(validState(state));
  assert.equal(Object.getPrototypeOf(state.studentRooms),Object.prototype);
  for(const id of expected)assert.ok(Object.hasOwn(state.studentRooms,id));
}

for(const id of auditIds)test(`Auto seats a valid imported one-student project with ID ${id}`,()=>{
  const source=fixture([id]),before=structuredClone(source);
  assert.ok(validProjectBackup({version:2,state:source}));
  assert.equal(studentLocationRoomId(source,id),undefined);
  const result=autoDistributeRooms(source,options);
  assert.equal(result.complete,true);assertAllSeated(result.state,[id]);
  assert.deepEqual(source,before);
});

test('normalization and manual room assignment create own entries without changing the record prototype',()=>{
  const state=fixture();state.studentRooms={};
  assert.ok(validState(state));normalizeRooms(state);
  for(const id of ids){assert.ok(Object.hasOwn(state.studentRooms,id));assert.equal(state.studentRooms[id],state.activeRoomId);}
  state.studentRooms={};
  for(const id of ids)assignRoom(state,id,state.activeRoomId);
  assert.equal(Object.getPrototypeOf(state.studentRooms),Object.prototype);
  assert.deepEqual(Object.keys(state.studentRooms).sort(),[...ids].sort());
  assert.ok(validState(roundtrip(state)));
});

for(const mode of Object.keys(DISTRIBUTION_MODES))test(`${mode} distribution assigns every prototype-named ID, then Auto seats them`,()=>{
  const state=fixture(ids,2);state.studentRooms={};
  const distribution=distributeRooms(state,mode);
  assert.deepEqual(distribution.unassigned,[]);assert.deepEqual(distribution.overflow,[]);
  for(const id of ids)assert.ok(Object.hasOwn(state.studentRooms,id)&&state.rooms.some(room=>room.id===state.studentRooms[id]));
  assert.equal(Object.getPrototypeOf(state.studentRooms),Object.prototype);
  const result=autoDistributeRooms(state,options);
  assert.equal(result.complete,true);assertAllSeated(result.state);
});

test('Auto respects real legacy room pins, seat locks and fixed rules for prototype-named IDs',()=>{
  const state=fixture(ids,2),[a,b]=state.rooms;
  state.studentRoomPins=Object.fromEntries([['toString',a.id]]);
  state.assignments={'grid-A1:1':'constructor'};state.locks=['constructor'];captureRoom(state);
  state.rules=[{id:'fixed',type:'fixed',students:['__proto__'],roomId:b.id,seat:'grid-A1:0',priority:'Verplicht'}];
  const result=autoDistributeRooms(state,options);assertAllSeated(result.state);
  assert.equal(result.state.studentRooms.toString,a.id);
  assert.equal(result.state.rooms[0].assignments['grid-A1:1'],'constructor');
  assert.equal(result.state.rooms[1].assignments['grid-A1:0'],'__proto__');
});

test('Auto stores __proto__ room membership and honors an explicit preferred position',()=>{
  const state=fixture();state.studentRooms={};
  const preferredPositions=Object.fromEntries([['__proto__',{roomId:state.activeRoomId,seat:'grid-D1:1'}]]);
  const result=autoDistributeRooms(state,{...options,preferredPositions});
  assertAllSeated(result.state);assert.equal(result.state.assignments['grid-D1:1'],'__proto__');
});

test('JSON import migration preserves legal IDs and their actual location pins',()=>{
  const state=fixture(ids,2);state.studentRoomPins=Object.fromEntries([['__proto__',state.rooms[1].id]]);
  const imported=initializeRooms(migrateState(roundtrip(state)));normalizeRooms(imported);
  assert.equal(imported.rules.find(rule=>rule.students[0]==='__proto__').roomId,state.rooms[1].id);
  const result=autoDistributeRooms(imported,options);assertAllSeated(result.state);
  assert.equal(result.state.studentRooms.__proto__,state.rooms[1].id);
});

for(const keepSeats of [true,false])test(`saved weeks preserve prototype-named IDs, attendance and pins (keepSeats=${keepSeats})`,()=>{
  const state=fixture(ids,2);state.students.find(p=>p.id==='valueOf').absent=true;
  state.students.find(p=>p.id==='toString').eveningStudy=Object.fromEntries(STUDY_DAYS.map((day,i)=>[day,i%2?'Ja':'Nee']));
  state.assignments={'grid-D1:0':'__proto__'};state.locks=['__proto__'];captureRoom(state);
  state.weeklyPlans=generateWeek(state,{...options,keepSeats});
  assert.ok(weeklyPlansValid(state.weeklyPlans,state));
  for(const day of STUDY_DAYS){
    const expected=ids.filter(id=>id!=='valueOf'&&(id!=='toString'||state.students.find(p=>p.id===id).eveningStudy[day]==='Ja'));
    const daily=state.weeklyPlans.days[day];
    assert.deepEqual(daily.unplaced,[]);assert.deepEqual(Object.values(daily.assignments).flatMap(Object.values).sort(),expected.sort());
    assert.equal(daily.assignments[state.activeRoomId]['grid-D1:0'],'__proto__');
  }
  applyWeeklyDay(state,'maandag');const reopened=initializeRooms(roundtrip(state));
  assert.ok(validProjectBackup({version:2,state:reopened}));applyWeeklyDay(reopened,'dinsdag');
  assert.equal(reopened.students.find(p=>p.id==='toString').absent,false);
  assert.equal(reopened.students.find(p=>p.id==='valueOf').absent,true);
  assert.equal(weeklyRows(reopened).length,26);
  leaveWeeklyDay(reopened);assert.ok(reopened.students.filter(p=>p.id!=='valueOf').every(p=>!p.absent));
  assert.ok(weeklyPlansValid(generateWeek(reopened,{...options,keepSeats}),reopened));
});

test('disk autosave and restart preserve prototype-named IDs, own memberships and saved weeks',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'klaslokaal-student-ids-'));
  t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const backend=new ProjectStore(directory),api=Object.fromEntries(['startup','bootstrap','save'].map(method=>[method,arg=>backend[method](arg)]));
  const state=autoDistributeRooms(fixture(ids,2),options).state;
  state.weeklyPlans=generateWeek(state,options);applyWeeklyDay(state,'maandag');
  const session=await createProjectSession(api,{getItem:()=>null},'klaslokaal-v1');
  await session.initialize(state,[],[]);await session.save('klaslokaal-v1',state);await session.flush();
  const saved=(await new ProjectStore(directory).startup()).document.state;
  assert.ok(validProjectBackup({version:2,state:saved}));
  const reopened=initializeRooms(migrateState(saved));normalizeRooms(reopened);applyWeeklyDay(reopened,'dinsdag');
  assertAllSeated(reopened);assert.equal(weeklyRows(reopened).length,32);
  assertAllSeated(autoDistributeRooms(reopened,options).state);
});
