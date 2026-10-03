import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { starterFixture } from './starter-fixture.mjs';
import { normalizeStarterProject, packStarterProject, selectStarterRooms, unseatedStarterProject } from '../src/starter-project.mjs';
import { validState } from '../src/project-validation.mjs';
import { defaults } from '../src/engine.mjs';
import { emptyGridRoom, generateGrid } from '../src/grid-room.mjs';
import { captureRoom } from '../src/rooms.mjs';
import { factoryDefaultSet } from '../src/default-set.mjs';
import { createProjectSession } from '../src/project-session.mjs';
const {ProjectStore}=createRequire(import.meta.url)('../desktop/project-store.cjs');
const KEY='klaslokaal-v1';
const api=store=>Object.fromEntries(['startup','bootstrap','save','list','load','activate','create','setTemplate','starterInfo','createFromStarter'].map(method=>[method,arg=>store[method](arg)]));
async function setup(t) {
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'klaslokaal-starter-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const backend=new ProjectStore(directory),current=factoryDefaultSet();current.name='Huidig project';
  const legacy={[KEY]:JSON.stringify(defaults())};
  const boot=await backend.bootstrap({state:current,plans:[],lists:[],template:factoryDefaultSet(),legacy});
  const session=await createProjectSession(api(backend),{getItem:k=>legacy[k]??null},KEY);
  return {backend,session,boot,legacy};
}
test('shared validation accepts project/export formats, packed rooms and legacy migrations',()=>{
  const source=starterFixture(),before=structuredClone(source);
  for(const version of [1,2]){
    const result=normalizeStarterProject(packStarterProject({...source,version}));
    assert.ok(validState(result.state));assert.equal(result.state.rooms.length,2);assert.equal(result.state.students.length,3);
    for(const key of ['students','rules','assignments','locks','studentRooms','classRooms','weeklyPlans'])assert.deepEqual(result.state[key],source.state[key],key);
    assert.deepEqual(result.plans,source.plans);assert.deepEqual(result.lists,source.lists);
  }
  const migrated=normalizeStarterProject({version:1,state:defaults()});assert.equal(migrated.state.rooms.length,1);
  assert.deepEqual(source,before);
});
test('invalid projects and associated lists/plans are rejected; launch flags never enter starter data',()=>{
  for(const input of [null,{}, {version:3,state:defaults()}, {version:1,state:{name:'broken'}}, {...starterFixture(),lists:{}}, {...starterFixture(),lists:[{id:'l',name:'Broken',students:[{}]}]}, {...starterFixture(),plans:[{id:'p',state:{}}]}])assert.throws(()=>normalizeStarterProject(input));
  const source=starterFixture();source.developerMode=true;source.state.developerMode=true;source.state.students[0].developerMode=true;source.state.rules[0].DEVELOPER_MODE=true;source.lists[0].students[0].KLASLOKAAL_DEV_MODE='True';
  const result=normalizeStarterProject(source);assert.ok(!JSON.stringify(result).includes('developerMode'));assert.ok(!JSON.stringify(result).includes('DEVELOPER_MODE'));assert.ok(!JSON.stringify(result).includes('KLASLOKAAL_DEV_MODE'));
});
test('large compact room exports retain exact layouts and student seat references',()=>{
  const source=starterFixture();
  source.state.settings.layout=generateGrid(emptyGridRoom(),{from:'A',to:'Z',rows:20});captureRoom(source.state);
  // The existing week belongs to the previous layout, as in normal migration.
  delete source.state.weeklyPlans;
  const packed=packStarterProject(source);assert.equal(packed.state.rooms[0].layout.packedGrid,true);
  const result=normalizeStarterProject(packed);
  assert.ok(validState(result.state));assert.deepEqual(result.state.rooms[0].layout,source.state.rooms[0].layout);assert.deepEqual(result.state.assignments,source.state.assignments);assert.deepEqual(result.state.rules,source.state.rules);
});
test('install persists an independent snapshot without touching current/default/legacy/pointer',async t=>{
  const {backend,session,boot,legacy}=await setup(t),files=[boot.file,...['workspace.json','default-layout.json','legacy-backup.json'].map(f=>path.join(backend.directory,f))];
  const before=await Promise.all(files.map(f=>fs.readFile(f,'utf8'))),source=starterFixture(),snapshot=structuredClone(source);
  const info=await session.confirmStarter({confirm:()=>backend.installStarter(source,'my-export.json')},'opaque-token');
  assert.deepEqual(source,snapshot);assert.equal(session.id,boot.document.id);assert.equal(info.mode,'project');assert.equal(info.students,3);assert.equal(info.rooms,2);
  assert.equal(path.dirname(info.file),path.join(backend.directory,'starters'));
  assert.deepEqual(await Promise.all(files.map(f=>fs.readFile(f,'utf8'))),before);
  source.state.students[0].name='Changed outside';
  const reboot=await new ProjectStore(backend.directory).startup();assert.equal(reboot.document.id,boot.document.id);assert.deepEqual(reboot.starter,info);
  assert.equal((await backend.list()).length,1);assert.deepEqual(JSON.parse(await fs.readFile(files[3],'utf8')),legacy);
  assert.equal((await backend.diagnostics()).starter.name,snapshot.state.name);
});
test('new projects retain full associated data with fresh IDs and independent autosaves across restart',async t=>{
  const {backend,session,boot}=await setup(t),source=starterFixture();await backend.installStarter(source,'starter.json');
  const first=await session.create('Eerste', {valid:validState});assert.notEqual(first.id,source.id);assert.notEqual(first.id,boot.document.id);assert.equal(first.state.planId,null);
  for(const key of ['rooms','students','rules','assignments','locks','studentRooms','classRooms','weeklyPlans'])assert.deepEqual(first.state[key],source.state[key],key);
  assert.deepEqual(first.lists,source.lists);assert.deepEqual(first.plans,source.plans);
  first.state.students[0].name='Only first';session.save(KEY,first.state);await session.flush();
  const restart=await createProjectSession(api(new ProjectStore(backend.directory)),{getItem:()=>null},KEY);
  assert.equal(restart.id,first.id);assert.equal(restart.read(KEY,null).students[0].name,'Only first');
  const second=await restart.create('Tweede',{valid:validState});assert.notEqual(second.id,first.id);assert.equal(second.state.students[0].name,source.state.students[0].name);
  second.lists[0].students[0].name='Only second';assert.notEqual(second.lists[0].students[0].name,first.lists[0].students[0].name);
  assert.equal((await backend.load(first.id)).state.students[0].name,'Only first');assert.equal((await backend.startup()).document.id,second.id);
});
test('room-only defaults remain unchanged and full starter can be reactivated',async t=>{
  const {backend,session}=await setup(t),defaultFile=path.join(backend.directory,'default-layout.json'),before=await fs.readFile(defaultFile,'utf8');
  const info=await backend.installStarter(starterFixture(),'starter.json');
  const controls={setMode:mode=>backend.setStarterMode(mode)};
  await session.setStarterMode(controls,'rooms');assert.equal(session.starter.mode,'rooms');assert.equal(session.starter.available,true);
  const empty=await session.create('Leeg',{valid:validState});assert.equal(empty.state.students.length,0);assert.equal(empty.state.rooms.length,1);assert.deepEqual(empty.state.rules,[]);assert.equal(empty.state.weeklyPlans,undefined);
  await session.setStarterMode(controls,'project');assert.equal(session.starter.file,info.file);assert.equal((await session.create('Volledig')).state.students.length,3);
  assert.equal(await fs.readFile(defaultFile,'utf8'),before);
});
test('failed installation preserves previous selection, current project and in-memory metadata',async t=>{
  const {backend,session,boot}=await setup(t),controls={confirm:()=>backend.installStarter(starterFixture(),'starter.json')};
  await session.confirmStarter(controls,'one');const previous=session.starter,config=path.join(backend.directory,'starter-settings.json'),before=await fs.readFile(config,'utf8');
  await fs.mkdir(`${config}.bak`);await assert.rejects(session.confirmStarter(controls,'two'));
  assert.deepEqual(session.starter,previous);assert.equal(await fs.readFile(config,'utf8'),before);assert.equal((await backend.startup()).document.id,boot.document.id);
  assert.deepEqual(await fs.readdir(path.join(backend.directory,'starters')),[path.basename(previous.file)]);
});
test('corrupt active starter does not prevent reopening current project or silently clear students',async t=>{
  const {backend,session,boot}=await setup(t);const info=await backend.installStarter(starterFixture(),'starter.json');await fs.writeFile(info.file,'broken');
  const restarted=await backend.startup();assert.equal(restarted.document.id,boot.document.id);assert.ok(restarted.starter.error);
  await assert.rejects(session.create('Must fail'),/beschadigd/);assert.equal((await backend.startup()).document.id,boot.document.id);
  await session.setStarterMode({setMode:mode=>backend.setStarterMode(mode)},'rooms');assert.equal((await session.create('Room fallback')).state.students.length,0);
});
test('invalid managed IDs cannot read arbitrary paths',async t=>{
  const {backend}=await setup(t);
  await fs.writeFile(path.join(backend.directory,'starter-settings.json'),JSON.stringify({version:1,mode:'project',starterId:'../../source'}));
  assert.match((await backend.starterInfo()).error,/startproject-ID/);await assert.rejects(backend.createFromStarter({name:'No'}),/startproject-ID/);
});
test('selecting all loaded rooms preserves every pupil and associated record without changing the source',()=>{
  const source=starterFixture(),before=structuredClone(source),selected=selectStarterRooms(source,source.state.rooms.map(room=>room.id));
  assert.deepEqual(selected.document,normalizeStarterProject(source));assert.deepEqual(selected.preview.roomNames,source.state.rooms.map(room=>room.name));assert.equal(selected.preview.clearedWeek,false);assert.deepEqual(source,before);
});
test('selecting a subset retains pupils/rules/lists/plans and frees excluded rooms with explicit week impact',()=>{
  const source=starterFixture(),before=structuredClone(source),id=source.state.rooms[1].id,{document,preview}=selectStarterRooms(source,[id]);
  assert.ok(validState(document.state));assert.equal(document.state.rooms.length,1);assert.equal(document.state.activeRoomId,id);assert.equal(document.state.students.length,3);assert.equal(document.state.studentRooms.p,null);assert.equal(document.state.studentRooms.q,null);assert.equal(document.state.studentRooms.r,id);
  assert.deepEqual(document.state.classRooms,{'2B':id});assert.equal(document.state.rules[0].roomId,source.state.rooms[0].id);assert.ok(document.state.rules[0].positionCode);
  assert.equal(document.state.weeklyPlans,undefined);assert.equal(preview.clearedWeek,true);assert.equal(preview.unassigned,2);assert.deepEqual(document.lists,source.lists);assert.deepEqual(document.plans,source.plans);assert.deepEqual(document.state.rooms[0].assignments,source.state.rooms[1].assignments);assert.deepEqual(document.state.rooms[0].locks,source.state.rooms[1].locks);assert.deepEqual(source,before);
  for(const ids of [[],[id,id],['unknown']])assert.throws(()=>selectStarterRooms(source,ids),/bestaand lokaal/);
});
test('main-process loaded-project preview never switches, writes or accepts path traversal',async t=>{
  const {backend,boot}=await setup(t),source=starterFixture(),saved=await backend.create(source);await backend.activate(boot.document.id);
  const files=[saved.file,boot.file,...['workspace.json','default-layout.json','legacy-backup.json'].map(file=>path.join(backend.directory,file))],before=await Promise.all(files.map(file=>fs.readFile(file,'utf8')));
  const result=await backend.prepareStarterFromProject({projectId:saved.document.id,roomIds:[source.state.rooms[1].id]});assert.equal(result.preview.rooms,1);assert.equal(result.preview.students,3);
  assert.deepEqual(await Promise.all(files.map(file=>fs.readFile(file,'utf8'))),before);assert.equal((await backend.startup()).starter.available,false);
  await assert.rejects(backend.prepareStarterFromProject({projectId:'../source',roomIds:[]}),/project-ID/);await assert.rejects(backend.prepareStarterFromProject({projectId:saved.document.id,roomIds:['missing']}),/bestaand lokaal/);
  await backend.installStarter(result.document,result.sourceName);assert.equal((await backend.startup()).document.id,boot.document.id);const fresh=await backend.createFromStarter({name:'Van geladen lokaal'});assert.notEqual(fresh.document.id,saved.document.id);assert.equal(fresh.document.state.rooms.length,1);assert.equal(fresh.document.state.students.length,3);
});
test('pending/failed autosaves block configuring and creating starters until successful retry',async t=>{
  const {backend,session,boot}=await setup(t),bridge=api(backend),status=[];
  const guarded=await createProjectSession(bridge,{getItem:()=>null},KEY,s=>status.push(s));bridge.save=()=>Promise.reject(Error('Disk full'));
  guarded.save(KEY,{...boot.document.state,name:'Edit'});await assert.rejects(guarded.flush(),/Disk full/);
  let called=false;const controls={choose:()=>{called=true;},fromProject:()=>{called=true;},confirm:()=>{called=true;},setMode:()=>{called=true;}};
  await assert.rejects(guarded.chooseStarter(controls),/Disk full/);await assert.rejects(guarded.confirmStarter(controls,'token'),/Disk full/);await assert.rejects(guarded.setStarterMode(controls,'project'),/Disk full/);await assert.rejects(guarded.create('No'),/Disk full/);assert.equal(called,false);assert.ok(status.at(-1).error);
  await assert.rejects(guarded.prepareStarterFromProject(controls,{projectId:boot.document.id,roomIds:[]}),/Disk full/);assert.equal(called,false);
  await assert.rejects(guarded.resetToDefaults(()=>{called=true;}),/Disk full/);assert.equal(called,false);
  bridge.save=doc=>backend.save(doc);guarded.save(KEY,{...boot.document.state,name:'Retried'});await guarded.flush();assert.equal((await backend.startup()).document.state.name,'Retried');assert.equal(session.id,boot.document.id);
});

