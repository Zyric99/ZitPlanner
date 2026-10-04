import test from 'node:test';
import assert from 'node:assert/strict';
import { defaults, legacyDefaults, evaluate, generate, seatBench } from '../src/engine.mjs';
import { makeBench, customBenches, layoutValid } from '../src/layout.mjs';
import { emptyGridRoom, generateGrid, setSection, removeSection, visualBands, tableAt, setTable, resizeCanvas, packGridRoom, unpackGridRoom } from '../src/grid-room.mjs';
import { initializeRooms, newRoom, assignRoom } from '../src/rooms.mjs';
import { evaluateCrossRoomRules } from '../src/auto-distribution.mjs';

function fixture(grid={from:'A',to:'C',rows:1}) {
  const state=defaults(),layout=generateGrid(emptyGridRoom(),grid);
  const extra=setSection(layout,{id:'extra',after:'A',name:'Extra',width:12});
  const computers=setSection(layout,{id:'computers',after:'B',name:'Computers',width:12});
  for(const section of [extra,computers])for(let i=0;i<2;i++) {
    const bench=makeBench(layout,'student',{sectionId:section.id,gx:i*6,gy:1,sortX:visualBands(layout).find(s=>s.id===section.id).x+i*6,sortY:1});
    layout.benches.push(bench);layout.nextManual++;
  }
  resizeCanvas(layout);state.settings.layout=layout;
  state.settings.classRulesEnabled=false;state.settings.yearRulesEnabled=false;state.settings.studentRulesEnabled=true;
  state.students=[{id:'s0',name:'Anna',class:'1A',year:'1',absent:false},{id:'s1',name:'Bram',class:'2B',year:'2',absent:false}];
  state.rules=[{id:'area',type:'area',students:['s0','s1'],priority:'Verplicht'}];
  const benches=id=>layout.benches.filter(b=>b.sectionId===id);
  const first=benches(extra.id),second=benches(computers.id);
  state.assignments={[`${first[0].id}:0`]:'s0',[`${second[0].id}:0`]:'s1'};
  return {state,extra,computers,first,second};
}

test('same-area rules detect pupils in different custom sections and name both affected benches',()=>{
  const {state,first,second}=fixture(),before=structuredClone(state);
  assert.ok(layoutValid(state.settings.layout));
  const result=evaluate(state),warning=result.warnings.find(w=>w.ruleId==='area');
  assert.equal(result.score[0],1);assert.deepEqual(warning.students,['s0','s1']);
  assert.deepEqual(warning.benches,[first[0].id,second[0].id]);assert.match(warning.message,/In hetzelfde gebied/);
  assert.deepEqual(evaluate(state,state.assignments,false).score,result.score);assert.deepEqual(state,before);
});

test('different tables in one named section satisfy the rule; ordinary grid tables share the main area',()=>{
  const {state,first}=fixture();
  state.assignments={[`${first[0].id}:0`]:'s0',[`${first[1].id}:0`]:'s1'};
  assert.deepEqual(evaluate(state).warnings,[]);
  state.assignments={'grid-A1:0':'s0','grid-C1:0':'s1'};
  assert.deepEqual(evaluate(state).warnings,[]);
  state.assignments={'grid-A1:0':'s0',[`${first[0].id}:0`]:'s1'};
  assert.equal(evaluate(state).score[0],1);
});

test('section identities survive renaming and distinguish duplicate names and the main-area name',()=>{
  const {state,first,second,extra,computers}=fixture();
  const original=customBenches(state.settings.layout).find(b=>b.id===first[0].id).area;
  state.settings.layout=structuredClone(state.settings.layout);
  setSection(state.settings.layout,{...extra,name:'Lokaal'});setSection(state.settings.layout,{...computers,name:'Lokaal'});
  assert.equal(customBenches(state.settings.layout).find(b=>b.id===first[0].id).area,original);
  assert.equal(evaluate(state).score[0],1);
  // A section ID equal to the main area's label must remain a distinct area.
  state.settings.layout=structuredClone(state.settings.layout);
  state.settings.layout.sections.find(s=>s.id===extra.id).id='Lokaal';
  for(const bench of state.settings.layout.benches.filter(b=>b.sectionId===extra.id))bench.sectionId='Lokaal';
  assert.ok(layoutValid(state.settings.layout));
  state.assignments={'grid-A1:0':'s0',[`${first[0].id}:0`]:'s1'};
  assert.equal(evaluate(state).score[0],1);
  assert.notEqual(seatBench(`${first[0].id}:0`,state.settings).area,seatBench(`${second[0].id}:0`,state.settings).area);
});

