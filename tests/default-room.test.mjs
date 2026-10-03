import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultClassroom} from '../src/default-room.mjs';
import {defaults,legacyDefaults,enabledSeats,orderedSeats,seatCode,generate} from '../src/engine.mjs';
import {initializeRooms,normalizeRooms,newRoom,duplicateRoom,switchRoom,roomSystemValid} from '../src/rooms.mjs';
import {benchSize,customSeatGeometry,fits,layoutValid,layoutSize} from '../src/layout.mjs';
import {generateGrid,setGap,setRowGap,setSection,removeSection,visualPosition,positionAt,packGridRoom,unpackGridRoom} from '../src/grid-room.mjs';

test('the default is a shared generated grid with the reference arrangement, aisles and teacher at K1',()=>{
  const l=defaultClassroom();assert.ok(layoutValid(l));assert.equal(l.kind,'custom');assert.equal(l.version,2);
  assert.equal(l.benches.filter(b=>b.kind==='student').length,95);
  for(const b of l.benches)assert.ok(fits(l,b),b.code);
  for(const letter of ['A','J','L','U'])assert.deepEqual(l.benches.filter(b=>b.cell?.column===letter).map(b=>b.code),[1,2,3,4].map(row=>letter+row));
  assert.deepEqual(l.benches.filter(b=>b.cell?.column==='K').map(b=>b.code),['K2','K3']);
  assert.deepEqual(l.benches.filter(b=>b.cell?.column==='Z').map(b=>b.code),['Z2']);
  assert.deepEqual(l.gaps,[{after:'J',width:2},{after:'K',width:2},{after:'U',width:1}]);
  const teacher=l.benches.find(b=>b.kind==='teacher');assert.equal(teacher.anchor,'K');assert.equal(teacher.gy,l.benches.find(b=>b.code==='A1').gy);
  assert.deepEqual(benchSize(teacher),benchSize({...teacher,kind:'student',capacity:2}));
  assert.equal(customSeatGeometry({...teacher,x:0,y:0},0).chairX+14,benchSize(teacher).width/2);
  const regenerated=generateGrid(l,l.grid);assert.deepEqual(regenerated,l);
});
test('new default rooms, copies and reopened plans all use the same editable format and table seat naming',()=>{
  assert.equal(defaults().settings.layout.kind,'custom');assert.equal(defaults().settings.layout.version,2);
  const s=initializeRooms(defaults()),r=newRoom(s,'Default','default');switchRoom(s,r.id);
  assert.equal(enabledSeats(s.settings).length,190);assert.equal(seatCode('grid-A1:0',s.settings),'A1');assert.equal(seatCode('grid-A1:1',s.settings),'A2');assert.equal(seatCode('grid-A2:0',s.settings),'A3');
  assert.deepEqual([1,2,3,4].flatMap(row=>[0,1].map(side=>seatCode(`grid-A${row}:${side}`,s.settings))),['A1','A2','A3','A4','A5','A6','A7','A8']);assert.equal(new Set(enabledSeats(s.settings).map(seat=>seatCode(seat,s.settings))).size,190);
  const copied=duplicateRoom(s,r.id,'Copy');assert.deepEqual(copied.layout,r.layout);
  const reopened=initializeRooms(JSON.parse(JSON.stringify(s)));assert.ok(reopened.rooms.every(r=>r.layout.kind==='custom'));assert.ok(roomSystemValid(reopened));
});
test('the legacy import retains the union of enabled ranges, including an entirely disabled room',()=>{
  const s=legacyDefaults();s.settings.sections=[];initializeRooms(s);assert.equal(enabledSeats(s.settings).length,0);
  const overlapping=legacyDefaults();overlapping.settings.sections=[{id:'off',from:'A',to:'Z',enabled:false},{id:'on',from:'A',to:'B',enabled:true}];initializeRooms(overlapping);assert.equal(enabledSeats(overlapping.settings).length,16);
});
test('both axes of visual whitespace preserve seats, codes, sort order, pinned students and generation',()=>{
  const s=initializeRooms(defaults());s.students=[{id:'p',name:'Pupil',class:'1A',year:'1',absent:false}];s.studentRooms.p=s.activeRoomId;
  s.assignments={'grid-C4:0':'p'};s.locks=['p'];s.rules=[{id:'f',roomId:s.activeRoomId,type:'fixed',students:['p'],seat:'grid-C4:0',priority:'Verplicht'}];
  const seats=enabledSeats(s.settings),order=orderedSeats(s.settings),codes=seats.map(x=>seatCode(x,s.settings)),b=s.settings.layout.benches.find(b=>b.code==='C4'),before=visualPosition(s.settings.layout,b),size=layoutSize(s.settings.layout);
  s.settings.layout=structuredClone(s.settings.layout);setGap(s.settings.layout,'B',2);setRowGap(s.settings.layout,3,1);
  const after=visualPosition(s.settings.layout,b);assert.deepEqual(after,{gx:before.gx+2,gy:before.gy+1});
  assert.deepEqual(enabledSeats(s.settings),seats);assert.deepEqual(orderedSeats(s.settings),order);assert.deepEqual(seats.map(x=>seatCode(x,s.settings)),codes);
  assert.equal(layoutSize(s.settings.layout).height,size.height+32);assert.equal(generate(s,{iterations:0}).assignments['grid-C4:0'],'p');
  const converted=positionAt(s.settings.layout,after.gx,after.gy);assert.equal(converted.gx,b.gx);assert.equal(converted.gy,b.gy);assert.equal(converted.rowAnchor,4);
  normalizeRooms(s);assert.ok(roomSystemValid(s));assert.deepEqual(s.locks,['p']);
});
test('moving a generated table into a named section and removing the section preserves display position and identity',()=>{
  const l=defaultClassroom(),section=setSection(l,{after:'D',name:'Extra',width:12}),b=l.benches.find(b=>b.code==='C4');
  b.sectionId=section.id;b.gx=1;b.gy=30;delete b.anchor;
  const before=visualPosition(l,b),id=b.id,cell=structuredClone(b.cell);removeSection(l,section.id);
  assert.deepEqual(visualPosition(l,b),before);assert.equal(b.id,id);assert.deepEqual(b.cell,cell);assert.ok(layoutValid(l));
});
test('row spacing validates boundaries and survives compact large-grid persistence',()=>{
  const l=generateGrid(defaultClassroom(),{from:'A',to:'Z',rows:30});setRowGap(l,3,2);
  assert.throws(()=>setRowGap(l,30,1));assert.throws(()=>setRowGap(l,0,1));assert.throws(()=>setRowGap(l,3,-1));
  const stored=packGridRoom(l);assert.equal(stored.packedGrid,true);assert.deepEqual(unpackGridRoom(JSON.parse(JSON.stringify(stored))),l);
  const malformed=structuredClone(l);malformed.rowGaps.push({after:3,width:1});assert.equal(layoutValid(malformed),false);
});
test('importing old default rooms remaps fixed references and unavailable single-chair rows without orphaned seats',()=>{
  const s=legacyDefaults();s.students=[{id:'p',name:'Pupil',class:'1A',year:'1',absent:false}];s.settings.rows=[2];s.assignments={'A1:1':'p'};s.locks=['p'];s.rules=[{id:'f',type:'fixed',priority:'Verplicht',students:['p'],seat:'A1:1'}];
  initializeRooms(s);assert.deepEqual(s.assignments,{'grid-A1:0':'p'});assert.equal(s.rules[0].seat,'grid-A1:0');assert.equal(s.settings.layout.benches.find(b=>b.code==='A1').capacity,1);assert.equal(enabledSeats(s.settings).length,24);assert.ok(roomSystemValid(s));
  const reopened=initializeRooms(JSON.parse(JSON.stringify(s)));assert.deepEqual(reopened.assignments,s.assignments);assert.deepEqual(reopened.locks,['p']);
});
