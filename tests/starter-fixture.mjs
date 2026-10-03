import { migrateLocationPins } from '../src/location-rules.mjs';
import { defaults, enabledSeats } from '../src/engine.mjs';
import { initializeRooms, newRoom, captureRoom } from '../src/rooms.mjs';
import { generateWeek, applyWeeklyDay } from '../src/weekly-planner.mjs';

export function starterFixture() {
  const state=initializeRooms(defaults());state.name='Testklassen · startproject';state.planId='source-plan';
  const second=newRoom(state,'Tweede testlokaal','small'),main=state.activeRoomId;
  state.participatingRooms.push(second.id);
  state.students=['p','q','r'].map((id,i)=>({id,name:`Testleerling ${i+1}`,class:i===2?'2B':'1A',year:i===2?'2':'1',absent:false}));
  state.studentRooms={p:main,q:main,r:second.id};state.classRooms={'1A':main,'2B':second.id};state.distribution.reviewed=true;
  state.assignments={'grid-A1:0':'p','grid-A1:1':'q'};state.locks=['p'];
  state.rules=[{id:'fixed-p',type:'fixed',students:['p'],roomId:main,seat:'grid-A1:0',priority:'Verplicht'}];
  const seat=enabledSeats({...state.settings,...second.settings,layout:second.layout})[0];second.assignments={[seat]:'r'};second.locks=['r'];captureRoom(state);
  migrateLocationPins(state);
  state.weeklyPlans=generateWeek(state,{iterations:0});applyWeeklyDay(state,'maandag');
  return {version:2,id:'source-project',state,lists:[{id:'list',name:'Testleerlingen',students:structuredClone(state.students)}],plans:[{id:'saved-plan',created:'2026-10-01',state:structuredClone(state)}]};
}
