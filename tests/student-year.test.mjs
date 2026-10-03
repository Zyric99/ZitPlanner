import test from 'node:test';
import assert from 'node:assert/strict';
import { inferYear, normalizeYear, normalizeStudentYears, setManualYear, studentYearErrors } from '../src/student-year.mjs';

test('year detection reads the first complete number anywhere in a class code',()=>{
  assert.deepEqual(['4B','DEMO-1BASa1','Track 12B-3','04B',' 6 ','Groep 4','0B-4','No number',null].map(inferYear),['4','1','12','4','6','4','','','']);
  assert.deepEqual(['0','-1','1.5','4th','NaN','Infinity','9007199254740992',' 04 '].map(normalizeYear),['','','','','','','','4']);
});

test('normalization repairs loaded years while retaining every unresolved student',()=>{
  const students=[{id:'a',class:'4B',year:'wrong'},{id:'b',class:'5A'},{id:'c',class:'Unknown',year:'3'}];
  normalizeStudentYears(students);assert.deepEqual(students.map(p=>p.year),['4','5','']);assert.deepEqual(studentYearErrors(students).map(p=>p.id),['c']);
});

test('manual corrections survive serialization and are rechecked when the class changes',()=>{
  const students=[{id:'a',class:'Unknown',year:''},{id:'b',class:'4B',year:'4'}];
  setManualYear(students[0],'2');setManualYear(students[1],'5');
  const restored=JSON.parse(JSON.stringify(students));normalizeStudentYears(restored);assert.deepEqual(restored.map(p=>p.year),['2','5']);assert.deepEqual(studentYearErrors(restored),[]);
  restored[0].class='6A';restored[1].class='Unknown again';normalizeStudentYears(restored);
  assert.deepEqual(restored.map(p=>p.year),['6','']);assert.deepEqual(studentYearErrors(restored).map(p=>p.id),['b']);assert.ok(restored.every(p=>!p.yearOverride));
  assert.throws(()=>setManualYear(restored[1],'-3'),/positief/);
});
