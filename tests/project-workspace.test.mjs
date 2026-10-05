import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {starterFixture} from './starter-fixture.mjs';
import {createProjectSession,blankProjectState} from '../src/project-session.mjs';
import {validState} from '../src/project-validation.mjs';
import {factoryDefaultSet} from '../src/default-set.mjs';
import {setCalendarEnabled,saveCalendarPeriod,openCalendarDate,calendarDraft} from '../src/calendar-model.mjs';
import {setStudentAttendance} from '../src/attendance.mjs';
const require=createRequire(import.meta.url),{ProjectWorkspace}=require('../desktop/project-workspace.cjs'),{ProjectStore}=require('../desktop/project-store.cjs');
const KEY='klaslokaal-v1';
const api=store=>Object.fromEntries(['startup','bootstrap','save','list','load','activate','create','createEmpty','duplicate','rename','resetPreview','reset','delete'].map(m=>[m,arg=>store[m](arg)]));
async function setup(t){const directory=await fs.mkdtemp(path.join(os.tmpdir(),'zitplanner-workspace-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));return new ProjectWorkspace(directory);}
async function fresh(t){const store=await setup(t),source=starterFixture(),boot=await store.bootstrap({...source,legacy:{[KEY]:'untouched'}});return {store,source,boot};}

test('first launch creates a normal standard project and restart reopens the last project',async t=>{
  const {store,source,boot}=await fresh(t);assert.equal(boot.document.state.name,'Standaard project');assert.equal(boot.standard.id,boot.document.id);
  assert.deepEqual(boot.document.state.students,source.state.students);assert.deepEqual(boot.document.state.rooms,source.state.rooms);
  const next=await store.createEmpty({name:'Leeg'});const reboot=await new ProjectWorkspace(store.directory).startup();assert.equal(reboot.document.id,next.document.id);assert.equal(reboot.standard.id,boot.document.id);
  assert.equal(reboot.workspaceVersion,3);assert.ok(!(await fs.readdir(store.directory)).includes('default-layout.json'));
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(store.directory,'backups','legacy-localStorage.json'),'utf8')),{[KEY]:'untouched'});
});

test('new projects start with a blank tab and no inherited layouts, rules, lists, students or plans',async t=>{
  const {store}=await fresh(t),{document}=await store.createEmpty({name:'Nieuw'}),s=document.state;
  assert.ok(validState(s));assert.equal(s.rooms.length,1);assert.equal(s.rooms[0].layout.benches.length,0);
  for(const key of ['students','rules','roomTemplates'])assert.deepEqual(s[key],[]);
  for(const key of ['assignments','classRooms','studentRooms'])assert.deepEqual(s[key],{});
  assert.deepEqual(s.settings.yearRules,[]);assert.equal(s.settings.classRules.default.type,'none');assert.deepEqual(document.lists,[]);assert.deepEqual(document.plans,[]);assert.equal(s.weeklyPlans,undefined);
  assert.ok(validState(blankProjectState()));
});

test('project sessions isolate saved calendar days and drafts when creating and reopening projects',async t=>{
  const {store,boot}=await fresh(t),session=await createProjectSession(api(store),{getItem:()=>null},KEY);
  const first=await session.open(boot.document.id,validState),a=first.state;
  setCalendarEnabled(a,true,'2026-10-05');
  const student=a.students[0].id;setStudentAttendance(a,student,true);
  saveCalendarPeriod(a,'2026-10-05','day');
  openCalendarDate(a,'2026-10-06',{fresh:true});
  openCalendarDate(a,'2026-10-08',{fresh:true});
  assert.ok(a.calendar.days['2026-10-06']);
  setCalendarEnabled(a,false);
  const archive=structuredClone(a.calendar);
  assert.ok(calendarDraft(a,'2026-10-08'));
  await session.save(KEY,a);
  const second=await session.create('Tweede project',{valid:validState});
  assert.equal(second.state.calendar,undefined);
  setCalendarEnabled(second.state,true,'2026-10-09');saveCalendarPeriod(second.state,'2026-10-09','day');
  await session.save(KEY,second.state);
  const reopened=await session.open(first.id,validState);
  assert.deepEqual(reopened.state.calendar,archive);
  assert.deepEqual(reopened.state.calendar.days['2026-10-05'].absentIds,[student]);
  const other=await session.open(second.id,validState);
  assert.deepEqual(Object.keys(other.state.calendar.days),['2026-10-09']);
  assert.equal(other.state.calendar.drafts,undefined);
});

