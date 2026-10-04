import test from 'node:test';
import assert from 'node:assert/strict';
import { legacyDefaults, generate, evaluate, enabledSeats } from '../src/engine.mjs';

function fixture(count=3,mode='ordered') {
  const state=legacyDefaults();
  state.settings.placementMode=mode;
  state.settings.sections=[{id:'A',from:'A',to:'A',enabled:true}];
  state.settings.rows=[1,2];state.settings.yearRules=[];
  state.settings.classRulesEnabled=true;
  state.settings.classRules.default={type:'separate',priority:'Verplicht'};
  state.students=Array.from({length:count},(_,i)=>({id:`s${i}`,name:`Student ${i}`,class:i<2?'1A':'2B',year:i<2?'1':'2',absent:false}));
  return state;
}
const rule=(id,type,students,priority='Verplicht')=>({id,type,students,priority});
function checkRoster(state,result,count) {
  const seated=Object.values(result.assignments),active=state.students.filter(p=>!p.absent&&(!state.studentRooms||state.studentRooms[p.id]===state.activeRoomId)).map(p=>p.id);
  assert.equal(seated.length,count);assert.equal(new Set(seated).size,count);
  assert.deepEqual([...seated,...result.unplaced].sort(),active.sort());
  assert.ok(Object.keys(result.assignments).every(seat=>enabledSeats(state.settings).includes(seat)));
}

for(const mode of ['ordered','random'])for(const priority of ['Verplicht','Voorkeur','Zachte voorkeur'])test(`${mode} overflow replaces a seated classmate for a better ${priority} rule score`,()=>{
  const state=fixture(3,mode);state.settings.classRules.default.priority=priority;
  const before=structuredClone(state),initial=generate(state,{iterations:0,random:()=>.99});
  assert.equal(initial.score[['Verplicht','Voorkeur','Zachte voorkeur'].indexOf(priority)],1);
  const result=generate(state,{iterations:1,random:()=>.99});
  assert.deepEqual(result.score.slice(0,3),[0,0,0]);assert.ok(Object.values(result.assignments).includes('s2'));
  assert.equal(result.warnings.filter(w=>w.type==='unplaced').length,1);
  checkRoster(state,result,2);assert.deepEqual(state,before);
  if(mode==='ordered')assert.deepEqual(generate(state,{iterations:1}),result);
});

test('year rules also improve through waiting-to-seated replacements',()=>{
  const state=fixture();state.settings.classRulesEnabled=false;
  state.settings.yearRules=[{years:['1','1'],type:'separate',priority:'Verplicht'}];
  const result=generate(state,{iterations:1});
  assert.equal(result.score[0],0);assert.ok(Object.values(result.assignments).includes('s2'));checkRoster(state,result,2);
});

test('an unresolved waiting rule member can replace an unconstrained seated pupil',()=>{
  const state=fixture();state.settings.classRulesEnabled=false;
  state.rules=[rule('pair','together',['s1','s2'])];
  assert.equal(generate(state,{iterations:0}).score[0],1);
  const result=generate(state,{iterations:1});
  assert.deepEqual(Object.values(result.assignments).sort(),['s1','s2']);assert.equal(result.score[0],0);
  assert.ok(!result.warnings.some(w=>w.ruleId==='pair'));checkRoster(state,result,2);
});

for(const protection of ['pin','fixed'])test(`waiting substitutions preserve a ${protection} with only one movable chair`,()=>{
  const state=fixture();state.settings.classRulesEnabled=false;
  state.rules=[rule('pair','together',['s0','s2'])];
  if(protection==='pin'){state.assignments={'A1:0':'s0'};state.locks=['s0'];}
  else state.rules.push({...rule('fixed','fixed',['s0']),seat:'A1:0'});
  const result=generate(state,{iterations:1});
  assert.equal(result.assignments['A1:0'],'s0');assert.deepEqual(Object.values(result.assignments).sort(),['s0','s2']);
  assert.equal(result.score[0],0);checkRoster(state,result,2);
});

