import test from 'node:test';
import assert from 'node:assert/strict';
import { defaults, migrateState, generate, evaluate } from '../src/engine.mjs';
import { initializeRooms, newRoom, captureRoom, normalizeRooms, assignRoom, pinStudentRoom, distributeRooms } from '../src/rooms.mjs';
import { locationRule, setLocationRule } from '../src/location-rules.mjs';
import { validState } from '../src/project-validation.mjs';
import { autoDistributeRooms } from '../src/auto-distribution.mjs';

function fixture(){const s=initializeRooms(defaults());s.settings.studentRulesEnabled=true;s.students=[{id:'p',name:'Pupil',class:'3A',year:'3',absent:false}];s.studentRooms={p:s.activeRoomId};newRoom(s,'Tweede','default');s.participatingRooms=s.rooms.map(r=>r.id);return s;}

test('legacy room and seat pins migrate deterministically into one rule, preserving source and effective seat',()=>{
  const s=fixture(),room=s.activeRoomId;s.assignments={'grid-A1:1':'p'};s.locks=['p'];s.studentRoomPins={p:room};
  s.rules=[{id:'old',type:'fixed',students:['p'],roomId:room,seat:'grid-B1:0',priority:'Verplicht'}];captureRoom(s);
  const before=structuredClone(s),m=migrateState(s);
  assert.deepEqual(s,before);assert.equal(m.rules.length,1);assert.equal(locationRule(m,'p').seat,'grid-A1:1');assert.equal(locationRule(m,'p').id,'old');
  assert.deepEqual(m.locks,[]);assert.ok(m.rooms.every(r=>!r.locks.length));assert.deepEqual(m.studentRoomPins,{});
  assert.deepEqual(m,migrateState(s));assert.deepEqual(m,migrateState(m));assert.equal(generate(m,{iterations:0}).assignments['grid-A1:1'],'p');
});

test('legacy room-only pins migrate without inventing a seat or changing membership',()=>{
  const s=fixture();s.studentRoomPins={p:s.rooms[1].id};s.studentRooms.p=s.rooms[1].id;
  const m=migrateState(s);assert.equal(locationRule(m,'p').roomId,s.rooms[1].id);assert.equal(locationRule(m,'p').seat,undefined);
  assert.deepEqual(m.studentRooms,s.studentRooms);assert.ok(validState(m));assert.deepEqual(m,migrateState(s));
});

test('migrating a room-only pin does not carry a fixed chair from a different room',()=>{
  const s=fixture(),oldRoom=s.activeRoomId,newRoomId=s.rooms[1].id;s.studentRoomPins={p:newRoomId};s.studentRooms.p=newRoomId;
  s.rules=[{id:'fixed',type:'fixed',students:['p'],roomId:oldRoom,seat:'grid-A1:1',positionCode:'A2',priority:'Verplicht'}];
  const m=migrateState(s);assert.equal(locationRule(m,'p').roomId,newRoomId);assert.equal(locationRule(m,'p').seat,undefined);assert.equal(locationRule(m,'p').positionCode,undefined);assert.ok(validState(m));
});

test('room-only and exact-seat edits replace the same rule and constrain both distribution and seating',()=>{
  const s=fixture(),room=s.rooms[1].id;pinStudentRoom(s,'p',room);const id=locationRule(s,'p').id;
  setLocationRule(s,{id,type:'fixed',students:['p'],priority:'Verplicht',roomId:room,seat:'grid-A1:1'});normalizeRooms(s);
  assert.equal(s.rules.length,1);assert.throws(()=>assignRoom(s,'p',s.rooms[0].id),/vaste locatie/);
  const result=autoDistributeRooms(s,{attempts:1,iterations:20});assert.equal(result.state.rooms[1].assignments['grid-A1:1'],'p');assert.ok(result.complete);
  pinStudentRoom(s,'p',room);assert.equal(locationRule(s,'p').id,id);assert.equal(locationRule(s,'p').seat,undefined);assert.ok(validState(s));
  distributeRooms(s,'balanced',{keepFixed:false});assert.equal(s.studentRooms.p,room);
  pinStudentRoom(s,'p');assert.equal(s.rules.length,0);assignRoom(s,'p',s.rooms[0].id);
});

test('room-only rules need no seat, survive validation, and follow the student module switch',()=>{
  const s=fixture();pinStudentRoom(s,'p',s.activeRoomId);assert.ok(validState(s));assert.deepEqual(evaluate(s).warnings.map(w=>w.type),['unplaced']);
  s.settings.studentRulesEnabled=false;assert.doesNotThrow(()=>assignRoom(s,'p',s.rooms[1].id));
  s.settings.studentRulesEnabled=true;normalizeRooms(s);assert.equal(s.studentRooms.p,s.activeRoomId);
  const invalid=structuredClone(s);invalid.rules[0].seat=null;assert.equal(validState(invalid),false);
});
