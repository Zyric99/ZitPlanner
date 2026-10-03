import { seatCode, roomStudents } from './engine.mjs';
import { roomState } from './rooms.mjs';
import { STUDY_DAYS, STUDY_HEADERS, studentNameParts } from './student-import.mjs';
import { weeklyRecords } from './weekly-planner.mjs';

export const EXCEL_MIME='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const EXCEL_HEADERS=['Naam','Klas','Leerjaar','Plaats'];
const collator=new Intl.Collator('nl',{sensitivity:'base',numeric:true});
export function compareStudentNames(a,b) {
  const left=studentNameParts(a),right=studentNameParts(b);
  return collator.compare(left.lastName.trim()||a.name,right.lastName.trim()||b.name)||collator.compare(left.firstName,right.firstName)||collator.compare(a.name,b.name)||collator.compare(a.id??'',b.id??'');
}
const nameColumns=[
  {id:'name',label:'Naam',value:r=>r.student.name,selected:true},
  {id:'lastName',label:'Achternaam',value:r=>studentNameParts(r.student).lastName},
  {id:'firstName',label:'Voornaam',value:r=>studentNameParts(r.student).firstName},
  {id:'class',label:'Klas',value:r=>r.student.class,selected:true},
  {id:'year',label:'Leerjaar',value:r=>r.student.year,selected:true}
];
export function exportColumns(format='xlsx',{allRooms=false,week=false}={}) {
  if(format==='study-xlsx')return [
    {id:'lastName',label:'Achternaam',header:STUDY_HEADERS[0],value:r=>studentNameParts(r.student).lastName,selected:true},
    {id:'firstName',label:'Voornaam',header:STUDY_HEADERS[1],value:r=>studentNameParts(r.student).firstName,selected:true},
    nameColumns.find(c=>c.id==='class'),
    ...STUDY_DAYS.map((day,i)=>({id:day,label:`Avondstudie op ${day}`,header:STUDY_HEADERS[i+3],value:r=>r.student.eveningStudy?.[day]??'',selected:true})),
    {id:'room',label:'Lokaal',value:r=>r.room,selected:false},
    {id:'seat',label:'Plaats',value:r=>r.seat,selected:false}
  ];
  return [...(week?[{id:'day',label:'Dag',value:r=>r.day,selected:true}]:[]),...nameColumns,
    {id:'room',label:'Lokaal',value:r=>r.room,selected:allRooms||week},
    {id:'seat',label:'Plaats',value:r=>r.seat,selected:true}];
}
function selectedColumns(format,options) {
  const available=exportColumns(format,options),ids=options.columns??available.filter(c=>c.selected).map(c=>c.id);
  if(!Array.isArray(ids)||ids.some(id=>!available.some(c=>c.id===id)))throw Error('Onbekende exportkolom.');
  const columns=[...new Set(ids)].map(id=>available.find(c=>c.id===id));
  if(!columns.length)throw Error('Kies minstens één kolom om te exporteren.');
  return columns;
}
function studentPositions(state,{allRooms=false}={}) {
  const positions=new Map(),multiple=allRooms&&state.rooms;
  if(multiple)for(const room of state.rooms){const view=roomState(state,room.id);for(const [seat,id] of Object.entries(view.assignments))positions.set(id,seatCode(seat,view.settings));}
  else for(const [seat,id] of Object.entries(state.assignments))positions.set(id,seatCode(seat,state.settings));
  return positions;
}
const studentRoomName=(state,student)=>state.rooms?.find(r=>r.id===state.studentRooms?.[student.id])?.name||'Nog geen lokaal';
function seatingRecords(state,{allRooms=false}={}) {
  const positions=studentPositions(state,{allRooms}),multiple=allRooms&&state.rooms;
  return (multiple?state.students:roomStudents(state)).filter(p=>!p.absent).map(student=>({student,room:studentRoomName(state,student),seat:positions.get(student.id)||'Nog niet geplaatst'}));
}
export function seatingRows(state,options={}) {
  const columns=selectedColumns('xlsx',options);
  return seatingRecords(state,options).sort((a,b)=>compareStudentNames(a.student,b.student)).map(r=>columns.map(c=>c.value(r)));
}
const xml=value=>String(value??'').toWellFormed().replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g,'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const declaration='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const spreadsheetNS='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const relationshipNS='http://schemas.openxmlformats.org/officeDocument/2006/relationships';

