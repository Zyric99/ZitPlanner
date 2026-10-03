import test from 'node:test';
import assert from 'node:assert/strict';
import { defaults, sampleStudents, enabledSeats } from '../src/engine.mjs';
import { initializeRooms, newRoom, normalizeRooms, switchRoom, captureRoom, assignClassRoom, classRoomId, assignRoom, distributeRooms, generateAllRooms, participatingRoomIds, deleteRoom, roomSystemValid } from '../src/rooms.mjs';
import { generateGrid, emptyGridRoom } from '../src/grid-room.mjs';
function fixture(){const state=initializeRooms(defaults());state.students=sampleStudents().slice(0,8).map((p,i)=>({...p,class:i<4?'1A':'1B'}));normalizeRooms(state);state.settings.classRulesEnabled=false;state.settings.yearRulesEnabled=false;const a=newRoom(state,'Main Classroom','classroom'),b=newRoom(state,'Science Room','exam');a.settings.placementMode=b.settings.placementMode='ordered';state.participatingRooms=[a.id,b.id];return {state,a,b};}
test('class bindings use stable room IDs across tab switching, renaming, saved plans and future students',()=>{
  const {state,a,b}=fixture();assignClassRoom(state,'1A',a.id);assignClassRoom(state,'1B',b.id);switchRoom(state,b.id);a.name='Main · renamed';normalizeRooms(state);
  assert.equal(classRoomId(state,'1A'),a.id);assert.ok(state.students.every(p=>state.studentRooms[p.id]===(p.class==='1A'?a.id:b.id)));
  const saved=JSON.parse(JSON.stringify(state));assert.ok(roomSystemValid(saved));normalizeRooms(saved);assert.deepEqual(saved.classRooms,state.classRooms);
  saved.students.push({...sampleStudents()[8],class:'1A',absent:true});normalizeRooms(saved);assert.equal(saved.studentRooms['demo-8'],a.id);
});
for(const mode of ['balanced','capacity','classesSpread','classesTogether','yearsSpread'])test(`${mode} respects class destinations independently of the selected tab`,()=>{
  const {state,a,b}=fixture();assignClassRoom(state,'1A',a.id);assignClassRoom(state,'1B',b.id);state.participatingRooms=[];switchRoom(state,state.rooms[0].id);const result=distributeRooms(state,mode);assert.equal(result.unassigned.length,0);assert.ok(state.students.every(p=>state.studentRooms[p.id]===(p.class==='1A'?a.id:b.id)));assert.deepEqual(new Set(participatingRoomIds(state)),new Set([a.id,b.id]));
  const results=generateAllRooms(state,{iterations:20});assert.equal(results.length,2);assert.equal(Object.keys(a.assignments).length,4);assert.equal(Object.keys(b.assignments).length,4);assert.equal(new Set([...Object.values(a.assignments),...Object.values(b.assignments)]).size,8);assert.ok(Object.values(a.assignments).every(id=>state.students.find(p=>p.id===id).class==='1A'));
});
test('a class that exceeds its assigned tab capacity stays in that tab, with excess pupils visibly unplaced',()=>{
  const {state,a,b}=fixture();a.layout=generateGrid(emptyGridRoom(),{from:'A',to:'A',rows:1});a.layout.benches.find(b=>b.kind==='student').capacity=1;assignClassRoom(state,'1A',a.id);assignClassRoom(state,'1B',b.id);const distribution=distributeRooms(state,'capacity');assert.ok(distribution.overflow.includes(a.id));assert.equal(distribution.unassigned.length,0);const results=generateAllRooms(state,{iterations:20});assert.equal(results.find(r=>r.roomId===a.id).unplaced.length,3);assert.equal(enabledSeats({...state.settings,...a.settings,layout:a.layout}).length,1);assert.ok(state.students.filter(p=>p.class==='1A').every(p=>state.studentRooms[p.id]===a.id));
});
test('rebinding a class removes old seats and pins, preserves unrelated pupils and keeps fixed rules traceable',()=>{
  const {state,a,b}=fixture();assignClassRoom(state,'1A',a.id);switchRoom(state,a.id);const bench=a.layout.benches.find(b=>b.kind==='student');state.assignments={[`${bench.id}:0`]:'demo-0'};state.locks=['demo-0'];state.rules=[{id:'fixed',type:'fixed',students:['demo-0'],seat:`${bench.id}:0`,roomId:a.id,priority:'Verplicht'}];captureRoom(state);assignClassRoom(state,'1A',b.id);assert.deepEqual(a.assignments,{});assert.deepEqual(a.locks,[]);assert.equal(state.rules[0].roomId,a.id);assert.equal(state.studentRooms['demo-0'],b.id);assert.throws(()=>assignRoom(state,'demo-0',a.id),/vast lokaal/);assert.throws(()=>assignRoom(state,'demo-0',null),/vast lokaal/);
  assignClassRoom(state,'1A',null);assignRoom(state,'demo-0',a.id);assert.equal(classRoomId(state,'1A'),null);assert.equal(state.studentRooms['demo-0'],a.id);
});
test('deleting an assigned tab requires a valid replacement and transfers all bound classes atomically',()=>{
  const {state,a,b}=fixture();assignClassRoom(state,'1A',a.id);assignClassRoom(state,'Future Class',a.id);const before=structuredClone(state);assert.throws(()=>deleteRoom(state,a.id),/ander lokaal/);assert.throws(()=>deleteRoom(state,a.id,{replacementId:a.id}));assert.deepEqual(state,before);deleteRoom(state,a.id,{replacementId:b.id});assert.equal(classRoomId(state,'1A'),b.id);assert.equal(classRoomId(state,'Future Class'),b.id);assert.ok(state.students.filter(p=>p.class==='1A').every(p=>state.studentRooms[p.id]===b.id));assert.ok(roomSystemValid(state));
});
test('class routing validates saved references and safely supports ordinary object property names',()=>{
  const {state,a}=fixture();for(const value of [null,[],{A:'missing'}]){const bad=structuredClone(state);bad.classRooms=value;assert.equal(roomSystemValid(bad),false);}assert.throws(()=>assignClassRoom(state,'1A','missing'));assignClassRoom(state,'__proto__',a.id);assert.equal(classRoomId(state,'__proto__'),a.id);assert.ok(roomSystemValid(JSON.parse(JSON.stringify(state))));
});
