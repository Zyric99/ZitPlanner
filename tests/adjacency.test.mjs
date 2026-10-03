import test from 'node:test';
import assert from 'node:assert/strict';
import { legacyDefaults as defaults, BENCHES, adjacentSeats, evaluate, generate, migrateState } from '../src/engine.mjs';
import { warningKey, warningGroups, reconcileHiddenWarnings } from '../src/warning-state.mjs';

function fixture(kind,acrossBenches) {
  const s=defaults();s.settings.classRulesEnabled=true;s.settings.classRules.default.type='none';s.settings.yearRules=[];s.students=[
    {id:'a',name:'Anna',class:'4B',year:'4',absent:false},
    {id:'b',name:'Bram',class:'4B',year:kind==='between-year'?'5':'4',absent:false}
  ];s.assignments={'A1:0':'a','B1:0':'b'};
  const rule={type:'adjacent',priority:'Verplicht',...(acrossBenches===undefined?{}:{acrossBenches})};
  if(kind==='class')s.settings.classRules.default=rule;
  if(kind==='override')s.settings.classRules.overrides['4B']=rule;
  if(kind==='same-year'||kind==='between-year')s.settings.yearRules=[{...rule,years:['4',s.students[1].year]}];
  if(kind==='personal')s.rules=[{...rule,id:'p',students:['a','b']}];
  return s;
}
for(const kind of ['class','override','same-year','between-year'])for(const across of [undefined,true,false])test(`${kind} adjacency with neighboring benches ${String(across)} checks only direct aligned seats`,()=>{
  const s=fixture(kind,across);
  for(const [seat,violation] of [['A1:1',true],['B1:0',across!==false],['A3:0',across!==false],['B1:1',false],['B3:0',false],['B3:1',false],['A5:0',false]]) {
    const assignments={'A1:0':'a',[seat]:'b'},result=evaluate(s,assignments);
    assert.equal(result.warnings.length,Number(violation),seat);
    assert.equal(evaluate(s,assignments,false).score[0],Number(violation),`optimizer score for ${seat}`);
    if(violation)assert.deepEqual(result.warnings[0].students,['a','b']);
  }
});
test('personal adjacency also ignores staggered seats and diagonal benches',()=>{
  const s=fixture('personal');assert.equal(evaluate(s).warnings.length,1);
  for(const seat of ['B1:1','B3:0','B3:1'])assert.equal(evaluate(s,{'A1:0':'a',[seat]:'b'}).warnings.length,0);
});
test('K horizontal benches exclude diagonal seats across their vertical neighbors',()=>{
  assert.equal(adjacentSeats('K3:0','K3:1'),true);
  assert.equal(adjacentSeats('K3:0','K5:0'),true);
  assert.equal(adjacentSeats('K3:1','K5:1'),true);
  assert.equal(adjacentSeats('K3:0','K5:1'),false);
  assert.equal(adjacentSeats('K3:1','K5:0'),false);
  assert.equal(adjacentSeats('K3:0','K5:0',false),false);
});
test('adjacency never crosses the wider section aisles and never compares a seat with itself',()=>{
  for(const [a,b] of [['J1:0','L1:0'],['U3:0','V3:0']])assert.equal(adjacentSeats(a,b),false);
  assert.equal(adjacentSeats('Y3:0','Z3:0'),true);
  for(const b of BENCHES)for(const side of [0,1])assert.equal(adjacentSeats(`${b.id}:${side}`,`${b.id}:${side}`),false);
});
for(const kind of ['class','same-year','between-year','personal'])test(`${kind} adjacency does not rearrange a diagonal ordered plan`,()=>{
  const s=fixture(kind,true);s.settings.placementMode='ordered';s.settings.sections=[{id:'AB',from:'A',to:'B',enabled:true}];s.settings.rows=[1,2];s.settings.ordered.startRows={A:1,B:2};
  const control=structuredClone(s);control.settings.classRules.default.type='none';control.settings.yearRules=[];control.rules=[];
  const before=generate(control,{iterations:0}),after=generate(s,{iterations:0});
  assert.deepEqual(Object.keys(before.assignments),['A1:0','B1:1']);assert.deepEqual(after.assignments,before.assignments);assert.equal(after.warnings.length,0);
  const improved=generate(s,{iterations:300});assert.deepEqual(Object.keys(improved.assignments).sort(),Object.keys(before.assignments).sort());assert.equal(improved.warnings.length,0);
});
test('disabling neighbor checks lets Ordered fill neighboring benches and keeps same-bench sharing restricted',()=>{
  const s=fixture('same-year',false);s.settings.placementMode='ordered';s.settings.rows=[1,2];
  const g=generate(s,{iterations:300});assert.deepEqual(Object.keys(g.assignments).sort(),['A1:0','B1:0']);assert.equal(g.warnings.length,0);
  s.settings.sections=[{id:'A',from:'A',to:'A',enabled:true}];s.settings.rows=[1,2];const shared=generate(s,{iterations:20});assert.equal(shared.unplaced.length,0);assert.equal(shared.warnings.length,1);assert.deepEqual(shared.warnings[0].students.sort(),['a','b']);
});
test('preferred-side normalization does not turn valid diagonals into warnings',()=>{
  const s=fixture('same-year',true);s.settings.placementMode='ordered';s.settings.sections=[{id:'AB',from:'A',to:'B',enabled:true}];s.settings.rows=[1,2];
  const g=generate(s,{iterations:300});assert.equal(g.unplaced.length,0);assert.equal(g.warnings.length,0);const seats=Object.keys(g.assignments);assert.equal(adjacentSeats(...seats),false);assert.ok(seats.some(seat=>seat.endsWith(':1')));
});
test('the new scope does not change gap, far, separate or other rules',()=>{
  const s=fixture('same-year',false);
  for(const type of ['none','separate','gap','far']) {
    s.settings.yearRules[0].type=type;const off=evaluate(s);s.settings.yearRules[0].acrossBenches=true;assert.deepEqual(evaluate(s),off);s.settings.yearRules[0].acrossBenches=false;
  }
});
test('old hidden adjacency keys survive explicit enabled scope; narrowed scope clears resolved warnings',()=>{
  const s=fixture('same-year'),warning=evaluate(s).warnings[0],key=warningKey(s,warning);s.hiddenWarnings=[key];
  s.settings.yearRules[0].acrossBenches=true;assert.equal(warningKey(s,evaluate(s).warnings[0]),key);assert.equal(warningGroups(s,evaluate(s).warnings).hidden.length,1);
  s.settings.yearRules[0].acrossBenches=false;assert.deepEqual(reconcileHiddenWarnings(s,evaluate(s).warnings),[]);
  s.assignments={'A1:0':'a','A1:1':'b'};assert.notEqual(warningKey(s,evaluate(s).warnings[0]),key);
});
test('migration and serialization preserve independent class, override and year adjacency scopes',()=>{
  const s=fixture('same-year',false);s.settings.classRules.default={type:'adjacent',priority:'Voorkeur',acrossBenches:false};s.settings.classRules.overrides['4B']={type:'adjacent',priority:'Voorkeur',acrossBenches:true};
  const loaded=migrateState(JSON.parse(JSON.stringify(s)));assert.deepEqual(loaded.settings,s.settings);
  assert.equal(loaded.settings.classRules.default.acrossBenches,false);assert.equal(loaded.settings.classRules.overrides['4B'].acrossBenches,true);assert.equal(loaded.settings.yearRules[0].acrossBenches,false);
});
