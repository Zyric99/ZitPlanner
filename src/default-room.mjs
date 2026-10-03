// This profile is built through the same grid operations as the room editor.
// The original classroom supplies only the arrangement, never a live room type.
import { emptyGridRoom, generateGrid, removeTable, setGap, columnX, rowY, resizeCanvas } from './grid-room.mjs';
import { benchSeatCode } from './layout.mjs';

export function defaultClassroom() {
  const seed=emptyGridRoom();seed.columns=8;seed.rows=8;
  const layout=generateGrid(seed,{from:'A',to:'Z',rows:4,columnStep:4,rowStep:6,firstRow:1},{facing:'right'});
  for(const code of ['K1','K4','V4','W4','X4','Y4','Z1','Z3','Z4'])removeTable(layout,`grid-${code}`);
  setGap(layout,'J',2);setGap(layout,'K',2);setGap(layout,'U',1);
  for(const b of layout.benches.filter(b=>b.kind==='student'))b.facing=b.cell.column<'K'?'left':b.cell.column==='K'?'down':'right';
  // The original profile includes its teacher explicitly; Apply never adds one.
  layout.benches.push({id:`teacher-${crypto.randomUUID()}`,code:'L',kind:'teacher',capacity:1,facing:'down',enabled:true,gx:columnX(layout,'K'),gy:rowY(layout,1),anchor:'K',rowAnchor:1,sortX:0,sortY:0});
  return resizeCanvas(layout);
}

// Import boundary only: map old bank/seat references onto newly generated tables.
// No legacy geometry or classroom type survives in the stored result.
export function rebuildReferenceRoom(room,rules=[]) {
  const layout=defaultClassroom(),seatMap=new Map(),disabled=new Set(room.settings.disabled??[]);
  for(const b of layout.benches.filter(b=>b.kind==='student')) {
    const oldId=`${b.cell.column}${b.cell.row*2-1}`;
    const inEnabledSection=(room.settings.sections??[]).some(s=>s.enabled&&b.cell.column>=s.from&&b.cell.column<=s.to);
    const indices=[0,1].filter(i=>(room.settings.rows??[1,2,3,4,5,6,7,8]).includes(b.cell.row*2-1+i));
    b.enabled=!disabled.has(oldId)&&inEnabledSection&&indices.length>0;
    if(indices.length===1)b.capacity=1;
    for(const i of [0,1])seatMap.set(`${oldId}:${i}`,`${b.id}:${indices.length===1?(i===indices[0]?0:1):i}`);
  }
  room.layout=layout;room.settings.disabled=[];
  room.settings.disabledSeats=(room.settings.disabledSeats??[]).map(seat=>seatMap.get(seat)??seat).filter(seat=>{const [id,index]=seat.split(':');return layout.benches.some(b=>b.id===id&&b.kind==='student'&&Number(index)<b.capacity);});
  const tables=new Map(layout.benches.map(b=>[b.id,b]));
  room.assignments=Object.fromEntries(Object.entries(room.assignments).map(([seat,id])=>[seatMap.get(seat)??seat,id]).filter(([seat])=>{const [id,index]=seat.split(':');return tables.get(id)?.kind==='student'&&Number(index)<tables.get(id).capacity;}));
  room.locks=(room.locks??[]).filter(id=>Object.values(room.assignments).includes(id));
  for(const rule of rules)if(rule.type==='fixed'&&rule.seat&&(!rule.roomId||rule.roomId===room.id)){rule.seat=seatMap.get(rule.seat)??rule.seat;const [id,index]=rule.seat.split(':');if(tables.has(id))rule.positionCode=benchSeatCode(tables.get(id),Number(index),2);}
  room.hiddenWarnings=(room.hiddenWarnings??[]).map(key=>{try{const value=JSON.parse(key);if(value[2]?.[0]==='fixed')value[2][2]=seatMap.get(value[2][2])??value[2][2];return JSON.stringify(value);}catch{return key;}});
  // The old per-column start rows referred to chairs, not table rows.
  if(Object.keys(room.settings.ordered?.startRows??{}).length)room.settings.ordered.startRows={};
  return room;
}
