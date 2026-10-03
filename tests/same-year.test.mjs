import test from 'node:test';
import assert from 'node:assert/strict';
import { legacyDefaults as defaults, evaluate, generate, migrateState, yearRuleFor, yearPairKey } from '../src/engine.mjs';
import { warningKey, warningGroups, reconcileHiddenWarnings } from '../src/warning-state.mjs';

function fixture(year='3') {
  const s=defaults();s.settings.classRules.default.type='none';s.settings.yearRules=[];
  s.students=Array.from({length:2},(_,i)=>({id:`s${i}`,name:`Leerling ${i}`,class:`${year}${i?'B':'A'}`,year,absent:false}));
  s.assignments={'A1:0':'s0','B1:0':'s1'};return s;
}

for(const year of ['3','4','12'])for(const type of ['none','separate','adjacent','gap','far'])test(`within year ${year}: ${type} applies the same distance semantics across classes`,()=>{
  const s=fixture(year);s.settings.yearRules=[{years:[year,year],type,priority:'Voorkeur'}];
  assert.equal(yearRuleFor(s.settings,year,year).type,type);
  const counts=['A1:1','B1:0','C1:0','G1:0'].map(seat=>evaluate(s,{'A1:0':'s0',[seat]:'s1'}).warnings.length);
  assert.deepEqual(counts,{none:[0,0,0,0],separate:[1,0,0,0],adjacent:[1,1,0,0],gap:[1,1,0,0],far:[1,1,1,0]}[type]);
  s.students[1].year='99';assert.equal(evaluate(s).warnings.length,0);
});
test('between-year far spreading uses the same measurable six-bench target',()=>{
  const s=fixture();s.students[1].year='4';s.settings.yearRules=[{years:['4','3'],type:'far',priority:'Zachte voorkeur'}];
  const w=evaluate(s).warnings[0];assert.equal(w.priority,'Zachte voorkeur');assert.match(w.message,/Zo ver mogelijk spreiden/);assert.match(w.message,/minimaal zes bankafstanden/);
  assert.equal(evaluate(s,{'A1:0':'s0','G1:0':'s1'}).warnings.length,0);
});
test('same-year rules check each distinct pupil pair exactly once and never a pupil against themselves',()=>{
  const s=fixture();s.students.push({...s.students[0],id:'s2',name:'Leerling 2'});s.assignments['A1:1']='s2';
  s.settings.yearRules=[{years:['3','3'],type:'adjacent',priority:'Verplicht'}];
  const result=evaluate(s);assert.equal(result.yearChecks,3);assert.equal(result.warnings.length,2);
  assert.equal(new Set(result.warnings.map(w=>warningKey(s,w))).size,2);assert.ok(result.warnings.every(w=>w.students.length===2&&w.students[0]!==w.students[1]));
  delete s.assignments['A1:1'];delete s.assignments['B1:0'];assert.equal(evaluate(s).yearChecks,0);assert.deepEqual(evaluate(s).warnings.map(w=>w.type),['unplaced','unplaced']);assert.deepEqual(evaluate(s).warnings.flatMap(w=>w.students),['s1','s2']);
});
test('3 ↔ 3, 4 ↔ 4, and 3 ↔ 4 are independent relationships with their own priorities',()=>{
  const s=fixture();s.settings.yearRules=[{years:['3','3'],type:'adjacent',priority:'Voorkeur'},{years:['4','4'],type:'gap',priority:'Zachte voorkeur'},{years:['4','3'],type:'separate',priority:'Verplicht'}];
  assert.equal(evaluate(s).warnings[0].priority,'Voorkeur');s.students.forEach(p=>p.year='4');assert.equal(evaluate(s).warnings[0].priority,'Zachte voorkeur');
  s.students[0].year='3';assert.equal(evaluate(s).warnings.length,0);s.assignments={'A1:0':'s0','A1:1':'s1'};assert.equal(evaluate(s).warnings[0].priority,'Verplicht');
  assert.equal(yearPairKey('3','4'),yearPairKey('4','3'));assert.notEqual(yearPairKey('3','3'),yearPairKey('3','4'));assert.equal(yearRuleFor(s.settings,'3','4'),yearRuleFor(s.settings,'4','3'));
});
test('same-year warnings retain names, exact rule, neighboring benches and both affected pupils',()=>{
  const s=fixture();s.settings.yearRules=[{years:['3','3'],type:'adjacent',priority:'Voorkeur'}];const w=evaluate(s).warnings[0];
  assert.equal(w.type,'year');assert.deepEqual(w.students,['s0','s1']);assert.deepEqual(w.benches,['A1','B1']);assert.match(w.message,/Leerling 0 en Leerling 1 uit leerjaar 3/);assert.match(w.message,/Niet direct naast elkaar/);assert.match(w.message,/direct naast elkaar op banken A 1–2 en B 1–2/);
});
for(const mode of ['ordered','random'])test(`same-year adjacency is respected in ${mode} generation and overrides compact filling`,()=>{
  const s=fixture();s.settings.placementMode=mode;s.settings.yearRules=[{years:['3','3'],type:'adjacent',priority:'Verplicht'}];
  const g=generate(s,{iterations:800});assert.equal(g.unplaced.length,0);assert.equal(Object.keys(g.assignments).length,2);assert.equal(g.warnings.length,0);
});
test('same-year importance takes precedence over a softer personal sharing rule',()=>{
  const s=fixture();s.settings.placementMode='ordered';s.settings.yearRules=[{years:['3','3'],type:'adjacent',priority:'Verplicht'}];s.rules=[{id:'t',type:'together',students:['s0','s1'],priority:'Zachte voorkeur'}];
  const g=generate(s,{iterations:500});assert.ok(!g.warnings.some(w=>w.type==='year'));assert.ok(g.warnings.some(w=>w.ruleId==='t'));
  s.settings.yearRules[0].priority='Zachte voorkeur';s.rules[0].priority='Verplicht';const reverse=generate(s,{iterations:500});assert.ok(reverse.warnings.some(w=>w.type==='year'));assert.ok(!reverse.warnings.some(w=>w.ruleId==='t'));
});
test('pinned and fixed students still yield a complete plan with a same-year warning',()=>{
  const s=fixture();s.locks=['s0'];s.rules=[{id:'f',type:'fixed',students:['s1'],seat:'B1:0',priority:'Verplicht'}];s.settings.yearRules=[{years:['3','3'],type:'adjacent',priority:'Verplicht'}];
  const g=generate(s,{iterations:50});assert.deepEqual(g.assignments,s.assignments);assert.equal(g.unplaced.length,0);assert.equal(g.warnings.length,1);assert.deepEqual(g.warnings[0].students,['s0','s1']);
});
test('same-year hidden warnings survive reload, can be restored, and disappear when resolved',()=>{
  const s=fixture();s.settings.yearRules=[{years:['3','3'],type:'adjacent',priority:'Voorkeur'}];s.hiddenWarnings=[warningKey(s,evaluate(s).warnings[0])];
  const loaded=migrateState(JSON.parse(JSON.stringify(s)));assert.equal(warningGroups(loaded,evaluate(loaded).warnings).hidden.length,1);
  loaded.hiddenWarnings=[];assert.equal(warningGroups(loaded,evaluate(loaded).warnings).active.length,1);
  loaded.hiddenWarnings=[...s.hiddenWarnings];loaded.assignments={'A1:0':'s0','C1:0':'s1'};loaded.hiddenWarnings=reconcileHiddenWarnings(loaded,evaluate(loaded).warnings);assert.deepEqual(loaded.hiddenWarnings,[]);
  loaded.assignments={...s.assignments};assert.equal(warningGroups(loaded,evaluate(loaded).warnings).active.length,1);
});
test('absent or unplaced same-year pupils create no pair warning',()=>{
  const s=fixture();s.settings.yearRules=[{years:['3','3'],type:'adjacent',priority:'Voorkeur'}];s.students[1].absent=true;assert.equal(evaluate(s).warnings.length,0);
  s.students[1].absent=false;delete s.assignments['B1:0'];assert.deepEqual(evaluate(s).warnings.map(w=>w.type),['unplaced']);assert.deepEqual(evaluate(s).warnings[0].students,['s1']);
});