test('duplicate any project copies full data, chooses unique numbered names, and remains independent',async t=>{
  const {store,source}=await fresh(t),original=await store.create({...source,state:{...source.state,name:'Klas'}}),file=original.file,before=await fs.readFile(file,'utf8');
  const first=await store.duplicate({id:original.document.id}),second=await store.duplicate({id:original.document.id}),third=await store.duplicate({id:first.document.id});
  assert.deepEqual([first.document.state.name,second.document.state.name,third.document.state.name],['Klas - kopie','Klas - kopie 2','Klas - kopie 3']);
  for(const key of ['rooms','students','rules','roomTemplates','weeklyPlans'])assert.deepEqual(first.document.state[key],original.document.state[key]);
  assert.deepEqual(first.document.plans,original.document.plans);assert.deepEqual(first.document.lists,original.document.lists);assert.notEqual(first.document.id,original.document.id);
  first.document.state.students[0].name='Alleen kopie';await store.save(first.document);assert.equal(await fs.readFile(file,'utf8'),before);
  assert.equal((await store.load(second.document.id)).state.students[0].name,source.state.students[0].name);
});

test('migration backs up legacy storage, retains projects/pointer/source and converts starter into a project',async t=>{
  const store=await setup(t),old=new ProjectStore(store.directory),source=starterFixture(),boot=await old.bootstrap({state:factoryDefaultSet(),plans:[],lists:[],template:factoryDefaultSet(),legacy:{[KEY]:'original'}});
  await old.installStarter(source,'source.json');const sourceBefore=structuredClone(source),oldFile=await fs.readFile(boot.file,'utf8');
  const next=await store.startup();assert.equal(next.document.id,boot.document.id);assert.equal(await fs.readFile(boot.file,'utf8'),oldFile);assert.deepEqual(source,sourceBefore);
  const standard=await store.load(next.standard.id);assert.equal(standard.state.name,'Standaard project');assert.deepEqual(standard.state.students,source.state.students);assert.deepEqual(standard.state.rooms,source.state.rooms);assert.deepEqual(standard.plans,source.plans);
  const m=JSON.parse(await fs.readFile(path.join(store.directory,'workspace.json'),'utf8'));assert.equal(m.version,3);assert.ok(m.migrationBackup.startsWith(path.join(store.directory,'backups')));
  assert.ok((await fs.readdir(m.migrationBackup)).includes('starter-settings.json'));assert.ok(!(await fs.readdir(store.directory)).includes('starters'));
  assert.equal((await new ProjectWorkspace(store.directory).startup()).standard.id,standard.id);assert.equal((await store.list()).filter(p=>p.standard).length,1);
});

test('failed migration does not switch pointers or lose old defaults/source/current',async t=>{
  const store=await setup(t),old=new ProjectStore(store.directory),source=starterFixture();await old.bootstrap({state:source.state,plans:[],lists:[],template:factoryDefaultSet()});await old.installStarter(source,'source.json');
  const before=await fs.readFile(path.join(store.directory,'workspace.json'),'utf8'),atomic=store.atomic.bind(store);
  store.atomic=async(file,value)=>{if(path.basename(file)==='workspace.json')throw Error('Vol');return atomic(file,value);};
  await assert.rejects(store.startup(),/Vol/);assert.equal(await fs.readFile(path.join(store.directory,'workspace.json'),'utf8'),before);
  assert.ok((await fs.readdir(store.directory)).includes('starter-settings.json'));assert.ok((await fs.readdir(store.directory)).includes('starters'));
  store.atomic=atomic;assert.ok((await store.startup()).standard.id);
});

