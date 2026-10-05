import { inferYear, normalizeYear, setManualYear, studentYearErrors } from './student-year.mjs';
export { inferYear } from './student-year.mjs';
export const STUDY_DAYS=['maandag','dinsdag','donderdag','vrijdag'];
export const STUDY_HEADERS=['Naam hoofdaccount','Voornaam hoofdaccount','Klas',...STUDY_DAYS.map(day=>`Avondstudie op ${day}`)];
const normalized=value=>String(value??'').trim().toLocaleLowerCase('nl');
const normalizedName=value=>normalized(value).replace(/\s+/g,' ');
const studentKey=(name,klass)=>JSON.stringify([normalized(name),normalized(klass)]);
const nameHeader=value=>normalized(value)==='familienaam'?'achternaam':normalized(value)==='full name'?'volledige naam':normalized(value);
function nameColumns(headers) {
  const study=headers.includes('naam hoofdaccount')||headers.includes('voornaam hoofdaccount');
  const first=headers.indexOf(study?'voornaam hoofdaccount':'voornaam');
  // In Dutch rosters, Naam + Voornaam means surname + first name.
  const surnameLabel=study?'naam hoofdaccount':headers.includes('achternaam')?'achternaam':first>=0?'naam':'achternaam';
  const last=headers.indexOf(surnameLabel),split=first>=0&&last>=0;
  const full=headers.findIndex(label=>label==='volledige naam'||label==='name'||label==='naam'&&!(split&&surnameLabel==='naam'));
  return {study,first,last,split,full,recognized:study||split||full>=0||first>=0||last>=0};
}
function splitFullName(name,order) {
  const parts=name.trim().split(/\s+/);
  return parts.length<2?{firstName:'',lastName:name}:order==='last-first'
    ?{firstName:parts.at(-1),lastName:parts.slice(0,-1).join(' ')}
    :{firstName:parts[0],lastName:parts.slice(1).join(' ')};
}

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
export function parseStudentRows(rows,existing=[],{defaultClass='',fullNameOrder='first-last'}={}) {
  defaultClass=String(defaultClass??'').trim();
  const students=[],errors=[],seen=new Set(existing.map(s=>studentKey(s.name,s.class)));
  const firstIndex=rows.findIndex(row=>row.some(value=>String(value??'').trim()));
  if(firstIndex<0)return {students,errors,yearErrors:[]};
  const headers=rows[firstIndex].map(nameHeader),names=nameColumns(headers),study=names.study;
  const splitNames=names.split;
  const standard=!study&&names.recognized;
  const hasHeader=study||standard;
  const hasEveningStudy=study||standard&&STUDY_DAYS.some(day=>headers.includes(normalized(`Avondstudie op ${day}`)));
  const column=label=>headers.indexOf(normalized(label));
  if(rows[firstIndex].invalidQuotes)return {students,errors:[`Regel ${firstIndex+1}: controleer de aanhalingstekens.`],yearErrors:[]};
  const recognized=new Set([...STUDY_HEADERS.map(normalized),'naam','name','volledige naam','achternaam','voornaam','leerjaar']);
  const duplicate=headers.find((label,index)=>recognized.has(label)&&headers.indexOf(label)!==index);
  const fullColumns=headers.filter((label,index)=>['naam','name','volledige naam'].includes(label)&&!(splitNames&&index===names.last));
  if(hasHeader&&(duplicate||fullColumns.length>1))return {students,errors:[`Dubbele naam of kolomkop: ${duplicate||fullColumns.join(' / ')}.`],yearErrors:[]};
  const required=study?STUDY_HEADERS:standard?(splitNames||names.full>=0?['Klas']:['Voornaam','Achternaam','Klas']):[];
  const missing=required.filter(label=>column(label)<0&&!(label==='Klas'&&defaultClass));
  if(missing.length)return {students,errors:[`Ontbrekende kolommen: ${missing.join(', ')}.`],yearErrors:[]};
  for(let i=firstIndex+(hasHeader?1:0);i<rows.length;i++) {
    const row=rows[i];if(!row.some(value=>String(value??'').trim()))continue;
    const get=index=>String(row[index]??'').trim();
    let lastName=study||splitNames?get(names.last):'',firstName=study||splitNames?get(names.first):'';
    const fullNameColumn=names.full;
    // Split fields define the displayed name too. A redundant full-name cell
    // must agree before we retain the row, so exports cannot identify someone else.
    const hasSplitName=(study||splitNames)&&!!(firstName||lastName);
    let name=hasSplitName?[firstName,lastName].filter(Boolean).join(' '):get(hasHeader?fullNameColumn:0);
    const inferredReverse=!hasSplitName&&!!name&&fullNameOrder==='last-first';
    if(inferredReverse){({firstName,lastName}=splitFullName(name,fullNameOrder));name=[firstName,lastName].filter(Boolean).join(' ');}
    const klass=hasHeader&&column('Klas')<0?defaultClass:get(hasHeader?column('Klas'):1);
    const year=inferYear(klass);
    if(row.invalidQuotes||!name||!klass){errors.push(`Regel ${i+1}: ${row.invalidQuotes?'controleer de aanhalingstekens':'naam en klas zijn verplicht'}.`);continue;}
    const suppliedYear=get(hasHeader?column('Leerjaar'):2);
    if(suppliedYear&&!normalizeYear(suppliedYear)){errors.push(`Regel ${i+1}: leerjaar moet een positief geheel getal zijn.`);continue;}
    if(hasSplitName&&fullNameColumn>=0&&get(fullNameColumn)&&![name,[lastName,firstName].filter(Boolean).join(' ')].some(candidate=>normalizedName(get(fullNameColumn))===normalizedName(candidate))) {
      errors.push(`Regel ${i+1}: de volledige naam (${rows[firstIndex][fullNameColumn]}) komt niet overeen met de voornaam en achternaam. Corrigeer de naamkolommen.`);continue;
    }
    const eveningStudy={};let invalid=false;
    if(hasEveningStudy)for(const day of STUDY_DAYS){const value=get(column(`Avondstudie op ${day}`)),key=normalized(value);if(!['ja','nee',''].includes(key)){errors.push(`Regel ${i+1}: avondstudie op ${day} moet Ja, Nee of leeg zijn.`);invalid=true;}eveningStudy[day]=key==='ja'?'Ja':key==='nee'?'Nee':'';}
    if(invalid)continue;
    const key=studentKey(name,klass);
    if(seen.has(key)){errors.push(`Regel ${i+1}: ${name} (${klass}) staat al in de lijst.`);continue;}
    const student={id:globalThis.crypto.randomUUID(),name,class:klass,year,absent:false,...(hasSplitName||inferredReverse?{firstName,lastName}:{}),...(hasEveningStudy?{eveningStudy}:{})};
    if(suppliedYear&&normalizeYear(suppliedYear)!==year)setManualYear(student,suppliedYear);
    seen.add(key);students.push(student);
  }
  return {students,errors,yearErrors:studentYearErrors(students)};
}
export function parseStudents(text,existing=[],options={}) {return parseStudentRows(textRows(text),existing,options);}

export function parseStudentSheets(sheets,existing=[],{classFromSheetName=false,fullNameOrder='first-last'}={}) {
  const students=[],errors=[],reports=[];
  for(const sheet of sheets) {
    const name=String(sheet.name??'Werkblad'),rows=sheet.rows??[];
    const options={defaultClass:classFromSheetName?sheet.name:'',fullNameOrder};
    const header=rows.find(row=>row.some(value=>String(value??'').trim()))?.map(nameHeader)??[];
    const recognized=nameColumns(header).recognized;
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
  const inferred=splitFullName(p.name,'first-last');
  return {firstName:p.firstName??inferred.firstName,lastName:p.lastName??inferred.lastName};
}
export function studyRows(students) {
  return students.map(p=>{
    const {firstName,lastName}=studentNameParts(p);
    return [lastName,firstName,p.class,...STUDY_DAYS.map(day=>p.eveningStudy?.[day]??'')];
  });
}
