import test from 'node:test';
import assert from 'node:assert/strict';
import { columnIndex, columnLetter, emptyGridRoom, generateGrid, gridColumns, visualPosition, visualBands, positionAt, tableAt, setTable, removeTable, setGap, setRowGap, setSection, removeSection, resizeCanvas, migrateGridRoom, packGridRoom, unpackGridRoom } from '../src/grid-room.mjs';
import { layoutValid, makeBench, fits, findSpace, layoutSize, benchSeatCodes } from '../src/layout.mjs';
import { defaults, enabledSeats, seatCode, orderedSeats } from '../src/engine.mjs';
import { initializeRooms, newRoom, switchRoom, normalizeRooms, roomSystemValid } from '../src/rooms.mjs';
const grid=()=>generateGrid(emptyGridRoom(),{from:'A',to:'F',rows:5,firstRow:6});
test('reducing 20 rows to 3 removes the old canvas height and keeps surviving bench ids',()=>{
  const large=generateGrid(emptyGridRoom(),{from:'A',to:'C',rows:20}),size=layoutSize(large);
  const small=generateGrid(large,{...large.grid,rows:3});
  assert.ok(layoutSize(small).height<size.height);assert.equal(small.rows,23);
  assert.deepEqual(small.benches.map(b=>b.id),large.benches.filter(b=>b.cell.row<=3).map(b=>b.id));
  assert.ok(layoutValid(small));assert.deepEqual(generateGrid(small,small.grid),small);
});
test('reducing A–T to A–C removes the old canvas width without affecting the row count',()=>{
  const large=generateGrid(emptyGridRoom(),{from:'A',to:'T',rows:3}),small=generateGrid(large,{...large.grid,to:'C'});
  assert.ok(layoutSize(small).width<layoutSize(large).width);assert.equal(small.columns,22);
  assert.equal(small.rows,large.rows);assert.equal(small.benches.length,9);assert.ok(layoutValid(small));
});
test('Apply clears saved excess canvas space, while ordinary deletion keeps its scroll surface',()=>{
  const l=generateGrid(emptyGridRoom(),{from:'A',to:'C',rows:3});l.columns=150;l.rows=130;
  removeTable(l,'grid-C3');resizeCanvas(l);assert.equal(l.columns,150);assert.equal(l.rows,130);
  const applied=generateGrid(l,l.grid,{fitCanvas:true});assert.equal(applied.columns,22);assert.equal(applied.rows,23);
  assert.equal(applied.benches.some(b=>b.id==='grid-C3'),false);
});
test('smaller canvases retain complete manually placed and customized table bounds and round-trip',()=>{
  const l=generateGrid(emptyGridRoom(),{from:'A',to:'T',rows:20});
  const manual=makeBench(l,'teacher',{gx:35,gy:30,facing:'left'});setTable(l,manual);
  const edited=l.benches.find(b=>b.code==='A20');edited.enabled=false;
  const small=generateGrid(l,{...l.grid,to:'C',rows:3});
  assert.deepEqual(small.benches.find(b=>b.id===manual.id),manual);
  assert.equal(small.benches.find(b=>b.id===edited.id).cell,undefined);
  assert.ok(small.columns>=manual.gx+3);assert.ok(small.rows>=edited.gy+3);assert.ok(layoutValid(small));
  assert.deepEqual(unpackGridRoom(JSON.parse(JSON.stringify(packGridRoom(small)))),small);
});
test('new grids start at chair row 1/2 without reserving an unnumbered teacher row',()=>{
  const l=generateGrid(emptyGridRoom(),{from:'A',to:'B',rows:2});
  assert.equal(l.grid.firstRow,1);assert.equal(l.benches.find(b=>b.code==='A1').gy,1);
  assert.deepEqual(l.benches.map(b=>benchSeatCodes(b,2)),[['A1','A2'],['A3','A4'],['B1','B2'],['B3','B4']]);
  assert.equal(l.benches.some(b=>b.kind==='teacher'),false);
  assert.deepEqual(generateGrid(l,l.grid),l);assert.ok(layoutValid(l));
});
test('optional teacher placement/removal leaves grid positions, codes and capacity unchanged',()=>{
  const l=generateGrid(emptyGridRoom(),{from:'A',to:'B',rows:2}),before=structuredClone(l);
  const teacher=makeBench(l,'teacher',{gx:18,gy:1});assert.ok(fits(l,teacher));setTable(l,teacher);resizeCanvas(l);
  assert.deepEqual(generateGrid(l,l.grid),l);
  assert.equal(enabledSeats({...defaults().settings,layout:l}).length,8);
  removeTable(l,teacher.id);const after=generateGrid(l,l.grid);
  assert.deepEqual(after.grid,before.grid);assert.deepEqual(after.benches,before.benches);assert.deepEqual(after.removed,[]);
});
test('saved legacy top spacing is retained until explicitly changed, and compact reload never adds a teacher',()=>{
  const seed=emptyGridRoom();delete seed.grid.firstRow;
  const legacy=generateGrid(seed,{from:'A',to:'Z',rows:20});assert.equal(legacy.benches[0].gy,6);
  assert.deepEqual(generateGrid(legacy,legacy.grid),legacy);
  const next=generateGrid(legacy,{...legacy.grid,firstRow:1});assert.equal(next.benches[0].gy,1);
  assert.deepEqual(next.benches.map(b=>b.id),legacy.benches.map(b=>b.id));
  assert.deepEqual(unpackGridRoom(JSON.parse(JSON.stringify(packGridRoom(next)))),next);
  assert.equal(next.benches.some(b=>b.kind==='teacher'),false);
});
test('placing at either chair row snaps to V7/V8 and restores the deleted grid cell',()=>{
  const l=generateGrid(emptyGridRoom(),{from:'V',to:'W',rows:4});removeTable(l,'grid-V4');
  for(const gy of [19,22]){
    const b=tableAt(l,makeBench(l),1,gy);
    assert.deepEqual(b.cell,{column:'V',row:4});assert.deepEqual(benchSeatCodes(b,2),['V7','V8']);
    assert.deepEqual(visualPosition(l,b),{gx:0,gy:19});assert.ok(fits(l,b));
  }
  setTable(l,tableAt(l,makeBench(l),1,22));assert.ok(!l.removed.includes('V4'));
  assert.deepEqual(generateGrid(l,l.grid),l);assert.ok(layoutValid(l));
});
test('moves update codes and logical order while keeping student seat ids, pins and fixed rules',()=>{
  const s=initializeRooms(defaults()),l=s.settings.layout,b=l.benches.find(b=>b.code==='V1');
  const id=b.id;s.students=[{id:'p',name:'Pupil',class:'1A',year:'1',absent:false}];s.studentRooms.p=s.activeRoomId;
  s.assignments={[`${id}:0`]:'p'};s.locks=['p'];s.rules=[{id:'fixed',type:'fixed',roomId:s.activeRoomId,students:['p'],seat:`${id}:0`,priority:'Verplicht'}];
  const target=visualPosition(l,{gx:b.gx,gy:19,anchor:'V',rowAnchor:4});
  const moved=tableAt(l,b,target.gx+1,target.gy+3);assert.ok(fits(l,moved));setTable(l,moved);
  assert.deepEqual(benchSeatCodes(moved,2),['V7','V8']);assert.equal(moved.id,id);assert.equal(moved.sortY,24);
  assert.ok(l.removed.includes('V1'));assert.ok(!l.removed.includes('V4'));
  assert.deepEqual(generateGrid(l,l.grid),l);normalizeRooms(s);
  assert.equal(s.assignments[`${id}:0`],'p');assert.deepEqual(s.locks,['p']);assert.equal(s.rules[0].seat,`${id}:0`);
  assert.equal(seatCode(`${id}:0`,s.settings),'V7');
});
test('snapping accounts for grid origin, pitch and both visual gaps',()=>{
  const l=generateGrid(emptyGridRoom(),{from:'U',to:'W',rows:4,columnStep:8,rowStep:9,firstRow:2});
  setGap(l,'U',3);setRowGap(l,3,5);setSection(l,{after:'U',name:'Extra',width:12});removeTable(l,'grid-V4');
  const next=tableAt(l,makeBench(l),24,36);
  assert.deepEqual(next.cell,{column:'V',row:4});assert.deepEqual(visualPosition(l,next),{gx:23,gy:34});
  assert.deepEqual(benchSeatCodes(next,2),['V7','V8']);assert.ok(fits(l,next));
  const single={...next,capacity:1};assert.deepEqual(benchSeatCodes(single,2),['V7']);
  assert.deepEqual(benchSeatCodes({...next,facing:'left'},2),['V7','V8']);
});
test('occupied logical cells cannot receive another bench, and section moves release their old cell',()=>{
  const l=grid(),b=l.benches.find(b=>b.code==='A1'),occupied=tableAt(l,b,6,6);
  assert.ok(!fits(l,occupied));
  const section=setSection(l,{after:'D',name:'Extra',width:12});
  const moved=tableAt(l,b,visualBands(l)[0].x,6);assert.equal(moved.sectionId,section.id);assert.equal(moved.cell,undefined);
  assert.ok(fits(l,moved));setTable(l,moved);assert.ok(l.removed.includes('A1'));
  const restored=tableAt(l,moved,0,6);setTable(l,restored);assert.deepEqual(benchSeatCodes(restored,2),['A1','A2']);
  assert.ok(!l.removed.includes('A1'));assert.equal(restored.sectionId,undefined);
});
test('compact saves retain moved cell identities and do not regenerate vacated cells',()=>{
  const l=generateGrid(emptyGridRoom(),{from:'A',to:'Z',rows:20}),b=l.benches.find(b=>b.code==='A1');
  removeTable(l,'grid-V4');setTable(l,tableAt(l,b,126,24));
  assert.deepEqual(unpackGridRoom(JSON.parse(JSON.stringify(packGridRoom(l)))),l);
  assert.ok(!generateGrid(l,l.grid).benches.some(b=>b.cell?.column==='A'&&b.cell.row===1));
});
test('letters support every spreadsheet column through ZZ, with rows 1 through 100',()=>{
  for(let i=0;i<702;i++)assert.equal(columnIndex(columnLetter(i)),i);
  assert.deepEqual(gridColumns({from:'Y',to:'AB',rows:100}),['Y','Z','AA','AB']);
  for(const value of [{from:'AAA',to:'AAA',rows:1},{from:'F',to:'A',rows:1},{from:'A',to:'F',rows:0},{from:'A',to:'F',rows:101}])assert.throws(()=>gridColumns(value));
  const l=generateGrid(emptyGridRoom(),{from:'ZZ',to:'ZZ',rows:100});assert.equal(l.benches.length,100);assert.ok(layoutValid(l));
});
test('the full A–ZZ and 1–100 range generates without the former 500-table limit',()=>{
  const l=generateGrid(emptyGridRoom(),{from:'A',to:'ZZ',rows:100});assert.equal(l.benches.length,70200);assert.ok(layoutValid(l));
  const settings={...defaults().settings,layout:l},seats=orderedSeats(settings);
  assert.equal(seats.length,140400);assert.equal(enabledSeats(settings).length,140400);
  assert.equal(seatCode(seats[0],settings),'A1');assert.equal(seatCode(seats.at(-1),settings),'ZZ200');
});
test('A–F / 1–5 creates only 30 student pairs without an automatic teacher',()=>{
  const l=grid();assert.ok(layoutValid(l));assert.equal(l.benches.length,30);assert.equal(l.benches.some(b=>b.kind==='teacher'),false);
  assert.equal(enabledSeats({...defaults().settings,layout:l}).length,60);for(const b of l.benches)assert.ok(fits(l,b),b.code);
});
test('the requested example round-trips through a saved multiroom project',()=>{
  const state=initializeRooms(defaults()),room=newRoom(state,'Voorbeeld');room.layout=grid();const l=room.layout;
  removeTable(l,l.benches.find(b=>b.code==='B3').id);Object.assign(l.benches.find(b=>b.code==='C4'),{gx:12,gy:42,facing:'left'});
  setGap(l,'B',2);const section=setSection(l,{after:'D',name:'Extra',width:12});
  for(let i=0;i<2;i++){const b=makeBench(l,'student',{sectionId:section.id,gx:i*6,gy:6,sortX:30+i*6,sortY:6,capacity:i?2:1,facing:i?'left':'down'});l.benches.push(b);l.nextManual++;}
  l.benches.push(makeBench(l,'teacher',{gx:12,gy:0,facing:'left'}));resizeCanvas(l);
  switchRoom(state,room.id);normalizeRooms(state);assert.ok(roomSystemValid(state));
  const saved=JSON.parse(JSON.stringify(state));normalizeRooms(saved);assert.deepEqual(saved.rooms,state.rooms);assert.deepEqual(saved.settings.layout,l);
  assert.equal(enabledSeats(saved.settings).length,61);assert.deepEqual(saved.settings.layout.grid,{from:'A',to:'F',rows:5,firstRow:6});
  const manual=saved.settings.layout.benches.filter(b=>b.sectionId);assert.equal(manual.length,2);assert.deepEqual(manual.map(b=>b.capacity),[1,2]);assert.ok(manual.every(b=>fits(l,b)));
});
test('regenerating or extending a grid preserves removals, ids, customized cells, manual tables, gaps and sections',()=>{
  const l=grid(),table=l.benches.find(b=>b.code==='C4');Object.assign(table,{gy:42,capacity:1,facing:'right',enabled:false});removeTable(l,l.benches.find(b=>b.code==='B3').id);
  setGap(l,'B',2);setSection(l,{after:'D',name:'Extra',width:12});const manual=makeBench(l,'student',{gx:40,gy:6,sortX:40,sortY:6});l.benches.push(manual);resizeCanvas(l);
  const again=generateGrid(l,l.grid);assert.deepEqual(again,l);const extended=generateGrid(l,{from:'A',to:'G',rows:6});assert.deepEqual(extended.benches.find(b=>b.id===table.id),table);assert.deepEqual(extended.benches.find(b=>b.id===manual.id),manual);assert.equal(extended.benches.some(b=>b.code==='B3'),false);assert.equal(extended.benches.filter(b=>b.cell).length,41);
});
test('spacing and sections move only drawing coordinates; capacity, ordering and codes remain unchanged',()=>{
  const l=grid(),settings={...defaults().settings,layout:l},seats=enabledSeats(settings),codes=seats.map(s=>seatCode(s,settings)),order=orderedSeats(settings),c=l.benches.find(b=>b.code==='C1'),e=l.benches.find(b=>b.code==='E1');
  const next=structuredClone(l);setGap(next,'B',2);setSection(next,{after:'D',name:'Computers',width:12});
  assert.equal(visualPosition(next,c).gx,c.gx+2);assert.equal(visualPosition(next,e).gx,e.gx+14);assert.equal(layoutSize(next).width,layoutSize(l).width+14*32);
  const changed={...settings,layout:next};assert.deepEqual(enabledSeats(changed),seats);assert.deepEqual(seats.map(s=>seatCode(s,changed)),codes);assert.deepEqual(orderedSeats(changed),order);assert.equal(next.benches.length,l.benches.length);
  setGap(next,'B',0);assert.equal(visualPosition(next,c).gx,c.gx);
});
test('manual tables inside empty sections follow section width and keep ids when the section is removed',()=>{
  const l=grid();setGap(l,'B',2);const section=setSection(l,{after:'D',name:'Project Area',width:12}),b=makeBench(l,'student',{sectionId:section.id});Object.assign(b,findSpace(l,b));b.sortX=26;b.sortY=6;l.benches.push(b);const before=visualPosition(l,b);
  assert.deepEqual(positionAt(l,before.gx,before.gy),{sectionId:section.id,gx:b.gx,gy:b.gy,rowAnchor:1});assert.ok(fits(l,b));assert.throws(()=>setSection(l,{...section,width:5}));
  removeSection(l,section.id);assert.equal(b.sectionId,undefined);assert.deepEqual(visualPosition(l,b),before);assert.ok(layoutValid(l));
});
test('validation rejects malformed sections, orphan section tables and ambiguous identities',()=>{
  const l=grid();l.benches.push(makeBench(l,'teacher',{gx:40,gy:0}));resizeCanvas(l);for(const update of [v=>v.gaps.push(null),v=>v.sections.push(null),v=>v.benches[0].sectionId='missing',v=>v.benches[0].sortX=NaN,v=>v.benches[0].cell={column:'AAA',row:1},v=>v.benches.push({...v.benches[0]}),v=>v.benches.find(b=>b.kind==='teacher').capacity=2]){const bad=structuredClone(l);update(bad);assert.equal(layoutValid(bad),false);}
});
test('old custom rooms convert once without changing student table ids, capacity or position',()=>{
  const old={kind:'custom',columns:40,rows:28,benches:[{id:'old',code:'A',gx:6,gy:6,facing:'right',kind:'student',capacity:2,enabled:true}]};const next=migrateGridRoom(old);assert.ok(layoutValid(next));assert.deepEqual(visualPosition(next,next.benches[0]),{gx:6,gy:6});assert.equal(next.benches[0].id,'old');assert.deepEqual(migrateGridRoom(next),next);
});
test('large grid storage fits comfortably within browser limits and losslessly retains custom edits and order',()=>{
  const l=generateGrid(emptyGridRoom(),{from:'A',to:'ZZ',rows:100});
  removeTable(l,l.benches.find(b=>b.code==='B3').id);Object.assign(l.benches.find(b=>b.code==='C4'),{gy:606,facing:'right',capacity:1});setGap(l,'B',2);setSection(l,{after:'D',name:'Extra',width:12});resizeCanvas(l);
  const data=JSON.stringify(packGridRoom(l));assert.ok(data.length<1000000);assert.deepEqual(unpackGridRoom(JSON.parse(data)),l);
});
test('changing the start column keeps manual offsets while aligning newly generated cells',()=>{
  const l=grid(),c=l.benches.find(b=>b.code==='C4');c.gy=42;c.gx+=1;
  const next=generateGrid(l,{from:'B',to:'H',rows:5});assert.equal(next.benches.find(b=>b.id===c.id).gx,7);assert.equal(next.benches.find(b=>b.code==='B1').gx,0);assert.equal(next.benches.find(b=>b.code==='H1').gx,36);assert.ok(layoutValid(next));
});
test('compact storage never invents grid cells or teachers in a room made entirely from manual tables',()=>{
  const l=emptyGridRoom();for(let i=0;i<500;i++)l.benches.push(makeBench(l,'student',{gx:(i%25)*6,gy:6+Math.floor(i/25)*6,sortX:(i%25)*6,sortY:6+Math.floor(i/25)*6}));resizeCanvas(l);
  assert.deepEqual(unpackGridRoom(JSON.parse(JSON.stringify(packGridRoom(l)))),l);
});
test('generating a legacy room with a student code L preserves it without adding a teacher',()=>{
  const l=emptyGridRoom();l.benches.push({...makeBench(l),code:'L',gx:40,gy:6,sortX:40,sortY:6});const next=generateGrid(l,l.grid);assert.ok(layoutValid(next));assert.equal(next.benches.some(b=>b.kind==='teacher'),false);assert.equal(next.benches.find(b=>b.id===l.benches[0].id).code,'L');
});
