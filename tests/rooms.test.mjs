import test from 'node:test';
import assert from 'node:assert/strict';
import { defaults, legacyDefaults, sampleStudents, generate, evaluate, enabledSeats, benchCapacity, benchesFor, seatGeometry, seatCode, validSeat, adjacentSeats, roomStudents } from '../src/engine.mjs';
import { initializeRooms, normalizeRooms, captureRoom, switchRoom, roomState, roomStats, newRoom, duplicateRoom, deleteRoom, assignRoom, distributeRooms, generateAllRooms, roomSystemValid } from '../src/rooms.mjs';
import { roomTemplate, makeBench, fits, findSpace, layoutValid, customBenches, benchSize } from '../src/layout.mjs';
import { seatingRows, seatingWorkbook } from '../src/excel-export.mjs';
import { warningKey, warningGroups, reconcileHiddenWarnings } from '../src/warning-state.mjs';

function fixture(count=10) {const state=defaults();state.settings.studentRulesEnabled=true;state.students=sampleStudents().slice(0,count);return initializeRooms(state);}
function customRoom(state,name='Lokaal A',capacities=[2,2,2]) {
  const room=newRoom(state,name);room.layout={kind:'custom',columns:40,rows:28,benches:capacities.map((capacity,i)=>({id:`bank-${i}`,code:String.fromCharCode(65+i),kind:'student',capacity,facing:'down',enabled:true,gx:i*10,gy:4}))};return room;
}
function use(state,room) {state.participatingRooms=[room.id];for(const p of state.students)assignRoom(state,p.id,room.id);switchRoom(state,room.id);return state;}
function xmlFiles(bytes) {const result={},view=new DataView(bytes.buffer),decoder=new TextDecoder();let cursor=0;while(view.getUint32(cursor,true)===0x04034b50){const length=view.getUint32(cursor+18,true),nameLength=view.getUint16(cursor+26,true),start=cursor+30+nameLength;result[decoder.decode(bytes.subarray(cursor+30,start))]=decoder.decode(bytes.subarray(start,start+length));cursor=start+length;}return result;}

