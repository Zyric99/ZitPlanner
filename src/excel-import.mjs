const MAIN_NS='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL_NS='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const MAX_BYTES=32*1024*1024;
const crcTable=Uint32Array.from({length:256},(_,i)=>{for(let bit=0;bit<8;bit++)i=i&1?0xedb88320^(i>>>1):i>>>1;return i>>>0;});
function crc32(bytes) {let crc=0xffffffff;for(const byte of bytes)crc=crcTable[(crc^byte)&255]^(crc>>>8);return (crc^0xffffffff)>>>0;}
function xmlDocument(text) {
  const document=new DOMParser().parseFromString(text,'application/xml');
  if(document.getElementsByTagName('parsererror').length)throw Error('Het Excelbestand bevat ongeldige XML.');
  return document;
}
const elements=(node,name)=>Array.from(node.getElementsByTagNameNS(MAIN_NS,name));
const cellText=node=>elements(node,'t').filter(t=>t.parentNode.localName!=='rPh').map(t=>t.textContent).join('');

// Read central-directory sizes: Excel commonly writes compressed ZIP entries
// with data descriptors, so local headers alone do not provide reliable sizes.
export async function workbookSheets(input) {
  const bytes=input instanceof Uint8Array?input:new Uint8Array(input);
  if(bytes.length>MAX_BYTES)throw Error('Het Excelbestand is te groot (maximaal 32 MB).');
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),decoder=new TextDecoder();
  const bad=()=>Error('Dit is geen geldig .xlsx-bestand. Bewaar het bestand als Excel-werkmap (.xlsx).');
  if(bytes.length<22)throw bad();
  let end=bytes.length-22;
  for(;end>=Math.max(0,bytes.length-65557);end--)if(view.getUint32(end,true)===0x06054b50&&end+22+view.getUint16(end+20,true)===bytes.length)break;
  if(end<0||end<bytes.length-65557)throw bad();
  if(view.getUint16(end+4,true)||view.getUint16(end+6,true))throw bad();
  const count=view.getUint16(end+10,true),centralStart=view.getUint32(end+16,true);
  if(count!==view.getUint16(end+8,true)||centralStart+view.getUint32(end+12,true)!==end)throw bad();
  let cursor=centralStart,total=0;
  const entries=new Map();
  for(let i=0;i<count;i++) {
    if(cursor+46>end||view.getUint32(cursor,true)!==0x02014b50)throw bad();
    const flags=view.getUint16(cursor+8,true),method=view.getUint16(cursor+10,true),crc=view.getUint32(cursor+16,true),size=view.getUint32(cursor+20,true),expanded=view.getUint32(cursor+24,true),length=view.getUint16(cursor+28,true),extra=view.getUint16(cursor+30,true),comment=view.getUint16(cursor+32,true),offset=view.getUint32(cursor+42,true);
    if(cursor+46+length+extra+comment>end||flags&1||offset+30>bytes.length||view.getUint32(offset,true)!==0x04034b50)throw bad();
    const name=decoder.decode(bytes.subarray(cursor+46,cursor+46+length));
    if(entries.has(name)||view.getUint16(offset+6,true)!==flags||view.getUint16(offset+8,true)!==method)throw bad();
    total+=expanded;if(total>MAX_BYTES)throw Error('De uitgepakte Excelgegevens zijn te groot (maximaal 32 MB).');
    const start=offset+30+view.getUint16(offset+26,true)+view.getUint16(offset+28,true);
    if(start+size>centralStart||decoder.decode(bytes.subarray(offset+30,offset+30+view.getUint16(offset+26,true)))!==name)throw bad();
    entries.set(name,{start,size,expanded,method,crc});cursor+=46+length+extra+comment;
  }
  if(cursor!==end)throw bad();
  async function read(name) {
    const entry=entries.get(name);if(!entry)throw bad();
    let data=bytes.subarray(entry.start,entry.start+entry.size);
    if(entry.method===8){const stream=new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));const chunks=[];let length=0;for await(const chunk of stream){length+=chunk.length;if(length>entry.expanded||length>MAX_BYTES)throw bad();chunks.push(chunk);}data=new Uint8Array(length);let at=0;for(const chunk of chunks){data.set(chunk,at);at+=chunk.length;}}
    else if(entry.method!==0)throw bad();
    if(data.length!==entry.expanded||crc32(data)!==entry.crc)throw Error('Het Excelbestand is beschadigd: de gegevenscontrole klopt niet.');return xmlDocument(decoder.decode(data));
  }
  const workbook=await read('xl/workbook.xml'),rels=await read('xl/_rels/workbook.xml.rels');
  const targets=new Map(Array.from(rels.documentElement.children).filter(r=>r.getAttribute('TargetMode')!=='External').map(r=>[r.getAttribute('Id'),r.getAttribute('Target')]));
  const shared=entries.has('xl/sharedStrings.xml')?elements(await read('xl/sharedStrings.xml'),'si').map(cellText):[];
  const sheets=[];
  for(const sheet of elements(workbook,'sheet')) {
    try {
    const target=targets.get(sheet.getAttributeNS(REL_NS,'id'));if(!target)throw bad();
    const path=[];for(const part of (target.startsWith('/')?target.slice(1):`xl/${target}`).split('/')){if(part==='..')path.pop();else if(part!=='.'&&part)path.push(part);}
    const document=await read(path.join('/')),rows=[];
    if(document.documentElement.namespaceURI!==MAIN_NS||document.documentElement.localName!=='worksheet')throw bad();
    for(const row of elements(document,'row')) {
      const reference=row.getAttribute('r'),index=reference===null?rows.length+1:Number(reference);if(!Number.isInteger(index)||index<1||index>100000||rows[index-1])throw bad();
      const values=[];
      for(const cell of elements(row,'c')) {
        const reference=cell.getAttribute('r'),match=reference?.match(/^([A-Z]+)([1-9]\d*)$/);
        if(reference!==null&&(!match||Number(match[2])!==index))throw bad();
        const letters=match?.[1];let col=letters?0:values.length+1;
        if(letters)for(const letter of letters)col=col*26+letter.charCodeAt(0)-64;
        if(col<1||col>16384||Object.hasOwn(values,col-1))throw bad();
        const type=cell.getAttribute('t'),value=elements(cell,'v')[0]?.textContent??'';
        if(elements(cell,'f').length&&value==='')throw Error(`Werkblad ${sheet.getAttribute('name')}: een formule heeft geen opgeslagen waarde. Open en bewaar het bestand eerst in Excel.`);
        if(type==='e')throw Error(`Werkblad ${sheet.getAttribute('name')}: een cel bevat een Excel-fout (${value}). Corrigeer de fout eerst in Excel.`);
        if(type==='s'&&(!/^\d+$/.test(value)||!Object.hasOwn(shared,Number(value))))throw Error('Het Excelbestand bevat een ongeldige tekstverwijzing.');
        if(type==='b'&&!['0','1'].includes(value))throw bad();
        values[col-1]=type==='s'?shared[Number(value)]??'':type==='inlineStr'?cellText(cell):type==='b'?(value==='1'?'Ja':'Nee'):value;
      }
      rows[index-1]=values;
    }
    sheets.push({name:sheet.getAttribute('name'),rows:Array.from(rows,row=>row??[])});
    }catch(error){sheets.push({name:sheet.getAttribute('name'),rows:[],error:error.message});}
  }
  if(!sheets.length)throw bad();return sheets;
}
