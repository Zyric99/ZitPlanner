import test from 'node:test';
import assert from 'node:assert/strict';
import { defaults, sampleStudents, enabledSeats, validSeat, benchesFor, benchCapacity, seatCode, seatLabel, seatGeometry, orderedSeats, distance, adjacentSeats, generate, evaluate } from '../src/engine.mjs';
import { initializeRooms, newRoom, assignRoom, switchRoom, normalizeRooms, roomStats, roomSystemValid } from '../src/rooms.mjs';
import { emptyGridRoom, generateGrid, resizeCanvas, setGap, setRowGap, setSection, migrateGridRoom } from '../src/grid-room.mjs';
import { seatingRows } from '../src/excel-export.mjs';
import { benchSize, makeBench } from '../src/layout.mjs';

function fixture(count=4) {
  const state=defaults();state.settings.studentRulesEnabled=true;state.students=sampleStudents().slice(0,count);
  state.settings.classRulesEnabled=false;state.settings.yearRulesEnabled=false;
  initializeRooms(state);
  const room=newRoom(state,'Een- en tweepersoonsbanken');
  room.layout=generateGrid(emptyGridRoom(),{from:'A',to:'B',rows:1});
  room.layout.benches.push(makeBench(room.layout,'teacher',{gx:12,gy:0}));
  resizeCanvas(room.layout);
  room.layout.benches.find(b=>b.code==='A1').capacity=1;
  for(const student of state.students)assignRoom(state,student.id,room.id);
  switchRoom(state,room.id);
  return state;
}
const bench=(state,code)=>benchesFor(state.settings).find(b=>b.code===code);
const seat=(state,code,index=0)=>`${bench(state,code).id}:${index}`;
function rng(seed=71){return()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};}

test('one-seat student and teacher desks retain the pair footprint with one centered chair in every direction',()=>{
  for(const kind of ['student','teacher'])for(const facing of ['up','right','down','left']) {
    const single={custom:true,layoutVersion:2,x:40,y:64,kind,facing,capacity:1};
    const size=benchSize(single),pairSize=benchSize({...single,capacity:2}),geometry=seatGeometry(single,0);
    assert.deepEqual(size,pairSize,`${kind} ${facing} footprint`);
    if(['up','down'].includes(facing)) {
      assert.equal(geometry.x+geometry.w/2,single.x+size.width/2,`${kind} ${facing} seat center`);
      assert.equal(geometry.chairX+geometry.chairWidth/2,single.x+size.width/2,`${kind} ${facing} chair center`);
    } else {
      assert.equal(geometry.y+geometry.h/2,single.y+size.height/2,`${kind} ${facing} seat center`);
      assert.equal(geometry.chairY+geometry.chairHeight/2,single.y+size.height/2,`${kind} ${facing} chair center`);
    }
  }
});

for(const mode of ['random','ordered'])for(const preferredSide of [0,1])test(`${mode} uses exactly one seat on a single table with preferred side ${preferredSide}`,()=>{
  const state=fixture();state.settings.placementMode=mode;state.settings.ordered.seatSide=preferredSide;
  const result=generate(state,{random:rng(),iterations:100});
  assert.equal(enabledSeats(state.settings).length,3);
  assert.equal(Object.keys(result.assignments).length,3);
  assert.equal(result.unplaced.length,1);
  assert.equal(new Set(Object.values(result.assignments)).size,3);
  assert.ok(Object.keys(result.assignments).every(s=>validSeat(s,state.settings)));
  assert.ok(Object.hasOwn(result.assignments,seat(state,'A1')));
  assert.equal(validSeat(seat(state,'A1',1),state.settings),false);
  const teacher=state.settings.layout.benches.find(b=>b.kind==='teacher');
  assert.equal(validSeat(`${teacher.id}:0`,state.settings),false);
  assert.equal(benchCapacity(bench(state,'A1')),1);
});

test('reducing a pair to one seat retains its first occupant and pin, removes its second occupant and pin, and keeps the fixed-position warning',()=>{
  const state=fixture(2),id=bench(state,'B1').id;
  state.assignments={[`${id}:0`]:'demo-0',[`${id}:1`]:'demo-1'};state.locks=['demo-0','demo-1'];
  state.rules=[{id:'fixed',type:'fixed',priority:'Verplicht',students:['demo-1'],seat:`${id}:1`,roomId:state.activeRoomId,positionCode:'B1.2'}];
  state.settings.layout=structuredClone(state.settings.layout);
  state.settings.layout.benches.find(b=>b.id===id).capacity=1;
  normalizeRooms(state);
  assert.deepEqual(state.assignments,{[`${id}:0`]:'demo-0'});
  assert.deepEqual(state.locks,['demo-0']);
  assert.equal(state.rules.length,1);
  assert.match(evaluate(state).warnings.find(w=>w.ruleId==='fixed').message,/B2.*bestaat niet meer/);
  assert.equal(adjacentSeats(`${id}:0`,`${id}:1`,true,state.settings),false);
  const result=generate(state,{iterations:100});
  assert.equal(result.assignments[`${id}:0`],'demo-0');
  assert.equal(result.assignments[`${id}:1`],undefined);
  assert.equal(result.unplaced.length,0);
  assert.ok(roomSystemValid(state));
  const restored=JSON.parse(JSON.stringify(state));initializeRooms(restored);normalizeRooms(restored);
  assert.deepEqual(restored.assignments,state.assignments);
  assert.deepEqual(restored.locks,state.locks);
  assert.equal(roomStats(restored,restored.rooms.find(r=>r.id===restored.activeRoomId)).capacity,2);
  assert.ok(roomSystemValid(restored));
});

