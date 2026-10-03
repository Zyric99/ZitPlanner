import test from 'node:test';
import assert from 'node:assert/strict';
import { defaults as freshDefaults, legacyDefaults as defaults, evaluate, generate, migrateState } from '../src/engine.mjs';
import { warningKey, warningGroups, reconcileHiddenWarnings } from '../src/warning-state.mjs';
function fixture() {
  const s=defaults();s.students=[{id:'a',name:'Anna',class:'4B',year:'3',absent:false},{id:'b',name:'Bram',class:'4B',year:'4',absent:false}];s.assignments={'A1:0':'a','A1:1':'b'};
  s.settings.classRules={default:{type:'gap',priority:'Verplicht'},overrides:{'4B':{type:'adjacent',priority:'Voorkeur',acrossBenches:false}}};s.settings.classRulesEnabled=true;
  return s;
}
test('fresh setup starts without automatically added relations between different years',()=>{
  const s=freshDefaults();assert.equal(s.settings.classRulesEnabled,false);assert.equal(s.settings.studentRulesEnabled,false);assert.equal(s.settings.classRules.default.type,'none');assert.equal(s.settings.yearRulesEnabled,true);assert.deepEqual(s.settings.yearRules,[]);
});
for(const category of ['class','year'])test(`${category} master switch suspends scores, checks and warnings while preserving configuration`,()=>{
  const s=fixture(),snapshot=structuredClone(s.settings),before=evaluate(s);assert.ok(before.warnings.some(w=>w.type===category));
  s.settings[`${category}RulesEnabled`]=false;const off=evaluate(s);assert.ok(!off.warnings.some(w=>w.type===category));assert.equal(off[`${category}Checks`],0);assert.ok(off.warnings.some(w=>w.type!==category));
  assert.deepEqual(s.settings.classRules,snapshot.classRules);assert.deepEqual(s.settings.yearRules,snapshot.yearRules);
  s.settings[`${category}RulesEnabled`]=true;assert.deepEqual(evaluate(s),before);
});
test('disabling both categories leaves student-specific, unavailable and fixed warnings active',()=>{
  const s=fixture();s.settings.classRulesEnabled=s.settings.yearRulesEnabled=false;s.settings.disabled=['A1'];s.rules=[{id:'pair',type:'separate',students:['a','b'],priority:'Verplicht'},{id:'fixed',type:'fixed',students:['a'],seat:'C1:0',priority:'Verplicht'}];
  const result=evaluate(s);assert.deepEqual(result.warnings.map(w=>w.type).sort(),['fixed','separate','unavailable','unavailable']);assert.equal(result.classChecks,0);assert.equal(result.yearChecks,0);
});
for(const category of ['class','year'])for(const mode of ['random','ordered'])test(`disabled ${category} settings do not influence ${mode} placement`,()=>{
  const s=fixture();s.settings.placementMode=mode;s.settings[`${category}RulesEnabled`]=false;
  const control=structuredClone(s);if(category==='class')control.settings.classRules={default:{type:'none',priority:'Voorkeur'},overrides:{}};else control.settings.yearRules=[];
  const rng=()=>{let seed=31;return()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};};
  const a=generate(s,{iterations:200,random:rng()}),b=generate(control,{iterations:200,random:rng()});assert.deepEqual(a,b);assert.equal(a.unplaced.length,0);
});
test('old plans acquire enabled master flags and preserve their custom settings and placement',()=>{
  const s=fixture();delete s.settings.classRulesEnabled;delete s.settings.yearRulesEnabled;const migrated=migrateState(s);
  assert.equal(migrated.settings.classRulesEnabled,true);assert.equal(migrated.settings.yearRulesEnabled,true);assert.deepEqual(migrated.settings.classRules,s.settings.classRules);assert.deepEqual(migrated.settings.yearRules,s.settings.yearRules);assert.deepEqual(migrated.assignments,s.assignments);assert.deepEqual(evaluate(migrated),evaluate(s));
});
test('saved master states survive serialization and migration, including explicit OFF',()=>{
  const s=fixture();s.settings.classRulesEnabled=s.settings.yearRulesEnabled=s.settings.studentRulesEnabled=false;const migrated=migrateState(JSON.parse(JSON.stringify(s)));assert.deepEqual(migrated.settings,s.settings);
});
test('student switch suspends personal and fixed warnings, preserves rules and restores checking',()=>{
  const s=fixture();s.rules=[{id:'pair',type:'separate',students:['a','b'],priority:'Verplicht'},{id:'fixed',type:'fixed',students:['a'],seat:'C1:0',priority:'Verplicht'}];
  const rules=structuredClone(s.rules),before=evaluate(s);assert.equal(before.evaluated,2);
  s.settings.studentRulesEnabled=false;const off=evaluate(s);assert.equal(off.evaluated,0);assert.deepEqual(off.warnings.map(w=>w.type).sort(),['class','year']);assert.deepEqual(s.rules,rules);
  s.settings.studentRulesEnabled=true;assert.deepEqual(evaluate(s),before);
});
for(const mode of ['random','ordered'])test(`disabled personal rules do not influence ${mode} placement, while pins remain active`,()=>{
  const s=fixture();s.settings.placementMode=mode;s.settings.studentRulesEnabled=false;s.locks=['b'];s.rules=[{id:'together',type:'together',students:['a','b'],priority:'Verplicht'},{id:'fixed',type:'fixed',students:['a'],seat:'C1:0',priority:'Verplicht'}];
  const control=structuredClone(s);control.rules=[];
  const rng=()=>{let seed=31;return()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};};
  const a=generate(s,{iterations:200,random:rng()}),b=generate(control,{iterations:200,random:rng()});assert.deepEqual(a,b);assert.equal(a.assignments['A1:1'],'b');
});
test('legacy plans enable personal rules and preserve their existing behavior',()=>{
  const s=fixture();delete s.settings.studentRulesEnabled;s.rules=[{id:'pair',type:'separate',students:['a','b'],priority:'Verplicht'}];const migrated=migrateState(s);
  assert.equal(migrated.settings.studentRulesEnabled,true);assert.deepEqual(migrated.rules,s.rules);assert.deepEqual(evaluate(migrated),evaluate(s));
});
test('hidden personal warnings survive suspension and are rechecked on reactivation',()=>{
  const s=fixture();s.rules=[{id:'pair',type:'separate',students:['a','b'],priority:'Verplicht'}];s.hiddenWarnings=evaluate(s).warnings.filter(w=>w.ruleId==='pair').map(w=>warningKey(s,w));const saved=[...s.hiddenWarnings];assert.equal(saved.length,1);
  s.settings.studentRulesEnabled=false;assert.deepEqual(reconcileHiddenWarnings(s,evaluate(s).warnings),saved);
  s.settings.studentRulesEnabled=true;assert.equal(warningGroups(s,evaluate(s).warnings).hidden.length,1);
  s.settings.studentRulesEnabled=false;s.rules=[];assert.deepEqual(reconcileHiddenWarnings(s,evaluate(s).warnings),[]);
});
test('hidden warning preferences survive a temporary category suspension',()=>{
  const s=fixture();s.hiddenWarnings=evaluate(s).warnings.map(w=>warningKey(s,w));const saved=[...s.hiddenWarnings];
  s.settings.classRulesEnabled=s.settings.yearRulesEnabled=false;s.hiddenWarnings=reconcileHiddenWarnings(s,evaluate(s).warnings);assert.deepEqual(s.hiddenWarnings,saved);assert.equal(warningGroups(s,evaluate(s).warnings).hidden.length,0);
  s.settings.classRulesEnabled=s.settings.yearRulesEnabled=true;assert.equal(warningGroups(s,evaluate(s).warnings).hidden.length,2);
  s.settings.classRulesEnabled=s.settings.yearRulesEnabled=false;s.assignments={'A1:0':'a','H1:0':'b'};s.settings.classRulesEnabled=s.settings.yearRulesEnabled=true;s.hiddenWarnings=reconcileHiddenWarnings(s,evaluate(s).warnings);assert.deepEqual(s.hiddenWarnings,[]);
});
