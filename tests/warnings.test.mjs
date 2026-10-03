import test from 'node:test';
import assert from 'node:assert/strict';
import { legacyDefaults as defaults, evaluate, migrateState, generate } from '../src/engine.mjs';
import { warningKey, warningGroups, aggregateUnplacedWarnings, reconcileHiddenWarnings } from '../src/warning-state.mjs';

function fixture() {
  const s=defaults();s.settings.classRulesEnabled=true;s.settings.classRules.default.type='gap';s.students=[
    {id:'a',name:'Anna',class:'3A',year:'3',absent:false},
    {id:'b',name:'Bram',class:'3A',year:'4',absent:false},
    {id:'c',name:'Cleo',class:'5C',year:'5',absent:false}
  ];s.assignments={'A1:0':'a','A1:1':'b','B1:0':'c'};return s;
}
const hideAll=s=>s.hiddenWarnings=evaluate(s).warnings.map(w=>warningKey(s,w));

test('multiple unplaced warnings form one display entry while retaining individual warning keys',()=>{
  const s=fixture();s.assignments={};s.rules=[];s.settings.classRulesEnabled=false;s.settings.yearRulesEnabled=false;
  const warnings=evaluate(s).warnings,groups=warningGroups(s,warnings),before=structuredClone(warnings),display=aggregateUnplacedWarnings(groups.active);
  assert.equal(warnings.length,3);assert.equal(display.length,1);assert.deepEqual(display[0].indices,[0,1,2]);assert.deepEqual(display[0].warning.students,['a','b','c']);assert.match(display[0].warning.message,/3 leerlingen/);assert.ok(!display[0].warning.message.includes('Anna'));assert.deepEqual(warnings,before);
  s.hiddenWarnings=display[0].indices.map(index=>warningKey(s,warnings[index]));assert.equal(warningGroups(s,warnings).active.length,0);assert.equal(aggregateUnplacedWarnings(warningGroups(s,warnings).hidden).length,1);
  s.assignments={'A1:0':'a','B1:0':'b'};s.hiddenWarnings=reconcileHiddenWarnings(s,evaluate(s).warnings);assert.equal(s.hiddenWarnings.length,1);const single=warningGroups(s,evaluate(s).warnings).hidden;assert.equal(aggregateUnplacedWarnings(single),single);assert.match(single[0].warning.message,/Cleo/);
});

test('unplaced display aggregation preserves other rule warnings and separate hidden preferences',()=>{
  const s=fixture();delete s.assignments['A1:1'];delete s.assignments['B1:0'];s.rules=[{id:'required-location',type:'fixed',students:['b'],seat:'A1:0',priority:'Verplicht'}];
  const warnings=evaluate(s).warnings,groups=warningGroups(s,warnings),display=aggregateUnplacedWarnings(groups.active);
  assert.equal(display.length,2);assert.equal(display[0].warning.type,'fixed');assert.equal(display[1].warning.type,'unplaced');
  const one=warnings.find(w=>w.type==='unplaced');s.hiddenWarnings=[warningKey(s,one)];const mixed=warningGroups(s,warnings);assert.equal(aggregateUnplacedWarnings(mixed.active).length,2);assert.equal(aggregateUnplacedWarnings(mixed.hidden).length,1);
});

