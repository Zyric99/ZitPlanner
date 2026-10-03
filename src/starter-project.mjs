import { validState } from './project-validation.mjs';
import { migrateState, defaults } from './engine.mjs';
import { initializeRooms } from './rooms.mjs';
import { normalizeStudentYears } from './student-year.mjs';
import { packGridRoom, unpackGridRoom } from './grid-room.mjs';
import { selectDefaultRooms, restoreDefaultSet } from './default-set.mjs';
import { leaveWeeklyDay } from './weekly-planner.mjs';

const flags=['developerMode','developerInfo','developerStorage','DEVELOPER_MODE','KLASLOKAAL_DEV_MODE'];
function cleanRecord(value) {for(const key of flags)delete value[key];return value;}
function cleanStudents(students) {return students.map(p=>cleanRecord(p));}
function normalizedState(source) {
  if(!validState(source))throw Error('Het startproject bevat ongeldige projectgegevens.');
  const state=initializeRooms(migrateState(source));normalizeStudentYears(state.students);
  cleanRecord(state);cleanRecord(state.settings);cleanStudents(state.students);
  for(const room of state.rooms){cleanRecord(room);cleanRecord(room.settings);}
  if(!validState(state))throw Error('Het startproject kan niet geldig worden gemigreerd.');
  return state;
}
// Use the same schema/migrations as normal import; associated data is checked strictly.
export function normalizeStarterProject(input) {
  const data=JSON.parse(JSON.stringify(input,(key,value)=>flags.includes(key)?undefined:value),(_key,value)=>unpackGridRoom(value));
  if(!data||![1,2].includes(data.version)||!data.state)throw Error('Kies een Zitplanner-projectbestand (.json), versie 1 of 2.');
  if(data.plans!==undefined&&!Array.isArray(data.plans)||data.lists!==undefined&&!Array.isArray(data.lists))throw Error('Het startproject bevat ongeldige plannen of leerlingenlijsten.');
  const state=normalizedState(data.state);
  const plans=(data.plans??[]).map(plan=>{
    if(!plan||typeof plan.id!=='string')throw Error('Het startproject bevat een ongeldig bewaard plan.');
    return {...cleanRecord(plan),state:normalizedState(plan.state)};
  });
  const lists=(data.lists??[]).map(list=>{
    if(!list||typeof list.id!=='string'||typeof list.name!=='string'||!Array.isArray(list.students)||!validState({...defaults(),students:list.students}))throw Error('Het startproject bevat een ongeldige leerlingenlijst.');
    cleanRecord(list);cleanStudents(list.students);normalizeStudentYears(list.students);return list;
  });
  return {version:1,state,plans,lists};
}
export const packStarterProject=document=>JSON.parse(JSON.stringify(document,(_key,value)=>packGridRoom(value)));
export function starterPreview(document) {return {name:document.state.name,rooms:document.state.rooms.length,students:document.state.students.length,lists:document.lists.length,plans:document.plans.length,weekly:!!document.state.weeklyPlans};}

// An explicit conversion: imported full starters may still include seating.
export function unseatedStarterProject(input) {
  const document=normalizeStarterProject(input),state=document.state;
  if(state.weeklyPlans)leaveWeeklyDay(state);
  delete state.weeklyPlans;
  state.assignments={};state.locks=[];state.benchLocks=[];state.hiddenWarnings=[];state.planId=null;
  for(const room of state.rooms){room.assignments={};room.locks=[];room.hiddenWarnings=[];}
  return document;
}

// Keep project-wide pupils, lists and named snapshots. Removing room tabs only
// frees the affected memberships/seats; it must never silently delete pupils.
export function selectStarterRooms(input,roomIds) {
  const document=normalizeStarterProject(input),source=document.state;
  if(!Array.isArray(roomIds)||!roomIds.length||new Set(roomIds).size!==roomIds.length||roomIds.some(id=>!source.rooms.some(room=>room.id===id)))throw Error('Selecteer minstens één bestaand lokaal.');
  let clearedWeek=false;
  if(roomIds.length!==source.rooms.length){
    const prepared=restoreDefaultSet(source,selectDefaultRooms(source,roomIds));
    document.state=prepared.state;clearedWeek=prepared.summary.clearedWeek;
  }
  if(!validState(document.state))throw Error('Deze lokaalkeuze vormt geen geldig startproject.');
  return {document,preview:{...starterPreview(document),roomNames:document.state.rooms.map(room=>room.name),unassigned:document.state.students.filter(p=>!document.state.studentRooms[p.id]).length,clearedWeek}};
}
