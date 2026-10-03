import test from 'node:test';
import assert from 'node:assert/strict';
import { defaults, legacyDefaults, evaluate, generate, benchesFor, distance } from '../src/engine.mjs';

function fixture(grid,scope='personal') {
  const state=grid?defaults():legacyDefaults();
  state.settings.classRulesEnabled=false;
  state.settings.yearRulesEnabled=false;
  state.settings.studentRulesEnabled=true;
  state.students=[
    {id:'a',name:'Anna',class:'3A',year:'3',absent:false},
    {id:'b',name:'Bram',class:'3A',year:'3',absent:false}
  ];
  const rule={type:'gap',priority:'Verplicht'};
  if(scope==='personal'||scope==='group')state.rules=[{...rule,id:'gap',students:['a','b'],type:scope==='group'?'group':'gap'}];
  if(scope==='class'||scope==='override') {
    state.settings.classRulesEnabled=true;
    if(scope==='class')state.settings.classRules.default=rule;
    else state.settings.classRules.overrides={'3A':rule};
  }
  if(scope==='within-year'||scope==='between-year') {
    if(scope==='between-year')state.students[1].year='4';
    state.settings.yearRulesEnabled=true;
    state.settings.yearRules=[{...rule,years:scope==='within-year'?['3','3']:['3','4']}];
  }
  return state;
}
const seat=(grid,column,row,index=0)=>`${grid?'grid-':''}${column}${grid?row:row*2-1}:${index}`;
const warnings=(state,first,second)=>evaluate(state,{[first]:'a',[second]:'b'}).warnings;
function rng(seed=71){return()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};}

for(const grid of [false,true])for(const scope of ['personal','group','class','override','within-year','between-year']) {
  test(`${grid?'grid':'legacy'} ${scope} gap accepts diagonals but rejects directly neighbouring tables`,()=>{
    const state=fixture(grid,scope),origin=seat(grid,'A',1);
    for(const target of [seat(grid,'A',1,1),seat(grid,'B',1),seat(grid,'A',2)]) {
      assert.equal(warnings(state,origin,target).length,1,`${origin} → ${target}`);
    }
    for(const target of [seat(grid,'B',2),seat(grid,'C',1),seat(grid,'A',3)]) {
      assert.equal(warnings(state,origin,target).length,0,`${origin} → ${target}`);
      assert.equal(warnings(state,target,origin).length,0,`${target} → ${origin}`);
    }
    // Both diagonal slopes are valid, independently of which seat is used.
    assert.equal(warnings(state,seat(grid,'A',2,1),seat(grid,'B',1,1)).length,0);
  });
}

for(const grid of [false,true])for(const mode of ['ordered','random']) {
  test(`${grid?'grid':'legacy'} ${mode} generation uses the only valid diagonal with a pinned student`,()=>{
    const state=fixture(grid,'class');
    state.settings.placementMode=mode;
    const allowed=new Set(['A','B'].flatMap(column=>[1,2].map(row=>seat(grid,column,row).split(':')[0])));
    state.settings.disabled=benchesFor(state.settings).filter(b=>!allowed.has(b.id)).map(b=>b.id);
    const origin=seat(grid,'A',1),diagonal=seat(grid,'B',2);
    state.assignments={[origin]:'a'};state.locks=['a'];
    const before=structuredClone(state);
    const result=generate(state,{iterations:200,random:rng()});
    assert.equal(result.assignments[origin],'a');
    assert.ok([diagonal,diagonal.replace(':0',':1')].some(s=>result.assignments[s]==='b'));
    assert.equal(result.unplaced.length,0);
    assert.equal(result.warnings.length,0);
    assert.deepEqual(state,before);
  });
}

test('grid diagonal gaps ignore visual position, facing and single-seat capacity',()=>{
  const state=fixture(true),first=seat(true,'A',1),second=seat(true,'B',2);
  state.settings.layout=structuredClone(state.settings.layout);
  for(const table of state.settings.layout.benches.filter(b=>[first.split(':')[0],second.split(':')[0]].includes(b.id))) {
    table.gx=10;table.gy=10;table.facing='up';table.capacity=1;
  }
  assert.equal(warnings(state,first,second).length,0);
  assert.equal(warnings(state,first,seat(true,'B',1)).length,1);
});

test('diagonal gap changes leave straight-line near and far distances unchanged',()=>{
  for(const grid of [false,true]) {
    const state=fixture(grid),benches=benchesFor(state.settings);
    const first=seat(grid,'A',1),second=seat(grid,'B',2);
    const a=benches.find(b=>b.id===first.split(':')[0]),b=benches.find(b=>b.id===second.split(':')[0]);
    const diagonalDistance=Math.SQRT2*(grid?1.2:1);
    assert.ok(Math.abs(distance(a,b)-diagonalDistance)<1e-12);
    state.rules[0].type='far';
    assert.ok(Math.abs(evaluate(state,{[first]:'a',[second]:'b'}).score[0]-(6-diagonalDistance)/6)<1e-12);
    state.rules[0].type='near';
    assert.equal(warnings(state,first,second).length,grid?1:0);
  }
});