test('hidden warnings remain evaluated, keep full details and leave scoring and generation unchanged',()=>{
  const s=fixture(),before=evaluate(s),generated=generate({...s,settings:{...s.settings,placementMode:'ordered'}},{iterations:20});hideAll(s);
  const after=evaluate(s);assert.deepEqual(after,before);
  const groups=warningGroups(s,after.warnings);assert.equal(groups.active.length,0);assert.equal(groups.hidden.length,2);
  assert.deepEqual(groups.hidden.map(x=>x.warning),before.warnings);
  assert.deepEqual(generate({...s,settings:{...s.settings,placementMode:'ordered'}},{iterations:20}),generated);
});
test('hiding one overlapping violation leaves the other active for both pupils',()=>{
  const s=fixture(),warnings=evaluate(s).warnings;s.hiddenWarnings=[warningKey(s,warnings[0])];
  const groups=warningGroups(s,warnings);assert.equal(groups.hidden.length,1);assert.equal(groups.active.length,1);
  assert.deepEqual(groups.active[0].warning.students,['a','b']);assert.ok(!groups.active[0].warning.students.includes('c'));
});
test('a continuous violation stays hidden through seat swaps and changes of bench',()=>{
  const s=fixture();hideAll(s);const keys=[...s.hiddenWarnings];
  s.assignments={'H5:0':'b','H5:1':'a','B1:0':'c'};
  assert.deepEqual(reconcileHiddenWarnings(s,evaluate(s).warnings).sort(),keys.sort());
  assert.equal(warningGroups(s,evaluate(s).warnings).active.length,0);
  assert.ok(evaluate(s).warnings.every(w=>w.benches.includes('H5')));
});
test('resolved hidden violations are pruned and a later recurrence is active',()=>{
  const s=fixture();hideAll(s);s.assignments={'A1:0':'a','H1:0':'b','B1:0':'c'};
  s.hiddenWarnings=reconcileHiddenWarnings(s,evaluate(s).warnings);assert.deepEqual(s.hiddenWarnings,[]);
  s.assignments={'A1:0':'a','A1:1':'b','B1:0':'c'};
  const groups=warningGroups(s,evaluate(s).warnings);assert.equal(groups.active.length,2);assert.equal(groups.hidden.length,0);
});
test('changing the effective rule exposes a new violation without losing other hidden warnings',()=>{
  const s=fixture();hideAll(s);s.settings.classRules.default.type='separate';
  const warnings=evaluate(s).warnings;s.hiddenWarnings=reconcileHiddenWarnings(s,warnings);
  const groups=warningGroups(s,warnings);assert.equal(groups.active.length,1);assert.equal(groups.active[0].warning.type,'class');assert.equal(groups.hidden[0].warning.type,'year');
});
test('two different rules for the same pupils can be hidden and restored independently',()=>{
  const s=fixture();s.settings.classRules.default.type='none';s.settings.yearRules=[];
  s.rules=['r1','r2'].map(id=>({id,type:'separate',students:['a','b'],priority:'Verplicht'}));hideAll(s);
  assert.equal(new Set(s.hiddenWarnings).size,2);s.hiddenWarnings.shift();
  const groups=warningGroups(s,evaluate(s).warnings);assert.equal(groups.active[0].warning.ruleId,'r1');assert.equal(groups.hidden[0].warning.ruleId,'r2');
});
test('a fixed-position violation identifies only its subject, including when unplaced',()=>{
  const s=fixture();s.settings.classRules.default.type='none';s.settings.yearRules=[];
  s.rules=[{id:'fixed',type:'fixed',students:['b'],seat:'A1:0',priority:'Verplicht'}];
  const w=evaluate(s).warnings[0];assert.deepEqual(w.students,['b']);assert.deepEqual(w.benches,['A1']);assert.match(w.message,/Bram hoort/);
  s.assignments={'A1:0':'a','H1:0':'b'};const moved=evaluate(s).warnings[0];assert.deepEqual(moved.students,['b']);assert.deepEqual(new Set(moved.benches),new Set(['A1','H1']));
  s.hiddenWarnings=[warningKey(s,moved)];delete s.assignments['H1:0'];
  const unplaced=evaluate(s).warnings[0];assert.deepEqual(unplaced.students,['b']);assert.match(unplaced.message,/nog niet geplaatst/);assert.equal(warningGroups(s,[unplaced]).hidden.length,1);
});
test('unavailable-seat warnings affect only the occupant of the disabled row',()=>{
  const s=fixture();s.settings.classRules.default.type='none';s.settings.yearRules=[];s.settings.rows=[2,3,4,5,6,7,8];
  const warnings=evaluate(s).warnings.filter(w=>w.benches.includes('A1'));assert.equal(warnings.length,1);assert.deepEqual(warnings[0].students,['a']);
});
test('removing a rule or making its pupil absent removes its hidden warning',()=>{
  const s=fixture();hideAll(s);s.settings.classRules.default.type='none';
  s.hiddenWarnings=reconcileHiddenWarnings(s,evaluate(s).warnings);assert.equal(s.hiddenWarnings.length,1);
  s.students[1].absent=true;assert.deepEqual(reconcileHiddenWarnings(s,evaluate(s).warnings),[]);
});
test('migration and project serialization preserve hidden warnings and old plans default to none',()=>{
  const s=fixture();hideAll(s);const saved=JSON.parse(JSON.stringify(s)),migrated=migrateState(saved);
  assert.deepEqual(migrated.hiddenWarnings,s.hiddenWarnings);assert.equal(warningGroups(migrated,evaluate(migrated).warnings).hidden.length,2);
  delete saved.hiddenWarnings;assert.deepEqual(migrateState(saved).hiddenWarnings,[]);
});
