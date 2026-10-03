import test from 'node:test';
import assert from 'node:assert/strict';
import { legacyDefaults, generate, evaluate, enabledSeats, validSeat, seatBench } from '../src/engine.mjs';

function fixture(count=2,mode='ordered') {
  const state=legacyDefaults();
  state.settings.placementMode=mode;
  state.settings.sections=[{id:'AD',from:'A',to:'D',enabled:true}];
  state.settings.rows=[1,2];state.settings.yearRules=[];
  state.students=Array.from({length:count},(_,i)=>({id:`s${i}`,name:`Student ${i}`,class:'',year:'',absent:false}));
  return state;
}
const rule=(id,type,students,priority='Verplicht')=>({id,type,students,priority});

test('required proximity can use a shared bench when the available benches are too far apart',()=>{
  const state=fixture(2,'random');state.settings.disabled=['B1','C1'];
  state.rules=[rule('near','near',['s0','s1'])];
  const result=generate(state,{random:()=>.1,iterations:1});
  assert.deepEqual(result.warnings,[]);assert.deepEqual(result.unplaced,[]);
  assert.equal(new Set(Object.keys(result.assignments).map(seat=>seatBench(seat).id)).size,1);
  assert.equal(result.score[3],1);
});

test('a missed random proposal is followed by checking available rule corrections',()=>{
  const state=fixture(2,'random');state.rules=[rule('together','together',['s0','s1'])];
  const result=generate(state,{random:()=>0,iterations:1});
  assert.equal(result.warnings.length,0);assert.equal(new Set(Object.values(result.assignments)).size,2);
});

test('coordinated reassignment solves a feasible plan with no improving individual move or swap',()=>{
  const state=fixture(5);
  state.rules=[rule('r0','near',['s2','s0']),rule('r1','adjacent',['s0','s3']),rule('r2','near',['s3','s2']),rule('r3','separate',['s4','s2']),rule('r4','adjacent',['s3','s4']),rule('r5','together',['s0','s4']),rule('r6','near',['s0','s2'])];
  const initial=generate(state,{iterations:0});assert.equal(initial.score[0],1);
  for(const a of Object.keys(initial.assignments))for(const b of enabledSeats(state.settings)) {
    if(a===b)continue;
    const candidate={...initial.assignments},first=candidate[a],second=candidate[b];
    if(second)candidate[a]=second;else delete candidate[a];candidate[b]=first;
    assert.ok(evaluate(state,candidate,false).score[0]>=initial.score[0]);
  }
  const result=generate(state,{iterations:1});
  assert.deepEqual(result.warnings,[]);assert.deepEqual(result.unplaced,[]);
  assert.equal(new Set(Object.values(result.assignments)).size,5);
  assert.deepEqual(generate(state,{iterations:1}).assignments,result.assignments);
});

test('diagnostics report removed and out-of-range seats instead of dropping the occupants',()=>{
  for(const seat of ['deleted:0','A1:7','A1:00']) {
    const state=fixture(1);state.assignments={[seat]:'s0'};
    const before=structuredClone(state),result=evaluate(state);
    assert.equal(validSeat(seat,state.settings),false);
    assert.ok(result.warnings.some(warning=>warning.type==='unavailable'&&warning.students.includes('s0')));
    assert.ok(result.warnings.some(warning=>warning.type==='unplaced'&&warning.students.includes('s0')));
    assert.deepEqual(state,before);
  }
});

test('duplicate saved pins cannot place a student twice or waste another student’s seat',()=>{
  const state=fixture(2);state.assignments={'A1:0':'s0','B1:0':'s0'};state.locks=['s0'];
  assert.ok(evaluate(state).warnings.some(warning=>warning.type==='duplicate'));
  const result=generate(state,{iterations:1});
  assert.equal(Object.values(result.assignments).filter(id=>id==='s0').length,1);
  assert.equal(result.assignments['A1:0'],'s0');assert.deepEqual(result.unplaced,[]);
  assert.ok(!result.warnings.some(warning=>warning.type==='duplicate'));
});

test('unplaced present pupils leave an unresolved personal rule warning',()=>{
  const state=fixture(2);state.assignments={'A1:0':'s0'};state.rules=[rule('pair','separate',['s0','s1'])];
  const result=evaluate(state);
  assert.ok(result.warnings.some(warning=>warning.ruleId==='pair'&&warning.students.includes('s1')));
  assert.ok(result.warnings.some(warning=>warning.type==='unplaced'&&warning.students.includes('s1')));
  state.students[1].absent=true;
  assert.deepEqual(evaluate(state).warnings,[]);
});

test('other-room members and absent pupils do not cause missing pair warnings',()=>{
  const state=fixture(2);state.activeRoomId='one';state.studentRooms={s0:'one',s1:'two'};
  state.rules=[rule('pair','separate',['s0','s1'])];
  assert.ok(!evaluate(state).warnings.some(warning=>warning.ruleId==='pair'));
  state.assignments={'A1:0':'s0'};
  assert.deepEqual(evaluate(state).warnings,[]);
  delete state.studentRooms;state.students[1].absent=true;delete state.assignments['A1:0'];
  assert.ok(!evaluate(state).warnings.some(warning=>warning.ruleId==='pair'));
});

test('repairs preserve pins and keep unavoidable conflicts visible',()=>{
  const state=fixture(2);state.settings.disabled=['B1','C1'];
  state.assignments={'A1:0':'s0','D1:0':'s1'};state.locks=['s0','s1'];state.rules=[rule('near','near',['s0','s1'])];
  const result=generate(state,{iterations:1});
  assert.deepEqual(result.assignments,state.assignments);
  assert.ok(result.warnings.some(warning=>warning.ruleId==='near'));
});

test('prototype property student IDs remain ordinary data when absent or unplaced',()=>{
  for(const id of ['toString','constructor','__proto__']) {
    const state=fixture(2);state.students[1].id=id;state.assignments={'A1:0':'s0'};state.rules=[rule('pair','separate',['s0',id])];
    assert.ok(evaluate(state).warnings.some(warning=>warning.ruleId==='pair'&&warning.students.includes(id)));
    state.students[1].absent=true;assert.deepEqual(evaluate(state).warnings,[]);
    state.students.pop();state.rules=[];state.assignments['B1:0']=id;
    assert.deepEqual(evaluate(state).warnings,[]);
  }
});