test('reset replaces only the selected project, preserving its ID/name and a recovery backup',async t=>{
  const {store,boot}=await fresh(t),target=await store.createEmpty({name:'Doel'}),other=await store.createEmpty({name:'Ander'}),otherBefore=await fs.readFile(other.file,'utf8');await store.activate(target.document.id);
  const preview=await store.resetPreview({id:target.document.id});assert.equal(preview.students,boot.document.state.students.length);
  const reset=await store.reset({id:target.document.id});assert.equal(reset.document.id,target.document.id);assert.equal(reset.document.state.name,'Doel');assert.deepEqual(reset.document.state.students,boot.document.state.students);
  assert.equal(await fs.readFile(other.file,'utf8'),otherBefore);assert.deepEqual((await store.load(boot.document.id)).state,boot.document.state);
  assert.equal(JSON.parse(await fs.readFile(path.join(reset.backupDirectory,`${target.document.id}.json`),'utf8')).state.students.length,0);
  assert.equal((await store.startup()).document.id,target.document.id);
});

test('resetting standard restores its initial project snapshot after edits',async t=>{
  const {store,boot}=await fresh(t),edited=structuredClone(boot.document);edited.state.students[0].name='Gewijzigd';await store.save(edited);
  const reset=await store.reset({id:edited.id});assert.equal(reset.document.state.students[0].name,boot.document.state.students[0].name);assert.equal(reset.document.id,edited.id);
});

test('reset without backup makes no project snapshot, preserves existing backups and still rolls back write failures',async t=>{
  const {store,boot}=await fresh(t),target=await store.createEmpty({name:'Zonder backup'}),beforeBackups=await fs.readdir(path.join(store.directory,'backups'));
  const preview=await store.resetPreview({id:target.document.id});assert.equal(preview.backupDirectory,path.join(store.directory,'backups'));
  const result=await store.reset({id:target.document.id,backup:false});assert.equal(result.backupDirectory,null);assert.equal(result.document.state.name,'Zonder backup');assert.deepEqual(result.document.state.students,boot.document.state.students);
  assert.deepEqual(await fs.readdir(path.join(store.directory,'backups')),beforeBackups);await assert.rejects(fs.access(`${target.file}.bak`),{code:'ENOENT'});
  const before=await fs.readFile(target.file,'utf8'),atomic=store.atomic.bind(store);let fail=true;
  store.atomic=async(file,value,options)=>{if(fail&&path.basename(file)==='workspace.json'){fail=false;throw Error('Schrijffout');}return atomic(file,value,options);};
  await assert.rejects(store.reset({id:target.document.id,backup:false}),/Schrijffout/);assert.equal(await fs.readFile(target.file,'utf8'),before);assert.equal((await store.startup()).document.id,target.document.id);
});

test('backup cleanup removes only generated project backups older than 30 days and preserves the standard snapshot',async t=>{
  const {store,boot}=await fresh(t),directory=path.join(store.directory,'backups'),now=Date.parse('2026-10-03T12:00:00Z'),day=24*60*60*1000;
  const make=async(kind,age)=>{const name=`${kind}-${new Date(now-age*day).toISOString().replace(/[:.]/g,'-')}-${randomUUID()}`,folder=path.join(directory,name);await fs.mkdir(path.join(folder,'nested'),{recursive:true});await fs.writeFile(path.join(folder,'nested','snapshot.json'),'old project');return name;};
  const expired=await Promise.all(['reset','verwijderd','migratie'].map(kind=>make(kind,31))),recent=await make('reset',29),boundary=await make('reset',30),future=await make('reset',-1);
  await fs.utimes(path.join(directory,recent),new Date(0),new Date(0));await fs.mkdir(path.join(directory,'handmatig-oud'));await fs.writeFile(path.join(directory,'reset-onbekend.json'),'keep');
  const baseline=await fs.readFile(store.baselineFile(),'utf8');await store.cleanupBackups(now);
  const remaining=await fs.readdir(directory);for(const name of expired)assert.ok(!remaining.includes(name));for(const name of [recent,boundary,future,'handmatig-oud','reset-onbekend.json','legacy-localStorage.json'])assert.ok(remaining.includes(name));
  assert.equal(await fs.readFile(store.baselineFile(),'utf8'),baseline);assert.equal((await store.reset({id:boot.document.id})).document.state.name,'Standaard project');
});

