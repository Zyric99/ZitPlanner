import test from 'node:test';
import assert from 'node:assert/strict';
import { tableWorkbook } from '../src/excel-export.mjs';
import { workbookSheets } from '../src/excel-import.mjs';

function workbook(){return tableWorkbook(['Naam','Klas'],[['Ada','3A']]);}
function directory(bytes){const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);return {view,end:bytes.length-22,central:view.getUint32(bytes.length-6,true)};}

test('Excel import rejects a stored XML entry whose content no longer matches its checksum',async()=>{
  const bytes=workbook(),{view,central}=directory(bytes);let cursor=central;
  while(view.getUint32(cursor,true)===0x02014b50){
    const length=view.getUint16(cursor+28,true),extra=view.getUint16(cursor+30,true),comment=view.getUint16(cursor+32,true),name=new TextDecoder().decode(bytes.subarray(cursor+46,cursor+46+length));
    if(name==='xl/workbook.xml'){const offset=view.getUint32(cursor+42,true),start=offset+30+view.getUint16(offset+26,true)+view.getUint16(offset+28,true);bytes[start+1]^=1;break;}
    cursor+=46+length+extra+comment;
  }
  await assert.rejects(workbookSheets(bytes),/beschadigd/);
});

test('Excel import rejects inconsistent ZIP entry counts, directory bounds and local metadata',async()=>{
  for(const mutate of [
    (bytes,{view,end})=>view.setUint16(end+8,0,true),
    (bytes,{view,end})=>view.setUint32(end+12,0,true),
    (bytes,{view})=>view.setUint16(8,8,true)
  ]){const bytes=workbook();mutate(bytes,directory(bytes));await assert.rejects(workbookSheets(bytes),/geldig .xlsx/);}
  for(const bytes of [new Uint8Array(),new Uint8Array([1,2,3])])await assert.rejects(workbookSheets(bytes),/geldig .xlsx/);
});
