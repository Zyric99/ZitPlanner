import test from 'node:test';
import assert from 'node:assert/strict';
import { defaults, evaluate } from '../src/engine.mjs';
import { emptyGridRoom, generateGrid } from '../src/grid-room.mjs';
import { initializeRooms, newRoom, assignRoom, switchRoom, distributeRooms, pinStudentRoom, assignClassRoom, deleteRoom, roomState, roomSystemValid } from '../src/rooms.mjs';
import { autoDistributeRooms, evaluateCrossRoomRules } from '../src/auto-distribution.mjs';
import { validState } from '../src/project-validation.mjs';
import { emptyProjectState } from '../src/project-session.mjs';
import { restoreDefaultSet, selectDefaultRooms } from '../src/default-set.mjs';
import { generateWeek, weeklyCurrent } from '../src/weekly-planner.mjs';

function rng(seed=71){return()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};}
function fixture(count=4) {
  const state=defaults();state.settings.studentRulesEnabled=true;state.settings.classRulesEnabled=false;state.settings.yearRulesEnabled=false;
  state.students=Array.from({length:count},(_,i)=>({id:`s${i}`,name:`Leerling ${i}`,class:i%2?'4B':'3A',year:i%2?'4':'3',absent:false}));
  initializeRooms(state);
  const a=state.rooms[0],b=newRoom(state,'Tweede lokaal');
  a.layout=generateGrid(emptyGridRoom(),{from:'A',to:'A',rows:1});
  b.layout=generateGrid(emptyGridRoom(),{from:'B',to:'B',rows:1});
  state.settings.layout=structuredClone(a.layout);state.participatingRooms=[a.id,b.id];
  return {state,a,b};
}
const run=state=>autoDistributeRooms(state,{attempts:3,iterations:1500,random:rng()});

function roomyFixture(count=8) {
  const {state,a,b}=fixture(count);
  for(const room of [a,b])room.layout=generateGrid(emptyGridRoom(),{from:'A',to:'D',rows:1});
  state.settings.layout=structuredClone(a.layout);
  return {state,a,b};
}

test('selected capacity and balanced modes produce different rule-free room occupancies',()=>{
  for(const [mode,expected] of [['capacity',[8,0]],['balanced',[4,4]]]) {
    const {state,a,b}=roomyFixture();state.distribution.mode=mode;
    const result=run(state);
    assert.equal(result.complete,true);assert.equal(result.state.distribution.mode,mode);
    assert.deepEqual([a,b].map(room=>Object.values(result.state.studentRooms).filter(id=>id===room.id).length),expected);
  }
});

test('selected class strategies spread or retain each class independently of seating rules',()=>{
  for(const mode of ['classesSpread','classesTogether']) {
    const {state,a,b}=roomyFixture();state.distribution.mode=mode;
    const result=run(state);assert.equal(result.complete,true);
    for(const klass of ['3A','4B']) {
      const counts=[a,b].map(room=>state.students.filter(p=>p.class===klass&&result.state.studentRooms[p.id]===room.id).length);
      assert.deepEqual(counts.sort((a,b)=>a-b),mode==='classesSpread'?[2,2]:[0,4]);
    }
  }
});

test('year spreading balances whole years even when each year contains multiple classes',()=>{
  const {state,a,b}=roomyFixture(12);state.distribution.mode='yearsSpread';
  state.students.forEach((p,i)=>{p.class=['3A','3B','4A','4B'][Math.floor(i/3)];p.year=p.class[0];});
  const result=run(state);assert.equal(result.complete,true);
  for(const year of ['3','4'])for(const room of [a,b])assert.equal(state.students.filter(p=>p.year===year&&result.state.studentRooms[p.id]===room.id).length,3);
});

for(const priority of ['Verplicht','Voorkeur','Zachte voorkeur']) {
  test(`${priority} separation outweighs filling the first room`,()=>{
    const {state}=fixture(2);state.distribution.mode='capacity';
    state.rules=[{id:'apart',type:'separate',students:['s0','s1'],priority}];
    const result=run(state);assert.equal(result.complete,true);
    assert.notEqual(result.state.studentRooms.s0,result.state.studentRooms.s1);
  });
  test(`${priority} together outweighs balanced room headcounts`,()=>{
    const {state}=fixture(2);state.distribution.mode='balanced';
    state.rules=[{id:'pair',type:'together',students:['s0','s1'],priority}];
    const result=run(state);assert.equal(result.complete,true);
    assert.equal(result.state.studentRooms.s0,result.state.studentRooms.s1);
  });
}