test('explicit unseated starter keeps students, layouts, memberships and rules but clears all live seating',()=>{
  const source=starterFixture(),before=structuredClone(source),document=unseatedStarterProject(packStarterProject(source));
  assert.ok(validState(document.state));assert.deepEqual(source,before);
  assert.deepEqual(document.state.rules,source.state.rules);assert.deepEqual(document.state.studentRooms,source.state.studentRooms);
  assert.deepEqual(document.state.rooms.map(r=>r.layout),source.state.rooms.map(r=>r.layout));
  assert.deepEqual(document.state.students,source.state.students.map(p=>({...p,absent:source.state.weeklyPlans.baselineAbsent[p.id]})));
  assert.deepEqual(document.state.assignments,{});assert.deepEqual(document.state.locks,[]);assert.equal(document.state.weeklyPlans,undefined);
  assert.ok(document.state.rooms.every(r=>!Object.keys(r.assignments).length&&!r.locks.length));
  assert.deepEqual(document.lists,source.lists);assert.deepEqual(document.plans,source.plans);
});

test('reset archives every previous project after saving and reopens independent unseated defaults across restart',async t=>{
  const {backend,session,boot}=await setup(t),source=unseatedStarterProject(starterFixture());
  const info=await backend.installStarter(source,'Unseated starter');
  const previous=await backend.createFromStarter({name:'Previous'});await backend.activate(boot.document.id);
  const protectedFiles=[info.file,...['default-layout.json','starter-settings.json','legacy-backup.json'].map(f=>path.join(backend.directory,f))];
  const protectedBytes=await Promise.all(protectedFiles.map(f=>fs.readFile(f,'utf8')));
  session.save(KEY,{...boot.document.state,name:'Final edit before reset'});
  const result=await session.resetToDefaults(()=>backend.resetToDefaults());
  assert.notEqual(result.document.id,boot.document.id);assert.notEqual(result.document.id,previous.document.id);
  assert.equal(session.id,result.document.id);assert.equal(result.document.state.students.length,3);
  assert.deepEqual(result.document.state.assignments,{});assert.deepEqual(result.document.lists,source.lists);
  assert.equal(JSON.parse(await fs.readFile(path.join(result.backupDirectory,`${boot.document.id}.json`),'utf8')).state.name,'Final edit before reset');
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(result.backupDirectory,`${previous.document.id}.json`),'utf8')),previous.document);
  assert.equal((await backend.list()).length,1);assert.equal((await new ProjectStore(backend.directory).startup()).document.id,result.document.id);
  assert.deepEqual(await Promise.all(protectedFiles.map(f=>fs.readFile(f,'utf8'))),protectedBytes);
  session.save(KEY,{...result.document.state,name:'After reset'});await session.flush();assert.equal((await backend.startup()).document.state.name,'After reset');
});

