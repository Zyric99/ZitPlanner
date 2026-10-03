import test from 'node:test';
import assert from 'node:assert/strict';
import {parseStudents,parseStudentRows,parseStudentSheets,textRows,rowsText,inferYear,studyRows,STUDY_HEADERS} from '../src/student-import.mjs';
const rows=[STUDY_HEADERS,['Anoniem','Piet','DEMO-1BASa1','Nee','Nee','Nee','Nee'],['Bibber','Bert','DEMO-1BASa1','Ja','Nee','Ja','Nee'],['Claeys','Mirthe','DEMO-1BASa1','Ja','Ja','Ja','Ja']];
test('example layout preserves separate names, class and evening attendance with inferred year',()=>{
  const result=parseStudentRows(rows);assert.deepEqual(result.errors,[]);assert.equal(result.students.length,3);
  assert.deepEqual(result.students.map(p=>[p.name,p.year,p.absent]),[['Piet Anoniem','1',false],['Bert Bibber','1',false],['Mirthe Claeys','1',false]]);
  assert.deepEqual(studyRows(result.students),rows.slice(1));
  assert.deepEqual(studyRows(JSON.parse(JSON.stringify(result.students))),rows.slice(1));
});
test('pasted Excel and reordered columns use header names rather than fixed positions',()=>{
  assert.deepEqual(studyRows(parseStudents(rowsText(rows)).students),rows.slice(1));
  const reordered=rows.map(row=>[row[2],row[6],row[0],row[4],row[1],row[5],row[3]]);
  assert.deepEqual(studyRows(parseStudentRows(reordered).students),rows.slice(1));
});
test('missing headers, invalid attendance, duplicates and unknown years are reported',()=>{
  assert.match(parseStudentRows([STUDY_HEADERS.slice(0,6)]).errors[0],/vrijdag/);
  assert.match(parseStudentRows([STUDY_HEADERS,[...rows[1].slice(0,3),'Maybe','Nee','Ja','Nee']]).errors[0],/Ja, Nee/);
  const result=parseStudentRows([...rows,rows[1]],parseStudentRows([STUDY_HEADERS,rows[2]]).students);assert.equal(result.students.length,2);assert.equal(result.errors.length,2);
  const unknown=[...rows[1]];unknown[2]='Onbekend';const pending=parseStudentRows([STUDY_HEADERS,unknown]);assert.deepEqual(pending.errors,[]);assert.equal(pending.students.length,1);assert.equal(pending.students[0].year,'');assert.deepEqual(pending.yearErrors,pending.students);
  assert.deepEqual(['DEMO-1BASa1','3A','04B','DEMO-X','Groep 4'].map(inferYear),['1','3','4','','4']);
});
test('legacy CSV remains valid and quoted delimiters/newlines round trip',()=>{
  const result=parseStudents('\uFEFFNaam;Klas;Leerjaar\r\n"Zoë; de \"\"Groot\"\"";3A;3\r\n"Anna\nMaes";4B;4');
  assert.deepEqual(result.errors,[]);assert.equal(result.students[0].name,'Zoë; de "Groot"');assert.equal(result.students[1].name,'Anna\nMaes');
  assert.deepEqual(textRows(rowsText([['a\tb','a"b','a\nb','']])),[['a\tb','a"b','a\nb','']]);
  assert.equal(parseStudents('"Unclosed;3A;3').students.length,0);
});
test('blank attendance remains blank and unstructured names have predictable export',()=>{
  const blank=[...rows[1]];blank[3]='';blank[4]=' ja ';blank[5]='nee';
  assert.deepEqual(studyRows(parseStudentRows([STUDY_HEADERS,blank]).students)[0].slice(3),['','Ja','Nee','Nee']);
  assert.deepEqual(studyRows([{name:'Jan van den Berg',class:'3A',absent:true},{name:'Solo',class:'4A'}]),[['van den Berg','Jan','3A','','','',''],['Solo','','4A','','','','']]);
});

test('every import format uses the first class number instead of a supplied year',()=>{
  for(const text of ['Naam;Klas;Leerjaar\nAda;4B;2','Naam;Klas\nAda;4B','Ada;4B;','Ada;4B;wrong']) {
    const result=parseStudents(text);assert.deepEqual(result.errors,[]);assert.deepEqual(result.yearErrors,[]);assert.equal(result.students[0].year,'4');
  }
  const result=parseStudentRows([[...STUDY_HEADERS,'Leerjaar'],[...rows[1],'6']]);assert.equal(result.students[0].year,'1');
});

test('all unrecognized class codes remain available for correction beyond the preview limit',()=>{
  const result=parseStudentRows([['Naam','Klas','Leerjaar'],...Array.from({length:9},(_,i)=>[`Pupil ${i}`,'Onbekend','3']),['Detected','4B','1']]);
  assert.equal(result.students.length,10);assert.equal(result.yearErrors.length,9);assert.deepEqual(result.errors,[]);assert.equal(result.students.at(-1).year,'4');
});