test('restoring capacity to two reuses the second seat identity and its existing fixed-position rule',()=>{
  const state=fixture(2),id=bench(state,'A1').id;
  state.rules=[{id:'fixed',type:'fixed',priority:'Verplicht',students:['demo-0'],seat:`${id}:1`,roomId:state.activeRoomId}];
  assert.equal(generate(state,{iterations:0}).assignments[`${id}:1`],undefined);
  state.settings.layout=structuredClone(state.settings.layout);state.settings.layout.benches.find(b=>b.id===id).capacity=2;
  const result=generate(state,{iterations:50});
  assert.equal(result.assignments[`${id}:1`],'demo-0');
  assert.equal(result.warnings.some(w=>w.ruleId==='fixed'),false);
  assert.equal(seatCode(`${id}:1`,state.settings),'A2');
});

test('the surviving first seat keeps its pin and fixed rule through capacity reduction, rotation and reopening',()=>{
  const state=fixture(2),id=bench(state,'B1').id,first=`${id}:0`;
  state.assignments={[first]:'demo-0'};state.locks=['demo-0'];
  state.rules=[{id:'first-fixed',type:'fixed',priority:'Verplicht',students:['demo-0'],seat:first,roomId:state.activeRoomId,positionCode:'B1'}];
  state.settings.layout=structuredClone(state.settings.layout);
  Object.assign(state.settings.layout.benches.find(b=>b.id===id),{capacity:1,facing:'right'});
  normalizeRooms(state);
  const restored=JSON.parse(JSON.stringify(state));initializeRooms(restored);normalizeRooms(restored);
  assert.equal(bench(restored,'B1').capacity,1);
  assert.equal(bench(restored,'B1').facing,'right');
  assert.equal(restored.assignments[first],'demo-0');
  assert.deepEqual(restored.locks,['demo-0']);
  for(const mode of ['random','ordered']) {
    restored.settings.placementMode=mode;
    const result=generate(restored,{random:rng(),iterations:100});
    assert.equal(result.assignments[first],'demo-0');
    assert.equal(result.warnings.some(w=>w.ruleId==='first-fixed'),false);
    assert.equal(result.assignments[`${id}:1`],undefined);
  }
});

test('a sharing request cannot manufacture a partner seat on a one-student table',()=>{
  const state=fixture(2);state.settings.layout=structuredClone(state.settings.layout);
  state.settings.layout.benches.filter(b=>b.kind==='student').forEach(b=>b.capacity=1);
  state.rules=[{id:'together',type:'together',priority:'Verplicht',students:['demo-0','demo-1']}];
  const result=generate(state,{random:rng(),iterations:200});
  assert.equal(result.unplaced.length,0);
  assert.ok(Object.keys(result.assignments).every(s=>s.endsWith(':0')));
  assert.equal(result.warnings.find(w=>w.ruleId==='together').type,'together');
});

test('legacy room migration preserves seat codes and capacities above two when saved and reopened',()=>{
  const state=fixture(3),room=state.rooms.find(r=>r.id===state.activeRoomId);
  state.settings.layout=migrateGridRoom({kind:'custom',columns:40,rows:28,benches:[{id:'old-table',code:'AA',kind:'student',capacity:3,facing:'left',enabled:true,gx:0,gy:6},{id:'old-teacher',code:'AB',kind:'teacher',capacity:1,facing:'right',enabled:true,gx:10,gy:0}]});
  state.assignments={'old-table:0':'demo-0','old-table:1':'demo-1','old-table:2':'demo-2'};state.locks=['demo-2'];
  normalizeRooms(state);
  assert.equal(roomStats(state,room).capacity,3);
  assert.deepEqual(Object.keys(state.assignments).map(s=>seatCode(s,state.settings)),['AA1','AA2','AA3']);
  const restored=JSON.parse(JSON.stringify(state));initializeRooms(restored);normalizeRooms(restored);
  assert.equal(benchCapacity(bench(restored,'AA')),3);
  assert.deepEqual(restored.assignments,state.assignments);
  assert.deepEqual(restored.locks,['demo-2']);
  assert.equal(seatCode('old-table:2',restored.settings),'AA3');
  assert.equal(generate(restored,{iterations:20}).assignments['old-table:2'],'demo-2');
  assert.ok(roomSystemValid(restored));
});

