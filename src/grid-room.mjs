// Grid cells determine chair codes and logical positions. Gaps and section
// widths affect only drawing coordinates; section membership identifies rule
// areas. Bench ids survive a move to another cell or section.
// FIRST_ROW remains the legacy/logical origin so saved positions and ordering
// stay stable. New classrooms explicitly start at 1, with only chair clearance.
import { sectionSeatNames } from './seat-codes.mjs';
export const COLUMN_STEP=6, ROW_STEP=6, FIRST_ROW=6;
export function columnIndex(letter) {
  if(typeof letter!=='string'||!/^[A-Z]{1,2}$/.test(letter))return -1;
  return [...letter].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0)-1;
}
export function columnLetter(index) {
  let out='';do{out=String.fromCharCode(65+index%26)+out;index=Math.floor(index/26)-1;}while(index>=0);return out;
}
export function gridColumns(grid) {
  const from=columnIndex(grid.from),to=columnIndex(grid.to);
  if(from<0||to<from||to>701||!Number.isInteger(grid.rows)||grid.rows<1||grid.rows>100)throw Error('Kies kolommen A–ZZ en 1–100 rijen; de eindkolom moet na de beginkolom liggen.');
  return Array.from({length:to-from+1},(_,i)=>columnLetter(from+i));
}
export function emptyGridRoom() {
  return {kind:'custom',version:2,grid:{from:'A',to:'F',rows:5,firstRow:1},columns:40,rows:40,gaps:[],rowGaps:[],sections:[],removed:[],benches:[],nextManual:1};
}
export function columnX(layout,letter) {return (columnIndex(letter)-columnIndex(layout.grid.from))*(layout.grid.columnStep??COLUMN_STEP);}
export function rowY(layout,row) {return (layout.grid.firstRow??FIRST_ROW)+(row-1)*(layout.grid.rowStep??ROW_STEP);}
export function rowOffset(layout,row) {return (layout.rowGaps??[]).filter(g=>g.after<row).reduce((n,g)=>n+g.width,0);}
export function boundaryValid(layout,after) {return columnIndex(after)>=columnIndex(layout.grid.from)&&columnIndex(after)<columnIndex(layout.grid.to);}
export function visualBands(layout) {
  let offset=0;const bands=[];
  for(const letter of gridColumns(layout.grid)) {
    const start=columnX(layout,letter)+(layout.grid.columnStep??COLUMN_STEP)+offset;
    const gap=layout.gaps.find(g=>g.after===letter)?.width??0;
    offset+=gap;let x=start+gap;
    for(const section of layout.sections.filter(s=>s.after===letter)){bands.push({...section,x});x+=section.width;offset+=section.width;}
  }
  return bands;
}
export function visualPosition(layout,bench) {
  if(layout.version!==2)return {gx:bench.gx,gy:bench.gy};
  const gy=bench.gy+rowOffset(layout,bench.rowAnchor??bench.cell?.row??0);
  if(bench.sectionId){const section=visualBands(layout).find(s=>s.id===bench.sectionId);if(section)return {gx:section.x+bench.gx,gy};}
  const anchor=bench.anchor??bench.cell?.column;
  const offset=anchor?[...layout.gaps,...layout.sections].filter(s=>columnIndex(s.after)<columnIndex(anchor)).reduce((n,s)=>n+s.width,0):0;
  return {gx:bench.gx+offset,gy};
}
export function positionAt(layout,gx,gy) {
  let rowAnchor=0;for(let row=1;row<=layout.grid.rows;row++)if(gy>=rowY(layout,row)+rowOffset(layout,row))rowAnchor=row;
  gy=Math.max(0,gy-rowOffset(layout,rowAnchor));
  const section=visualBands(layout).find(s=>gx>=s.x&&gx<s.x+s.width);
  if(section)return {sectionId:section.id,gx:gx-section.x,gy,rowAnchor};
  const columns=gridColumns(layout.grid);let anchor=columns[0];
  for(const letter of columns)if(gx>=visualPosition(layout,{gx:columnX(layout,letter),gy:0,anchor:letter}).gx)anchor=letter;
  const offset=visualPosition(layout,{gx:0,gy:0,anchor}).gx;
  return {anchor,gx:Math.max(0,gx-offset),gy,rowAnchor};
}
export function tableAt(layout,bench,gx,gy) {
  const position=positionAt(layout,gx,gy),next={...bench,...position};
  if(bench.kind==='teacher'){
    if(position.sectionId)delete next.anchor;else delete next.sectionId;
    return next;
  }
  delete next.cell;delete next.codeStyle;delete next.sectionId;delete next.anchor;delete next.seatPrefix;delete next.seatStart;
  let code;
  if(position.sectionId){
    Object.assign(next,position);
    let index=layout.nextManual;code=bench.cell?`M${index}`:bench.code;
    while(layout.benches.some(b=>b.id!==bench.id&&b.code===code))code=`M${++index}`;
    const p=visualPosition(layout,next);next.sortX=p.gx;next.sortY=p.gy;
  }else{
    // A slot contains both chair rows, including the lower (even) chair.
    const columns=gridColumns(layout.grid),column=columns[Math.max(0,Math.min(columns.length-1,Math.floor((position.gx+.5)/(layout.grid.columnStep??COLUMN_STEP))))];
    const row=Math.max(1,Math.min(layout.grid.rows,Math.floor((position.gy-(layout.grid.firstRow??FIRST_ROW)+.875)/(layout.grid.rowStep??ROW_STEP))+1));
    Object.assign(next,{gx:columnX(layout,column),gy:rowY(layout,row),cell:{column,row},anchor:column,rowAnchor:row,sortX:columnIndex(column)*COLUMN_STEP,sortY:FIRST_ROW+(row-1)*ROW_STEP});
    code=`${column}${row}`;
  }
  let unique=code,suffix=1;while(layout.benches.some(b=>b.id!==bench.id&&b.code===unique))unique=`${code}-${suffix++}`;
  next.code=unique;return next;
}
export function setTable(layout,bench) {
  const index=layout.benches.findIndex(b=>b.id===bench.id),previous=layout.benches[index];
  const key=b=>b?.cell?`${b.cell.column}${b.cell.row}`:null,from=key(previous),to=key(bench);
  if(from&&from!==to)layout.removed=[...new Set([...layout.removed,from])];
  if(to)layout.removed=layout.removed.filter(code=>code!==to);
  if(index<0)layout.benches.push(bench);else layout.benches[index]=bench;
}
export function resizeCanvas(layout,{shrink=false}={}) {
  const horizontal=b=>['up','down'].includes(b.facing),capacity=b=>Math.max(2,b.capacity);
  const right=layout.benches.reduce((n,b)=>Math.max(n,b.sectionId?0:b.gx+Math.ceil((horizontal(b)?capacity(b)*64+16:80)/32)+1),gridColumns(layout.grid).length*(layout.grid.columnStep??COLUMN_STEP)+4);
  // Ordinary bench edits preserve scrolling; applying a smaller grid trims the
  // old surface while still including every remaining table and chair.
  layout.columns=Math.max(shrink?8:layout.columns??8,8,right);
  layout.rows=Math.max(shrink?8:layout.rows??8,8,rowY(layout,layout.grid.rows)+10,...layout.benches.map(b=>b.gy+Math.ceil((horizontal(b)?80:capacity(b)*53+24)/32)+2));
  return layout;
}
export function generateGrid(layout,grid,{capacity=2,facing='down',fitCanvas=false}={}) {
  const columns=gridColumns(grid),next=structuredClone(layout);next.grid={...grid};
  if(grid.firstRow===undefined&&layout.grid.firstRow!==undefined)next.grid.firstRow=layout.grid.firstRow;
  if(next.sections.some(s=>!boundaryValid(next,s.after)))throw Error('Verwijder of verplaats eerst de eigen vakken buiten het nieuwe kolombereik.');
  const wanted=new Set(columns.flatMap(column=>Array.from({length:grid.rows},(_,i)=>`${column}${i+1}`)));
  // Keep customized tables even when a range shrinks, converting them to manual.
  next.benches=next.benches.filter(b=>{
    if(!b.cell||wanted.has(`${b.cell.column}${b.cell.row}`))return true;
    const oldX=columnX(layout,b.cell.column),oldY=rowY(layout,b.cell.row);
    if(b.gx===oldX&&b.gy===oldY&&b.capacity===2&&b.facing==='down'&&b.enabled)return false;
    delete b.cell;return true;
  });
  for(const b of next.benches.filter(b=>b.cell)){
    // Preserve each manual displacement relative to its original grid column.
    b.gx=Math.max(0,b.gx+columnX(next,b.cell.column)-columnX(layout,b.cell.column));
    b.gy=Math.max(0,b.gy+rowY(next,b.cell.row)-rowY(layout,b.cell.row));
  }
  const existing=new Set(next.benches.filter(b=>b.cell).map(b=>`${b.cell.column}${b.cell.row}`));
  const removed=new Set(next.removed);
  const usedCodes=new Set(next.benches.map(b=>b.code));
  const occupiedIds=new Set(next.benches.map(b=>b.id));
  for(const column of columns)for(let row=1;row<=grid.rows;row++){
    const code=`${column}${row}`;if(existing.has(code)||removed.has(code))continue;
    let unique=code,index=1;while(usedCodes.has(unique))unique=`${code}-${index++}`;usedCodes.add(unique);
    const gx=columnX(next,column),gy=rowY(next,row);
    let id=`grid-${code}`,suffix=1;while(occupiedIds.has(id))id=`grid-${code}-${suffix++}`;occupiedIds.add(id);
    next.benches.push({id,code:unique,kind:'student',capacity,facing,enabled:true,gx,gy,sortX:columnIndex(column)*COLUMN_STEP,sortY:FIRST_ROW+(row-1)*ROW_STEP,cell:{column,row},anchor:column});
  }
  // Only student grid cells are generated. Teacher tables are optional objects
  // placed explicitly by the editor or by the original classroom profile.
  next.rowGaps=(next.rowGaps??[]).filter(g=>g.after<grid.rows);next.gaps=next.gaps.filter(g=>boundaryValid(next,g.after));next.sections=next.sections.filter(s=>boundaryValid(next,s.after)||next.benches.some(b=>b.sectionId===s.id));
  const smaller=grid.rows<layout.grid.rows||columns.length<gridColumns(layout.grid).length;
  return resizeCanvas(next,{shrink:fitCanvas||smaller});
}
export function removeTable(layout,id) {
  const b=layout.benches.find(b=>b.id===id);
  if(b?.cell)layout.removed=[...new Set([...layout.removed,`${b.cell.column}${b.cell.row}`])];
  layout.benches=layout.benches.filter(b=>b.id!==id);
}
export function setGap(layout,after,width) {
  if(!boundaryValid(layout,after)||!Number.isInteger(width)||width<0||width>100)throw Error('Kies twee aangrenzende kolommen en een tussenruimte van 0–100 vakken.');
  layout.gaps=layout.gaps.filter(g=>g.after!==after);if(width)layout.gaps.push({after,width});
}
export function setRowGap(layout,after,width) {
  if(!Number.isInteger(after)||after<1||after>=layout.grid.rows||!Number.isInteger(width)||width<0||width>100)throw Error('Kies twee aangrenzende rijen en een tussenruimte van 0–100 vakken.');
  layout.rowGaps=(layout.rowGaps??[]).filter(g=>g.after!==after);if(width)layout.rowGaps.push({after,width});
}
export function setSection(layout,section) {
  if(!boundaryValid(layout,section.after)||typeof section.name!=='string'||!section.name.trim()||section.name.length>100||!Number.isInteger(section.width)||section.width<6||section.width>100)throw Error('Geef het vak een naam en een breedte van 6–100 rastervakken.');
  const old=layout.sections.find(s=>s.id===section.id);
  if(old&&layout.benches.some(b=>b.sectionId===old.id&&b.gx+5>section.width))throw Error('Verplaats de banken eerst voordat je dit vak smaller maakt.');
  const next={id:section.id??`section-${crypto.randomUUID()}`,after:section.after,name:section.name.trim(),width:section.width};
  const index=layout.sections.findIndex(s=>s.id===next.id);if(index>=0)layout.sections[index]=next;else layout.sections.push(next);return next;
}
export function removeSection(layout,id) {
  // Removing a section preserves tables at their displayed positions. Their
  // rule areas follow the resulting section membership.
  const names=sectionSeatNames(layout);
  const positions=layout.benches.filter(b=>b.sectionId===id).map(b=>[b,visualPosition(layout,b)]);
  layout.sections=layout.sections.filter(s=>s.id!==id);
  for(const [b,p] of positions){Object.assign(b,names.get(b.id));delete b.sectionId;delete b.anchor;const position=positionAt(layout,p.gx,p.gy);Object.assign(b,position);}
  resizeCanvas(layout);
}
export function migrateGridRoom(layout) {
  if(layout.version===2)return {...structuredClone(layout),rowGaps:structuredClone(layout.rowGaps??[])};
  const next={...emptyGridRoom(),columns:layout.columns,rows:layout.rows,benches:structuredClone(layout.benches)};
  for(const b of next.benches){b.sortX=b.gx;b.sortY=b.gy;b.codeStyle='legacy';if(b.kind==='teacher')b.capacity=1;else if(b.capacity>2)b.legacyCapacity=b.capacity;}
  return resizeCanvas(next);
}
export function gridRoomValid(layout) {
  try{gridColumns(layout.grid);}catch{return false;}
  if(['columnStep','rowStep','firstRow'].some(key=>layout.grid[key]!==undefined&&(!Number.isInteger(layout.grid[key])||layout.grid[key]<(key==='firstRow'?0:4)||layout.grid[key]>100)))return false;
  if(layout.rowGaps!==undefined&&(!Array.isArray(layout.rowGaps)||!layout.rowGaps.every(g=>g&&Number.isInteger(g.after)&&g.after>=1&&g.after<layout.grid.rows&&Number.isInteger(g.width)&&g.width>=1&&g.width<=100)||new Set(layout.rowGaps.map(g=>g.after)).size!==layout.rowGaps.length))return false;
  if(!Array.isArray(layout.gaps)||!Array.isArray(layout.sections)||!Array.isArray(layout.removed)||!Number.isInteger(layout.nextManual)||layout.nextManual<1)return false;
  if(!layout.gaps.every(g=>g&&boundaryValid(layout,g.after)&&Number.isInteger(g.width)&&g.width>=1&&g.width<=100)||new Set(layout.gaps.map(g=>g.after)).size!==layout.gaps.length)return false;
  if(!layout.sections.every(s=>s&&typeof s.id==='string'&&/^[\w-]+$/.test(s.id)&&boundaryValid(layout,s.after)&&typeof s.name==='string'&&s.name.trim()&&s.name.length<=100&&Number.isInteger(s.width)&&s.width>=6&&s.width<=100)||new Set(layout.sections.map(s=>s.id)).size!==layout.sections.length)return false;
  if(!layout.removed.every(c=>typeof c==='string'&&/^[A-Z]{1,2}(?:[1-9]|[1-9][0-9]|100)$/.test(c)))return false;
  if(!layout.benches.every(b=>b.seatPrefix===undefined&&b.seatStart===undefined||typeof b.seatPrefix==='string'&&/^[A-Z]{1,3}$/.test(b.seatPrefix)&&Number.isSafeInteger(b.seatStart)&&b.seatStart>0&&b.seatStart%2===1))return false;
  return layout.benches.every(b=>Number.isFinite(b.sortX)&&Number.isFinite(b.sortY)&&b.sortX>=0&&b.sortY>=0&&(b.kind==='teacher'?b.capacity===1:[1,2].includes(b.capacity)||b.legacyCapacity===b.capacity)&&(!b.sectionId||layout.sections.some(s=>s.id===b.sectionId&&b.gx*32+(b.facing==='up'||b.facing==='down'?Math.max(2,b.capacity)*64+16:80)<=s.width*32))&&(!b.anchor||columnIndex(b.anchor)>=0)&&(b.rowAnchor===undefined||Number.isInteger(b.rowAnchor)&&b.rowAnchor>=0&&b.rowAnchor<=100)&&(!b.cell||columnIndex(b.cell.column)>=0&&Number.isInteger(b.cell.row)&&b.cell.row>=1&&b.cell.row<=100));
}
// Large grids are saved as their generated baseline plus customized tables. This
// keeps an A–ZZ / 100-row classroom within browser storage without losing edits.
export function packGridRoom(layout) {
  if(layout?.kind!=='custom'||layout.version!==2||layout.benches.length<500)return layout;
  const benches=layout.benches.filter(b=>{
    if(!b.cell)return true;
    const {column,row}=b.cell,gx=columnX(layout,column),gy=rowY(layout,row);
    const baseline={id:`grid-${column}${row}`,code:`${column}${row}`,kind:'student',capacity:2,facing:'down',enabled:true,gx,gy,sortX:columnIndex(column)*COLUMN_STEP,sortY:FIRST_ROW+(row-1)*ROW_STEP,cell:{column,row},anchor:column};
    return JSON.stringify(b)!==JSON.stringify(baseline);
  });
  return {...layout,benches,packedGrid:true,packedOrder:layout.benches.map(b=>b.code)};
}
export function unpackGridRoom(layout) {
  if(!layout?.packedGrid)return layout;
  const {packedGrid,packedOrder,...source}=layout,next=generateGrid(source,source.grid);
  const order=new Map(packedOrder.map((code,i)=>[code,i]));next.benches=next.benches.filter(b=>order.has(b.code));next.benches.sort((a,b)=>order.get(a.code)-order.get(b.code));
  return resizeCanvas(next);
}
