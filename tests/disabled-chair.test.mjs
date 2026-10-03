import test from 'node:test';
import assert from 'node:assert/strict';
import {defaults,legacyDefaults,sampleStudents,enabledSeats,generate,evaluate,migrateState} from '../src/engine.mjs';
import {initializeRooms,newRoom,switchRoom,captureRoom,normalizeRooms,roomState,roomStats} from '../src/rooms.mjs';
import {emptyGridRoom,generateGrid,packGridRoom,unpackGridRoom} from '../src/grid-room.mjs';
import {validState} from '../src/project-validation.mjs';
import {autoDistributeRooms} from '../src/auto-distribution.mjs';

function fixture(){
  const state=defaults();state.settings.layout=generateGrid(emptyGridRoom(),{from:'A',to:'B',rows:2});
  state.students=sampleStudents().slice(0,8);state.settings.classRulesEnabled=false;state.settings.yearRulesEnabled=false;
  return initializeRooms(state);
}

for(const side of [0,1])for(const mode of ['random','ordered'])test(`${mode} skips disabled chair ${side} while keeping its partner and seat codes`,()=>{
  const state=fixture();state.settings.placementMode=mode;state.settings.disabledSeats=[`grid-A1:${side}`,`grid-B2:${side}`];
  const result=generate(state,{iterations:100});
  assert.equal(enabledSeats(state.settings).length,6);assert.equal(Object.keys(result.assignments).length,6);assert.equal(result.unplaced.length,2);
  for(const id of ['grid-A1','grid-B2']){assert.equal(result.assignments[`${id}:${side}`],undefined);assert.ok(result.assignments[`${id}:${1-side}`]);}
});

test('chair settings remain specific to each room through switching, serialization and Auto distribution',()=>{
  const state=fixture(),first=state.activeRoomId,second=newRoom(state,'Tweede lokaal');
  second.layout=structuredClone(state.settings.layout);state.participatingRooms.push(second.id);
  state.settings.disabledSeats=['grid-A1:1'];captureRoom(state);switchRoom(state,second.id);
  assert.deepEqual(state.settings.disabledSeats,[]);state.settings.disabledSeats=['grid-B2:0'];captureRoom(state);switchRoom(state,first);
  assert.deepEqual(state.settings.disabledSeats,['grid-A1:1']);
  const saved=JSON.parse(JSON.stringify(state,(_key,value)=>packGridRoom(value)),(_key,value)=>unpackGridRoom(value));
  initializeRooms(saved);assert.ok(validState(saved));
  const result=autoDistributeRooms(saved,{attempts:1,iterations:100});assert.equal(result.unplaced.length,0);
  assert.equal(result.state.rooms[0].assignments['grid-A1:1'],undefined);assert.equal(result.state.rooms[1].assignments['grid-B2:0'],undefined);
  assert.equal(roomStats(saved,saved.rooms[0]).capacity,7);assert.equal(roomStats(saved,saved.rooms[1]).capacity,7);
});

test('disabling an occupied chair retains the pupil and pin with an availability warning, like disabling a table',()=>{
  const state=fixture();state.assignments={'grid-A1:0':'demo-0','grid-A1:1':'demo-1'};state.locks=['demo-1'];state.settings.disabledSeats=['grid-A1:1'];normalizeRooms(state);
  assert.equal(state.assignments['grid-A1:1'],'demo-1');assert.deepEqual(state.locks,['demo-1']);
  assert.ok(evaluate(state).warnings.some(w=>w.students.includes('demo-1')&&/uitgeschakeld/i.test(w.message)));
});

test('old projects gain empty chair settings without inheriting the active room selection',()=>{
  const state=fixture(),second=newRoom(state,'Oud lokaal');delete state.settings.disabledSeats;for(const room of state.rooms)delete room.settings.disabledSeats;
  assert.ok(validState(state));const upgraded=initializeRooms(migrateState(state));assert.deepEqual(upgraded.settings.disabledSeats,[]);
  upgraded.settings.disabledSeats=['grid-A1:1'];captureRoom(upgraded);switchRoom(upgraded,second.id);assert.deepEqual(upgraded.settings.disabledSeats,[]);
  const legacy=legacyDefaults();legacy.settings.disabledSeats=['A1:1'];assert.ok(!enabledSeats(legacy.settings).includes('A1:1'));assert.ok(enabledSeats(legacy.settings).includes('A1:0'));
});

test('chair validation rejects malformed or unknown seats and normalization drops removed chairs',()=>{
  for(const invalid of ['bad:1','grid-A1:2',null,42]){const state=fixture();state.settings.disabledSeats=[invalid];assert.equal(validState(state),false);}
  const state=fixture();state.settings.disabledSeats=['grid-A1:1'];captureRoom(state);state.rooms[1]=structuredClone(state.rooms[0]);state.rooms[1].id='other';state.rooms[1].settings.disabledSeats=['bad:1'];assert.equal(validState(state),false);
  state.rooms.pop();state.settings.layout.benches.find(b=>b.id==='grid-A1').capacity=1;normalizeRooms(state);assert.deepEqual(state.settings.disabledSeats,[]);assert.ok(validState(state));
  assert.equal(enabledSeats(roomState(state,state.activeRoomId).settings).length,7);
});
