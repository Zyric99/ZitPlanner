import test from 'node:test';
import assert from 'node:assert/strict';
import { legacyDefaults as defaults, BENCHES, seatCode } from '../src/engine.mjs';
import { seatingRows, seatingWorkbook, studyWorkbook, weeklyWorkbook, exportColumns, EXCEL_HEADERS, EXCEL_MIME } from '../src/excel-export.mjs';
import { setCalendarEnabled, openCalendarDate, saveCalendarPeriod, saveCalendarAttendance, deleteCalendarDay, captureCalendarDay } from '../src/calendar-model.mjs';
import { setStudentAttendance, resetStudentAttendance } from '../src/attendance.mjs';
import { STUDY_HEADERS } from '../src/student-import.mjs';
import { generateWeek } from '../src/weekly-planner.mjs';
import { initializeRooms, newRoom, assignRoom, normalizeRooms } from '../src/rooms.mjs';
function files(bytes) {
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),decoder=new TextDecoder(),result={};let cursor=0;
  while(view.getUint32(cursor,true)===0x04034b50) {
    assert.equal(view.getUint16(cursor+8,true),0);const size=view.getUint32(cursor+18,true),nameLength=view.getUint16(cursor+26,true),extraLength=view.getUint16(cursor+28,true),start=cursor+30+nameLength+extraLength;
    const name=decoder.decode(bytes.subarray(cursor+30,cursor+30+nameLength));result[name]=decoder.decode(bytes.subarray(start,start+size));cursor=start+size;
  }
  assert.equal(view.getUint32(cursor,true),0x02014b50);assert.equal(view.getUint32(bytes.length-22,true),0x06054b50);return result;
}
function fixture() { const s=defaults();s.students=[
  {id:'e',name:'Emma Peeters',class:'4B',year:'4',absent:false},
  {id:'l',name:'Lucas Maes',class:'3A',year:'3',absent:false},
  {id:'n',name:'Noah Jacobs',class:'4A',year:'4',absent:false},
  {id:'u',name:'Sofie Wouters',class:'3B',year:'3',absent:false},
  {id:'x',name:'Absent',class:'3A',year:'3',absent:true}
 ];s.assignments={'B1:0':'n','A1:1':'l','A1:0':'e','C3:0':'x'};return s; }
