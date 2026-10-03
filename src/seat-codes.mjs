// Visible codes are separate from bench ids and stored assignment references.
export function benchSeatCode(bench,index,version=bench.layoutVersion) {
  if(bench.seatPrefix&&Number.isInteger(bench.seatStart))return `${bench.seatPrefix}${bench.seatStart+index}`;
  if(bench.cell&&bench.capacity<=2)return `${bench.cell.column}${(bench.cell.row-1)*2+index+1}`;
  return `${bench.code}${version===2&&bench.codeStyle!=='legacy'?'.':''}${index+1}`;
}
export const benchSeatCodes=(bench,version)=>Array.from({length:bench.capacity??2},(_,i)=>benchSeatCode(bench,i,version));

export function sectionSeatNames(layout,previewBench) {
  const sections=new Map((layout.sections??[]).map(s=>[s.id,s]));
  if(!sections.size)return new Map();
  let benches=layout.benches;
  if(previewBench)benches=benches.some(b=>b.id===previewBench.id)?benches.map(b=>b.id===previewBench.id?previewBench:b):[...benches,previewBench];
  const named=b=>b.kind==='student'&&sections.has(b.sectionId);
  const used=new Set(benches.filter(b=>b.kind==='student'&&!named(b)).flatMap(b=>benchSeatCodes(b,layout.version)));
  const counters=new Map(),names=new Map();
  for(const bench of benches.filter(named)){
    const section=sections.get(bench.sectionId);
    const prefix=section.name.normalize('NFD').replace(/\p{M}/gu,'').toUpperCase().replace(/[^A-Z]/g,'').slice(0,3)||'VAK';
    let start=counters.get(prefix)??1;
    const reserved=Math.ceil(Math.max(2,bench.capacity??2)/2)*2;
    while(Array.from({length:reserved},(_,i)=>`${prefix}${start+i}`).some(code=>used.has(code)))start+=2;
    const name={seatPrefix:prefix,seatStart:start};names.set(bench.id,name);
    // A one-chair bench still reserves the other half of its numbered pair.
    for(let i=0;i<reserved;i++)used.add(`${prefix}${start+i}`);
    counters.set(prefix,start+reserved);
  }
  return names;
}