test('moving a table between named sections updates its area while preserving seats and pupils',()=>{
  const {state,first,computers}=fixture(),assignments=structuredClone(state.assignments);
  evaluate(state); // Exercise an already cached source layout before the edit.
  const next=structuredClone(state.settings.layout),bench=next.benches.find(b=>b.id===first[0].id);
  const band=visualBands(next).find(s=>s.id===computers.id);
  setTable(next,tableAt(next,bench,band.x,7));resizeCanvas(next);state.settings.layout=next;
  assert.ok(layoutValid(next));assert.deepEqual(evaluate(state).warnings,[]);assert.deepEqual(state.assignments,assignments);
});

test('removing a section follows the surviving table membership rather than its old seat prefix',()=>{
  const {state,extra,first}=fixture();state.assignments={'grid-A1:0':'s0',[`${first[0].id}:0`]:'s1'};
  assert.equal(evaluate(state).score[0],1);
  const next=structuredClone(state.settings.layout);removeSection(next,extra.id);resizeCanvas(next);state.settings.layout=next;
  assert.ok(layoutValid(next));assert.equal(next.benches.find(b=>b.id===first[0].id).sectionId,undefined);
  assert.deepEqual(evaluate(state).warnings,[]);
});

test('generation repairs a split-area pair while retaining a pinned pupil and the full seat count',()=>{
  const {state,first,second}=fixture();state.locks=['s0'];
  const before=structuredClone(state),result=generate(state,{iterations:1,preferredSeats:{s1:`${second[0].id}:0`}});
  assert.equal(result.assignments[`${first[0].id}:0`],'s0');assert.equal(Object.keys(result.assignments).length,2);
  const areas=Object.keys(result.assignments).map(seat=>seatBench(seat,state.settings).area);
  assert.equal(new Set(areas).size,1);assert.deepEqual(result.unplaced,[]);assert.deepEqual(result.warnings,[]);assert.deepEqual(state,before);
});

test('fixed positions in different sections keep the same-area violation visible',()=>{
  const {state,first,second}=fixture();
  state.rules.push({id:'fixed0',type:'fixed',students:['s0'],seat:`${first[0].id}:0`,priority:'Verplicht'},
    {id:'fixed1',type:'fixed',students:['s1'],seat:`${second[0].id}:0`,priority:'Verplicht'});
  const result=generate(state,{iterations:10});
  assert.deepEqual(result.assignments,state.assignments);assert.deepEqual(result.unplaced,[]);
  assert.equal(result.score[0],1);assert.equal(result.warnings[0].ruleId,'area');
  state.settings.studentRulesEnabled=false;assert.deepEqual(evaluate(state).warnings,[]);
});

test('JSON and compact grid persistence retain custom area behavior without saving derived areas',()=>{
  for(const grid of [{from:'A',to:'C',rows:1},{from:'A',to:'Z',rows:20}]) {
    const {state}=fixture(grid),packed=packGridRoom(state.settings.layout);
    const saved={...state,settings:{...state.settings,layout:packed}};
    const restored=JSON.parse(JSON.stringify(saved),(_key,value)=>unpackGridRoom(value));
    assert.ok(layoutValid(restored.settings.layout));assert.equal(evaluate(restored).score[0],1);
    assert.ok(restored.settings.layout.benches.every(b=>!Object.hasOwn(b,'area')));
    assert.deepEqual(evaluate(restored).warnings,evaluate(state).warnings);
  }
});

test('identically named sections in different rooms still trigger a cross-room same-area warning',()=>{
  const {state}=fixture();initializeRooms(state);
  const other=newRoom(state,'Copy');other.layout=structuredClone(state.settings.layout);assignRoom(state,'s1',other.id);
  const result=evaluateCrossRoomRules(state);
  assert.equal(result.score[0],1);assert.ok(result.warnings.some(w=>w.ruleId==='area'&&w.crossRoom));
});

test('legacy areas and old custom layouts without sections retain their established meaning',()=>{
  const {state}=fixture(),legacy=legacyDefaults();legacy.students=state.students;legacy.rules=state.rules;
  legacy.assignments={'A1:0':'s0','L1:0':'s1'};assert.equal(evaluate(legacy).score[0],1);
  state.settings.layout={kind:'custom',columns:40,rows:20,benches:[
    {id:'a',code:'A',kind:'student',capacity:2,facing:'down',enabled:true,gx:0,gy:1},
    {id:'b',code:'B',kind:'student',capacity:2,facing:'down',enabled:true,gx:12,gy:1}]};
  state.assignments={'a:0':'s0','b:0':'s1'};assert.ok(layoutValid(state.settings.layout));assert.deepEqual(evaluate(state).warnings,[]);
});
