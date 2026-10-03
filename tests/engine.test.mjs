import test from 'node:test';
import assert from 'node:assert/strict';
import { BENCHES, legacyDefaults as defaults, enabledSeats, generate, evaluate, parseStudents, sampleStudents, seatBench, defaultSections } from '../src/engine.mjs';
function rng(seed=7) { return ()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;}; }
function fixture(n=10) { const s=defaults();s.settings.classRulesEnabled=true;s.settings.classRules.default.type='gap';s.students=sampleStudents().slice(0,n);return s; }
test('the reference has exactly 95 real benches and 190 seats',()=>{
  assert.equal(BENCHES.length,95);assert.equal(enabledSeats(defaults().settings).length,190);
  assert.deepEqual(BENCHES.filter(b=>b.area==='K').map(b=>b.id),['K3','K5']);
  assert.deepEqual(BENCHES.filter(b=>b.area==='Z').map(b=>b.id),['Z3']);
  assert.equal(BENCHES.filter(b=>b.area==='V–Y').length,12);assert.ok(!BENCHES.some(b=>b.id==='K1'||b.id==='V7'||b.id==='Z1'));
});
test('areas, individual seat rows, and disabled benches determine capacity',()=>{
  const s=defaults();s.settings.sections=defaultSections(['A–J']);s.settings.rows=[1,3];s.settings.disabled=['A1'];
  const seats=enabledSeats(s.settings);assert.equal(seats.length,19);assert.ok(seats.every(x=>x.endsWith(':0')));assert.ok(!seats.includes('A1:0'));
});
test('normal generation assigns each student once, with one student per bench first',()=>{
  const s=fixture(48),g=generate(s,{random:rng(),iterations:300});assert.equal(g.unplaced.length,0);assert.equal(Object.keys(g.assignments).length,48);assert.equal(new Set(Object.values(g.assignments)).size,48);assert.equal(new Set(Object.keys(g.assignments).map(x=>seatBench(x).id)).size,48);
  assert.ok(new Set(Object.keys(g.assignments).map(x=>seatBench(x).area)).size>=2);
});
test('physical shortage produces a usable plan and explicitly unplaced students',()=>{
  const s=fixture(10);s.settings.sections=defaultSections(['K']);const g=generate(s,{random:rng(),iterations:100});assert.equal(Object.keys(g.assignments).length,4);assert.equal(g.unplaced.length,6);assert.equal(new Set(Object.values(g.assignments)).size,4);
});
test('an absent pupil remains in the class list but is excluded from generation',()=>{
  const s=fixture();s.students[0].absent=true;const g=generate(s,{random:rng(),iterations:100});assert.equal(s.students.length,10);assert.ok(!Object.values(g.assignments).includes(s.students[0].id));assert.equal(Object.keys(g.assignments).length,9);
});
test('locked students and occupied and empty locked benches are unchanged',()=>{
  const s=fixture();s.assignments={'A1:0':s.students[0].id,'B1:0':s.students[1].id};s.locks=[s.students[0].id];s.benchLocks=['B1','C1'];const g=generate(s,{random:rng(),iterations:300});assert.equal(g.assignments['A1:0'],s.students[0].id);assert.equal(g.assignments['B1:0'],s.students[1].id);assert.ok(!g.assignments['B1:1']);assert.ok(!g.assignments['C1:0']);assert.ok(!g.assignments['C1:1']);
});
test('disabled locked places stay fixed and are visibly reported',()=>{
  const s=fixture(2);s.assignments={'A1:0':s.students[0].id};s.locks=[s.students[0].id];s.settings.disabled=['A1'];const g=generate(s,{random:rng(),iterations:20});assert.equal(g.assignments['A1:0'],s.students[0].id);assert.ok(g.warnings.some(w=>w.type==='unavailable'&&w.benches.includes('A1')));
});
test('explicit compulsory sharing can override the one-pupil-per-bench preference',()=>{
  const s=fixture(2);s.rules=[{id:'r',students:s.students.map(p=>p.id),type:'together',priority:'Verplicht'}];const g=generate(s,{random:rng(),iterations:2500});assert.equal(new Set(Object.keys(g.assignments).map(x=>seatBench(x).id)).size,1);assert.ok(!g.warnings.some(w=>w.ruleId==='r'));
});
test('mandatory rules take precedence over contradictory soft preferences',()=>{
  const s=fixture(2);s.rules=[{id:'separate',students:s.students.map(p=>p.id),type:'separate',priority:'Verplicht'},{id:'together',students:s.students.map(p=>p.id),type:'together',priority:'Zachte voorkeur'}];const g=generate(s,{random:rng(),iterations:300});assert.equal(new Set(Object.keys(g.assignments).map(x=>seatBench(x).id)).size,2);assert.ok(g.warnings.some(w=>w.ruleId==='together'));assert.ok(!g.warnings.some(w=>w.ruleId==='separate'));
});
test('warnings identify specific pupils and benches and clear after manual correction',()=>{
  const s=fixture(2);s.students[1].class=s.students[0].class;s.students[1].year='4';s.rules=[{id:'r',students:s.students.map(p=>p.id),type:'separate',priority:'Verplicht'}];s.assignments={'F5:0':s.students[0].id,'F5:1':s.students[1].id};let result=evaluate(s);assert.equal(result.warnings.length,3);assert.ok(result.warnings.every(w=>w.benches.includes('F5')&&w.students.length===2));assert.match(result.warnings[0].message,/Emma Peeters/);
  s.assignments={'F5:0':s.students[0].id,'R1:1':s.students[1].id};result=evaluate(s);assert.equal(result.warnings.length,0);assert.equal(result.evaluated,1);
});
test('group rules evaluate every pair and inactive rules are counted',()=>{
  const s=fixture(3);s.settings.classRules.default.type='none';s.assignments={'A1:0':s.students[0].id,'A1:1':s.students[1].id,'B1:0':s.students[2].id};s.rules=[{id:'group',students:s.students.map(p=>p.id),type:'group',priority:'Voorkeur'}];assert.equal(evaluate(s).warnings.filter(w=>w.ruleId==='group').length,3);delete s.assignments['B1:0'];assert.equal(evaluate(s).partial,1);assert.equal(evaluate(s).warnings.filter(w=>w.ruleId==='group').length,2);delete s.assignments['A1:1'];assert.equal(evaluate(s).inactive,1);
});
test('conflicting compulsory rules still produce a full seating plan',()=>{
  const s=fixture(2);s.settings.sections=defaultSections(['Z']);s.rules=[{id:'r',students:s.students.map(p=>p.id),type:'separate',priority:'Verplicht'}];const g=generate(s,{random:rng(),iterations:100});assert.equal(g.unplaced.length,0);assert.ok(g.warnings.some(w=>w.ruleId==='r'));
});
test('arbitrary-year separation is preferred when sharing is necessary',()=>{
  const s=fixture(4);s.settings.sections=defaultSections(['K']);s.settings.classRules.default.type='none';s.settings.yearRules=[{years:['7','12'],type:'separate',priority:'Voorkeur'}];s.students.forEach((p,i)=>p.year=i<2?'7':'12');const g=generate(s,{random:rng(),iterations:300});assert.equal(g.warnings.filter(w=>w.type==='year').length,0);
});
test('import understands pasted tables, quoted CSV, duplicate and missing fields',()=>{
  const existing=[{name:'Emma Peeters',class:'3A'}];const result=parseStudents('Naam;Klas;Leerjaar\nEmma Peeters;3A;3\n"Peeters, Jan";4B;4\nIncomplete;3A;\n"Peeters, Jan";4B;4',existing);assert.equal(result.students.length,2);assert.equal(result.students[0].name,'Peeters, Jan');assert.equal(result.students[1].year,'3');assert.equal(result.errors.length,2);
  assert.equal(parseStudents('Naam\tKlas\tLeerjaar\nZoë\t6A\t6').students.length,1);
});
test('zero enabled seats never crashes and returns everyone unplaced',()=>{const s=fixture();s.settings.sections=[];const g=generate(s);assert.deepEqual(g.assignments,{});assert.equal(g.unplaced.length,10);});
test('rechecking never modifies assignments',()=>{const s=fixture();s.assignments=generate(s,{random:rng(),iterations:50}).assignments;const before=structuredClone(s.assignments);evaluate(s);assert.deepEqual(s.assignments,before);});
