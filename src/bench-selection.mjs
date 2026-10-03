import { benchSize } from './layout.mjs';

export function axisBenchIds(benches,{column,row}={}) {
  return benches.filter(b=>b.kind!=='teacher'&&(column!==undefined?(b.cell?.column??(!b.custom?b.letter:undefined))===column:b.cell?b.cell.row===Math.ceil(row/2):!b.custom&&b.block===Math.floor((row-1)/2))).map(b=>b.id);
}
export function mergeSelection(current,ids,{additive=false,toggle=false}={}) {
  const selected=new Set(additive?current:[]);
  for(const id of new Set(ids)){if(additive&&toggle&&selected.has(id))selected.delete(id);else selected.add(id);}
  return [...selected];
}
export function selectionRect(a,b) {
  return {x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),width:Math.abs(a.x-b.x),height:Math.abs(a.y-b.y)};
}
export function benchesInRect(benches,rect) {
  return benches.filter(b=>{
    if(b.kind==='teacher')return false;
    const {width,height}=benchSize(b);
    return b.x<rect.x+rect.width&&b.x+width>rect.x&&b.y<rect.y+rect.height&&b.y+height>rect.y;
  }).map(b=>b.id);
}
