import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { defaults } from '../src/engine.mjs';
import { initializeRooms, newRoom, switchRoom, pinStudentRoom } from '../src/rooms.mjs';
import { emptyProjectState, createProjectSession } from '../src/project-session.mjs';
const {ProjectStore}=createRequire(import.meta.url)('../desktop/project-store.cjs');
const KEY='klaslokaal-v1';
function fixture(){const state=initializeRooms(defaults());state.name='Mijn huidige klas';newRoom(state,'Tweede lokaal','small');switchRoom(state,state.rooms[1].id);return state;}
async function store(t){const directory=await fs.mkdtemp(path.join(os.tmpdir(),'klaslokaal-project-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));return new ProjectStore(directory);}
const memory=entries=>({getItem:key=>entries[key]??null});
const api=store=>Object.fromEntries(['startup','bootstrap','save','list','load','activate','create','setTemplate'].map(method=>[method,arg=>store[method](arg)]));

test('legacy migration preserves every room and active tab, named plans, lists and raw backup',async t=>{
  const backend=await store(t),state=fixture(),lists=[{id:'list',name:'Klaslijst',students:[]}],plans=[{id:'old',created:'2026-01-01',state:structuredClone(state)}];
  const legacy={[KEY]:JSON.stringify(state),[`${KEY}-plans`]:JSON.stringify(plans),[`${KEY}-lists`]:JSON.stringify(lists)};
  const session=await createProjectSession(api(backend),memory(legacy),KEY);
  await session.initialize(state,plans,lists);
  const reboot=await new ProjectStore(backend.directory).startup();
  assert.deepEqual(reboot.document.state,state);assert.deepEqual(reboot.document.lists,lists);
  assert.equal((await backend.list()).length,2);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(backend.directory,'legacy-backup.json'),'utf8')),legacy);
  assert.deepEqual(reboot.template.rooms.map(r=>r.layout),state.rooms.map(r=>r.layout));
});
test('autosave queue writes the final edit and restart loads disk rather than stale browser data',async t=>{
  const backend=await store(t),state=fixture(),session=await createProjectSession(api(backend),memory({}),KEY);
  await session.initialize(state,[],[]);
  for(let i=0;i<15;i++)session.save(KEY,{...state,name:`Edit ${i}`});
  await session.flush();
  const reboot=await createProjectSession(api(new ProjectStore(backend.directory)),memory({[KEY]:JSON.stringify({...state,name:'Old cache'})}),KEY);
  assert.equal(reboot.read(KEY,null).name,'Edit 14');
  const files=await fs.readdir(backend.directory);assert.ok(files.some(f=>f.endsWith('.json.bak')));assert.ok(!files.some(f=>f.endsWith('.tmp')));
});

test('a room-only student pin survives disk autosave and restart and clears from room-only defaults',async t=>{
  const backend=await store(t),state=fixture();state.students=[{id:'p',name:'Pupil',class:'3A',year:'3',absent:false}];state.studentRooms={p:state.activeRoomId};
  const session=await createProjectSession(api(backend),memory({}),KEY);await session.initialize(state,[],[]);
  pinStudentRoom(state,'p',state.activeRoomId);session.save(KEY,state);await session.flush();
  const reboot=await new ProjectStore(backend.directory).startup();
  assert.deepEqual(reboot.document.state.studentRoomPins,{});assert.deepEqual(reboot.document.state.rules,state.rules);assert.equal(reboot.document.state.rules[0].roomId,state.activeRoomId);assert.equal(reboot.document.state.rules[0].seat,undefined);
  assert.equal(reboot.document.state.studentRooms.p,state.activeRoomId);
  assert.deepEqual(reboot.template.studentRoomPins,{});
});
test('save and new project retains default layouts, clears pupils, and switching preserves both projects',async t=>{
  const backend=await store(t),state=fixture();state.students=[{id:'p',name:'Pupil',class:'1A',year:'1',absent:false}];state.studentRooms={p:state.activeRoomId};
  const session=await createProjectSession(api(backend),memory({}),KEY);await session.initialize(state,[],[]);session.save(KEY,state);
  const first=session.id,created=await session.create('Nieuw');
  assert.equal(created.state.students.length,0);assert.deepEqual(created.state.rooms.map(r=>r.layout),state.rooms.map(r=>r.layout));
  assert.equal(created.state.activeRoomId,state.activeRoomId);
  assert.equal((await backend.startup()).document.id,created.id);
  const opened=await session.open(first,()=>true);assert.deepEqual(opened.state.students,state.students);
  assert.equal((await backend.startup()).document.id,first);
});
test('an unreadable file recovers its backup; unrecoverable corruption does not get overwritten',async t=>{
  const backend=await store(t),state=fixture(),boot=await backend.bootstrap({state,plans:[],lists:[],template:emptyProjectState(state)});
  await backend.save({...boot.document,state:{...state,name:'New name'}});
  await fs.writeFile(boot.file,'{broken');
  assert.equal((await backend.startup()).document.state.name,state.name);
  await fs.writeFile(`${boot.file}.bak`,'broken backup');
  await assert.rejects(backend.startup(),/beschadigd/);
  assert.equal(await fs.readFile(boot.file,'utf8'),'{broken');
});
test('invalid IDs cannot access paths outside the project folder',async t=>{
  const backend=await store(t);for(const id of ['../README','..\\README','C:\\secret','/tmp/secret'])await assert.rejects(backend.load(id),/project-ID/);
});
test('save failures remain visible and block switching until a successful retry',async t=>{
  const backend=await store(t),state=fixture(),status=[],bridge=api(backend),session=await createProjectSession(bridge,memory({}),KEY,s=>status.push(s));
  await session.initialize(state,[],[]);const original=bridge.save;bridge.save=()=>Promise.reject(Error('Disk full'));
  session.save(KEY,state);await assert.rejects(session.flush(),/Disk full/);
  await assert.rejects(session.create('New'),/Disk full/);assert.ok(status.at(-1).error);
  bridge.save=original;session.save(KEY,{...state,name:'Retry'});await session.flush();assert.equal(status.at(-1).error,undefined);
});
test('empty templates contain no pupils, fixed positions, pins or weekly arrangements',()=>{
  const state=fixture();state.rules=[{id:'fixed',type:'fixed',students:['p']}];state.rooms[0].locks=['p'];state.classRooms={'1A':state.rooms[0].id};
  const empty=emptyProjectState(state);
  assert.deepEqual(empty.rules,[]);assert.deepEqual(empty.classRooms,{});assert.ok(empty.rooms.every(r=>!r.locks.length&&!Object.keys(r.assignments).length));
  assert.ok(state.rules.length); // The original remains untouched.
});