// Small, dependency-free OOXML package: all student data is stored as literal
// text, never formulas. ZIP storage works in the browser and sandboxed Electron.
const crcTable=Uint32Array.from({length:256},(_,i)=>{for(let n=0;n<8;n++)i=i&1?0xedb88320^(i>>>1):i>>>1;return i>>>0;});
function crc32(bytes) { let crc=0xffffffff;for(const byte of bytes)crc=crcTable[(crc^byte)&255]^(crc>>>8);return (crc^0xffffffff)>>>0; }
function zip(files) {
  const encoder=new TextEncoder(),entries=Object.entries(files).map(([name,body])=>({name:encoder.encode(name),data:encoder.encode(declaration+body)}));
  const localSize=entries.reduce((n,e)=>n+30+e.name.length+e.data.length,0),centralSize=entries.reduce((n,e)=>n+46+e.name.length,0);
  const bytes=new Uint8Array(localSize+centralSize+22),view=new DataView(bytes.buffer);let cursor=0;
  for(const e of entries) {
    e.offset=cursor;e.crc=crc32(e.data);
    view.setUint32(cursor,0x04034b50,true);view.setUint16(cursor+4,20,true);view.setUint16(cursor+6,0x800,true);view.setUint16(cursor+12,33,true);
    view.setUint32(cursor+14,e.crc,true);view.setUint32(cursor+18,e.data.length,true);view.setUint32(cursor+22,e.data.length,true);view.setUint16(cursor+26,e.name.length,true);
    bytes.set(e.name,cursor+30);bytes.set(e.data,cursor+30+e.name.length);cursor+=30+e.name.length+e.data.length;
  }
  for(const e of entries) {
    view.setUint32(cursor,0x02014b50,true);view.setUint16(cursor+4,20,true);view.setUint16(cursor+6,20,true);view.setUint16(cursor+8,0x800,true);view.setUint16(cursor+14,33,true);
    view.setUint32(cursor+16,e.crc,true);view.setUint32(cursor+20,e.data.length,true);view.setUint32(cursor+24,e.data.length,true);view.setUint16(cursor+28,e.name.length,true);view.setUint32(cursor+42,e.offset,true);
    bytes.set(e.name,cursor+46);cursor+=46+e.name.length;
  }
  view.setUint32(cursor,0x06054b50,true);view.setUint16(cursor+8,entries.length,true);view.setUint16(cursor+10,entries.length,true);view.setUint32(cursor+12,centralSize,true);view.setUint32(cursor+16,localSize,true);
  return bytes;
}

function classWorkbook(records,columns,{emptyName='Leerlingen',separateClasses=true}={}) {
  const headers=columns.map(c=>c.header??c.label);
  if(!separateClasses)return tableWorkbook(headers,[...records].sort((a,b)=>compareStudentNames(a.student,b.student)).map(r=>columns.map(c=>c.value(r))),{sheetName:emptyName});
  const groups=new Map();
  for(const record of records){const klass=String(record.student.class??'').trim();if(!groups.has(klass))groups.set(klass,[]);groups.get(klass).push(record);}
  const sheets=[...groups].sort(([a],[b])=>collator.compare(a,b)).map(([klass,entries],i)=>({
    sheetName:klass||'Zonder klas',tableName:`Klas_${i+1}`,headers,
    rows:entries.sort((a,b)=>compareStudentNames(a.student,b.student)).map(r=>columns.map(c=>c.value(r)))
  }));
  return tablesWorkbook(sheets.length?sheets:[{sheetName:emptyName,headers,rows:[]}]);
}
export function seatingWorkbook(state,options={}) {return classWorkbook(seatingRecords(state,options),selectedColumns('xlsx',options),{emptyName:'Zitplaatsen',separateClasses:options.separateClasses});}
export function studyWorkbook(state,options={}) {
  const positions=studentPositions(state,{allRooms:true});
  return classWorkbook(state.students.map(student=>({student,room:studentRoomName(state,student),seat:positions.get(student.id)||'Nog niet geplaatst'})),selectedColumns('study-xlsx',options),{separateClasses:options.separateClasses});
}
export function weeklyWorkbook(state,options={}) {return classWorkbook(weeklyRecords(state),selectedColumns('xlsx',{...options,week:true}),{emptyName:'Weekindeling',separateClasses:options.separateClasses});}