test('capacity alone removes the second seat without moving the logical table or the surviving seat code',()=>{
  const state=fixture(0),a=bench(state,'A1'),b=bench(state,'B1'),before=distance(a,b),code=seatCode(`${b.id}:0`,state.settings);
  state.settings.layout=structuredClone(state.settings.layout);state.settings.layout.benches.find(table=>table.id===b.id).capacity=1;
  assert.equal(distance(bench(state,'A1'),bench(state,'B1')),before);
  assert.equal(seatCode(`${b.id}:0`,state.settings),code);
  assert.equal(enabledSeats(state.settings).length,2);
});

test('row whitespace moves a centered one-seat desk visually while retaining its pin, fixed rule and ordered assignment',()=>{
  const state=fixture(3);state.settings.placementMode='ordered';
  state.settings.layout=generateGrid(state.settings.layout,{from:'A',to:'B',rows:2});
  const id=bench(state,'B2').id,target=`${id}:0`;
  state.settings.layout=structuredClone(state.settings.layout);
  state.settings.layout.benches.find(b=>b.id===id).capacity=1;
  state.assignments={[target]:'demo-0'};state.locks=['demo-0'];
  state.rules=[{id:'row-fixed',type:'fixed',priority:'Verplicht',students:['demo-0'],seat:target,roomId:state.activeRoomId}];
  const before={geometry:seatGeometry(bench(state,'B2'),0),seats:enabledSeats(state.settings),order:orderedSeats(state.settings),result:generate(state,{iterations:50})};
  state.settings.layout=structuredClone(state.settings.layout);setRowGap(state.settings.layout,1,2);
  const after=generate(state,{iterations:50});
  assert.deepEqual(enabledSeats(state.settings),before.seats);
  assert.deepEqual(orderedSeats(state.settings),before.order);
  assert.deepEqual(after,before.result);
  assert.notDeepEqual(seatGeometry(bench(state,'B2'),0),before.geometry);
  assert.equal(after.assignments[target],'demo-0');
  assert.equal(after.assignments[`${id}:1`],undefined);
  normalizeRooms(state);
  const restored=JSON.parse(JSON.stringify(state));normalizeRooms(restored);
  assert.deepEqual(restored.settings.layout.rowGaps,[{after:1,width:2}]);
  assert.deepEqual(restored.locks,['demo-0']);
  assert.equal(restored.assignments[target],'demo-0');
});

test('visual movement, rotation, gaps and sections preserve identities, capacities, ordering, relation scores and generated assignments',()=>{
  const state=fixture(3);state.settings.placementMode='ordered';
  state.settings.yearRulesEnabled=true;state.settings.yearRules=[{years:['3','4'],type:'far',priority:'Voorkeur'}];
  state.rules=[{id:'adjacent',type:'adjacent',priority:'Verplicht',students:['demo-0','demo-1']}];
  const a=seat(state,'A1'),b=seat(state,'B1');state.assignments={[a]:'demo-0',[b]:'demo-1'};
  const before={seats:enabledSeats(state.settings),order:orderedSeats(state.settings),evaluation:evaluate(state),generated:generate(state,{iterations:100}).assignments,distance:distance(bench(state,'A1'),bench(state,'B1')),adjacent:adjacentSeats(a,b,true,state.settings),geometry:seatGeometry(bench(state,'B1'),0)};
  state.settings.layout=structuredClone(state.settings.layout);
  const layout=state.settings.layout;
  Object.assign(layout.benches.find(table=>table.code==='B1'),{gx:14,gy:16,facing:'right'});
  Object.assign(layout.benches.find(table=>table.kind==='teacher'),{gx:10,gy:3,facing:'left'});
  setGap(layout,'A',2);setSection(layout,{after:'A',name:'Extra',width:8});
  assert.deepEqual(enabledSeats(state.settings),before.seats);
  assert.deepEqual(orderedSeats(state.settings),before.order);
  assert.deepEqual(evaluate(state),before.evaluation);
  assert.deepEqual(generate(state,{iterations:100}).assignments,before.generated);
  assert.equal(distance(bench(state,'A1'),bench(state,'B1')),before.distance);
  assert.equal(adjacentSeats(a,b,true,state.settings),before.adjacent);
  assert.notDeepEqual(seatGeometry(bench(state,'B1'),0),before.geometry);
  assert.equal(seatCode(a,state.settings),'A1');
  assert.equal(seatCode(b,state.settings),'B1');
  assert.match(seatLabel(a,state.settings),/^A1$/);
  assert.deepEqual(seatingRows(state).map(row=>row[3]),['B1','Nog niet geplaatst','A1']);
});

