export type SaveSlot='current'|'backup-1'|'backup-2'|'checkpoint';
export interface StoredSave {key:SaveSlot;payload:string;savedAt:number}
export interface SaveStorage {
  mode:'indexeddb'|'localStorage';
  read(slot:SaveSlot):Promise<StoredSave|null>;
  write(payload:string,checkpoint?:boolean):Promise<void>;
  checkpoint(payload:string):Promise<void>;
  close():void;
}
export const STORAGE_PREFIX='last-garden:v1:';
export function saveEmergencyCheckpoint(local:Storage,payload:string):void {local.setItem(`${STORAGE_PREFIX}checkpoint`,JSON.stringify({key:'checkpoint',payload,savedAt:Date.now()}));}
function readLocal(local:Storage,slot:SaveSlot):StoredSave|null {
  const raw=local.getItem(`${STORAGE_PREFIX}${slot}`);
  if(raw===null)return null;
  // A malformed wrapper is deliberately retained and surfaced as a corrupt save.
  try {const value=JSON.parse(raw); if(typeof value?.payload==='string'&&Number.isFinite(value.savedAt)) return {key:slot,payload:value.payload,savedAt:value.savedAt};} catch {/* Preserve raw below. */}
  return {key:slot,payload:raw,savedAt:0};
}
export function localSaveStorage(local:Storage):SaveStorage {
  return {mode:'localStorage',read:async(slot)=>readLocal(local,slot),
    async write(payload,checkpoint=false){
      const previous=local.getItem(`${STORAGE_PREFIX}current`);
      const first=local.getItem(`${STORAGE_PREFIX}backup-1`);
      if(first!==null)local.setItem(`${STORAGE_PREFIX}backup-2`,first);
      if(previous!==null)local.setItem(`${STORAGE_PREFIX}backup-1`,previous);
      if(checkpoint)saveEmergencyCheckpoint(local,payload);
      local.setItem(`${STORAGE_PREFIX}current`,JSON.stringify({key:'current',payload,savedAt:Date.now()}));
    },async checkpoint(payload){saveEmergencyCheckpoint(local,payload);},close(){}};
}
function request<T>(req:IDBRequest<T>):Promise<T>{return new Promise((resolve,reject)=>{req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error??new Error('IndexedDB request failed'));});}
function transactionDone(tx:IDBTransaction):Promise<void>{return new Promise((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error??new Error('Save transaction was aborted'));tx.onerror=()=>reject(tx.error??new Error('Save transaction failed'));});}
export async function openSaveStorage(factory:IDBFactory|undefined,local:Storage):Promise<{storage:SaveStorage;warning:string|null}> {
  if(!factory)return {storage:localSaveStorage(local),warning:'IndexedDB is unavailable. Saves use this browser’s smaller localStorage fallback. Export a backup regularly.'};
  let db:IDBDatabase;
  try {
    db=await new Promise<IDBDatabase>((resolve,reject)=>{
      const req=factory.open('the-last-garden',1);
      const timeout=setTimeout(()=>reject(new Error('Database opening timed out')),5000);
      req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains('saves'))req.result.createObjectStore('saves',{keyPath:'key'});};
      req.onsuccess=()=>{clearTimeout(timeout);resolve(req.result);};
      req.onerror=()=>{clearTimeout(timeout);reject(req.error);};
      req.onblocked=()=>{clearTimeout(timeout);reject(new Error('Database upgrade is blocked by another tab'));};
    });
  }catch {return {storage:localSaveStorage(local),warning:'IndexedDB could not open. Saves use localStorage instead. Keep an exported backup and close older game tabs.'};}
  return {warning:null,storage:{mode:'indexeddb',
    async read(slot){const tx=db.transaction('saves','readonly');const result=await request(tx.objectStore('saves').get(slot));return result??null;},
    async write(payload,checkpoint=false){
      const tx=db.transaction('saves','readwrite');const done=transactionDone(tx);const store=tx.objectStore('saves');
      const oldRequest=store.get('current');const backupRequest=store.get('backup-1');
      oldRequest.onsuccess=()=>{if(oldRequest.result)store.put({...oldRequest.result,key:'backup-1'});};
      backupRequest.onsuccess=()=>{if(backupRequest.result)store.put({...backupRequest.result,key:'backup-2'});};
      if(checkpoint)store.put({key:'checkpoint',payload,savedAt:Date.now()});
      store.put({key:'current',payload,savedAt:Date.now()});await done;
    },
    async checkpoint(payload){const tx=db.transaction('saves','readwrite');const done=transactionDone(tx);tx.objectStore('saves').put({key:'checkpoint',payload,savedAt:Date.now()});await done;},
    close(){db.close();}
  }};
}
