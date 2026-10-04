import { inferYear, studentYearErrors } from './student-year.mjs';
export { inferYear } from './student-year.mjs';
export const STUDY_DAYS=['maandag','dinsdag','donderdag','vrijdag'];
export const STUDY_HEADERS=['Naam hoofdaccount','Voornaam hoofdaccount','Klas',...STUDY_DAYS.map(day=>`Avondstudie op ${day}`)];
const normalized=value=>String(value??'').trim().toLocaleLowerCase('nl');
const normalizedName=value=>normalized(value).replace(/\s+/g,' ');
const studentKey=(name,klass)=>JSON.stringify([normalized(name),normalized(klass)]);

// CSV/TSV records may contain quoted delimiters, escaped quotes and newlines.
export function textRows(text) {
  text=String(text).replace(/^\uFEFF/,'');
  // Delimiter discovery uses the first complete nonempty record, including
  // quoted line breaks, rather than an empty or truncated physical line.
  let end=text.search(/\S/),inQuote=false;
  if(end<0)end=text.length;
  const start=end;
  for(;end<text.length;end++){
    if(text[end]==='"'){if(inQuote&&text[end+1]==='"')end++;else inQuote=!inQuote;}
    else if(!inQuote&&['\r','\n'].includes(text[end]))break;
  }
  const first=text.slice(start,end);
  const counts=['\t',';',','].map(delimiter=>{
    let quoted=false,count=0;
    for(let i=0;i<first.length;i++){if(first[i]==='"'){if(quoted&&first[i+1]==='"')i++;else quoted=!quoted;}else if(!quoted&&first[i]===delimiter)count++;}
    return {delimiter,count};
  });
  const delimiter=counts.sort((a,b)=>b.count-a.count)[0].delimiter;
  const rows=[];let row=[],field='',quoted=false,closed=false,invalid=false;
  const finishField=()=>{row.push(field.trim());field='';closed=false;};
  const finishRow=()=>{finishField();if(invalid)row.invalidQuotes=true;rows.push(row);row=[];invalid=false;};
  for(let i=0;i<text.length;i++) {
    const char=text[i];
    if(char==='"'){
      if(quoted&&text[i+1]==='"'){field+='"';i++;}
      else if(quoted){quoted=false;closed=true;}
      else if(!closed&&!field.trim()){quoted=true;field='';}
      else {invalid=true;field+=char;}
    }
    else if(char===delimiter&&!quoted)finishField();
    else if((char==='\n'||char==='\r')&&!quoted){if(char==='\r'&&text[i+1]==='\n')i++;finishRow();}
    else {if(closed&&char.trim())invalid=true;field+=char;}
  }
  if(field||row.length||quoted||closed){if(quoted)invalid=true;finishRow();}
  return rows;
}
export function rowsText(rows) {
  return rows.map(row=>Array.from(row,value=>`"${String(value??'').replaceAll('"','""')}"`).join('\t')).join('\n');
}
export function parseStudentRows(rows,existing=[],{defaultClass=''}={}) {
  defaultClass=String(defaultClass??'').trim();
  const students=[],errors=[],seen=new Set(existing.map(s=>studentKey(s.name,s.class)));
  const firstIndex=rows.findIndex(row=>row.some(value=>String(value??'').trim()));
  if(firstIndex<0)return {students,errors,yearErrors:[]};
  const headers=rows[firstIndex].map(normalized),study=headers.includes('naam hoofdaccount')||headers.includes('voornaam hoofdaccount');
  const splitNames=!study&&headers.includes('achternaam')&&headers.includes('voornaam');
  const standard=!study&&(headers.includes('naam')||headers.includes('name')||splitNames);
  const hasHeader=study||standard;
  const column=label=>headers.indexOf(normalized(label));
  if(rows[firstIndex].invalidQuotes)return {students,errors:[`Regel ${firstIndex+1}: controleer de aanhalingstekens.`],yearErrors:[]};
  const recognized=new Set([...STUDY_HEADERS.map(normalized),'naam','name','achternaam','voornaam']);
  const duplicate=headers.find((label,index)=>recognized.has(label)&&headers.indexOf(label)!==index);
  if(hasHeader&&(duplicate||headers.includes('naam')&&headers.includes('name')))return {students,errors:[`Dubbele naam of kolomkop: ${duplicate||'Naam / name'}.`],yearErrors:[]};
  const required=study?STUDY_HEADERS:standard?(splitNames?['Klas']:['Naam','Klas']):[];
  const missing=required.filter(label=>column(label)<0&&!(label==='Naam'&&headers.includes('name'))&&!(label==='Klas'&&defaultClass));
  if(missing.length)return {students,errors:[`Ontbrekende kolommen: ${missing.join(', ')}.`],yearErrors:[]};
  for(let i=firstIndex+(hasHeader?1:0);i<rows.length;i++) {
    const row=rows[i];if(!row.some(value=>String(value??'').trim()))continue;
    const get=index=>String(row[index]??'').trim();
    const lastName=study?get(column(STUDY_HEADERS[0])):splitNames?get(column('Achternaam')):'',firstName=study?get(column(STUDY_HEADERS[1])):splitNames?get(column('Voornaam')):'';
    const fullNameColumn=column('Naam')>=0?column('Naam'):column('name');
    // Split fields define the displayed name too. A redundant full-name cell
    // must agree before we retain the row, so exports cannot identify someone else.
    const name=study||splitNames?[firstName,lastName].filter(Boolean).join(' '):get(standard?fullNameColumn:0);
    const klass=hasHeader&&column('Klas')<0?defaultClass:get(hasHeader?column('Klas'):1);
    const year=inferYear(klass);
    if(row.invalidQuotes||!name||!klass){errors.push(`Regel ${i+1}: ${row.invalidQuotes?'controleer de aanhalingstekens':'naam en klas zijn verplicht'}.`);continue;}
    if((study||splitNames)&&fullNameColumn>=0&&get(fullNameColumn)&&normalizedName(get(fullNameColumn))!==normalizedName(name)) {
      errors.push(`Regel ${i+1}: de volledige naam (${column('Naam')>=0?'Naam':'name'}) komt niet overeen met de voornaam en achternaam. Corrigeer de naamkolommen.`);continue;
    }
    const eveningStudy={};let invalid=false;
    if(study)for(const day of STUDY_DAYS){const value=get(column(`Avondstudie op ${day}`)),key=normalized(value);if(!['ja','nee',''].includes(key)){errors.push(`Regel ${i+1}: avondstudie op ${day} moet Ja, Nee of leeg zijn.`);invalid=true;}eveningStudy[day]=key==='ja'?'Ja':key==='nee'?'Nee':'';}
    if(invalid)continue;
    const key=studentKey(name,klass);
    if(seen.has(key)){errors.push(`Regel ${i+1}: ${name} (${klass}) staat al in de lijst.`);continue;}
    seen.add(key);students.push({id:globalThis.crypto.randomUUID(),name,class:klass,year,absent:false,...(study?{firstName,lastName,eveningStudy}:splitNames?{firstName,lastName}:{})});
  }
  return {students,errors,yearErrors:studentYearErrors(students)};
}
export function parseStudents(text,existing=[]) {return parseStudentRows(textRows(text),existing);}