test('class rules outweigh keeping classes together across rooms',()=>{
  const {state}=fixture(2);state.distribution.mode='classesTogether';
  state.students.forEach(p=>{p.class='3A';p.year='3';});
  state.settings.classRulesEnabled=true;state.settings.classRules.default={type:'separate',priority:'Verplicht'};
  const result=run(state);assert.equal(result.complete,true);
  assert.notEqual(result.state.studentRooms.s0,result.state.studentRooms.s1);
});

test('distribution keeps improving after a rule-free seed unnecessarily splits a class',()=>{
  const {state,a,b}=roomyFixture(14);state.distribution.mode='classesTogether';
  b.layout=generateGrid(emptyGridRoom(),{from:'A',to:'C',rows:1});
  state.students.forEach((p,i)=>{p.class=i<6?'3A':i<10?'3B':'4A';p.year=p.class[0];});
  distributeRooms(state,'classesTogether');
  assert.ok(['3A','3B','4A'].some(klass=>new Set(state.students.filter(p=>p.class===klass).map(p=>state.studentRooms[p.id])).size>1));
  const result=autoDistributeRooms(state,{random:rng()});assert.equal(result.complete,true);
  for(const klass of ['3A','3B','4A'])assert.equal(new Set(state.students.filter(p=>p.class===klass).map(p=>result.state.studentRooms[p.id])).size,1);
  assert.equal(state.rooms.find(room=>room.id===a.id).layout.benches.length,4);
});

test('Auto repairs a capacity-balanced distribution that violates class separation',()=>{
  const {state,a,b}=fixture();state.settings.classRulesEnabled=true;state.settings.classRules.default={type:'separate',priority:'Verplicht'};
  distributeRooms(state,'balanced');
  assert.deepEqual(state.students.filter(p=>state.studentRooms[p.id]===a.id).map(p=>p.class),['3A','3A']);
  const before=structuredClone(state),result=run(state);
  assert.equal(result.complete,true);assert.deepEqual(result.unplaced,[]);assert.deepEqual(result.warnings,[]);
  for(const room of [a,b])assert.equal(new Set(result.state.students.filter(p=>result.state.studentRooms[p.id]===room.id).map(p=>p.class)).size,2);
  assert.deepEqual(state,before);assert.ok(validState(result.state));
});

test('joint moves satisfy together rules instead of hiding them across two room tabs',()=>{
  const {state}=fixture();state.rules=[{id:'pair',type:'together',students:['s0','s1'],priority:'Verplicht'}];
  const result=autoDistributeRooms(state,{attempts:1,iterations:1200,random:rng(10)});
  assert.equal(result.complete,true);assert.equal(result.state.studentRooms.s0,result.state.studentRooms.s1);
  assert.equal(result.warnings.length,0);
});

test('unassigned present pupils expose every affected cross-room relationship as well as missing placement',()=>{
  const {state,a}=fixture(2);state.studentRooms={s0:a.id,s1:null};state.rules=['together','near','area'].map(type=>({id:type,type,students:['s0','s1'],priority:'Verplicht'}));
  const warnings=evaluateCrossRoomRules(state).warnings;assert.deepEqual(warnings.map(w=>w.type),['unplaced','together','near','area']);assert.ok(warnings.every(w=>w.crossRoom));
  state.students[1].absent=true;assert.deepEqual(evaluateCrossRoomRules(state).warnings,[]);
});

test('incompatible room pins produce a visible cross-room warning for together',()=>{
  const {state,a,b}=fixture(2);pinStudentRoom(state,'s0',a.id);pinStudentRoom(state,'s1',b.id);
  state.rules.push({id:'pair',type:'together',students:['s0','s1'],priority:'Verplicht'});
  const result=run(state);assert.equal(result.complete,false);assert.equal(result.unplaced.length,0);
  assert.equal(result.state.studentRooms.s0,a.id);assert.equal(result.state.studentRooms.s1,b.id);
  assert.ok(result.warnings.some(w=>w.ruleId==='pair'&&w.priority==='Verplicht'&&/verschillende lokalen/.test(w.message)));
});

test('Auto retains room pins, seat pins and enabled fixed positions and the active tab',()=>{
  const {state,a,b}=fixture();assignRoom(state,'s0',b.id);switchRoom(state,b.id);
  state.assignments={'grid-B1:1':'s0'};state.locks=['s0'];pinStudentRoom(state,'s1',a.id);
  state.rules.push({id:'fixed',type:'fixed',students:['s2'],roomId:a.id,seat:'grid-A1:0',priority:'Verplicht'});
  const result=run(state);assert.equal(result.state.activeRoomId,b.id);assert.equal(result.state.assignments['grid-B1:1'],'s0');
  assert.equal(roomState(result.state,a.id).assignments['grid-A1:0'],'s2');assert.equal(result.state.studentRooms.s1,a.id);
  assert.deepEqual(result.state.rules,state.rules);assert.deepEqual(result.state.studentRoomPins,state.studentRoomPins);
  assert.ok(validState(result.state));
});