test('legacy room import rebuilds the default in the shared grid while preserving students, pins and rules',()=>{
  const s=legacyDefaults();s.students=sampleStudents().slice(0,2);s.assignments={'A1:0':'demo-0','A1:1':'demo-1'};s.locks=['demo-0'];s.hiddenWarnings=['saved'];s.rules=[{id:'f',type:'fixed',students:['demo-1'],seat:'A1:1',priority:'Verplicht'}];
  const before=structuredClone(s);initializeRooms(s);assert.equal(s.rooms[0].name,'Standaardlokaal');assert.equal(s.rooms[0].layout.kind,'custom');assert.equal(s.rooms[0].layout.version,2);assert.deepEqual(s.assignments,{'grid-A1:0':'demo-0','grid-A1:1':'demo-1'});assert.deepEqual(s.settings.classRules,before.settings.classRules);assert.deepEqual(s.locks,before.locks);assert.deepEqual(s.hiddenWarnings,before.hiddenWarnings);assert.equal(enabledSeats(s.settings).length,190);assert.equal(s.rules[0].roomId,s.activeRoomId);assert.equal(s.rules[0].seat,'grid-A1:1');assert.ok(roomSystemValid(s));
});
test('all four room templates validate and keep their student/teacher capacity separate',()=>{
  for(const type of ['empty','classroom','exam','computer']){const layout=roomTemplate(type);assert.ok(layoutValid(layout),type);for(const b of layout.benches)assert.ok(fits(layout,b),`${type} ${b.code}`);const s=fixture(0),room=newRoom(s,type,type);switchRoom(s,room.id);const stats=roomStats(s,room);assert.equal(stats.benches,type==='empty'?0:12);assert.equal(stats.capacity,type==='empty'?0:type==='exam'?12:24);assert.equal(customBenches(room.layout).filter(b=>b.kind==='teacher').length,0);}
});
test('capacities 1 through 8 generate that many seats, exclude teacher benches and disabled benches',()=>{
  const s=fixture(0),r=customRoom(s,'Variabel',[1,2,3,4,5,6,7,8]);r.layout.columns=100;r.layout.benches.push({id:'teacher',code:'I',kind:'teacher',capacity:8,facing:'left',enabled:true,gx:85,gy:4});r.layout.benches[1].enabled=false;switchRoom(s,r.id);s.settings.disabled=['bank-2'];captureRoom(s);assert.equal(enabledSeats(s.settings).length,36-2-3);const stats=roomStats(s,r);assert.deepEqual([stats.benches,stats.seats,stats.enabled,stats.disabled,stats.capacity],[8,36,6,2,31]);for(const b of benchesFor(s.settings))assert.equal(benchCapacity(b),b.capacity);assert.equal(validSeat('teacher:0',s.settings),false);assert.equal(validSeat('bank-0:1',s.settings),false);
});
test('seat codes stay unique and stable after movement, rotation, capacity changes and room copies',()=>{
  const s=fixture(0),r=customRoom(s,'Codes',[8,4]);switchRoom(s,r.id);const codes=enabledSeats(s.settings).map(seat=>seatCode(seat,s.settings));assert.equal(new Set(codes).size,12);assert.deepEqual(codes.slice(0,3),['A1','A2','A3']);const before=seatCode('bank-0:3',s.settings);s.settings.layout=structuredClone(s.settings.layout);Object.assign(s.settings.layout.benches[0],{gx:4,gy:10,facing:'left'});assert.equal(seatCode('bank-0:3',s.settings),before);captureRoom(s);const copy=duplicateRoom(s,r.id,'Kopie');switchRoom(s,copy.id);assert.equal(seatCode('bank-0:3',s.settings),before);assert.deepEqual(s.assignments,{});
});
test('all four directions change both table axis and attached chair side',()=>{
  const base={custom:true,x:40,y:64,capacity:3};for(const facing of ['up','right','down','left']){const b={...base,facing},size=benchSize(b),g=seatGeometry(b,0),g2=seatGeometry(b,1);if(facing==='up'){assert.ok(g.chairY>b.y+size.height);assert.equal(g.y,g2.y);}if(facing==='down'){assert.ok(g.chairY<b.y);assert.equal(g.y,g2.y);}if(facing==='right'){assert.ok(g.chairX<b.x);assert.equal(g.x,g2.x);}if(facing==='left'){assert.ok(g.chairX>b.x+size.width);assert.equal(g.x,g2.x);}}
});
test('grid snapping data disallows collisions and out-of-room placements; duplicate searches free space',()=>{
  const layout=roomTemplate('empty'),b=makeBench(layout);layout.benches.push(b);assert.ok(fits(layout,b));assert.equal(fits(layout,{...makeBench(layout),gx:0,gy:0}),false);assert.equal(fits(layout,{...b,gx:-1}),false);const copy=makeBench(layout),position=findSpace(layout,copy);assert.ok(position);assert.ok(fits(layout,{...copy,...position}));assert.equal(layoutValid({...layout,columns:7}),false);
});
test('duplicating the reference creates an editable, collision-free grid copy and preserves the original',()=>{
  const s=fixture(0),original=structuredClone(s.rooms[0]),copy=duplicateRoom(s,s.activeRoomId,'Referentiekopie');assert.equal(copy.layout.kind,'custom');assert.equal(copy.layout.benches.filter(b=>b.kind==='student').length,95);assert.equal(copy.layout.benches.filter(b=>b.kind==='teacher').length,1);assert.ok(layoutValid(copy.layout));for(const b of copy.layout.benches)assert.ok(fits(copy.layout,b),b.code);assert.deepEqual(s.rooms[0],original);switchRoom(s,copy.id);assert.equal(enabledSeats(s.settings).length,190);assert.equal(new Set(enabledSeats(s.settings).map(seat=>seatCode(seat,s.settings))).size,190);
});
test('room import validation rejects malformed data without throwing or losing the valid project',()=>{
  const s=fixture(1);for(const malformed of [null,{},[null],[{id:'bad'}]]){const data=structuredClone(s);data.rooms=malformed;assert.equal(roomSystemValid(data),false);}const room=customRoom(s);room.layout.benches=[null];assert.equal(layoutValid(room.layout),false);assert.equal(roomSystemValid(s),false);room.layout=roomTemplate();s.roomTemplates=[{id:'bad',name:'Bad',layout:null,settings:room.settings}];assert.equal(roomSystemValid(s),false);
});