test('workbook import combines different class-sheet formats and keeps attendance and year corrections',()=>{
  const sheets=[{name:'3A',rows:[['Naam','Klas'],['Ada','3A']]},{name:'Avondstudie',rows},
    {name:'Handmatig',rows:[['Klas','Naam'],['Onbekend','Noah']]}];
  const before=structuredClone(sheets),result=parseStudentSheets(sheets);
  assert.equal(result.students.length,5);assert.deepEqual(result.errors,[]);
  assert.deepEqual(result.sheets.map(sheet=>[sheet.name,sheet.valid,sheet.students]),[['3A',true,1],['Avondstudie',true,3],['Handmatig',true,1]]);
  assert.equal(result.students[2].eveningStudy.maandag,'Ja');
  assert.deepEqual(result.yearErrors.map(p=>p.name),['Noah']);assert.deepEqual(sheets,before);
});

test('invalid and unreadable sheets are warned about and excluded without losing valid sheets',()=>{
  const result=parseStudentSheets([
    {name:'Overzicht',rows:[['Omschrijving','Aantal'],['Totaal','48']]},
    {name:'Leeg',rows:[]},
    {name:'Onvolledig',rows:[['Naam'],['Anna']]},
    {name:'Beschadigd',rows:[],error:'Ongeldige XML.'},
    {name:'Geen leerlingen',rows:[['Naam','Klas']]},
    {name:'3A',rows:[['Naam','Klas'],['Emma','3A']]}
  ]);
  assert.deepEqual(result.students.map(p=>p.name),['Emma']);assert.equal(result.errors.length,5);
  for(const name of ['Overzicht','Leeg','Onvolledig','Beschadigd','Geen leerlingen'])assert.ok(result.errors.some(e=>e.includes(name)&&e.includes('overgeslagen')));
  assert.deepEqual(result.sheets.map(s=>s.valid),[false,false,false,false,false,true]);
});

test('cross-sheet and existing duplicates and invalid rows are skipped with their sheet names',()=>{
  const existing=[{id:'existing',name:'Anna',class:'3A'}];
  const result=parseStudentSheets([
    {name:'3A',rows:[['Naam','Klas'],['Anna','3A'],['Emma','3A'],['','3A']]},
    {name:'Kopie',rows:[['Naam','Klas'],['Emma','3A'],['Emma','4B']]}
  ],existing);
  assert.deepEqual(result.students.map(p=>[p.name,p.class]),[['Emma','3A'],['Emma','4B']]);
  assert.equal(result.errors.length,3);assert.equal(result.errors.filter(e=>e.includes('Werkblad “3A”')).length,2);
  assert.ok(result.errors.some(e=>e.includes('Werkblad “Kopie”')&&e.includes('al in de lijst')));
  assert.equal(new Set(result.students.map(p=>p.id)).size,2);assert.equal(existing.length,1);
});

test('a workbook with no valid sheets yields no students to replace the current list',()=>{
  const result=parseStudentSheets([{name:'Notities',rows:[['Hallo','Wereld']]}]);
  assert.deepEqual(result.students,[]);assert.deepEqual(result.yearErrors,[]);assert.equal(result.errors.length,1);
});

test('leading empty records do not change CSV delimiter detection or drop pupils',()=>{
  for(const delimiter of [';',',','\t']){
    const result=parseStudents(`\uFEFF\r\n  \r\nNaam${delimiter}Klas\r\n"Anna, Maes"${delimiter}3A\r\nAda${delimiter}4B`);
    assert.deepEqual(result.errors,[]);assert.deepEqual(result.students.map(p=>[p.name,p.class]),[['Anna, Maes','3A'],['Ada','4B']]);
  }
  assert.deepEqual(parseStudents('"Anna\nMaes";3A\rAda;4B').students.map(p=>p.name),['Anna\nMaes','Ada']);
});

test('duplicate detection keeps name and class boundaries even when either contains a pipe',()=>{
  const result=parseStudentRows([['Naam','Klas'],['Ada|3A','4B'],['Ada','3A|4B']]);
  assert.equal(result.students.length,2);assert.deepEqual(result.errors,[]);
});

test('malformed balanced quotes warn and skip only their record instead of altering names',()=>{
  const result=parseStudents('Naam;Klas\nAn"na";3A\n"Ada" extra;4B\n"Valid ""quoted"" name";5C');
  assert.deepEqual(result.students.map(p=>p.name),['Valid "quoted" name']);
  assert.equal(result.errors.length,2);assert.ok(result.errors.every(error=>error.includes('aanhalingstekens')));
  assert.equal(parseStudents('"Naam" extra;Klas\nAda;3A').students.length,0);
});

test('duplicate roster headers are rejected instead of silently choosing a class or attendance value',()=>{
  for(const rows of [
    [['Naam','Klas','Klas'],['Ada','3A','4B']],
    [['Naam','name','Klas'],['Ada','Other','3A']],
    [[...STUDY_HEADERS,'Avondstudie op maandag'],[...['Maes','Ada','3A','Ja','Nee','Nee','Nee'],'Nee']]
  ]){const result=parseStudentRows(rows);assert.equal(result.students.length,0);assert.match(result.errors[0],/Dubbele/);}
});

test('separate standard name columns import and preserve compound surnames used for ordering',()=>{
  const result=parseStudentSheets([{name:'3A',rows:[['Voornaam','Klas','Achternaam'],['Anna','3A','Van den Berg'],['','3A','Solo']]}]);
  assert.deepEqual(result.errors,[]);assert.deepEqual(result.students.map(p=>[p.name,p.firstName,p.lastName]),[['Anna Van den Berg','Anna','Van den Berg'],['Solo','','Solo']]);
  assert.deepEqual(studyRows(result.students).map(row=>row.slice(0,3)),[['Van den Berg','Anna','3A'],['Solo','','3A']]);
});
