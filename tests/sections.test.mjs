import test from 'node:test';
import assert from 'node:assert/strict';
import { BENCHES, BY_BENCH, ROOM, legacyDefaults as defaults, defaultSections, sectionLabel, enabledSeats, benchPriority, containsBench, migrateState, generate, evaluate, seatBench, seatGeometry, distance } from '../src/engine.mjs';
const section=(id,from,to,enabled=true)=>({id,from,to,enabled,builtin:false});
const random=()=>{let seed=31;return()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};};
function fixture(n=8){const s=defaults();s.settings.classRulesEnabled=true;s.settings.classRules.default.type='gap';s.students=Array.from({length:n},(_,i)=>({id:`s${i}`,name:`Leerling ${i}`,class:`K${i%4}`,year:String(i%2+3),absent:false}));return s;}
test('the default order prefers A–J, L–U, V–Y, K, and retains Z',()=>{
  assert.deepEqual(defaultSections().map(sectionLabel),['A–J','L–U','V–Y','K','Z']);
  assert.equal(enabledSeats(defaults().settings).length,190);
});
test('legacy settings migrate without changing students or assigned places, converting bench locks into student pins',()=>{
  const state=fixture();state.settings.areas=['K','L–U'];delete state.settings.sections;
  state.assignments={'K3:0':'s0'};state.locks=['s0'];state.benchLocks=['K3'];
  const before=structuredClone(state),migrated=migrateState(state);
  assert.deepEqual(state,before);assert.deepEqual(migrated.assignments,before.assignments);assert.deepEqual(migrated.students,before.students);assert.deepEqual(migrated.locks,[]);assert.equal(migrated.rules.find(r=>r.type==='fixed').seat,'K3:0');assert.deepEqual(migrated.benchLocks,[]);
  assert.equal(enabledSeats(migrated.settings).length,84);assert.equal(migrated.settings.areas,undefined);
  assert.deepEqual(migrated.settings.sections.filter(s=>s.enabled).map(sectionLabel),['L–U','K']);
});
test('overlapping built-in and multiple custom ranges count each bench only once',()=>{
  const state=fixture();state.settings.sections=[section('a','A','J'),section('d','D','H'),section('l','L','U'),section('m','M','P'),section('d2','D','H')];
  const seats=enabledSeats(state.settings);assert.equal(seats.length,160);assert.equal(new Set(seats).size,160);assert.equal(new Set(seats.map(s=>seatBench(s).id)).size,80);
});
test('two custom overlaps form a union; row and individual bench switches still apply',()=>{
  const state=fixture();state.settings.sections=[section('bf','B','F'),section('eh','E','H')];
  assert.equal(enabledSeats(state.settings).length,56);
  state.settings.rows=[1,3];state.settings.disabled=['E1'];assert.equal(enabledSeats(state.settings).length,13);
});
test('disabled ranges contribute neither capacity nor preference, while another range can still include their benches',()=>{
  const state=fixture();state.settings.sections=[section('aj','A','J',false),section('dh','D','H'),section('lu','L','U')];
  assert.equal(enabledSeats(state.settings).length,120);assert.equal(benchPriority(state.settings,BY_BENCH.D1),0);assert.equal(benchPriority(state.settings,BY_BENCH.L1),1);assert.ok(!enabledSeats(state.settings).includes('A1:0'));
});
test('the first enabled overlapping range owns the preference; reordering changes that owner',()=>{
  const state=fixture();state.settings.sections=[section('lu','L','U'),section('aj','A','J'),section('dh','D','H')];
  assert.equal(benchPriority(state.settings,BY_BENCH.D1),1);
  state.settings.sections=[state.settings.sections[2],state.settings.sections[0],state.settings.sections[1]];
  assert.equal(benchPriority(state.settings,BY_BENCH.D1),0);assert.equal(benchPriority(state.settings,BY_BENCH.A1),2);
});
test('ranges never create absent benches or a seat at the teacher desk',()=>{
  const state=fixture();state.settings.sections=[section('jl','J','L'),section('vz','V','Z')];
  const seats=enabledSeats(state.settings);assert.equal(seats.length,46);assert.ok(!seats.some(s=>s.startsWith('K1:')||s.startsWith('Z1:')||s.startsWith('V7:')));
});
test('a small unconstrained plan generally starts in the preferred section and follows a changed order',()=>{
  const state=fixture(8);state.settings.classRules.default.type='none';state.settings.yearRules=[];
  let result=generate(state,{random:random(),iterations:1800});assert.ok(Object.keys(result.assignments).every(s=>seatBench(s).area==='A–J'));
  state.settings.sections=defaultSections();const lu=state.settings.sections.splice(1,1)[0];state.settings.sections.unshift(lu);
  result=generate(state,{random:random(),iterations:1800});assert.ok(Object.keys(result.assignments).every(s=>seatBench(s).area==='L–U'));
});
test('balancing can use a later section before the preferred section is full',()=>{
  const state=fixture(30);state.settings.classRules.default.type='none';state.settings.yearRules=[];
  const result=generate(state,{random:random(),iterations:1800}),benchIds=Object.keys(result.assignments).map(seatBench);
  assert.ok(benchIds.some(b=>b.area==='L–U'));assert.ok(benchIds.filter(b=>b.area==='A–J').length<40);assert.ok(benchIds.filter(b=>b.area==='A–J').length>benchIds.filter(b=>b.area==='L–U').length);
});
test('a soft student relation overrides section preference',()=>{
  const state=fixture(2);state.settings.yearRules=[];state.assignments={'Z3:0':'s0'};state.locks=['s0'];state.rules=[{id:'later',students:['s0','s1'],type:'together',priority:'Zachte voorkeur'}];
  const result=generate(state,{random:random(),iterations:1800});assert.equal(result.assignments['Z3:1'],'s1');assert.equal(result.warnings.length,0);
});
test('class separation overrides filling order and can use a later section',()=>{
  const state=fixture(6);state.students.forEach(s=>s.class='4A');state.settings.sections=[section('a','A','A'),section('lu','L','U')];
  const result=generate(state,{random:random(),iterations:1800});assert.ok(!result.warnings.some(w=>w.type==='class'));assert.ok(Object.keys(result.assignments).some(s=>seatBench(s).area==='L–U'));
});
test('arbitrary-year separation remains more important than the section preference',()=>{
  const state=fixture(4);state.settings.classRules.default.type='none';state.settings.yearRules=[{years:['7','12'],type:'separate',priority:'Voorkeur'}];state.settings.sections=[section('a','A','A'),section('k','K','K')];state.settings.rows=[1,2,3,4];state.students.forEach((s,i)=>s.year=i<2?'7':'12');
  const result=generate(state,{random:random(),iterations:1800});assert.equal(result.unplaced.length,0);assert.ok(!result.warnings.some(w=>w.type==='year'));
});
test('an exact position within a custom range overrides section preference',()=>{
  const state=fixture(1);state.rules=[{id:'custom',students:['s0'],type:'fixed',seat:'M3:1',priority:'Verplicht'}];
  const result=generate(state,{random:random(),iterations:1800});assert.equal(result.assignments['M3:1'],'s0');assert.equal(result.warnings.length,0);
});
test('overlap does not duplicate assignments or warnings even at capacity',()=>{
  const state=fixture(60);state.settings.sections=[section('bf','B','F'),section('eh','E','H')];
  const result=generate(state,{random:random(),iterations:100});assert.equal(Object.keys(result.assignments).length,56);assert.equal(new Set(Object.values(result.assignments)).size,56);assert.equal(result.unplaced.length,4);
  state.students=state.students.slice(0,2);state.students[1].class=state.students[0].class;state.settings.yearRules=[];state.assignments={'E1:0':'s0','E1:1':'s1'};
  assert.equal(evaluate(state).warnings.length,1);
});
test('later-section locks are preserved without a warning about filling order',()=>{
  const state=fixture(8);state.assignments={'Z3:0':'s0'};state.locks=['s0'];
  const result=generate(state,{random:random(),iterations:100});assert.equal(result.assignments['Z3:0'],'s0');assert.ok(!result.warnings.some(w=>/vulvolgorde/i.test(w.message)));
});
test('every chair faces the reversed direction: A–J left, L–U/V–Y/Z right, and K down',()=>{
  for(const bench of BENCHES)for(const i of [0,1]){const g=seatGeometry(bench,i);if(bench.area==='K'){assert.equal(bench.facing,'down');assert.equal(g.chairY+g.chairHeight,bench.y+10);assert.ok(g.x>=bench.x-17&&g.x+g.w<=bench.x+85);}else if(bench.area==='A–J'){assert.equal(bench.facing,'left');assert.equal(g.chairX,bench.x+67);}else{assert.equal(bench.facing,'right');assert.equal(g.chairX+g.chairWidth,bench.x-2);}}
});
test('the larger geometry leaves clear gaps between all neighbouring bench/chair groups',()=>{
  assert.ok(ROOM.rowStep>142);assert.ok(ROOM.columnStep>83);
  for(const bench of BENCHES){const next=BY_BENCH[`${bench.letter}${bench.block*2+3}`];if(next)assert.ok(next.y-(bench.y+129)>=30);assert.ok(bench.x+85<ROOM.width);assert.ok(bench.y+129<ROOM.height);}
});
test('cosmetic spacing preserves the previous distance calculations and thresholds',()=>{
  assert.equal(distance(BY_BENCH.A1,BY_BENCH.B1),1);
  assert.equal(distance(BY_BENCH.A1,BY_BENCH.A5),2);
  assert.ok(Math.abs(distance(BY_BENCH.J1,BY_BENCH.L1)-236/83)<1e-12);
  assert.ok(Math.abs(distance(BY_BENCH.U1,BY_BENCH.V3)-Math.hypot(121/83,1))<1e-12);
});