test('room validation rejects seating a pupil outside their room and normalization removes duplicate seating',()=>{
  const s=fixture(1),a=customRoom(s,'A',[2]),b=customRoom(s,'B',[2]);use(s,a);s.assignments={'bank-0:0':'demo-0'};captureRoom(s);
  b.assignments={'bank-0:0':'demo-0'};assert.equal(roomSystemValid(s),false);
  b.assignments={};s.assignments={'bank-0:0':'demo-0','bank-0:1':'demo-0'};normalizeRooms(s);
  assert.deepEqual(s.assignments,{'bank-0:0':'demo-0'});assert.ok(roomSystemValid(s));
});
test('room distribution creates room membership and never creates seats',()=>{
  const s=fixture(8),a=customRoom(s,'A',[2,2]),b=customRoom(s,'B',[2,2]);s.participatingRooms=[a.id,b.id];const result=distributeRooms(s,'balanced');assert.equal(result.unassigned.length,0);assert.deepEqual(a.assignments,{});assert.deepEqual(b.assignments,{});assert.deepEqual([roomStats(s,a).assigned,roomStats(s,b).assigned],[4,4]);assert.equal(s.distribution.reviewed,false);assert.ok(roomSystemValid(s));
});
for(const mode of ['balanced','capacity','classesSpread','classesTogether','yearsSpread'])test(`${mode} distribution never silently exceeds capacity; excess students stay without a room`,()=>{
  const s=fixture(10),a=customRoom(s,'A',[1,2]),b=customRoom(s,'B',[2]);s.participatingRooms=[a.id,b.id];const result=distributeRooms(s,mode);assert.equal(result.unassigned.length,5);assert.equal(roomStats(s,a).assigned,3);assert.equal(roomStats(s,b).assigned,2);assert.ok(s.students.every(p=>Object.hasOwn(s.studentRooms,p.id)));assert.equal(Object.keys(a.assignments).length+Object.keys(b.assignments).length,0);
});
test('capacity mode fills selected rooms in order; balanced mode balances head counts',()=>{
  const s=fixture(6),a=customRoom(s,'A',[4,4]),b=customRoom(s,'B',[4,4]);s.participatingRooms=[a.id,b.id];distributeRooms(s,'capacity');assert.deepEqual([roomStats(s,a).assigned,roomStats(s,b).assigned],[6,0]);distributeRooms(s,'balanced');assert.deepEqual([roomStats(s,a).assigned,roomStats(s,b).assigned],[3,3]);
});
test('class and year spreading distribute groups and keeping classes together avoids unnecessary splits',()=>{
  const s=fixture(8);s.students.forEach((p,i)=>{p.class=i<4?'3A':'4B';p.year=i<4?'3':'4';});const a=customRoom(s,'A',[4]),b=customRoom(s,'B',[4]);s.participatingRooms=[a.id,b.id];for(const mode of ['classesSpread','yearsSpread']){distributeRooms(s,mode);for(const room of [a,b])assert.equal(s.students.filter(p=>p.class==='3A'&&s.studentRooms[p.id]===room.id).length,2);}distributeRooms(s,'classesTogether');assert.equal(new Set(s.students.filter(p=>p.class==='3A').map(p=>s.studentRooms[p.id])).size,1);assert.equal(new Set(s.students.filter(p=>p.class==='4B').map(p=>s.studentRooms[p.id])).size,1);
});
test('manual overfilling keeps capacities unchanged and produces a visible capacity count',()=>{
  const s=fixture(3),a=customRoom(s,'Small',[1]);for(const p of s.students)assignRoom(s,p.id,a.id);assert.equal(roomStats(s,a).capacity,1);assert.equal(roomStats(s,a).assigned,3);assert.equal(roomStats(s,a).overflow,2);switchRoom(s,a.id);const result=generate(s,{iterations:50});assert.equal(Object.keys(result.assignments).length,1);assert.equal(result.unplaced.length,2);
});
test('moving between rooms removes the old seat and pin, never silently seats the student at destination',()=>{
  const s=fixture(2),a=customRoom(s,'A'),b=customRoom(s,'B');use(s,a);s.assignments={'bank-0:0':'demo-0','bank-1:0':'demo-1'};s.locks=['demo-0'];captureRoom(s);assignRoom(s,'demo-0',b.id);assert.deepEqual(s.assignments,{'bank-1:0':'demo-1'});assert.deepEqual(s.locks,[]);assert.deepEqual(b.assignments,{});switchRoom(s,b.id);assert.deepEqual(roomStudents(s).map(p=>p.id),['demo-0']);
});
test('each room generates only its roster, observes its capacities, and does not overwrite other room plans',()=>{
  const s=fixture(6),a=customRoom(s,'A',[1,3]),b=customRoom(s,'B',[2]);s.participatingRooms=[a.id,b.id];distributeRooms(s,'capacity');switchRoom(s,a.id);const result=generateAllRooms(s,{iterations:80});assert.equal(result.length,2);assert.equal(Object.keys(a.assignments).length,4);assert.equal(Object.keys(b.assignments).length,2);assert.equal(new Set([...Object.values(a.assignments),...Object.values(b.assignments)]).size,6);const original=structuredClone(a.assignments);switchRoom(s,b.id);s.assignments=generate(s,{iterations:20}).assignments;captureRoom(s);assert.deepEqual(a.assignments,original);
});
test('class, year and personal rules apply within each room; relationships across rooms are inactive',()=>{
  const s=fixture(4),a=customRoom(s,'A',[4]),b=customRoom(s,'B',[4]);s.students.forEach(p=>{p.class='4B';p.year='4';});s.settings.classRulesEnabled=true;s.settings.classRules.default={type:'separate',priority:'Verplicht'};s.settings.yearRules=[{years:['4','4'],type:'separate',priority:'Voorkeur'}];s.rules=[{id:'personal',type:'separate',students:['demo-0','demo-2'],priority:'Verplicht'}];assignRoom(s,'demo-0',a.id);assignRoom(s,'demo-1',a.id);assignRoom(s,'demo-2',b.id);assignRoom(s,'demo-3',b.id);switchRoom(s,a.id);s.assignments={'bank-0:0':'demo-0','bank-0:1':'demo-1'};const result=evaluate(s);assert.deepEqual(result.warnings.map(w=>w.type),['class','year']);assert.equal(result.classChecks,1);assert.equal(result.yearChecks,1);assert.equal(result.inactive,1);
});
test('room-specific fixed positions and pins survive generation and room switching',()=>{
  const s=fixture(3),a=customRoom(s,'A',[4]),b=customRoom(s,'B',[4]);use(s,a);s.assignments={'bank-0:2':'demo-0'};s.locks=['demo-0'];s.rules=[{id:'f',type:'fixed',students:['demo-1'],seat:'bank-0:3',roomId:a.id,priority:'Verplicht'}];s.assignments=generate(s,{iterations:100}).assignments;assert.equal(s.assignments['bank-0:2'],'demo-0');assert.equal(s.assignments['bank-0:3'],'demo-1');switchRoom(s,b.id);assert.deepEqual(s.locks,[]);assert.equal(evaluate(s).warnings.length,0);switchRoom(s,a.id);assert.equal(s.assignments['bank-0:2'],'demo-0');assert.deepEqual(s.locks,['demo-0']);s.participatingRooms=[a.id,b.id];distributeRooms(s,'balanced',{keepFixed:true});assert.equal(s.studentRooms['demo-0'],a.id);assert.equal(s.studentRooms['demo-1'],a.id);
});
test('disabled personal rules release fixed room destinations while preserving pins and saved rules',()=>{
  const s=fixture(3),a=customRoom(s,'A',[4]),b=customRoom(s,'B',[4]);use(s,a);s.assignments={'bank-0:2':'demo-0'};s.locks=['demo-0'];s.rules=[{id:'f',type:'fixed',students:['demo-1'],seat:'bank-0:3',roomId:a.id,priority:'Verplicht'}];s.participatingRooms=[a.id,b.id];s.settings.studentRulesEnabled=false;
  const rules=structuredClone(s.rules);distributeRooms(s,'balanced',{keepFixed:true});assert.equal(s.studentRooms['demo-0'],a.id);assert.equal(s.studentRooms['demo-1'],b.id);assert.deepEqual(s.rules,rules);
  switchRoom(s,b.id);assert.equal(s.settings.studentRulesEnabled,false);assert.equal(evaluate(s).evaluated,0);switchRoom(s,a.id);assert.equal(s.settings.studentRulesEnabled,false);assert.deepEqual(s.locks,['demo-0']);
});
test('rotated custom banks use actual aligned geometry: horizontal and vertical neighbors, never diagonals',()=>{
  const s=fixture(0),a=customRoom(s,'Adjacency',[2,2,2,2]);a.layout.benches[0].gx=0;a.layout.benches[0].gy=0;a.layout.benches[1].gx=6;a.layout.benches[1].gy=0;a.layout.benches[2].gx=0;a.layout.benches[2].gy=4;a.layout.benches[3].gx=6;a.layout.benches[3].gy=4;switchRoom(s,a.id);
  assert.equal(adjacentSeats('bank-0:1','bank-1:0',true,s.settings),true);assert.equal(adjacentSeats('bank-0:0','bank-2:0',true,s.settings),true);assert.equal(adjacentSeats('bank-0:0','bank-3:0',true,s.settings),false);assert.equal(adjacentSeats('bank-0:0','bank-1:0',false,s.settings),false);
  s.settings.layout=structuredClone(s.settings.layout);s.settings.layout.benches.forEach(b=>b.facing='right');s.settings.layout.benches[1].gx=4;s.settings.layout.benches[2].gy=6;assert.equal(adjacentSeats('bank-0:0','bank-1:0',true,s.settings),true);assert.equal(adjacentSeats('bank-0:1','bank-1:0',true,s.settings),false);assert.equal(adjacentSeats('bank-0:0','bank-3:0',true,s.settings),false);
});
test('non-neighbor seats on a four-chair bench do not violate direct adjacency',()=>{
  const s=fixture(2),a=customRoom(s,'A',[4]);use(s,a);s.settings.classRulesEnabled=true;s.settings.classRules.default={type:'adjacent',priority:'Verplicht'};s.students.forEach(p=>p.class='4B');s.settings.yearRules=[];s.assignments={'bank-0:0':'demo-0','bank-0:2':'demo-1'};assert.equal(evaluate(s).warnings.length,0);s.assignments={'bank-0:0':'demo-0','bank-0:1':'demo-1'};assert.equal(evaluate(s).warnings.length,1);
});
test('custom Ordered generation remains compact, respects directions and fixed positions, and is repeatable',()=>{
  const s=fixture(4),a=customRoom(s,'A',[2,3,1]);use(s,a);s.settings.placementMode='ordered';s.settings.yearRules=[];s.rules=[{id:'fixed',type:'fixed',students:['demo-0'],seat:'bank-1:2',roomId:a.id,priority:'Verplicht'}];const first=generate(s,{iterations:100}),second=generate(s,{iterations:100});assert.deepEqual(first.assignments,second.assignments);assert.equal(first.assignments['bank-1:2'],'demo-0');assert.equal(Object.keys(first.assignments).length,4);assert.ok(Object.keys(first.assignments).every(seat=>validSeat(seat,s.settings)));
});
test('hidden warnings are local to a room, survive switching and clear when resolved',()=>{
  const s=fixture(2),a=customRoom(s,'A',[2]),b=customRoom(s,'B',[2]);use(s,a);s.students.forEach(p=>p.year='4');s.settings.yearRules=[{years:['4','4'],type:'separate',priority:'Voorkeur'}];s.assignments={'bank-0:0':'demo-0','bank-0:1':'demo-1'};s.hiddenWarnings=[warningKey(s,evaluate(s).warnings[0])];switchRoom(s,b.id);assert.deepEqual(s.hiddenWarnings,[]);switchRoom(s,a.id);assert.equal(warningGroups(s,evaluate(s).warnings).hidden.length,1);assignRoom(s,'demo-1',b.id);assert.equal(evaluate(s).warnings.length,0);assert.deepEqual(reconcileHiddenWarnings(s,evaluate(s).warnings),[]);
});
test('layout capacity reductions remove invalid chairs and pins without deleting fixed-position rules',()=>{
  const s=fixture(2),a=customRoom(s,'A',[3]);use(s,a);s.assignments={'bank-0:2':'demo-0'};s.locks=['demo-0'];s.rules=[{id:'f',type:'fixed',students:['demo-0'],seat:'bank-0:2',roomId:a.id,priority:'Verplicht'}];s.settings.layout=structuredClone(s.settings.layout);s.settings.layout.benches[0].capacity=1;normalizeRooms(s);assert.deepEqual(s.assignments,{});assert.deepEqual(s.locks,[]);assert.equal(s.rules.length,1);assert.equal(evaluate(s).warnings[0].type,'fixed');assert.ok(roomSystemValid(s));
});
test('deleting a room returns its students to unassigned, keeps other rooms intact, and is serializable',()=>{
  const s=fixture(2),a=customRoom(s,'A'),b=customRoom(s,'B');use(s,a);s.assignments={'bank-0:0':'demo-0'};deleteRoom(s,a.id);assert.equal(s.studentRooms['demo-0'],null);assert.equal(s.rooms.some(r=>r.id===a.id),false);assert.ok(s.rooms.some(r=>r.id===b.id));assert.equal(s.students.length,2);assert.ok(roomSystemValid(JSON.parse(JSON.stringify(s))));
});
test('new and absent students are normalized without mixing room rosters',()=>{
  const s=fixture(2),a=customRoom(s,'A'),b=customRoom(s,'B');use(s,a);s.assignments={'bank-0:0':'demo-0'};s.students[0].absent=true;s.students.push({...sampleStudents()[2]});normalizeRooms(s);assert.deepEqual(s.assignments,{});assert.equal(s.studentRooms['demo-2'],a.id);s.participatingRooms=[a.id,b.id];s.students.push(sampleStudents()[3]);normalizeRooms(s);assert.equal(s.studentRooms['demo-3'],null);
});
test('all-room Excel uses exactly five columns and local identifiers; current room keeps four columns',()=>{
  const s=fixture(3),a=customRoom(s,'3.12',[2]),b=customRoom(s,'4.05',[2]);assignRoom(s,'demo-0',a.id);assignRoom(s,'demo-1',b.id);assignRoom(s,'demo-2',null);switchRoom(s,a.id);s.assignments={'bank-0:0':'demo-0'};captureRoom(s);b.assignments={'bank-0:0':'demo-1'};const rows=seatingRows(s,{allRooms:true});assert.deepEqual(rows.map(r=>r.slice(3)),[['4.05','A1'],['Nog geen lokaal','Nog niet geplaatst'],['3.12','A1']]);assert.equal(seatingRows(s).length,1);assert.equal(seatingRows(s)[0].length,4);const files=xmlFiles(seatingWorkbook(s,{allRooms:true}));assert.match(files['xl/tables/table1.xml'],/tableColumns count="5"/);assert.match(files['xl/tables/table1.xml'],/name="Lokaal"/);assert.match(files['xl/tables/table1.xml'],/ref="A1:E2"/);assert.match(files['xl/workbook.xml'],/\$A\$1:\$E\$2/);
});