function rows(parts,id=1) {
  return [...parts[`xl/worksheets/sheet${id}.xml`].matchAll(/<row\b[^>]*>(.*?)<\/row>/g)].map(row=>[...row[1].matchAll(/<t\b[^>]*>(.*?)<\/t>/g)].map(cell=>cell[1].replace(/&(?:amp|lt|gt|quot|apos);/g,value=>({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'"}[value]))));
}
test('seat codes use one real letter/seat-row identifier, including K and Z',()=>{
  assert.deepEqual(['A1:0','A1:1','B1:0','C3:0','K3:1','Z3:0'].map(seatCode),['A1','A2','B1','C3','K4','Z3']);assert.equal(seatCode('K1:0'),'');
  const codes=BENCHES.flatMap(b=>[seatCode(`${b.id}:0`),seatCode(`${b.id}:1`)]);assert.equal(codes.length,190);assert.equal(new Set(codes).size,190);assert.ok(codes.every(code=>/^[A-Z][1-8]$/.test(code)));
});
test('Excel defaults to Naam, Klas, Leerjaar, Plaats and sorts surnames independently of seats',()=>{
  assert.deepEqual(EXCEL_HEADERS,['Naam','Klas','Leerjaar','Plaats']);assert.deepEqual(seatingRows(fixture()),[['Noah Jacobs','4A','4','B1'],['Lucas Maes','3A','3','A2'],['Emma Peeters','4B','4','A1'],['Sofie Wouters','3B','3','Nog niet geplaatst']]);
});
test('workbook has an alphabetically ordered tab and a filterable printable table for every class',()=>{
  const s=fixture(),original=structuredClone(s),bytes=seatingWorkbook(s),parts=files(bytes);assert.deepEqual(s,original);assert.equal(EXCEL_MIME,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  assert.match(parts['[Content_Types].xml'],/spreadsheetml.sheet.main\+xml/);
  assert.deepEqual([...parts['xl/workbook.xml'].matchAll(/<sheet name="([^"]+)"/g)].map(m=>m[1]),['3A','3B','4A','4B']);
  for(let id=1;id<=4;id++){
    const sheet=parts[`xl/worksheets/sheet${id}.xml`],table=parts[`xl/tables/table${id}.xml`];
    assert.match(sheet,/state="frozen"/);assert.match(sheet,/fitToWidth="1"/);assert.ok(!sheet.includes('Absent'));
    assert.match(table,/<autoFilter ref="A1:D2"/);assert.match(table,/tableColumns count="4"/);assert.match(table,new RegExp(`id="${id}" name="Klas_${id}"`));
    assert.match(parts[`xl/worksheets/_rels/sheet${id}.xml.rels`],new RegExp(`Target="../tables/table${id}.xml"`));
    assert.match(parts['xl/_rels/workbook.xml.rels'],new RegExp(`Id="rId${id}"[^>]+Target="worksheets/sheet${id}.xml"`));
    assert.match(parts['xl/workbook.xml'],new RegExp(`Print_Titles" localSheetId="${id-1}"`));
    assert.match(parts['[Content_Types].xml'],new RegExp(`/xl/worksheets/sheet${id}.xml`));
  }
});
test('names and other user text remain literal text, with XML escaping and Unicode preserved',()=>{
  const s=fixture();s.students[0].name='=HYPERLINK("x") & Zoë <Maes>\u0001';s.students[0].class='04B';
  const parts=files(seatingWorkbook(s)),sheet=Object.entries(parts).filter(([name])=>/^xl\/worksheets\/sheet\d+\.xml$/.test(name)).map(([,body])=>body).join('');assert.match(sheet,/=HYPERLINK\(&quot;x&quot;\) &amp; Zoë &lt;Maes&gt;/);assert.ok(!sheet.includes('\u0001'));assert.ok(!sheet.includes('<f>'));assert.match(sheet,/t="inlineStr"/);assert.match(sheet,/>04B</);
});
test('empty roster exports a valid headers-only workbook without a broken empty table',()=>{
  const parts=files(seatingWorkbook(defaults()));assert.match(parts['xl/worksheets/sheet1.xml'],/dimension ref="A1:D1"/);assert.ok(!parts['xl/worksheets/sheet1.xml'].includes('<tableParts'));assert.equal(parts['xl/tables/table1.xml'],undefined);
});
test('capacity export maps all 190 seats once without technical colon suffixes',()=>{
  const s=defaults();let i=0;for(const b of BENCHES)for(const side of [0,1]){const id=`s${i++}`;s.students.push({id,name:`Student ${i}`,class:'4B',year:'4',absent:false});s.assignments[`${b.id}:${side}`]=id;}
  const rows=seatingRows(s);assert.equal(rows.length,190);assert.equal(new Set(rows.map(r=>r[3])).size,190);assert.ok(rows.every(r=>!r[3].includes(':')));assert.match(files(seatingWorkbook(s))['xl/tables/table1.xml'],/ref="A1:D191"/);
});
test('stored compound surnames, accents, fallback names and equal-surname first names sort correctly',()=>{
  const s=defaults();s.students=[
    {id:'a',name:'Zoe Aard',firstName:'Zoe',lastName:'Van den Berg',class:'3A'},
    {id:'b',name:'Zara Éclair',class:'3A'},
    {id:'c',name:'Anna van den Berg',class:'3A'},
    {id:'d',name:'Noah Maes',class:'3A'},
    {id:'e',name:'Ada Maes',class:'3A'},
    {id:'f',name:'Alice',class:'3A'}
  ];
  assert.deepEqual(seatingRows(s,{columns:['name']}).flat(),['Alice','Zara Éclair','Ada Maes','Noah Maes','Anna van den Berg','Zoe Aard']);
  assert.deepEqual(rows(files(seatingWorkbook(s,{columns:['lastName','firstName']}))),[
    ['Achternaam','Voornaam'],['Alice',''],['Éclair','Zara'],['Maes','Ada'],['Maes','Noah'],['van den Berg','Anna'],['Van den Berg','Zoe']
  ]);
});
test('column selection omits data but preserves class grouping and surname sorting',()=>{
  const s=fixture();s.students.forEach(p=>p.class=p.id==='u'?'10B':'2A');
  const parts=files(seatingWorkbook(s,{columns:['seat']}));
  assert.deepEqual(rows(parts),[['Plaats'],['B1'],['A2'],['A1']]);assert.deepEqual(rows(parts,2),[['Plaats'],['Nog niet geplaatst']]);
  assert.match(parts['xl/workbook.xml'],/name="2A".*name="10B"/);
  assert.match(parts['xl/tables/table1.xml'],/ref="A1:A4"/);assert.match(parts['xl/tables/table1.xml'],/tableColumns count="1"/);
  assert.ok(!parts['xl/worksheets/sheet1.xml'].includes('Peeters'));assert.ok(!parts['xl/worksheets/sheet1.xml'].includes('2A'));
  assert.throws(()=>seatingWorkbook(s,{columns:[]}),/minstens één/);assert.throws(()=>seatingWorkbook(s,{columns:['unknown']}),/Onbekende/);
  assert.throws(()=>studyWorkbook(s,{columns:[]}),/minstens één/);
});
test('Excel tab names are valid and unique even when class labels sanitize or truncate to the same name',()=>{
  const s=defaults(),classes=['3/A','3:A','Long class '.repeat(5)+'A','Long class '.repeat(5)+'B',"O'Brien & Co",'History',"'Quoted'",'', '3/a'];
  s.students=classes.map((klass,i)=>({id:String(i),name:`Student ${i}`,class:klass}));
  const parts=files(seatingWorkbook(s)),names=[...parts['xl/workbook.xml'].matchAll(/<sheet name="([^"]+)"/g)].map(m=>m[1].replaceAll('&apos;',"'").replaceAll('&amp;','&'));
  assert.equal(names.length,classes.length);assert.equal(new Set(names.map(n=>n.toLowerCase())).size,classes.length);
  assert.ok(names.every(n=>n.length<=31&&!/[\[\]:*?/\\]/.test(n)&&!n.startsWith("'")&&!n.endsWith("'")&&n.toLowerCase()!=='history'));
  assert.ok(names.includes('Zonder klas'));assert.match(parts['xl/workbook.xml'],/O&apos;&apos;Brien &amp; Co/);
  assert.deepEqual(Object.keys(parts).filter(n=>/^xl\/worksheets\/sheet\d+\.xml$/.test(n)).flatMap((name,i)=>rows(parts,i+1).slice(1).map(row=>row[1])).sort(),classes.sort());
});
test('student-list export includes absent students and optional attendance columns on separate class tabs',()=>{
  const s=fixture();s.students[0].eveningStudy={maandag:'Ja',vrijdag:'Nee'};
  const parts=files(studyWorkbook(s));assert.deepEqual(rows(parts)[0],STUDY_HEADERS);
  assert.equal([1,2,3,4].flatMap(id=>rows(parts,id).slice(1)).length,5);
  const selected=files(studyWorkbook(s,{columns:['lastName','vrijdag']}));
  assert.deepEqual(rows(selected,4),[['Naam hoofdaccount','Avondstudie op vrijdag'],['Peeters','Nee']]);
  assert.equal(exportColumns('study-xlsx').filter(c=>c.selected).length,7);
});

test('example-layout seat export is opt-in and retains every student with readable seat codes',()=>{
  const s=fixture(),before=structuredClone(s);
  assert.equal(exportColumns('study-xlsx').find(c=>c.id==='seat').selected,false);
  assert.deepEqual(rows(files(studyWorkbook(s,{separateClasses:false})))[0],STUDY_HEADERS);
  const exported=rows(files(studyWorkbook(s,{columns:['lastName','seat'],separateClasses:false})));
  assert.deepEqual(exported,[['Naam hoofdaccount','Plaats'],['Absent','C3'],['Jacobs','B1'],['Maes','A2'],['Peeters','A1'],['Wouters','Nog niet geplaatst']]);
  assert.deepEqual(s,before);
});

test('example-layout seats use the current active assignments and the other room layouts',()=>{
  const s=fixture();initializeRooms(s);
  const other=newRoom(s,'Tweede lokaal','default');assignRoom(s,'l',other.id);
  // Active state is newer than its captured room snapshot.
  s.assignments={'grid-B1:1':'e'};
  other.assignments={'grid-C2:0':'l'};
  const before=structuredClone(s);
  const exported=rows(files(studyWorkbook(s,{columns:['lastName','seat'],separateClasses:false})));
  assert.deepEqual(exported,[['Naam hoofdaccount','Plaats'],['Absent','Nog niet geplaatst'],['Jacobs','Nog niet geplaatst'],['Maes','C3'],['Peeters','B2'],['Wouters','Nog niet geplaatst']]);
  assert.deepEqual(s,before);
});
test('weekly export groups classes and keeps each student’s days together in week order',()=>{
  const s=defaults();s.students=[
    {id:'z',name:'Anna Zulu',class:'3A',year:'3',absent:false},
    {id:'b',name:'Zoe Beta',class:'3A',year:'3',absent:false,eveningStudy:{maandag:'Ja',dinsdag:'Nee',donderdag:'Ja',vrijdag:'Nee'}},
    {id:'a',name:'Ada Alpha',class:'4B',year:'4',absent:false}
  ];initializeRooms(s);s.weeklyPlans=generateWeek(s,{iterations:0});
  const parts=files(weeklyWorkbook(s,{columns:['day','name']}));
  assert.deepEqual(rows(parts),[['Dag','Naam'],['Maandag','Zoe Beta'],['Donderdag','Zoe Beta'],['Maandag','Anna Zulu'],['Dinsdag','Anna Zulu'],['Donderdag','Anna Zulu'],['Vrijdag','Anna Zulu']]);
  assert.deepEqual(rows(parts,2).slice(1).map(row=>row[1]),Array(4).fill('Ada Alpha'));
  assert.match(parts['xl/workbook.xml'],/name="3A".*name="4B"/);
  const combined=files(weeklyWorkbook(s,{columns:['day','name'],separateClasses:false}));
  assert.equal(Object.keys(combined).filter(n=>/^xl\/worksheets\/sheet\d+\.xml$/.test(n)).length,1);
  assert.deepEqual(rows(combined).slice(1).map(row=>row[1]),[...Array(4).fill('Ada Alpha'),...Array(2).fill('Zoe Beta'),...Array(4).fill('Anna Zulu')]);
  const reordered=rows(files(weeklyWorkbook(s,{columns:['seat','room','name','day'],separateClasses:false})));
  assert.deepEqual(reordered[0],['Plaats','Lokaal','Naam','Dag']);assert.equal(reordered[1][1],'Standaardlokaal');assert.deepEqual(reordered[1].slice(2),['Ada Alpha','Maandag']);
});
test('separate class tabs can be disabled for seating and student-list exports while retaining surname order',()=>{
  const s=fixture(),original=structuredClone(s);
  const seating=files(seatingWorkbook(s,{columns:['name','class'],separateClasses:false}));
  assert.deepEqual(rows(seating),[['Naam','Klas'],['Noah Jacobs','4A'],['Lucas Maes','3A'],['Emma Peeters','4B'],['Sofie Wouters','3B']]);
  assert.ok(!seating['xl/worksheets/sheet2.xml']);assert.match(seating['xl/workbook.xml'],/name="Zitplaatsen"/);assert.match(seating['xl/tables/table1.xml'],/ref="A1:B5"/);
  const study=files(studyWorkbook(s,{columns:['lastName'],separateClasses:false}));
  assert.deepEqual(rows(study),[['Naam hoofdaccount'],['Absent'],['Jacobs'],['Maes'],['Peeters'],['Wouters']]);
  assert.ok(!study['xl/worksheets/sheet2.xml']);assert.deepEqual(s,original);
});
test('custom column order includes the assigned room name even when different rooms share A1',()=>{
  const s=fixture();initializeRooms(s);s.rooms[0].name='Zaal Oost';
  const other=newRoom(s,'Zaal West','default');assignRoom(s,'l',other.id);assignRoom(s,'u',null);
  s.students.find(p=>p.id==='n').absent=true;
  s.assignments={'grid-A1:0':'e'};other.assignments={'grid-A1:0':'l'};
  const before=structuredClone(s);
  assert.ok(exportColumns().some(c=>c.id==='room'));assert.ok(exportColumns('study-xlsx').some(c=>c.id==='room'));
  const options={allRooms:true,columns:['name','room','seat'],separateClasses:false};
  assert.deepEqual(rows(files(seatingWorkbook(s,options))),[['Naam','Lokaal','Plaats'],['Lucas Maes','Zaal West','A1'],['Emma Peeters','Zaal Oost','A1'],['Sofie Wouters','Nog geen lokaal','Nog niet geplaatst']]);
  assert.deepEqual(rows(files(seatingWorkbook(s,{columns:['seat','room','name'],separateClasses:false}))),[['Plaats','Lokaal','Naam'],['A1','Zaal Oost','Emma Peeters']]);
  const study=rows(files(studyWorkbook(s,{columns:['seat','room','lastName'],separateClasses:false})));
  assert.deepEqual(study[0],['Plaats','Lokaal','Naam hoofdaccount']);assert.deepEqual(study.find(row=>row[2]==='Maes'),['A1','Zaal West','Maes']);
  s.rooms[0].name='Nieuwe naam';assert.equal(rows(files(seatingWorkbook(s,{columns:['room'],separateClasses:false})))[1][0],'Nieuwe naam');
  s.rooms[0].name='Zaal Oost';assert.deepEqual(s,before);
});


test('combined Excel offers unique optional evening-study fields without changing defaults',()=>{
  const columns=exportColumns();assert.equal(new Set(columns.map(c=>c.id)).size,columns.length);
  assert.deepEqual(columns.filter(c=>c.selected).map(c=>c.id),['name','class','year','seat']);
  const s=fixture();s.students[0].eveningStudy={maandag:'Ja',vrijdag:'Nee'};
  const parts=files(seatingWorkbook(s,{columns:['name','vrijdag','maandag'],separateClasses:false}));
  assert.deepEqual(rows(parts)[0],['Naam','Avondstudie op vrijdag','Avondstudie op maandag']);
  assert.deepEqual(rows(parts).find(row=>row[0]==='Emma Peeters'),['Emma Peeters','Nee','Ja']);
});


function cellStylesFor(parts,name,sheetId=1) {
  const row=[...parts[`xl/worksheets/sheet${sheetId}.xml`].matchAll(/<row[^>]*>(.*?)<\/row>/g)].find(match=>match[1].includes(name))?.[1];
  assert.ok(row,`Missing row for ${name}`);
  return [...row.matchAll(/<c[^>]* s="(\d+)"/g)].map(match=>Number(match[1]));
}

test('attendance export colors each saved date independently and grays unrecorded days',()=>{
  const s=fixture();initializeRooms(s);normalizeRooms(s);
  s.students[0].eveningStudy={maandag:'Ja',dinsdag:'Ja',donderdag:'Ja',vrijdag:'Nee'};
  s.students[1].eveningStudy={maandag:'Nee',dinsdag:'Ja',donderdag:'Nee',vrijdag:'Ja'};
  setCalendarEnabled(s,true,'2026-10-05');setStudentAttendance(s,'e',true);
  saveCalendarAttendance(s,'2026-10-05');
  openCalendarDate(s,'2026-10-06');setStudentAttendance(s,'l',true);saveCalendarAttendance(s,'2026-10-06');
  openCalendarDate(s,'2026-10-09');setStudentAttendance(s,'e',true); // Unsaved Friday is still unknown.
  const before=structuredClone(s),options={columns:['name','maandag','dinsdag','donderdag','vrijdag'],separateClasses:false};
  const plain=files(seatingWorkbook(s,options)),colored=files(seatingWorkbook(s,{...options,attendanceColors:true}));
  assert.deepEqual(rows(colored),rows(plain));
  assert.deepEqual(cellStylesFor(colored,'Emma Peeters'),[0,4,3,5,5]);
  assert.deepEqual(cellStylesFor(colored,'Lucas Maes'),[0,0,4,5,5]);
  assert.deepEqual(rows(colored).find(row=>row[0]==='Emma Peeters'),['Emma Peeters','Ja','Ja','Ja','Nee']);
  assert.match(colored['xl/styles.xml'],/color rgb="FF008000"/);assert.match(colored['xl/styles.xml'],/color rgb="FFFF0000"/);assert.match(colored['xl/styles.xml'],/color rgb="FF8A9290"/);
  assert.doesNotMatch(plain['xl/worksheets/sheet1.xml'],/s="[345]"/);
  const separate=files(seatingWorkbook(s,{...options,separateClasses:true,attendanceColors:true}));
  assert.deepEqual(cellStylesFor(separate,'Emma Peeters',4),[0,4,3,5,5]);
  const reordered=files(seatingWorkbook(s,{...options,columns:['vrijdag','name','dinsdag','maandag'],attendanceColors:true}));
  assert.deepEqual(cellStylesFor(reordered,'Emma Peeters'),[5,0,3,4]);
  assert.deepEqual(s,before);
});

test('all Excel workbooks keep Nee black and blank schedules gray even on recorded dates',()=>{
  const s=defaults();s.students=[{id:'e',name:'Emma Peeters',class:'4B',year:'4',absent:false,eveningStudy:{maandag:'',dinsdag:'Nee',donderdag:'Ja',vrijdag:'Nee'}}];
  initializeRooms(s);setCalendarEnabled(s,true,'2026-10-05');setStudentAttendance(s,'e',true);saveCalendarAttendance(s,'2026-10-05');
  openCalendarDate(s,'2026-10-06');saveCalendarAttendance(s,'2026-10-06');
  s.weeklyPlans=generateWeek(s,{iterations:0});
  const before=structuredClone(s),options={columns:['lastName','maandag','dinsdag','donderdag','vrijdag'],separateClasses:false,attendanceColors:true};
  for(const exporter of [seatingWorkbook,studyWorkbook,weeklyWorkbook]) {
    assert.deepEqual(cellStylesFor(files(exporter(s,options)),'Peeters'),[0,5,0,5,5]);
  }
  assert.deepEqual(s,before);
});

test('no calendar, a deleted day or a pupil outside the archived roster never imply presence',()=>{
  const s=fixture();initializeRooms(s);normalizeRooms(s);
  s.students[0].attendanceAbsent=true;s.students[0].eveningStudy={maandag:'Ja',dinsdag:'Ja'};
  const options={columns:['name','maandag','dinsdag'],separateClasses:false,attendanceColors:true,attendanceDate:'2026-10-05'};
  assert.deepEqual(cellStylesFor(files(seatingWorkbook(s,options)),'Emma Peeters'),[0,5,5]);
  setCalendarEnabled(s,true,'2026-10-05');saveCalendarAttendance(s,'2026-10-05');
  openCalendarDate(s,'2026-10-06');saveCalendarPeriod(s,'2026-10-06','day');deleteCalendarDay(s,'2026-10-06');
  s.students.push({id:'new',name:'New Student',class:'4B',year:'4',absent:false,eveningStudy:{maandag:'Ja',dinsdag:'Ja'}});normalizeRooms(s);
  const colored=files(seatingWorkbook(s,options));
  assert.deepEqual(cellStylesFor(colored,'Emma Peeters'),[0,4,5]);
  assert.deepEqual(cellStylesFor(colored,'New Student'),[0,5,5]);
  assert.deepEqual(rows(colored).find(row=>row[0]==='New Student'),['New Student','Ja','Ja']);
});

test('attendance week selection matches exact calendar dates across years for every Excel export',()=>{
  const s=defaults();s.students=[{id:'e',name:'Emma Peeters',class:'4B',year:'4',absent:false,eveningStudy:{maandag:'Ja',dinsdag:'Ja',donderdag:'Ja',vrijdag:'Ja'}}];
  initializeRooms(s);
  setCalendarEnabled(s,true,'2026-12-28');setStudentAttendance(s,'e',true);saveCalendarAttendance(s,'2026-12-28');
  openCalendarDate(s,'2027-01-01');saveCalendarAttendance(s,'2027-01-01');
  s.weeklyPlans=generateWeek(s,{iterations:0});
  const before=structuredClone(s),options={columns:['lastName','maandag','vrijdag'],separateClasses:false,attendanceColors:true};
  for(const exporter of [seatingWorkbook,studyWorkbook,weeklyWorkbook]) {
    assert.deepEqual(cellStylesFor(files(exporter(s,options)),'Peeters'),[0,4,3]);
    assert.deepEqual(cellStylesFor(files(exporter(s,{...options,attendanceDate:'2027-01-04'})),'Peeters'),[0,5,5]);
  }
  assert.deepEqual(s,before);
});

test('Ja and Nee stay gray after layout saving or day switches until attendance is confirmed',()=>{
  const s=fixture();initializeRooms(s);normalizeRooms(s);
  s.students[0].eveningStudy={maandag:'Ja',dinsdag:'Nee',donderdag:'Ja',vrijdag:'Nee'};
  const options={columns:['name','maandag','dinsdag','donderdag','vrijdag'],separateClasses:false,attendanceColors:true};
  setCalendarEnabled(s,true,'2026-10-05');saveCalendarPeriod(s,'2026-10-05','day');
  assert.deepEqual(cellStylesFor(files(seatingWorkbook(s,options)),'Emma Peeters'),[0,5,5,5,5]);
  saveCalendarAttendance(s);
  assert.deepEqual(cellStylesFor(files(seatingWorkbook(s,options)),'Emma Peeters'),[0,3,5,5,5]);
  setStudentAttendance(s,'e',true);captureCalendarDay(s);
  assert.deepEqual(cellStylesFor(files(seatingWorkbook(s,options)),'Emma Peeters'),[0,5,5,5,5]);
  saveCalendarAttendance(s);openCalendarDate(s,'2026-10-06');saveCalendarPeriod(s,'2026-10-06','day');
  assert.deepEqual(cellStylesFor(files(seatingWorkbook(s,options)),'Emma Peeters'),[0,4,5,5,5]);
  saveCalendarAttendance(s);
  assert.deepEqual(cellStylesFor(files(seatingWorkbook(s,options)),'Emma Peeters'),[0,4,0,5,5]);
  resetStudentAttendance(s);captureCalendarDay(s);
  assert.deepEqual(cellStylesFor(files(seatingWorkbook(s,options)),'Emma Peeters'),[0,4,5,5,5]);
});
