import test from 'node:test';
import assert from 'node:assert/strict';
import { defaults, legacyDefaults, generate, evaluate, orderedSeats, enabledSeats, seatBench } from '../src/engine.mjs';

function fixture(type,n=48) {
  const state=defaults();state.settings.placementMode='ordered';state.settings.classRulesEnabled=true;
  state.settings.classRules.default={type,priority:'Zachte voorkeur'};
  state.settings.yearRules=[{years:['3','4'],type:'separate',priority:'Voorkeur'}];
  state.students=Array.from({length:n},(_,i)=>({id:`p${i}`,name:`Test ${i}`,class:`${1+Math.floor(i/10)%5}${Math.floor(i/10)<5?'A':'B'}`,year:String(1+Math.floor(i/10)%5),absent:false}));
  return state;
}
function avoidableGaps(state,result) {
  const seats=orderedSeats(state.settings),rank=new Map([...new Set(seats.map(s=>seatBench(s,state.settings).id))].map((id,i)=>[id,i]));
  const bench=seat=>seatBench(seat,state.settings).id,occupied=new Set(Object.keys(result.assignments).map(bench));
  const moves=[];
  for(const target of seats.filter(seat=>!occupied.has(bench(seat))))for(const [from,id] of Object.entries(result.assignments)) {
    if(rank.get(bench(target))>=rank.get(bench(from)))continue;
    const assignments={...result.assignments,[target]:id};delete assignments[from];const score=evaluate(state,assignments,false).score;
    if(score.slice(0,-1).every((value,i)=>value<=result.score[i]+1e-8)&&score.at(-1)<result.score.at(-1)-1e-8)moves.push({from,target});
  }
  return moves;
}
test('ordered adjacency fills every usable early bench instead of leaving a random-search gap',()=>{
  const state=fixture('adjacent'),before=structuredClone(state),result=generate(state);
  assert.deepEqual(result.score,[0,0,0,0,1128]);assert.equal(result.unplaced.length,0);assert.equal(result.warnings.length,0);
  const occupied=new Set(Object.keys(result.assignments).map(seat=>seatBench(seat,state.settings).id));
  assert.deepEqual(occupied,new Set(orderedSeats(state.settings).map(seat=>seatBench(seat,state.settings).id).slice(0,96)));
  assert.deepEqual(avoidableGaps(state,result),[]);assert.deepEqual(state,before);assert.deepEqual(generate(state).assignments,result.assignments);
});
test('ordered one-bank-gap rules also leave no empty earlier bank that can be used without worsening a score',()=>{
  const state=fixture('gap'),result=generate(state);
  assert.equal(result.unplaced.length,0);assert.equal(result.warnings.length,0);assert.deepEqual(avoidableGaps(state,result),[]);
});
test('ordered fills later empty tables before keeping avoidable sharing in earlier tables',()=>{
  const state=fixture('gap',100),result=generate(state);
  const available=new Set(enabledSeats(state.settings).map(seat=>seatBench(seat,state.settings).id));
  const used=new Set(Object.keys(result.assignments).map(seat=>seatBench(seat,state.settings).id));
  assert.equal(available.size,95);assert.deepEqual(used,available);
  assert.equal(result.unplaced.length,0);assert.equal(result.warnings.length,0);assert.equal(result.score[3],5);
  assert.equal(new Set(Object.values(result.assignments)).size,100);
});
function small() {
  const state=legacyDefaults();state.settings.placementMode='ordered';state.settings.sections=[{id:'AD',from:'A',to:'D',enabled:true}];state.settings.rows=[1,2];state.settings.yearRules=[];
  state.students=[{id:'p',name:'P',class:'1A',year:'1',absent:false},{id:'q',name:'Q',class:'1A',year:'1',absent:false}];return state;
}
test('packing preserves individually pinned pupils, fixed positions and empty bench locks',()=>{
  const state=small();state.assignments={'C1:0':'p'};state.locks=['p'];state.benchLocks=['A1'];state.rules=[{id:'fixed',type:'fixed',priority:'Verplicht',students:['q'],seat:'D1:0'}];
  const result=generate(state);assert.deepEqual(result.assignments,{'C1:0':'p','D1:0':'q'});assert.equal(result.warnings.length,0);
});
test('packing preserves weekly seat preferences even when earlier empty banks would be more compact',()=>{
  const state=small(),preferredSeats={p:'C1:0',q:'D1:0'},result=generate(state,{preferredSeats});
  assert.deepEqual(result.assignments,{'C1:0':'p','D1:0':'q'});assert.equal(result.warnings.length,0);
});
test('a required empty bank remains empty when filling it would violate a seating rule',()=>{
  const state=small();state.settings.classRulesEnabled=true;state.settings.classRules.default={type:'gap',priority:'Verplicht'};
  const result=generate(state);assert.equal(result.warnings.length,0);assert.equal(result.unplaced.length,0);
  const occupied=new Set(Object.keys(result.assignments).map(seat=>seatBench(seat,state.settings).id));assert.deepEqual(occupied,new Set(['A1','C1']));
});
test('packing retains intentional sharing when a personal together rule requires it',()=>{
  const state=small();state.rules=[{id:'together',type:'together',priority:'Verplicht',students:['p','q']}];
  const result=generate(state);
  assert.equal(result.warnings.length,0);assert.equal(result.unplaced.length,0);
  assert.equal(new Set(Object.keys(result.assignments).map(seat=>seatBench(seat,state.settings).id)).size,1);
});