test('backup cleanup skips directory links and never deletes projects outside its backup folder',async t=>{
  const {store}=await fresh(t),outside=await fs.mkdtemp(path.join(os.tmpdir(),'zitplanner-outside-'));t.after(()=>fs.rm(outside,{recursive:true,force:true}));
  const sentinel=path.join(outside,'keep.json');await fs.writeFile(sentinel,'keep');
  const link=path.join(store.directory,'backups',`reset-2020-01-01T00-00-00-000Z-${randomUUID()}`);await fs.symlink(outside,link,process.platform==='win32'?'junction':'dir');
  await store.cleanupBackups();assert.equal(await fs.readFile(sentinel,'utf8'),'keep');assert.ok((await fs.lstat(link)).isSymbolicLink());
});

test('delete archives the target, preserves other projects, selects standard when active and rejects standard deletion',async t=>{
  const {store,boot}=await fresh(t),target=await store.createEmpty({name:'Weg'}),other=await store.createEmpty({name:'Bewaren'}),otherBefore=await fs.readFile(other.file,'utf8');
  const inactive=await store.delete({id:target.document.id});assert.equal(inactive.document.id,other.document.id);assert.ok(!(await store.list()).some(p=>p.id===target.document.id));assert.equal(await fs.readFile(other.file,'utf8'),otherBefore);
  const active=await store.delete({id:other.document.id});assert.equal(active.document.id,boot.document.id);assert.equal((await store.startup()).document.id,boot.document.id);
  assert.ok((await fs.readdir(active.backupDirectory)).some(n=>n===`${other.document.id}.json`));await assert.rejects(store.delete({id:boot.document.id}),/standaardproject/);
});

test('reset/delete failures roll back target and selection',async t=>{
  for(const operation of ['reset','delete']){
    const {store,boot}=await fresh(t),target=await store.createEmpty({name:'Behouden'}),before=await fs.readFile(target.file,'utf8'),atomic=store.atomic.bind(store);let fail=true;
    store.atomic=async(file,value)=>{if(fail&&path.basename(file)==='workspace.json'){fail=false;throw Error('Schrijffout');}return atomic(file,value);};
    await assert.rejects(store[operation]({id:target.document.id}),/Schrijffout/);assert.equal(await fs.readFile(target.file,'utf8'),before);assert.equal((await store.startup()).document.id,target.document.id);assert.ok((await store.load(boot.document.id)).id);
  }
});

test('session save barrier blocks new/duplicate/rename/reset/delete after a write error',async t=>{
  const {store,boot}=await fresh(t),bridge=api(store),session=await createProjectSession(bridge,{getItem:()=>null},KEY),copy=await session.duplicate(boot.document.id);
  bridge.save=()=>Promise.reject(Error('Schijf vol'));session.save(KEY,copy.state);await assert.rejects(session.flush(),/Schijf vol/);
  for(const call of [()=>session.create('Nieuw'),()=>session.duplicate(boot.document.id),()=>session.rename(copy.id,'Naam'),()=>session.resetPreview(),()=>session.reset(),()=>session.remove(copy.id)])await assert.rejects(call(),/Schijf vol/);
  bridge.save=d=>store.save(d);session.save(KEY,copy.state);await session.flush();assert.equal((await session.create('Nieuw')).state.students.length,0);
});

test('renderer IDs cannot reach workspace settings or arbitrary paths',async t=>{
  const {store,boot}=await fresh(t);for(const id of ['workspace','../outside','backups','C:\\outside','default-layout'])for(const method of ['load','delete','duplicate','reset'])await assert.rejects(store[method](method==='load'?id:{id}),/project-ID/);
  await assert.rejects(store.rename({id:boot.document.id,name:'Naam'}),/standaardproject/);
});
