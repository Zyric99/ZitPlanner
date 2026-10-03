import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyGridRoom, generateGrid, setSection, removeSection, tableAt, setTable, visualBands, resizeCanvas, packGridRoom, unpackGridRoom } from '../src/grid-room.mjs';
import { makeBench, benchSeatCodes, sectionSeatNames, layoutValid } from '../src/layout.mjs';
import { defaults, seatCode, enabledSeats } from '../src/engine.mjs';
import { initializeRooms, newRoom, switchRoom, normalizeRooms } from '../src/rooms.mjs';
import { seatingRows } from '../src/excel-export.mjs';
const fixture=()=>{
  const l=generateGrid(emptyGridRoom(),{from:'A',to:'B',rows:2});
  const section=setSection(l,{after:'A',name:'Extra',width:12});
  for(let i=0;i<2;i++){l.benches.push(makeBench(l,'student',{sectionId:section.id,gx:i*6,gy:1,sortX:6+i*6,sortY:6}));l.nextManual++;}
  return {l,section,benches:l.benches.filter(b=>b.sectionId)};
};
const codes=(l,b)=>benchSeatCodes({...b,...sectionSeatNames(l).get(b.id)},l.version);
test('named areas show EXT1/EXT2 then EXT3/EXT4 in both editor and engine, regardless of legacy dots',()=>{
  const {l,benches}=fixture();benches[0].codeStyle='legacy';
  assert.deepEqual(codes(l,benches[0]),['EXT1','EXT2']);assert.deepEqual(codes(l,benches[1]),['EXT3','EXT4']);
  const settings={...defaults().settings,layout:l};
  assert.deepEqual(benches.flatMap(b=>[0,1].map(i=>seatCode(`${b.id}:${i}`,settings))),['EXT1','EXT2','EXT3','EXT4']);
  assert.equal(new Set(enabledSeats(settings).map(s=>seatCode(s,settings))).size,12);
});
test('one-chair benches reserve complete pairs and restoring capacity keeps their first code',()=>{
  const {l,benches}=fixture();benches[0].capacity=1;
  assert.deepEqual(codes(l,benches[0]),['EXT1']);assert.deepEqual(codes(l,benches[1]),['EXT3','EXT4']);
  benches[0].capacity=2;assert.deepEqual(codes(l,benches[0]),['EXT1','EXT2']);
});
test('prefixes use the first three letters, normalize accents, skip punctuation and support short names',()=>{
  for(const [name,prefix] of [['Computers','COM'],[' Éxtra ruimte ','EXT'],['3 - Project','PRO'],['ICT','ICT'],['X','X'],['123','VAK']]){
    const {l,section,benches}=fixture();setSection(l,{...section,name});assert.deepEqual(codes(l,benches[0]),[`${prefix}1`,`${prefix}2`]);
  }
});
test('shared prefixes and short names cannot duplicate another area or ordinary grid chair codes',()=>{
  const {l,section,benches}=fixture();setSection(l,{...section,name:'A'});
  assert.deepEqual(codes(l,benches[0]),['A5','A6']);assert.deepEqual(codes(l,benches[1]),['A7','A8']);
  setSection(l,{...section,name:'Computers'});
  const other=setSection(l,{after:'A',name:'Computerwerk',width:6}),b=makeBench(l,'student',{sectionId:other.id,gx:0,gy:1});l.benches.push(b);
  assert.deepEqual(codes(l,b),['COM5','COM6']);
});
test('placement previews use the same next pair as the saved bench and do not mutate existing names',()=>{
  const {l,benches}=fixture(),before=structuredClone(l),x=visualBands(l)[0].x;
  const preview=tableAt(l,makeBench(l),x,13),names=sectionSeatNames(l,preview);
  assert.deepEqual(benchSeatCodes({...preview,...names.get(preview.id)},2),['EXT5','EXT6']);
  assert.deepEqual(l,before);setTable(l,preview);assert.deepEqual(codes(l,preview),['EXT5','EXT6']);
  assert.deepEqual(codes(l,benches[0]),['EXT1','EXT2']);
});
test('renaming updates visible codes and exports while saving preserves students, pins and fixed bench references',()=>{
  const {l,section,benches}=fixture(),s=initializeRooms(defaults()),room=newRoom(s,'Naamtest');room.layout=l;
  const id=benches[0].id;s.students=[{id:'p',name:'Pupil Test',class:'1A',year:'1',absent:false}];s.studentRooms.p=room.id;
  room.assignments={[`${id}:0`]:'p'};room.locks=['p'];s.rules=[{id:'fixed',type:'fixed',roomId:room.id,students:['p'],seat:`${id}:0`,priority:'Verplicht'}];
  switchRoom(s,room.id);assert.equal(seatCode(`${id}:0`,s.settings),'EXT1');
  s.settings.layout=structuredClone(s.settings.layout);setSection(s.settings.layout,{...section,name:'Computers'});normalizeRooms(s);
  assert.equal(seatCode(`${id}:0`,s.settings),'COM1');assert.deepEqual(s.locks,['p']);assert.equal(s.assignments[`${id}:0`],'p');assert.equal(s.rules[0].seat,`${id}:0`);
  assert.ok(seatingRows(s).some(row=>row.includes('COM1')));
  const saved=JSON.parse(JSON.stringify(s));normalizeRooms(saved);assert.equal(seatCode(`${id}:0`,saved.settings),'COM1');
});
test('removing an area preserves its last codes, until a bench moves into an ordinary grid cell',()=>{
  const {l,section,benches}=fixture(),b=benches[0],before=codes(l,b);removeSection(l,section.id);
  assert.deepEqual(benchSeatCodes(b,2),before);assert.ok(layoutValid(l));
  const target=l.benches.find(b=>b.cell?.column==='A'&&b.cell.row===1);
  l.benches=l.benches.filter(b=>b.id!==target.id);setTable(l,tableAt(l,b,0,1));
  assert.deepEqual(benchSeatCodes(l.benches.find(v=>v.id===b.id),2),['A1','A2']);
});
test('named and detached codes survive compact saves without changing stored bench identities',()=>{
  const l=generateGrid(emptyGridRoom(),{from:'A',to:'Z',rows:20}),section=setSection(l,{after:'D',name:'Extra',width:12}),b=makeBench(l,'student',{sectionId:section.id,gx:0,gy:1});
  l.benches.push(b);resizeCanvas(l);let reopened=unpackGridRoom(JSON.parse(JSON.stringify(packGridRoom(l))));assert.deepEqual(reopened,l);
  assert.deepEqual(codes(reopened,reopened.benches.find(v=>v.id===b.id)),['EXT1','EXT2']);
  removeSection(l,section.id);reopened=unpackGridRoom(JSON.parse(JSON.stringify(packGridRoom(l))));assert.deepEqual(reopened,l);
  assert.deepEqual(benchSeatCodes(reopened.benches.find(v=>v.id===b.id),2),['EXT1','EXT2']);
});
test('normal grid and legacy labels retain their existing formats outside named areas',()=>{
  assert.deepEqual(benchSeatCodes({cell:{column:'V',row:4},capacity:2},2),['V7','V8']);
  assert.deepEqual(benchSeatCodes({code:'M3',capacity:2},2),['M3.1','M3.2']);
  assert.deepEqual(benchSeatCodes({code:'M3',capacity:2,codeStyle:'legacy'},2),['M31','M32']);
});
