// ID-indexed JSON records must ignore inherited properties and store every ID
// as ordinary data, including __proto__. Keep their persisted object format.
export const ownValue=(record,id)=>record!=null&&Object.hasOwn(record,id)?record[id]:undefined;
export function setOwnValue(record,id,value) {
  Object.defineProperty(record,id,{value,writable:true,enumerable:true,configurable:true});
  return value;
}
