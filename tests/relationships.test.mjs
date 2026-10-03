import test from 'node:test';
import assert from 'node:assert/strict';
import { legacyDefaults as defaults, evaluate, generate, migrateState, defaultSections, classRuleFor, yearPairKey, yearRuleFor, BENCHES, ROOM, seatGeometry } from '../src/engine.mjs';
function fixture(n=2) {
  const s=defaults();s.settings.classRulesEnabled=true;s.settings.classRules.default.type='none';s.settings.yearRules=[];
  s.students=Array.from({length:n},(_,i)=>({id:`s${i}`,name:`Leerling ${i}`,class:'4A',year:i%2?'4':'3',absent:false}));
  s.assignments={'A1:0':'s0','A1:1':'s1'};return s;
}
const placed=(s,a,b)=>evaluate(s,{[a]:'s0',[b]:'s1'});
test('fresh defaults disable unrestricted class rules and enable 3 ↔ 4 bench separation',()=>{
  const settings=defaults().settings;assert.deepEqual(settings.classRules,{default:{type:'none',priority:'Voorkeur'},overrides:{}});assert.equal(settings.classRulesEnabled,false);assert.equal(settings.yearRulesEnabled,true);assert.deepEqual(settings.yearRules,[{years:['3','4'],type:'separate',priority:'Voorkeur'}]);
  assert.equal(settings.separateClasses,undefined);assert.equal(settings.mixYears,undefined);
  const s=fixture();s.settings=settings;s.students[1].class='4B';assert.equal(evaluate(s).warnings[0].type,'year');assert.equal(placed(s,'A1:0','B1:0').warnings.length,0);
  s.students[1].year='3';assert.equal(evaluate(s).warnings.length,0);
});
for(const type of ['none','separate','adjacent','gap','far'])test(`class rule ${type} has the intended physical distance semantics`,()=>{
  const s=fixture();s.settings.classRules.default={type,priority:'Verplicht'};
  const counts=['A1:1','B1:0','C1:0','H1:0'].map(target=>placed(s,'A1:0',target).warnings.filter(w=>w.type==='class').length);
  assert.deepEqual(counts,{none:[0,0,0,0],separate:[1,0,0,0],adjacent:[1,1,0,0],gap:[1,1,0,0],far:[1,1,1,0]}[type]);
  if(type!=='none'){const w=evaluate(s).warnings[0];assert.equal(w.priority,'Verplicht');assert.deepEqual(w.students,['s0','s1']);assert.deepEqual(w.benches,['A1']);assert.match(w.message,/klas 4A/);}
});
test('per-class overrides replace the global rule, and deletion immediately restores inheritance',()=>{
  const s=fixture();s.settings.classRules.default={type:'gap',priority:'Voorkeur'};s.settings.classRules.overrides={'4A':{type:'separate',priority:'Verplicht'}};
  assert.equal(placed(s,'A1:0','B1:0').warnings.length,0);assert.equal(evaluate(s).warnings[0].priority,'Verplicht');
  s.settings.classRules.overrides['4A']={type:'none',priority:'Zachte voorkeur'};assert.equal(evaluate(s).warnings.length,0);
  delete s.settings.classRules.overrides['4A'];assert.equal(placed(s,'A1:0','B1:0').warnings[0].priority,'Voorkeur');
  s.students.forEach(p=>p.class='4B');assert.equal(evaluate(s).warnings[0].type,'class');
});
test('a class far-spreading override uses a measurable six-bank target',()=>{
  const s=fixture();s.settings.classRules.overrides['4A']={type:'far',priority:'Zachte voorkeur'};const result=placed(s,'A1:0','B1:0');assert.match(result.warnings[0].message,/minimaal zes bankafstanden/);assert.ok(result.score[2]>0);
});
test('class names remain data even if they match JavaScript prototype property names',()=>{
  const s=fixture();s.students.forEach(p=>p.class='__proto__');assert.equal(classRuleFor(s.settings,'__proto__').type,'none');
  s.settings.classRules.overrides=JSON.parse('{"__proto__":{"type":"separate","priority":"Verplicht"}}');assert.equal(evaluate(s).warnings[0].type,'class');
});
for(const type of ['none','separate','adjacent','gap'])test(`year-pair rule ${type} acts only on the configured two years`,()=>{
  const s=fixture();s.settings.yearRules=[{years:['4','3'],type,priority:'Voorkeur'}];
  const counts=['A1:1','B1:0','C1:0'].map(target=>placed(s,'A1:0',target).warnings.filter(w=>w.type==='year').length);
  assert.deepEqual(counts,{none:[0,0,0],separate:[1,0,0],adjacent:[1,1,0],gap:[1,1,0]}[type]);
  s.students[1].year='5';assert.equal(evaluate(s).warnings.length,0);
});
test('arbitrary year pairs are symmetric, independent and retain their own priorities',()=>{
  const s=fixture();s.settings.yearRules=[{years:['2','3'],type:'gap',priority:'Verplicht'},{years:['2','4'],type:'separate',priority:'Zachte voorkeur'},{years:['3','5'],type:'adjacent',priority:'Voorkeur'}];
  assert.equal(yearPairKey('2','3'),yearPairKey('3','2'));assert.equal(yearRuleFor(s.settings,'3','2').type,'gap');
  s.students[0].year='2';s.students[1].year='3';assert.equal(placed(s,'A1:0','B1:0').warnings[0].priority,'Verplicht');
  s.students[1].year='4';assert.equal(placed(s,'A1:0','B1:0').warnings.length,0);assert.equal(evaluate(s).warnings[0].priority,'Zachte voorkeur');
  s.students[0].year='5';s.students[1].year='3';assert.equal(placed(s,'A1:0','B1:0').warnings[0].priority,'Voorkeur');
});
test('warnings name both pupils, the year pair, the exact rule and affected benches',()=>{
  const s=fixture();s.settings.yearRules=[{years:['3','4'],type:'separate',priority:'Verplicht'}];const w=evaluate(s).warnings[0];assert.match(w.message,/Leerling 0 \(leerjaar 3\).*Leerling 1 \(leerjaar 4\)/);assert.match(w.message,/Niet aan dezelfde bank/);assert.match(w.message,/delen bank A 1–2/);assert.deepEqual(w.benches,['A1']);assert.deepEqual(w.students,['s0','s1']);
});
test('year-rule importance precedes compact filling and softer personal sharing',()=>{
  const s=fixture();s.settings.placementMode='ordered';s.settings.yearRules=[{years:['3','4'],type:'separate',priority:'Verplicht'}];s.rules=[{id:'t',students:['s0','s1'],type:'together',priority:'Zachte voorkeur'}];
  let g=generate(s,{iterations:1200});assert.ok(!g.warnings.some(w=>w.type==='year'));assert.ok(g.warnings.some(w=>w.ruleId==='t'));
  s.settings.yearRules[0].priority='Zachte voorkeur';s.rules[0].priority='Verplicht';g=generate(s,{iterations:1200});assert.ok(g.warnings.some(w=>w.type==='year'));assert.ok(!g.warnings.some(w=>w.ruleId==='t'));
});
test('class-rule importance precedes softer sharing instructions',()=>{
  const s=fixture();s.settings.placementMode='ordered';s.settings.classRules.default={type:'separate',priority:'Verplicht'};s.rules=[{id:'t',students:['s0','s1'],type:'together',priority:'Voorkeur'}];const g=generate(s,{iterations:1200});assert.ok(!g.warnings.some(w=>w.type==='class'));assert.ok(g.warnings.some(w=>w.ruleId==='t'));
});
test('impossible class and year rules with fixed or pinned students return a complete plan with warnings',()=>{
  const s=fixture();s.settings.classRules.default={type:'gap',priority:'Verplicht'};s.settings.yearRules=[{years:['3','4'],type:'separate',priority:'Verplicht'}];s.locks=['s0'];s.rules=[{id:'fixed',students:['s1'],type:'fixed',seat:'A1:1',priority:'Verplicht'}];
  const g=generate(s,{iterations:80});assert.equal(g.unplaced.length,0);assert.equal(g.assignments['A1:0'],'s0');assert.equal(g.assignments['A1:1'],'s1');assert.deepEqual(g.warnings.map(w=>w.type).sort(),['class','year']);
  s.locks=[];s.rules=[];s.settings.sections=defaultSections(['Z']);const impossible=generate(s,{iterations:80});assert.equal(impossible.unplaced.length,0);assert.ok(impossible.warnings.some(w=>w.type==='class'));assert.ok(impossible.warnings.some(w=>w.type==='year'));
});
test('absent or unplaced pupils do not create class or year pair warnings',()=>{
  const s=fixture();s.settings.classRules.default.type='gap';s.settings.yearRules=[{years:['3','4'],type:'gap',priority:'Verplicht'}];s.students[1].absent=true;assert.equal(evaluate(s).warnings.length,0);assert.equal(evaluate(s).yearChecks,0);
  s.students[1].absent=false;delete s.assignments['A1:1'];assert.deepEqual(evaluate(s).warnings.map(w=>w.type),['unplaced']);assert.deepEqual(evaluate(s).warnings[0].students,['s1']);
});
test('legacy class controls migrate, year mixing becomes a bench-level 3 ↔ 4 rule, and assignments stay intact',()=>{
  const s=fixture();delete s.settings.classRules;delete s.settings.yearRules;s.settings.separateClasses=true;s.settings.classPriority='Verplicht';s.settings.mixYears=true;s.settings.yearPriority='Zachte voorkeur';const before=structuredClone(s),m=migrateState(s);
  assert.deepEqual(s,before);assert.deepEqual(m.assignments,s.assignments);assert.deepEqual(m.settings.classRules,{default:{type:'gap',priority:'Verplicht'},overrides:{}});assert.deepEqual(m.settings.yearRules,[{years:['3','4'],type:'separate',priority:'Zachte voorkeur'}]);assert.equal(m.settings.mixYears,undefined);
  s.settings.separateClasses=false;s.settings.mixYears=false;const disabled=migrateState(s);assert.equal(disabled.settings.classRules.default.type,'none');assert.deepEqual(disabled.settings.yearRules,[]);
});
test('migration preserves explicit relationship overrides and priorities',()=>{
  const s=fixture();s.settings.classRules.overrides={'4A':{type:'far',priority:'Verplicht'}};s.settings.yearRules=[{years:['2','5'],type:'gap',priority:'Voorkeur'}];const m=migrateState(s);assert.deepEqual(m.settings.classRules,s.settings.classRules);assert.deepEqual(m.settings.yearRules,s.settings.yearRules);
});
test('reversal changes only facing and chairs, keeping all bench and seat coordinates fixed',()=>{
  for(const b of BENCHES){assert.equal(b.x,38+b.col*ROOM.columnStep+(b.col>=10?35:0)+(b.col>=11?35:0)+(b.col>=21?38:0));assert.equal(b.y,92+b.block*ROOM.rowStep);
    for(const side of [0,1]){const g=seatGeometry(b,side);assert.equal(g.x,b.area==='K'?b.x-12+side*47:b.x+4);assert.equal(g.y,b.area==='K'?b.y+23:b.y+8+side*53);
      if(b.area==='K'){assert.equal(g.chairY+g.chairHeight,b.y+10);assert.equal((g.chairX+g.chairWidth/2)-(b.x-17),g.x+8+27/2-(b.x-17));}
      else{assert.equal(g.chairY,g.y+7);assert.ok(b.area==='A–J'?g.chairX===b.x+67:g.chairX+g.chairWidth===b.x-2);}
    }
  }
});