test('room-only reset preserves the standard layout and clears project-specific data',async t=>{
  const {backend,boot}=await setup(t),before=await fs.readFile(path.join(backend.directory,'default-layout.json'),'utf8');
  const result=await backend.resetToDefaults();assert.notEqual(result.document.id,boot.document.id);
  assert.equal(result.document.state.students.length,0);assert.deepEqual(result.document.state.rules,[]);assert.deepEqual(result.document.state.assignments,{});
  assert.deepEqual(result.document.state.rooms.map(r=>r.layout),normalizeStarterProject({version:1,state:JSON.parse(before)}).state.rooms.map(r=>r.layout));
  assert.equal(await fs.readFile(path.join(backend.directory,'default-layout.json'),'utf8'),before);
});

test('failed reset restores original files and pointer and never switches the session',async t=>{
  const {backend,session,boot}=await setup(t),files=await fs.readdir(backend.directory),before=await Promise.all(files.map(f=>fs.readFile(path.join(backend.directory,f),'utf8')));
  const atomic=backend.atomic.bind(backend);backend.atomic=async(file,value)=>{if(path.basename(file)==='workspace.json')throw Error('Reset write failure');return atomic(file,value);};
  await assert.rejects(session.resetToDefaults(()=>backend.resetToDefaults()),/Reset write failure/);
  assert.equal(session.id,boot.document.id);assert.equal((await backend.startup()).document.id,boot.document.id);
  assert.deepEqual(await Promise.all(files.map(f=>fs.readFile(path.join(backend.directory,f),'utf8'))),before);assert.equal((await backend.list()).length,1);
});