export function parseStudentSheets(sheets,existing=[],{classFromSheetName=false}={}) {
  const students=[],errors=[],reports=[];
  for(const sheet of sheets) {
    const name=String(sheet.name??'Werkblad'),rows=sheet.rows??[];
    const options={defaultClass:classFromSheetName?sheet.name:''};
    const header=rows.find(row=>row.some(value=>String(value??'').trim()))?.map(normalized)??[];
    const recognized=['naam','name','naam hoofdaccount','voornaam hoofdaccount'].some(label=>header.includes(label))||header.includes('achternaam')&&header.includes('voornaam');
    const checked=sheet.error||!recognized?null:parseStudentRows(rows,[],options);
    const valid=!!checked?.students.length;
    if(!valid) {
      const reason=sheet.error||(!header.length?'Het werkblad is leeg.':!recognized?'Geen herkenbare leerlingenlijst met kolomkoppen.':checked.errors.join(' ')||'Geen geldige leerlingen.');
      const message=`Werkblad “${name}” overgeslagen: ${reason}`;
      errors.push(message);reports.push({name,valid:false,students:0,errors:[message]});continue;
    }
    const parsed=parseStudentRows(rows,[...existing,...students],options);
    const sheetErrors=parsed.errors.map(error=>`Werkblad “${name}”: ${error}`);
    students.push(...parsed.students);errors.push(...sheetErrors);
    reports.push({name,valid:true,students:parsed.students.length,errors:sheetErrors});
  }
  return {students,errors,yearErrors:studentYearErrors(students),sheets:reports};
}

export function studentNameParts(p) {
  const parts=p.name.trim().split(/\s+/);
  return {firstName:p.firstName??(parts.length>1?parts[0]:''),lastName:p.lastName??(parts.length>1?parts.slice(1).join(' '):p.name)};
}
export function studyRows(students) {
  return students.map(p=>{
    const {firstName,lastName}=studentNameParts(p);
    return [lastName,firstName,p.class,...STUDY_DAYS.map(day=>p.eveningStudy?.[day]??'')];
  });
}