test('impossible separation retains students and real capacities with unresolved warnings',()=>{
  const {state}=fixture(3);state.students.forEach(p=>p.class='3A');state.settings.classRulesEnabled=true;
  state.settings.classRules.default={type:'separate',priority:'Verplicht'};
  const result=run(state);assert.equal(result.complete,false);assert.equal(result.unplaced.length,0);
  assert.equal(result.state.students.length,3);assert.equal(result.warnings.filter(w=>w.priority==='Verplicht').length,1);
  assert.equal(result.state.rooms.reduce((n,r)=>n+Object.keys(r.assignments).length,0),3);assert.ok(validState(result.state));
});

test('overflow stays visible and Auto never exceeds or invents seats',()=>{
  const {state}=fixture(5),result=run(state);assert.equal(result.complete,false);assert.equal(result.unplaced.length,1);
  assert.equal(result.state.rooms.reduce((n,r)=>n+Object.keys(r.assignments).length,0),4);assert.ok(roomSystemValid(result.state));
});

test('disabled modules do not constrain Auto and absent students keep their memberships',()=>{
  const {state,a,b}=fixture(3);state.students[2].absent=true;pinStudentRoom(state,'s2',b.id);
  pinStudentRoom(state,'s0',a.id);pinStudentRoom(state,'s1',b.id);state.settings.studentRulesEnabled=false;
  state.rules=[{id:'disabled',type:'together',students:['s0','s1'],priority:'Verplicht'}];
  const result=run(state);assert.equal(result.complete,true);assert.equal(result.state.studentRooms.s2,b.id);
  assert.ok(!result.state.rooms.some(r=>Object.values(r.assignments).includes('s2')));
});

for(const mode of ['balanced','capacity','classesSpread','classesTogether','yearsSpread'])test(`${mode} retains a room-only pin even with keepFixed off`,()=>{
  const {state,b}=fixture();pinStudentRoom(state,'s0',b.id);distributeRooms(state,mode,{keepFixed:false});
  assert.equal(state.studentRooms.s0,b.id);assert.ok(!Object.keys(b.assignments).length);
  const loaded=JSON.parse(JSON.stringify(state));initializeRooms(loaded);distributeRooms(loaded,mode,{keepFixed:false});
  assert.equal(loaded.studentRooms.s0,b.id);assert.ok(validState(loaded));
});

test('room pins reject manual moves and conflicting class bindings until released',()=>{
  const {state,a,b}=fixture();pinStudentRoom(state,'s0',b.id);
  assert.throws(()=>assignRoom(state,'s0',a.id),/lokaalpin/);assert.throws(()=>assignClassRoom(state,'3A',a.id),/lokaalpin/);
  pinStudentRoom(state,'s0');assignRoom(state,'s0',a.id);assignClassRoom(state,'3A',a.id);
  assert.throws(()=>pinStudentRoom(state,'s0',b.id),/vast lokaal/);
  assert.equal(state.studentRoomPins.s0,undefined);
});

test('room pins are cleared from empty defaults and removed rooms without touching students',()=>{
  const {state,a,b}=fixture();pinStudentRoom(state,'s0',b.id);
  assert.deepEqual(emptyProjectState(state).studentRoomPins,{});
  const restored=restoreDefaultSet(state,selectDefaultRooms(state,[a.id])).state;
  assert.deepEqual(restored.studentRoomPins,{});assert.equal(restored.students.length,4);assert.ok(validState(restored));
  deleteRoom(state,b.id);assert.deepEqual(state.studentRoomPins,{});assert.ok(validState(state));
});

test('validation rejects room pins pointing to unknown pupils, rooms or conflicting classes',()=>{
  for(const pins of [{missing:'standaardlokaal'},{s0:'missing'},[]]){const {state}=fixture();state.studentRoomPins=pins;assert.equal(validState(state),false);}
  const {state,a,b}=fixture();state.classRooms={'3A':a.id};state.studentRoomPins={s0:b.id};assert.equal(validState(state),false);
});

test('legacy weekly plans respect room-only pins and become stale when a room pin changes',()=>{
  const {state,b}=fixture();pinStudentRoom(state,'s0',b.id);
  state.weeklyPlans=generateWeek(state,{iterations:20});
  for(const day of Object.values(state.weeklyPlans.days))assert.equal(day.studentRooms.s0,b.id);
  assert.equal(weeklyCurrent(state),true);pinStudentRoom(state,'s0');assert.equal(weeklyCurrent(state),false);
});
