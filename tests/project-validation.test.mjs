import test from 'node:test';
import assert from 'node:assert/strict';
import { legacyDefaults } from '../src/engine.mjs';
import { validState, validProjectBackup } from '../src/project-validation.mjs';

function fixture(){const s=legacyDefaults();s.students=[{id:'a',name:'Ada',class:'3A',year:'3',absent:false},{id:'b',name:'Bram',class:'3A',year:'3',absent:false}];s.assignments={'A1:0':'a'};s.rules=[{id:'rule',type:'separate',students:['a','b'],priority:'Verplicht'}];return s;}

test('project import rejects arrays masquerading as assignments and missing student identities',()=>{
  assert.ok(validState(fixture()));
  for(const mutate of [s=>{s.assignments=[];},s=>{s.students[0].id='';s.assignments={};s.rules=[];},s=>{s.students[0].id='  ';s.assignments={};s.rules=[];}]){const s=fixture();mutate(s);assert.equal(validState(s),false);}
});

test('project import rejects duplicate rule identities and inherited rule type names',()=>{
  for(const mutate of [s=>s.rules.push({...s.rules[0]}),s=>{s.rules[0].id='';},s=>{s.rules[0].type='toString';},s=>{s.rules[0].acrossBenches='false';}]){const s=fixture();mutate(s);assert.equal(validState(s),false);}
});

test('unsatisfied fixed rules retain their deleted room and seat targets across project import',()=>{
  const s=fixture();s.rules=[{id:'fixed',type:'fixed',students:['a'],priority:'Verplicht',roomId:'removed-room',seat:'removed-bench:2'}];
  assert.ok(validState(s));
});

test('a project backup validates every plan and list before any import can discard data',()=>{
  const backup={version:1,state:fixture(),plans:[{id:'saved',state:fixture()}],lists:[{id:'list',name:'Leerlingen',students:fixture().students}]};
  assert.ok(validProjectBackup(backup));assert.ok(validProjectBackup({state:fixture()}));
  for(const mutate of [data=>{data.plans[0].state.assignments=[];},data=>{data.plans.push({...data.plans[0]});},data=>{data.lists[0].students[0].id='';},data=>{data.lists.push({...data.lists[0]});},data=>{data.plans={};},data=>{data.lists=null;}]){const data=structuredClone(backup);mutate(data);assert.equal(validProjectBackup(data),false);}
});
