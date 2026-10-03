import test from 'node:test';
import assert from 'node:assert/strict';
import { axisBenchIds, mergeSelection, selectionRect, benchesInRect } from '../src/bench-selection.mjs';
import { emptyGridRoom, generateGrid, tableAt, setTable, removeTable, setGap, setRowGap } from '../src/grid-room.mjs';
import { customBenches } from '../src/layout.mjs';

test('each letter selects its banks; either chair row selects the same whole banks',()=>{
  const l=generateGrid(emptyGridRoom(),{from:'A',to:'C',rows:2});
  assert.deepEqual(axisBenchIds(l.benches,{column:'B'}),['grid-B1','grid-B2']);
  assert.deepEqual(axisBenchIds(l.benches,{row:1}),['grid-A1','grid-B1','grid-C1']);
  assert.deepEqual(axisBenchIds(l.benches,{row:2}),axisBenchIds(l.benches,{row:1}));
  assert.deepEqual(axisBenchIds(l.benches,{row:4}),['grid-A2','grid-B2','grid-C2']);
  assert.deepEqual(axisBenchIds(l.benches,{column:'Z'}),[]);
});

test('axis selection follows moved cell codes and ignores teacher/manual banks',()=>{
  const l=generateGrid(emptyGridRoom(),{from:'A',to:'C',rows:2});
  removeTable(l,'grid-C2');setTable(l,tableAt(l,l.benches.find(b=>b.id==='grid-A1'),12,12));
  l.benches.push({id:'manual',kind:'student',custom:true,gx:0,gy:0,capacity:2,facing:'down'});
  setGap(l,'A',3);setRowGap(l,1,2);
  assert.deepEqual(axisBenchIds(customBenches(l),{column:'C'}),['grid-A1','grid-C1']);
  assert.deepEqual(axisBenchIds(customBenches(l),{row:4}),['grid-A1','grid-A2','grid-B2']);
  assert.ok(!axisBenchIds(customBenches(l),{column:'A'}).includes('manual'));
  assert.ok(!axisBenchIds(l.benches,{row:1}).includes('teacher'));
});

test('Ctrl adds or toggles banks without duplicating them or mutating the base selection',()=>{
  const base=['A','B'];
  assert.deepEqual(mergeSelection(base,['C','C']),['C']);
  assert.deepEqual(mergeSelection(base,['B','C'],{additive:true}),['A','B','C']);
  assert.deepEqual(mergeSelection(base,['B','B','C'],{additive:true,toggle:true}),['A','C']);
  assert.deepEqual(base,['A','B']);
});

test('drag selection works in either direction, includes partial intersections and excludes the teacher',()=>{
  const benches=[
    {id:'A',kind:'student',x:40,y:100,facing:'down',capacity:2},
    {id:'B',kind:'student',x:232,y:100,facing:'left',capacity:2},
    {id:'T',kind:'teacher',x:40,y:20,facing:'down',capacity:1}
  ];
  const rect=selectionRect({x:250,y:150},{x:30,y:90});
  assert.deepEqual(rect,{x:30,y:90,width:220,height:60});
  assert.deepEqual(benchesInRect(benches,rect),['A','B']);
  assert.deepEqual(benchesInRect(benches,{x:310,y:228,width:3,height:3}),['B']);
  assert.deepEqual(benchesInRect(benches,{x:0,y:0,width:400,height:300}),['A','B']);
  assert.deepEqual(benchesInRect(benches,{x:184,y:100,width:20,height:80}),[]);
});