function uniqueSheetName(value,used) {
  const base=String(value??'Werkblad').toWellFormed().replace(/[\u0000-\u001f\ufffe\uffff\[\]:*?/\\]/g,' ').trim().replace(/^'+|'+$/g,'')||'Werkblad';
  let name=base.slice(0,31).replace(/'+$/g,''),suffix=1;
  while(name.toLocaleLowerCase('nl')==='history'||used.has(name.toLocaleLowerCase('nl'))){const tail=` (${++suffix})`;name=base.slice(0,31-tail.length).replace(/'+$/g,'')+tail;}
  used.add(name.toLocaleLowerCase('nl'));return name;
}
function columnName(index) {let name='';for(index++;index>0;index=Math.floor((index-1)/26))name=String.fromCharCode(65+(index-1)%26)+name;return name;}
export function tableWorkbook(headers,rows,options={}) {return tablesWorkbook([{headers,rows,sheetName:'Zitplaatsen',tableName:'Zitplaatsen',...options}]);}
function tablesWorkbook(sheets) {
  const used=new Set(),names=[],printAreas=[],relationships=[],types=[],files={};
  sheets.forEach((sheet,index)=>{
    const id=index+1,sheetName=uniqueSheetName(sheet.sheetName,used),headers=sheet.headers,rows=sheet.rows;
    if(!headers.length)throw Error('Kies minstens één kolom om te exporteren.');
    const parts=worksheetFiles(headers,rows,{id,tableName:sheet.tableName??`Tabel_${id}`});
    // Each worksheet owns its table relationship; workbook styles are shared.
    Object.assign(files,parts);
    if(rows.length){types.push(`<Override PartName="/xl/tables/table${id}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml"/>`);}
    names.push(`<sheet name="${xml(sheetName)}" sheetId="${id}" r:id="rId${id}"/>`);
    const quoted=xml(sheetName.replaceAll("'","''"));
    printAreas.push(`<definedName name="_xlnm.Print_Area" localSheetId="${index}">'${quoted}'!$A$1:$${columnName(headers.length-1)}$${rows.length+1}</definedName><definedName name="_xlnm.Print_Titles" localSheetId="${index}">'${quoted}'!$1:$1</definedName>`);
    relationships.push(`<Relationship Id="rId${id}" Type="${relationshipNS}/worksheet" Target="worksheets/sheet${id}.xml"/>`);
    types.push(`<Override PartName="/xl/worksheets/sheet${id}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`);
  });
  files['[Content_Types].xml']=`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${types.join('')}</Types>`;
  files['_rels/.rels']=`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${relationshipNS}/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
  files['xl/workbook.xml']=`<workbook xmlns="${spreadsheetNS}" xmlns:r="${relationshipNS}"><bookViews><workbookView/></bookViews><sheets>${names.join('')}</sheets><definedNames>${printAreas.join('')}</definedNames></workbook>`;
  files['xl/_rels/workbook.xml.rels']=`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relationships.join('')}<Relationship Id="rId${sheets.length+1}" Type="${relationshipNS}/styles" Target="styles.xml"/></Relationships>`;
  return zip(files);
}
function worksheetFiles(headers,rows,{id,tableName}) {
  const all=[headers,...rows],last=all.length,lastColumn=columnName(headers.length-1),range=`A1:${lastColumn}${last}`;
  const widths=headers.map((header,col)=>Math.min(col===0?60:32,Math.max(col===0?28:12,...all.map(row=>String(row[col]).length+3))));
  const sheetRows=all.map((row,i)=>{
    const height=i===0?24:Math.max(20,...row.map((value,col)=>Math.ceil(String(value).length/(widths[col]-2))*15+5));
    return `<row r="${i+1}" ht="${height}" customHeight="1">${row.map((value,col)=>`<c r="${columnName(col)}${i+1}" t="inlineStr" s="${i===0?1:0}"><is><t xml:space="preserve">${xml(value)}</t></is></c>`).join('')}</row>`;
  }).join('');
  const files={
    'xl/styles.xml':`<styleSheet xmlns="${spreadsheetNS}"><fonts count="2"><font><sz val="11"/><color rgb="FF263A35"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF27745C"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="49" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center"/></xf><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles><dxfs count="0"/><tableStyles count="0" defaultTableStyle="TableStyleMedium4" defaultPivotStyle="PivotStyleLight16"/></styleSheet>`,
    [`xl/worksheets/sheet${id}.xml`]:`<worksheet xmlns="${spreadsheetNS}" xmlns:r="${relationshipNS}"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="${range}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="20"/><cols>${widths.map((width,i)=>`<col min="${i+1}" max="${i+1}" width="${width}" customWidth="1"/>`).join('')}</cols><sheetData>${sheetRows}</sheetData><printOptions horizontalCentered="1"/><pageMargins left="0.3" right="0.3" top="0.4" bottom="0.4" header="0.2" footer="0.2"/><pageSetup paperSize="9" orientation="portrait" fitToWidth="1" fitToHeight="0"/><headerFooter><oddFooter>&amp;CPagina &amp;P van &amp;N</oddFooter></headerFooter>${rows.length?'<tableParts count="1"><tablePart r:id="rId1"/></tableParts>':''}</worksheet>`
  };
  if(rows.length) {
    files[`xl/worksheets/_rels/sheet${id}.xml.rels`]=`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${relationshipNS}/table" Target="../tables/table${id}.xml"/></Relationships>`;
    files[`xl/tables/table${id}.xml`]=`<table xmlns="${spreadsheetNS}" id="${id}" name="${xml(tableName)}" displayName="${xml(tableName)}" ref="${range}" totalsRowShown="0"><autoFilter ref="${range}"/><tableColumns count="${headers.length}">${headers.map((name,i)=>`<tableColumn id="${i+1}" name="${xml(name)}"/>`).join('')}</tableColumns><tableStyleInfo name="TableStyleMedium4" showFirstColumn="0" showLastColumn="0" showRowStripes="1" showColumnStripes="0"/></table>`;
  }
  return files;
}
