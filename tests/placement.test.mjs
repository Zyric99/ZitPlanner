import test from 'node:test';
import assert from 'node:assert/strict';
import { legacyDefaults as defaults, migrateState, defaultSections, RULE_TYPES, REMOVED_RULE_TYPES, generate, evaluate, seatBench, orderedSeats } from '../src/engine.mjs';
function rng(seed=7){return()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};}
function fixture(n=8,mode='ordered') {
  const s=defaults();s.settings.classRulesEnabled=true;s.settings.placementMode=mode;s.settings.classRules.default.type='none';s.settings.yearRules=[];
  s.students=Array.from({length:n},(_,i)=>({id:`s${i}`,name:`Leerling ${i}`,class:`K${i%4}`,year:String(i%2+3),absent:false}));return s;
}
const plan=s=>generate(s,{random:rng(),iterations:800});
const places=g=>Object.keys(g.assignments).sort();
test('only student relations and exact positioning remain as personal rules',()=>{
  for(const type of REMOVED_RULE_TYPES)assert.equal(RULE_TYPES[type],undefined);
  assert.equal(defaults().settings.placementMode,'random');
});
test('migration removes obsolete rules and pins occupants individually without retaining empty bench locks',()=>{
  const s=fixture(2);s.assignments={'A1:0':'s0','A1:1':'s1'};s.benchLocks=['A1','B1'];
  s.rules=[{id:'old',type:'front',students:['s0'],priority:'Verplicht'},{id:'keep',type:'separate',students:['s0','s1'],priority:'Voorkeur'}];
  delete s.settings.placementMode;delete s.settings.ordered;
  const m=migrateState(s);assert.deepEqual(m.assignments,s.assignments);assert.deepEqual(m.locks,[]);assert.deepEqual(m.rules.filter(r=>r.type==='fixed').map(r=>[r.students[0],r.seat]),[['s0','A1:0'],['s1','A1:1']]);assert.deepEqual(m.benchLocks,[]);assert.deepEqual(m.rules.filter(r=>r.type!=='fixed'),[s.rules[1]]);assert.equal(m.settings.placementMode,'random');
  const g=plan(m);assert.equal(g.assignments['A1:0'],'s0');assert.equal(g.assignments['A1:1'],'s1');assert.equal(s.locks.length,0);
});
test('ordered mode fills successive banks in each column, without unnecessary row gaps',()=>{
  const s=fixture(8),g=plan(s);assert.deepEqual(places(g),['A1:0','A3:0','A5:0','A7:0','B1:0','B3:0','B5:0','B7:0']);assert.equal(g.warnings.length,0);
});
test('ordered mode is repeatable including student assignments',()=>{const s=fixture(20);assert.deepEqual(plan(s).assignments,generate(s,{random:rng(500),iterations:800}).assignments);});
test('ordered settings support row-first filling and both directions within section priority',()=>{
  const s=fixture(3);s.settings.ordered={axis:'rows',horizontal:'right',vertical:'bottom',seatSide:1};
  assert.deepEqual(places(plan(s)),['H7:1','I7:1','J7:1']);
  s.settings.ordered.axis='columns';assert.deepEqual(places(plan(s)),['J3:1','J5:1','J7:1']);
});
test('reordered and overlapping column ranges still determine a unique ordered preference',()=>{
  const s=fixture(3);s.settings.sections=[{id:'m',from:'M',to:'N',enabled:true},{id:'all',from:'A',to:'Z',enabled:true}];
  assert.deepEqual(places(plan(s)),['M1:0','M3:0','M5:0']);assert.equal(new Set(orderedSeats(s.settings)).size,190);
});
test('disabled rows, banks and sections are skipped compactly',()=>{
  const s=fixture(3);s.settings.sections=defaultSections(['A–J']);s.settings.rows=[1,5,7];s.settings.disabled=['A5'];
  assert.deepEqual(places(plan(s)),['A1:0','A7:0','B1:0']);
});
test('both modes keep single students on the same preferred side',()=>{
  for(const mode of ['random','ordered'])for(const side of [0,1]){
    const s=fixture(25,mode);s.settings.ordered.seatSide=side;const g=plan(s);
    assert.ok(Object.keys(g.assignments).every(seat=>seat.endsWith(`:${side}`)));
    assert.equal(new Set(Object.keys(g.assignments).map(s=>seatBench(s).id)).size,25);
  }
});
test('disabled preferred seats naturally use the other seat',()=>{const s=fixture(3);s.settings.rows=[2,4,6,8];assert.ok(Object.keys(plan(s).assignments).every(seat=>seat.endsWith(':1')));});
test('the second seat is used once sharing is necessary',()=>{const s=fixture(3);s.settings.sections=defaultSections(['K']);const g=plan(s);assert.equal(Object.keys(g.assignments).length,3);assert.equal(new Set(Object.keys(g.assignments).map(seatBench)).size,2);});
test('random regeneration produces visibly different complete suitable arrangements',()=>{
  const s=fixture(24,'random'),a=generate(s,{random:rng(1),iterations:800}),b=generate(s,{random:rng(8),iterations:800});
  assert.equal(a.warnings.length,0);assert.equal(b.warnings.length,0);assert.equal(Object.keys(a.assignments).length,24);
  assert.ok(Object.keys(a.assignments).filter(seat=>a.assignments[seat]!==b.assignments[seat]).length>=12);
  assert.notDeepEqual(places(a),places(b));
});
test('a student pin preserves precisely one place and leaves its bench partner available',()=>{
  const s=fixture(4);s.settings.sections=defaultSections(['K']);s.assignments={'K3:1':'s0'};s.locks=['s0'];
  const g=plan(s);assert.equal(g.assignments['K3:1'],'s0');assert.ok(g.assignments['K3:0']);assert.equal(Object.keys(g.assignments).length,4);
});
test('fixed positions preserve the specified seat even in a later column and on the other side',()=>{
  for(const mode of ['random','ordered']){const s=fixture(8,mode);s.rules=[{id:'fixed',type:'fixed',students:['s0'],seat:'Z3:1',priority:'Verplicht'}];const g=plan(s);assert.equal(g.assignments['Z3:1'],'s0');assert.ok(!g.warnings.some(w=>w.ruleId==='fixed'));}
});
test('fixed positions on disabled places remain assigned with student warning diagnostics',()=>{
  const s=fixture(2);s.rules=[{id:'fixed',type:'fixed',students:['s0'],seat:'A1:1',priority:'Verplicht'}];s.settings.disabled=['A1'];
  const g=plan(s);assert.equal(g.assignments['A1:1'],'s0');assert.ok(g.warnings.some(w=>w.type==='unavailable'&&w.benches.includes('A1')));assert.equal(g.unplaced.length,0);
});
test('incompatible pins and fixed positions are reported with both affected benches',()=>{
  const s=fixture(2);s.assignments={'A1:0':'s0'};s.locks=['s0'];s.rules=[{id:'fixed',type:'fixed',students:['s0'],seat:'Z3:1',priority:'Verplicht'}];
  const g=plan(s),warning=g.warnings.find(w=>w.ruleId==='fixed');assert.equal(g.assignments['A1:0'],'s0');assert.deepEqual(warning.benches.sort(),['A1','Z3']);assert.ok(warning.students.includes('s0'));
});
test('colliding fixed-position rules keep a full plan and explain the conflict',()=>{
  const s=fixture(3);s.rules=['s0','s1'].map(id=>({id,type:'fixed',students:[id],seat:'A1:0',priority:'Verplicht'}));const g=plan(s);
  assert.equal(Object.keys(g.assignments).length,3);assert.equal(g.assignments['A1:0'],'s0');const w=g.warnings.find(w=>w.ruleId==='s1');assert.ok(w);assert.ok(w.benches.includes('A1'));assert.deepEqual(w.students,['s1']);
});
test('unplaced fixed students produce a warning, absent ones make their rule inactive',()=>{
  const s=fixture(1);s.rules=[{id:'fixed',type:'fixed',students:['s0'],seat:'K3:1',priority:'Verplicht'}];
  assert.equal(evaluate(s).warnings[0].type,'fixed');assert.deepEqual(evaluate(s).warnings[0].benches,['K3']);s.students[0].absent=true;assert.equal(evaluate(s).inactive,1);assert.equal(evaluate(s).warnings.length,0);
});
test('ordered filling leaves a necessary gap for compulsory separation',()=>{
  const s=fixture(2);s.rules=[{id:'gap',type:'gap',students:['s0','s1'],priority:'Verplicht'}];
  const g=plan(s);assert.deepEqual(places(g),['A1:0','A5:0']);assert.equal(g.warnings.length,0);
});
test('ordered filling respects class and year separation over compactness',()=>{
  // B3 now fits diagonally between A1 and A5 without breaking the gap rule.
  const s=fixture(3);s.settings.classRules.default.type='gap';s.students.forEach(p=>p.class='3A');const g=plan(s);assert.equal(g.warnings.length,0);assert.deepEqual(places(g),['A1:0','A5:0','B3:0']);
  const y=fixture(4);y.settings.sections=defaultSections(['K']);y.settings.yearRules=[{years:['3','4'],type:'separate',priority:'Voorkeur'}];const mixed=plan(y);assert.equal(mixed.warnings.length,0);
});
test('fixed-position conflicts with class and year separation still produce a complete plan',()=>{
  const s=fixture(2);s.settings.yearRules=[{years:['3','4'],type:'separate',priority:'Voorkeur'}];s.rules=[...s.students.map((p,i)=>({id:`f${i}`,type:'fixed',students:[p.id],seat:`A1:${i}`,priority:'Verplicht'})),{id:'separate',type:'separate',students:['s0','s1'],priority:'Verplicht'}];
  const g=plan(s);assert.equal(g.unplaced.length,0);assert.ok(g.warnings.some(w=>w.type==='year'));assert.ok(g.warnings.some(w=>w.ruleId==='separate'));assert.ok(g.warnings.every(w=>w.benches.includes('A1')));
});
test('each column begins at its own configured row, also in row-first mode',()=>{
  const s=fixture(4);s.settings.sections=[{id:'ad',from:'A',to:'D',enabled:true}];s.settings.ordered.axis='rows';s.settings.ordered.startRows={A:2,B:5,C:1,D:6};
  const g=plan(s);assert.deepEqual(places(g),['A1:1','B5:0','C1:0','D5:1']);assert.equal(g.warnings.length,0);
});
test('column-first filling continues compactly and wraps through all other benches',()=>{
  const s=fixture(4);s.settings.sections=[{id:'a',from:'A',to:'A',enabled:true}];s.settings.ordered.startRows={A:6};
  assert.deepEqual(orderedSeats(s.settings).filter(seat=>seat.endsWith(':1')),['A5:1','A7:1','A1:1','A3:1']);
  assert.deepEqual(places(plan(s)),['A1:1','A3:1','A5:1','A7:1']);
  s.students=s.students.slice(0,2);assert.deepEqual(places(plan(s)),['A5:1','A7:1']);
});
test('starting-row order follows the downward or upward filling direction',()=>{
  const s=fixture(2);s.settings.sections=[{id:'a',from:'A',to:'A',enabled:true}];s.settings.ordered.startRows={A:5};
  assert.deepEqual(places(plan(s)),['A5:0','A7:0']);s.settings.ordered.vertical='bottom';assert.deepEqual(places(plan(s)),['A3:0','A5:0']);
});
test('unavailable starting rows fall forward to a suitable place rather than restricting capacity',()=>{
  const s=fixture(1);s.settings.sections=[{id:'a',from:'A',to:'A',enabled:true}];s.settings.ordered.startRows={A:2};s.settings.rows=[1,3,4,5,6,7,8];
  assert.deepEqual(places(plan(s)),['A3:0']);
  s.settings.rows=[1,2,3,4,5,6,7,8];s.settings.disabled=['A1'];assert.deepEqual(places(plan(s)),['A3:0']);
  s.students=fixture(6).students;const g=plan(s);assert.equal(Object.keys(g.assignments).length,6);assert.equal(g.unplaced.length,0);
});
test('columns with missing physical benches find their next valid row and wrap',()=>{
  const s=fixture(1);s.settings.sections=defaultSections(['K']);s.settings.ordered.startRows={K:1};assert.deepEqual(places(plan(s)),['K3:0']);
  s.settings.ordered.startRows={K:8};assert.deepEqual(places(plan(s)),['K3:0']);
  s.settings.sections=defaultSections(['Z']);s.settings.ordered.startRows={Z:6};assert.deepEqual(places(plan(s)),['Z3:0']);
});
test('starting rows coexist with overlapping and disabled ranges without duplicate seats',()=>{
  const s=fixture(2);s.settings.sections=[{id:'off',from:'A',to:'D',enabled:false},{id:'bc',from:'B',to:'C',enabled:true},{id:'bd',from:'B',to:'D',enabled:true}];s.settings.ordered.startRows={A:2,B:5,C:1,D:6};
  const g=plan(s);assert.deepEqual(places(g),['B5:0','B7:0']);assert.equal(new Set(orderedSeats(s.settings)).size,24);
  s.settings.sections.unshift({id:'cfirst',from:'C',to:'C',enabled:true});assert.deepEqual(places(plan(s)),['C1:0','C3:0']);
});
test('column starting rows do not move pinned or fixed-position students',()=>{
  const s=fixture(3);s.settings.ordered.startRows={A:6};s.assignments={'A1:0':'s0'};s.locks=['s0'];s.rules=[{id:'fixed',type:'fixed',students:['s1'],seat:'A3:0',priority:'Verplicht'}];
  const g=plan(s);assert.equal(g.assignments['A1:0'],'s0');assert.equal(g.assignments['A3:0'],'s1');assert.equal(g.assignments['A5:1'],'s2');assert.equal(g.warnings.length,0);
});
test('personal separation, class and year rules override column row preferences',()=>{
  const s=fixture(2);s.settings.ordered.startRows={A:2};s.rules=[{id:'gap',type:'gap',students:['s0','s1'],priority:'Verplicht'}];assert.deepEqual(places(plan(s)),['A1:1','A5:1']);
  s.rules=[];s.settings.classRules.default.type='gap';s.students.forEach(p=>p.class='3A');assert.equal(plan(s).warnings.length,0);
  s.settings.classRules.default.type='none';s.settings.yearRules=[{years:['3','4'],type:'separate',priority:'Voorkeur'}];s.settings.sections=defaultSections(['K']);s.settings.ordered.startRows={K:4};s.students=fixture(4).students;assert.equal(plan(s).warnings.length,0);
});
test('Random ignores per-column starting rows',()=>{
  const s=fixture(20,'random'),before=plan(s);s.settings.ordered.startRows={A:6,B:5,C:1,D:6};assert.deepEqual(plan(s).assignments,before.assignments);
});
test('migration defaults missing starting rows and preserves stored column preferences',()=>{
  const s=fixture();delete s.settings.ordered.startRows;assert.deepEqual(migrateState(s).settings.ordered.startRows,{});
  s.settings.ordered.startRows={A:2,K:8,Z:6};assert.deepEqual(migrateState(s).settings.ordered.startRows,{A:2,K:8,Z:6});assert.deepEqual(s.settings.ordered.startRows,{A:2,K:8,Z:6});
});
