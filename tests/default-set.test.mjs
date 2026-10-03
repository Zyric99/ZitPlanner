import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { defaults, enabledSeats } from '../src/engine.mjs';
import { initializeRooms, captureRoom, newRoom, switchRoom, roomSystemValid } from '../src/rooms.mjs';
import { generateWeek, applyWeeklyDay } from '../src/weekly-planner.mjs';
import { createProjectSession } from '../src/project-session.mjs';
import { factoryDefaultSet, selectDefaultRooms, restoreDefaultSet, validDefaultSet } from '../src/default-set.mjs';
import { emptyGridRoom, generateGrid, setGap, setRowGap } from '../src/grid-room.mjs';
const {ProjectStore}=createRequire(import.meta.url)('../desktop/project-store.cjs');
const KEY='klaslokaal-v1';
const bridge=store=>Object.fromEntries(['startup','bootstrap','save','list','load','activate','create','setTemplate'].map(method=>[method,arg=>store[method](arg)]));
async function session(t,source){const directory=await fs.mkdtemp(path.join(os.tmpdir(),'klaslokaal-default-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));const backend=new ProjectStore(directory);const session=await createProjectSession(bridge(backend),{getItem:()=>null},KEY);await session.initialize(source,[],[]);return {backend,session};}
function fixture(){const state=initializeRooms(defaults());state.name='Mijn project';const second=newRoom(state,'Computerlokaal','computer');state.participatingRooms.push(second.id);return state;}

test('saving selected tabs retains geometry and settings without pupils or project changes',async t=>{
  const source=fixture(),second=source.rooms[1];switchRoom(source,second.id);
  second.layout.benches[0].facing='left';source.settings.layout=structuredClone(second.layout);
  source.settings.placementMode='ordered';captureRoom(source);
  source.students=[{id:'p',name:'Leerling',class:'1A',year:'1',absent:false}];source.studentRooms={p:second.id};
  const original=structuredClone(source),{session:storage,backend}=await session(t,source);
  const diskBefore=await fs.readFile(storage.file,'utf8');
  await storage.setDefaultLayout(selectDefaultRooms(source));
  assert.deepEqual(source,original);assert.equal(await fs.readFile(storage.file,'utf8'),diskBefore);
  const reboot=await createProjectSession(bridge(new ProjectStore(backend.directory)),{getItem:()=>null},KEY);
  assert.deepEqual(reboot.getDefaultLayout().rooms.map(r=>[r.layout,r.settings]),source.rooms.map(r=>[r.layout,r.settings]));
  const created=await reboot.create('Nieuw');assert.equal(created.state.students.length,0);assert.equal(created.state.rooms.length,2);assert.equal(created.state.activeRoomId,second.id);
  assert.deepEqual(created.state.rooms.map(r=>r.layout),source.rooms.map(r=>r.layout));
  const onlyFirst=selectDefaultRooms(source,[source.rooms[0].id]);assert.equal(onlyFirst.activeRoomId,source.rooms[0].id);assert.deepEqual(onlyFirst.settings.layout,onlyFirst.rooms[0].layout);
  assert.throws(()=>selectDefaultRooms(source,[]),/minstens/);
});
test('reset preserves stable seats and pins; removed chairs and rooms become traceable',()=>{
  const source=fixture(),main=source.rooms[0],target=selectDefaultRooms(source);
  const seat=enabledSeats(source.settings)[0],other=`${seat.split(':')[0]}:1`;
  target.rooms[0].layout.benches.find(b=>b.id===seat.split(':')[0]).capacity=1;
  target.settings.layout=structuredClone(target.rooms[0].layout);
  const removed=newRoom(source,'Tijdelijk lokaal','small'),removedSeat=enabledSeats({...source.settings,...removed.settings,layout:removed.layout})[0];
  source.students=['p','q','r'].map((id,i)=>({id,name:`Leerling ${i}`,class:i===2?'2C':'1A',year:i===2?'2':'1',absent:false}));
  source.studentRooms={p:main.id,q:main.id,r:removed.id};source.classRooms={'1A':main.id,'2C':removed.id};
  source.assignments={[seat]:'p',[other]:'q'};source.locks=['p','q'];
  removed.assignments={[removedSeat]:'r'};removed.locks=['r'];
  source.rules=[{id:'fixed',type:'fixed',students:['r'],roomId:removed.id,seat:removedSeat,priority:'Verplicht'}];
  captureRoom(source);const original=structuredClone(source);
  const {state,summary}=restoreDefaultSet(source,target);
  assert.deepEqual(source,original);assert.deepEqual(state.students,source.students);
  assert.deepEqual(state.assignments,{[seat]:'p'});assert.deepEqual(state.locks,['p']);
  assert.deepEqual(state.studentRooms,{p:main.id,q:main.id,r:null});assert.deepEqual(state.classRooms,{'1A':main.id});
  assert.equal(state.rules[0].roomId,removed.id);assert.ok(state.rules[0].positionCode);
  assert.equal(summary.removedSeats,2);assert.equal(summary.removedPins,2);assert.equal(summary.removedMemberships,1);assert.deepEqual(summary.removedClassBindings,['2C']);assert.equal(summary.unavailableFixed,1);
  assert.ok(roomSystemValid(state));assert.equal(state.name,source.name);
});
test('reset does not auto-assign pupils from removed rooms or generate new seats',()=>{
  const source=fixture(),target=selectDefaultRooms(source,[source.rooms[0].id]);
  source.students=[{id:'p',name:'Leerling',class:'1A',year:'1',absent:false}];source.studentRooms={p:source.rooms[1].id};
  switchRoom(source,source.rooms[1].id);
  const next=restoreDefaultSet(source,target).state;
  assert.equal(next.studentRooms.p,null);assert.deepEqual(next.assignments,{});assert.equal(next.activeRoomId,target.activeRoomId);
});
test('reset restores manual attendance when clearing an active weekly plan',()=>{
  const source=initializeRooms(defaults());source.students=[{id:'p',name:'Leerling',class:'1A',year:'1',absent:false,eveningStudy:{maandag:'Ja',dinsdag:'Nee',donderdag:'Ja',vrijdag:'Ja'}}];source.studentRooms={p:source.activeRoomId};
  const target=selectDefaultRooms(source);source.weeklyPlans=generateWeek(source,{iterations:0});applyWeeklyDay(source,'dinsdag');
  assert.equal(source.students[0].absent,true);
  const {state,summary}=restoreDefaultSet(source,target);
  assert.equal(state.students[0].absent,false);assert.equal(state.weeklyPlans,undefined);assert.equal(summary.clearedWeek,true);assert.equal(source.weeklyPlans.activeDay,'dinsdag');
});
test('a real backup-write failure leaves both disk and in-memory default intact',async t=>{
  const source=fixture(),{backend,session:storage}=await session(t,source),file=path.join(backend.directory,'default-layout.json');
  const before=await fs.readFile(file,'utf8'),memory=storage.getDefaultLayout();
  await fs.mkdir(`${file}.bak`);
  await assert.rejects(storage.setDefaultLayout(selectDefaultRooms(source,[source.rooms[0].id])));
  assert.equal(await fs.readFile(file,'utf8'),before);assert.deepEqual(storage.getDefaultLayout(),memory);
  assert.ok(!(await fs.readdir(backend.directory)).some(f=>f.endsWith('.tmp')));
});
test('factory reset does not replace custom defaults, while large compact grids round-trip',async t=>{
  const source=fixture();source.rooms[1].layout=generateGrid(emptyGridRoom(),{from:'A',to:'F',rows:100},{facing:'left'});setGap(source.rooms[1].layout,'B',2);setRowGap(source.rooms[1].layout,3,1);
  const {session:storage,backend}=await session(t,source);await storage.setDefaultLayout(selectDefaultRooms(source));
  const file=path.join(backend.directory,'default-layout.json'),before=await fs.readFile(file,'utf8');
  const reset=restoreDefaultSet(source,factoryDefaultSet()).state;
  assert.equal(reset.rooms.length,1);assert.equal(await fs.readFile(file,'utf8'),before);
  const reboot=await createProjectSession(bridge(new ProjectStore(backend.directory)),{getItem:()=>null},KEY);
  assert.deepEqual(reboot.getDefaultLayout().rooms[1].layout,source.rooms[1].layout);
});
test('invalid templates cannot replace defaults through the main-process API',async t=>{
  const source=fixture(),{backend}=await session(t,source),file=path.join(backend.directory,'default-layout.json'),before=await fs.readFile(file,'utf8');
  assert.equal(validDefaultSet({rooms:[]}),false);
  const invalid=selectDefaultRooms(source);invalid.students=[{id:'p',name:'Leerling',class:'1A',year:'1',absent:false}];
  await assert.rejects(backend.setTemplate(invalid),/standaardset/);
  assert.equal(await fs.readFile(file,'utf8'),before);
});