test('locked benches cannot evict their occupants to reduce a rule violation',()=>{
  const state=fixture();state.assignments={'A1:0':'s0','A1:1':'s1'};state.benchLocks=['A1'];
  const result=generate(state,{iterations:20});
  assert.deepEqual(result.assignments,state.assignments);assert.equal(result.score[0],1);checkRoster(state,result,2);
});

test('a violation cannot be hidden by moving a personal-rule member to the waiting list',()=>{
  const state=fixture();state.settings.classRulesEnabled=false;state.rules=[rule('pair','separate',['s0','s1'])];
  const result=generate(state,{iterations:20});
  assert.deepEqual(Object.values(result.assignments).sort(),['s0','s1']);assert.equal(result.score[0],1);
  assert.equal(evaluate(state,{'A1:0':'s0','A1:1':'s2'},false).score[0],1);checkRoster(state,result,2);
});

test('substitutions never trade a compulsory relationship for a softer improvement',()=>{
  const state=fixture();state.settings.classRules.default.priority='Voorkeur';
  state.rules=[rule('pair','together',['s0','s1'])];
  const result=generate(state,{iterations:20});
  assert.deepEqual(Object.values(result.assignments).sort(),['s0','s1']);assert.deepEqual(result.score.slice(0,3),[0,1,0]);checkRoster(state,result,2);
});

test('small exhaustive search can admit two waiting pupils when each single replacement ties',()=>{
  const state=fixture(4);state.settings.classRulesEnabled=false;
  state.rules=[rule('apart','separate',['s0','s1']),rule('pair','together',['s2','s3'])];
  const initial=generate(state,{iterations:0});assert.equal(initial.score[0],2);
  for(const seat of Object.keys(initial.assignments))for(const id of initial.unplaced)
    assert.equal(evaluate(state,{...initial.assignments,[seat]:id},false).score[0],2);
  // Independent enumeration includes every two-student subset and both seats.
  const seats=enabledSeats(state.settings),costs=[];
  for(const a of state.students)for(const b of state.students)if(a.id!==b.id)
    costs.push(evaluate(state,{[seats[0]]:a.id,[seats[1]]:b.id},false).score[0]);
  const result=generate(state,{iterations:1});
  assert.equal(result.score[0],Math.min(...costs));assert.equal(result.score[0],1);
  assert.deepEqual(Object.values(result.assignments).sort(),['s2','s3']);checkRoster(state,result,2);
});

test('unresolved group pairs count at their rule priority in detailed and fast evaluation',()=>{
  const state=fixture();state.settings.classRulesEnabled=false;state.settings.sections[0].to='D';
  state.rules=[rule('group','group',['s0','s1','s2'],'Voorkeur')];
  state.assignments={'A1:0':'s0','D1:0':'s1'};
  assert.equal(evaluate(state).score[1],2);assert.deepEqual(evaluate(state,{},false).score.slice(0,3),[0,3,0]);
  assert.deepEqual(evaluate(state,state.assignments,false).score,evaluate(state).score);
  state.students[2].absent=true;assert.equal(evaluate(state).score[1],0);
  state.students[2].absent=false;state.activeRoomId='one';state.studentRooms={s0:'one',s1:'one',s2:'two'};
  assert.equal(evaluate(state).score[1],0);
});

test('equal-cost overflow keeps the initial seated group and excludes absent or other-room pupils',()=>{
  const state=fixture(5);state.settings.classRulesEnabled=false;state.students[3].absent=true;
  state.activeRoomId='one';state.studentRooms={s0:'one',s1:'one',s2:'one',s3:'one',s4:'two'};
  const initial=generate(state,{iterations:0}),result=generate(state,{iterations:20});
  assert.deepEqual(Object.values(result.assignments).sort(),Object.values(initial.assignments).sort());
  assert.deepEqual(result.unplaced,['s2']);checkRoster(state,result,2);
});
