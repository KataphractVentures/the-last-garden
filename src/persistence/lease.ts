import { STORAGE_PREFIX } from './storage';
export interface Lease {owner:string;expiresAt:number;generation:number}
export const LEASE_KEY=`${STORAGE_PREFIX}leader`;
export const LEASE_DURATION=5000;
export function readLease(storage:Storage):Lease|null {
  const text=storage.getItem(LEASE_KEY);if(!text)return null;
  try {const v=JSON.parse(text);return typeof v.owner==='string'&&v.owner.length<150&&Number.isFinite(v.expiresAt)&&Number.isSafeInteger(v.generation)&&v.generation>=0?v:null;}catch{return null;}
}
export function acquireLease(storage:Storage,owner:string,now=Date.now(),force=false):Lease|null {
  const current=readLease(storage);
  if(current&&current.owner!==owner&&current.expiresAt>now&&!force)return null;
  const lease={owner,expiresAt:now+LEASE_DURATION,generation:(current?.generation??0)+(current?.owner===owner&&current.expiresAt>now?0:1)};
  storage.setItem(LEASE_KEY,JSON.stringify(lease));
  const confirmed=readLease(storage);return confirmed?.owner===owner&&confirmed.generation===lease.generation?lease:null;
}
export function renewLease(storage:Storage,lease:Lease,now=Date.now()):Lease|null {
  const current=readLease(storage);
  if(!current||current.owner!==lease.owner||current.generation!==lease.generation||current.expiresAt<=now)return null;
  const renewed={...lease,expiresAt:now+LEASE_DURATION};storage.setItem(LEASE_KEY,JSON.stringify(renewed));return renewed;
}
export function ownsLease(storage:Storage,lease:Lease|null,now=Date.now()):boolean {
  if(!lease)return false;const current=readLease(storage);
  return current?.owner===lease.owner&&current.generation===lease.generation&&current.expiresAt>now;
}
export function releaseLease(storage:Storage,lease:Lease|null):void {
  if(lease&&ownsLease(storage,lease))storage.removeItem(LEASE_KEY);
}
