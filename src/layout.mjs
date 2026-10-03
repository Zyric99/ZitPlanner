// All editable rooms, including the default profile, use this geometry.
import { emptyGridRoom, generateGrid, visualPosition, gridRoomValid } from './grid-room.mjs';
import { benchSeatCode, benchSeatCodes, sectionSeatNames } from './seat-codes.mjs';
export { benchSeatCode, benchSeatCodes, sectionSeatNames } from './seat-codes.mjs';
export const GRID = 32;
export const DIRECTIONS = ['up','right','down','left'];
export const directionName = direction => ({up:'Omhoog',right:'Rechts',down:'Omlaag',left:'Links'})[direction];
export function alphabet(index) { let out=''; do {out=String.fromCharCode(65+index%26)+out;index=Math.floor(index/26)-1;}while(index>=0);return out; }
export function benchSize(bench) {
  const horizontal=['up','down'].includes(bench.facing), capacity=Math.max(2,bench.capacity??2);
  return {width:horizontal?capacity*64+16:80,height:horizontal?80:capacity*53+24};
}
export function tableBounds(bench) { return {x:bench.x,y:bench.y,...benchSize(bench)}; }
export function customSeatGeometry(bench,index) {
  const horizontal=['up','down'].includes(bench.facing),{width,height}=benchSize(bench);
  const centered=bench.capacity===1;
  const x=centered&&horizontal?bench.x+(width-60)/2:bench.x+8+(horizontal?index*64:0),y=centered&&!horizontal?bench.y+(height-43)/2:bench.y+8+(horizontal?0:index*53);
  return {x,y,w:horizontal?60:64,h:43,
    chairX:horizontal?(centered?bench.x+(width-28)/2:x+16):bench.facing==='right'?bench.x-18:bench.x+width+4,
    chairY:horizontal?(bench.facing==='down'?bench.y-22:bench.y+height+4):(centered?bench.y+(height-26)/2:y+9),
    chairWidth:horizontal?28:14,chairHeight:horizontal?16:26};
}
const cache=new WeakMap();
export function customBenches(layout) {
  if(!layout||layout.kind!=='custom')return null;
  if(!cache.has(layout)){const names=sectionSeatNames(layout);cache.set(layout,layout.benches.map(b=>{const p=visualPosition(layout,b),named={...b,...names.get(b.id)};return {...named,custom:true,layoutVersion:layout.version,logicalX:b.sortX??b.gx,logicalY:b.sortY??b.gy,x:40+p.gx*GRID,y:64+p.gy*GRID,col:b.sortX??b.gx,block:b.sortY??b.gy,letter:b.cell?.column??alphabet(Math.floor(b.gx/4)),area:'Lokaal',label:benchSeatCodes(named,layout.version).join(' / '),aisle:false};}));}
  return cache.get(layout);
}
export function layoutSize(layout) { const extra=layout.version===2?[...layout.gaps,...layout.sections].reduce((n,s)=>n+s.width,0):0,extraY=(layout.rowGaps??[]).reduce((n,s)=>n+s.width,0);return {width:(layout.columns+extra)*GRID+80,height:(layout.rows+extraY)*GRID+112}; }
export function layoutValid(layout) {
  if(!layout||layout.kind==='builtin')return !!layout&&layout.kind==='builtin';
  const modern=layout.version===2;
  if(layout.kind!=='custom'||(layout.version!==undefined&&!modern)||!Number.isInteger(layout.columns)||!Number.isInteger(layout.rows)||layout.columns<8||layout.rows<8||layout.columns>(modern?100000:160)||layout.rows>(modern?10000:100)||!Array.isArray(layout.benches)||layout.benches.length>(modern?75000:500))return false;
  return layout.benches.every(b=>b&&typeof b.id==='string'&&/^[a-zA-Z0-9_-]+$/.test(b.id)&&typeof b.code==='string'&&(modern?/^[A-Z0-9-]+$/:/^[A-Z]+$/).test(b.code)&&['student','teacher'].includes(b.kind)&&DIRECTIONS.includes(b.facing)&&Number.isInteger(b.capacity)&&b.capacity>=1&&b.capacity<=8&&Number.isInteger(b.gx)&&b.gx>=0&&Number.isInteger(b.gy)&&b.gy>=0&&typeof b.enabled==='boolean'&&(b.sectionId||b.gx*GRID+benchSize(b).width<=layout.columns*GRID)&&b.gy*GRID+benchSize(b).height<=layout.rows*GRID)&&new Set(layout.benches.map(b=>b.id)).size===layout.benches.length&&new Set(layout.benches.map(b=>b.code)).size===layout.benches.length&&(!modern||gridRoomValid(layout));
}
export function makeBench(layout,kind='student',position={}) {
  if(layout.version===2){let index=layout.nextManual??1;const used=new Set(layout.benches.map(b=>b.code));while(used.has(`M${index}`))index++;return {id:`bank-${crypto.randomUUID()}`,code:`M${index}`,kind,capacity:kind==='teacher'?1:2,facing:'down',enabled:true,gx:0,gy:0,sortX:0,sortY:0,...position};}
  const used=new Set(layout.benches.map(b=>b.code));let index=0;while(used.has(alphabet(index)))index++;
  return {id:`bank-${crypto.randomUUID()}`,code:alphabet(index),kind,capacity:kind==='teacher'?1:2,facing:'down',enabled:true,gx:0,gy:0,...position};
}
export function fits(layout,bench,ignoreId=bench.id) {
  if(!Number.isInteger(bench.gx)||!Number.isInteger(bench.gy)||!Number.isInteger(bench.capacity)||bench.capacity<1||bench.capacity>8||!DIRECTIONS.includes(bench.facing))return false;
  const size=benchSize(bench),p=visualPosition(layout,bench),x=p.gx*GRID,y=p.gy*GRID;
  if(layout.version===2){
    if(x<0||y<0)return false;
    if(bench.cell&&layout.benches.some(b=>b.id!==ignoreId&&b.cell?.column===bench.cell.column&&b.cell?.row===bench.cell.row))return false;
    if(bench.sectionId){const s=layout.sections.find(s=>s.id===bench.sectionId);if(!s||bench.gx*GRID+size.width>s.width*GRID)return false;}
    const bounds=b=>{const p=visualPosition(layout,b),s=benchSize(b);return {left:p.gx*GRID-20,top:p.gy*GRID-24,right:p.gx*GRID+s.width+20,bottom:p.gy*GRID+s.height+24};};
    const a=bounds(bench);return !layout.benches.some(b=>{if(b.id===ignoreId)return false;const c=bounds(b);return a.left<c.right&&a.right>c.left&&a.top<c.bottom&&a.bottom>c.top;});
  }
  if(x<0||y<0||x+size.width>layout.columns*GRID||y+size.height>layout.rows*GRID)return false;
  // Leave chairs and a small walkway visible between objects.
  const bounds=b=>{const s=benchSize(b);return {left:b.gx*GRID-20,top:b.gy*GRID-24,right:b.gx*GRID+s.width+20,bottom:b.gy*GRID+s.height+24};};
  const a=bounds(bench);
  return !layout.benches.some(b=>{if(b.id===ignoreId)return false;const c=bounds(b);return a.left<c.right&&a.right>c.left&&a.top<c.bottom&&a.bottom>c.top;});
}
export function findSpace(layout,bench) {
  if(layout.version===2){const section=layout.sections.find(s=>s.id===bench.sectionId),maxX=section?.width??layout.columns;for(let gy=6;gy<=layout.rows+6;gy+=6)for(let gx=0;gx<maxX;gx+=6)if(fits(layout,{...bench,gx,gy}))return {gx,gy};return null;}
  for(let gy=0;gy<layout.rows;gy++)for(let gx=0;gx<layout.columns;gx++)if(fits(layout,{...bench,gx,gy}))return {gx,gy};
  return null;
}
export function roomTemplate(type='empty') {
  const layout=emptyGridRoom();
  return type==='empty'?layout:generateGrid(layout,{from:'A',to:'D',rows:3},{capacity:type==='exam'?1:2,facing:type==='computer'?'right':'down'});
}
