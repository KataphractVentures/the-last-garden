import type { Command, CommandResult, GameState } from '../contracts';
import { createGame, dispatchCommand, tick } from '../engine';
import { PRODUCERS, UPGRADES, SCENARIO_MODULES } from '../content/economy';
import { STORY_EVENTS, CHARACTERS } from '../content/story';
import { RESEARCH_PROJECTS } from '../laboratory/projects';
import { EXPERIMENT_TEMPLATES } from '../laboratory/experiments';
import { parseSave, serializeSave, type ValidationCatalog } from './validation';
import { openSaveStorage, localSaveStorage, saveEmergencyCheckpoint, STORAGE_PREFIX, type SaveSlot, type SaveStorage } from './storage';
import { acquireLease, ownsLease, readLease, releaseLease, renewLease, LEASE_KEY, type Lease } from './lease';
import { catchUpOffline } from './offline';

export interface StoreStatus {ready:boolean;leader:boolean;storageError:string|null;notice:string|null;catchup:string|null;recoveryRequired:boolean;storageMode:'indexeddb'|'localStorage'|null}
export interface BackupInfo {slot:Exclude<SaveSlot,'current'>;savedAt:number;valid:boolean;message:string}
export interface GameStore {
  getSnapshot:()=>GameState; subscribe:(listener:()=>void)=>()=>void;
  dispatch:(command:Command)=>CommandResult; initialize:()=>Promise<void>;
  exportSave:()=>string; importSave:(text:string)=>Promise<{ok:boolean;message:string}>;
  takeControl:()=>Promise<void>; getStatus:()=>StoreStatus;
  listBackups:()=>Promise<BackupInfo[]>; recoverBackup:(slot?:Exclude<SaveSlot,'current'>)=>Promise<{ok:boolean;message:string}>;
  destroy:()=>void;
}
const ids=(items:readonly {id:string}[])=>new Set(items.map(item=>item.id));
export function getValidationCatalog():ValidationCatalog {
  return {producers:ids(PRODUCERS),upgrades:ids(UPGRADES),projects:ids(RESEARCH_PROJECTS),events:ids(STORY_EVENTS),
    choices:new Map(STORY_EVENTS.map(event=>[event.id,new Set(event.choices.map(choice=>choice.id))])),
    characters:ids(CHARACTERS),modules:ids(SCENARIO_MODULES),templates:ids(EXPERIMENT_TEMPLATES),
    templateSpecs:new Map(EXPERIMENT_TEMPLATES.map(template=>[template.id,{program:template.program,interventions:template.interventions}]))};
}
const IRREVERSIBLE=new Set<Command['type']>(['finish','prestige','branch']);
export function requiresRecoveryCheckpoint(command:Command):boolean {
  if(IRREVERSIBLE.has(command.type))return true;
  return command.type==='choose'&&!!STORY_EVENTS.find(event=>event.id===command.event)?.choices.find(choice=>choice.id===command.choice)?.flags?.includes('scope_transferred');
}
const errorText=(error:unknown)=>error instanceof Error?error.message:'Browser storage is unavailable';

export function createGameStore():GameStore {
  let state=createGame();
  let status:StoreStatus={ready:false,leader:false,storageError:null,notice:null,catchup:null,recoveryRequired:false,storageMode:null};
  const listeners=new Set<()=>void>();
  const catalog=getValidationCatalog();
  const owner=typeof crypto!=='undefined'&&crypto.randomUUID?crypto.randomUUID():`garden-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let local:Storage|null=null;let storage:SaveStorage|null=null;let lease:Lease|null=null;
  let channel:BroadcastChannel|null=null;let interval:ReturnType<typeof setInterval>|null=null;
  let initPromise:Promise<void>|null=null;let saving:Promise<void>=Promise.resolve();let destroyed=false;
  let pendingSave:{payload:string;checkpoint:boolean}|null=null;let catchupPromise:Promise<boolean>|null=null;
  let lastTick=Date.now(),lastPublish=0,lastSave=0,lastHeartbeat=0;let wasHidden=false;
  let acquiring=false;let yielding=false;let corruptPayload:string|null=null;let reacquireAfter=0;
  let handoffResolve:(()=>void)|null=null;
  let commandIndex=0;
  let freshPreferencesInitialized=false;
  function publish(){state={...state};lastPublish=Date.now();for(const listener of listeners)listener();}
  function updateStatus(update:Partial<StoreStatus>){status={...status,...update};publish();}
  function message(notice:string){updateStatus({notice});}
  function isLeader():boolean {
    try{return !!local&&ownsLease(local,lease);}catch(error){updateStatus({storageError:`Cannot verify tab ownership: ${errorText(error)}`,leader:false});return false;}
  }
  function broadcast(){try{channel?.postMessage({type:'snapshot',owner,state});}catch{/* Storage remains authoritative when messaging is unavailable. */}}
  function markFollower(){lease=null;updateStatus({leader:false,notice:'Another tab controls this garden. This tab is read-only; use Take control to move play here.'});channel?.postMessage({type:'request-snapshot',owner});}
  function persist(checkpoint=false):Promise<void> {
    if(!storage||!status.leader||!isLeader()||status.recoveryRequired)return Promise.resolve();
    state={...state,lastSavedAt:Date.now()};
    const payload=serializeSave(state);lastSave=Date.now();
    const validation=parseSave(payload,catalog);
    if(!validation.ok){updateStatus({storageError:`The current garden could not be safely saved; the previous save is preserved. ${validation.message}`});return Promise.resolve();}
    // Keep one in-flight write and the newest pending regular snapshot. Recovery
    // checkpoint barriers clear this reference so saves never cross a barrier.
    if(pendingSave&&!checkpoint&&!pendingSave.checkpoint){pendingSave.payload=payload;return saving;}
    const job={payload,checkpoint};pendingSave=job;
    saving=saving.then(async()=>{
      if(pendingSave===job)pendingSave=null;
      if(!storage||!isLeader())return;
      try{await storage.write(job.payload,job.checkpoint);}
      catch(error){
        if(storage.mode==='indexeddb'&&local){
          const old=storage;storage=localSaveStorage(local);old.close();updateStatus({storageMode:'localStorage',storageError:`IndexedDB saving failed; localStorage fallback is active. ${errorText(error)}`});
          try{await storage.write(job.payload,job.checkpoint);return;}catch(fallbackError){updateStatus({storageError:`Saving failed. Export your garden now. ${errorText(fallbackError)}`});}
        }else updateStatus({storageError:`Saving failed. Export your garden now. ${errorText(error)}`});
      }
    });
    return saving;
  }
  function applyOffline(now:number):Promise<boolean>{
    if(catchupPromise)return catchupPromise;
    const previousYielding=yielding;yielding=true;
    let lastProgressAt=0;
    catchupPromise=(async()=>{
      try{
        const result=await catchUpOffline(state,Math.max(0,(now-state.lastActiveAt)/1000),{
          authorize(){
            if(destroyed||!isLeader())return false;
            const clock=Date.now();
            if(clock-lastHeartbeat>=1000&&local&&lease){lease=renewLease(local,lease,clock);lastHeartbeat=clock;if(!lease)return false;}
            return true;
          },
          progress(processed,total){
            const clock=Date.now();if(processed===0||processed===total||clock-lastProgressAt>=250){lastProgressAt=clock;updateStatus({catchup:`Restoring offline progress · ${Math.min(100,Math.floor(processed/total*100))}% · ${Math.floor(processed)} / ${Math.ceil(total)} seconds`});}
          }
        });
        if(result.cancelled||destroyed||!isLeader()){if(status.leader&&!destroyed)markFollower();return false;}
        // Catch-up itself is a paused preparation interval; all absence was
        // measured once at its start, and no live input can spend the candidate.
        const resumedAt=Date.now();state={...result.state,lastActiveAt:resumedAt};lastTick=resumedAt;return true;
      }catch(error){updateStatus({storageError:`Offline recovery could not finish; the previous save is preserved. ${errorText(error)}`});return false;}
      finally{yielding=previousYielding;catchupPromise=null;updateStatus({catchup:null});}
    })();return catchupPromise;
  }
  function queueOffline(now:number){void applyOffline(now).then(completed=>{if(completed&&!destroyed){publish();broadcast();void persist();}});}
  function advanceLive(now:number):boolean {
    const seconds=Math.max(0,(now-lastTick)/1000);
    if(seconds>2){queueOffline(now);return false;}
    else if(seconds>0){state=tick(state,seconds*state.settings.speed);state={...state,lastActiveAt:now};lastTick=now;}
    return true;
  }
  async function loadCurrent():Promise<boolean>{
    if(!storage)return false;
    let saved=await storage.read('current');
    // This also recovers saves made while IndexedDB was temporarily unavailable.
    if(local){const fallback=await localSaveStorage(local).read('current');if(!saved||(fallback&&fallback.savedAt>saved.savedAt))saved=fallback??saved;}
    if(!saved){
      if(!freshPreferencesInitialized){
        const reducedMotion=typeof window!=='undefined'&&typeof window.matchMedia==='function'&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        state={...state,settings:{...state.settings,reducedMotion}};
        freshPreferencesInitialized=true;
      }
      corruptPayload=null;status={...status,recoveryRequired:false};return true;
    }
    const result=parseSave(saved.payload,catalog);
    if(!result.ok){corruptPayload=saved.payload;updateStatus({recoveryRequired:true,storageError:`The existing save is damaged or incompatible and has been preserved. ${result.message}`,notice:'Recover a backup or import a valid exported garden to continue.'});return false;}
    state=result.state;freshPreferencesInitialized=true;corruptPayload=null;status={...status,recoveryRequired:false};return true;
  }
  async function becomeLeader(force=false){
    if(!local||acquiring||destroyed)return;acquiring=true;
    try{
      const acquired=acquireLease(local,owner,Date.now(),force);
      if(!acquired){if(status.leader)markFollower();return;}
      lease=acquired;status={...status,leader:true};
      // Re-read after ownership changes: a follower's snapshot may lag the writer.
      const loaded=await loadCurrent();
      if(!isLeader()){markFollower();return;}
      if(loaded){if(!await applyOffline(Date.now()))return;status={...status,notice:force?'This tab now controls the garden.':status.notice};await persist();}
      publish();broadcast();
    }catch(error){updateStatus({storageError:`Could not take control: ${errorText(error)}`,leader:false});}
    finally{acquiring=false;}
  }
  async function onHandoff(to:string){
    if(!isLeader()||yielding)return;yielding=true;
    try{if(wasHidden){if(!await applyOffline(Date.now()))return;}else if(!advanceLive(Date.now())){if(!await catchupPromise)return;}if(!isLeader())return;await persist();channel?.postMessage({type:'handoff',to,owner,state});if(local)releaseLease(local,lease);reacquireAfter=Date.now()+5000;markFollower();}
    finally{yielding=false;}
  }
  function onMessage(event:MessageEvent){
    const data=event.data;if(!data||typeof data!=='object')return;
    if(data.type==='handoff-request'&&typeof data.owner==='string'&&data.owner!==owner){void onHandoff(data.owner);return;}
    if(data.type==='request-snapshot'&&status.leader){broadcast();return;}
    if(data.type==='handoff'&&data.to===owner){handoffResolve?.();return;}
    if(data.type==='snapshot'&&data.owner!==owner&&!isLeader()){
      try{if(!local||readLease(local)?.owner!==data.owner)return;const parsed=parseSave(serializeSave(data.state),catalog);if(parsed.ok){state=parsed.state;status={...status,leader:false};publish();}}catch{/* Ignore malformed cross-tab messages. */}
    }
  }
  function onStorage(event:StorageEvent){if(event.key===LEASE_KEY&&status.leader&&!isLeader())markFollower();}
  function onVisibility(){
    const hidden=typeof document!=='undefined'&&document.hidden;
    if(hidden){if(status.leader&&isLeader()&&!yielding&&advanceLive(Date.now()))void persist();wasHidden=true;return;}
    if(wasHidden&&status.leader&&isLeader()&&!status.recoveryRequired)queueOffline(Date.now());wasHidden=false;
  }
  function onPageHide(){if(status.leader&&isLeader()&&local&&!status.recoveryRequired){try{const payload=serializeSave(state);if(parseSave(payload,catalog).ok)local.setItem(`${STORAGE_PREFIX}current`,JSON.stringify({key:'current',payload,savedAt:Date.now()}));}catch{/* Existing durable save is preserved if quota is exhausted. */}}}
  function pulse(){
    if(destroyed||!status.ready)return;const now=Date.now();
    if(status.leader&&!isLeader()){markFollower();return;}
    if(!status.leader){if(now-lastHeartbeat>1000&&now>=reacquireAfter){lastHeartbeat=now;void becomeLeader();}return;}
    if(now-lastHeartbeat>=1000&&local){try{lease=lease&&renewLease(local,lease,now);lastHeartbeat=now;if(!lease){markFollower();return;}}catch(error){updateStatus({storageError:errorText(error),leader:false});return;}}
    if(status.recoveryRequired||yielding)return;
    if(typeof document!=='undefined'&&document.hidden){wasHidden=true;return;}
    if(wasHidden){onVisibility();return;}
    if(!advanceLive(now))return;
    if(now-lastPublish>=250){publish();broadcast();}
    if(now-lastSave>=3000)void persist();
  }
  const store:GameStore={
    getSnapshot:()=>state,subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener);},getStatus:()=>status,
    initialize(){
      if(initPromise)return initPromise;
      initPromise=(async()=>{
        try{
          if(typeof window==='undefined')throw new Error('The game store needs a browser.');
          local=window.localStorage;const testKey=`${STORAGE_PREFIX}storage-test-${owner}`;local.setItem(testKey,'1');local.removeItem(testKey);
          const opened=await openSaveStorage(window.indexedDB,local);storage=opened.storage;
          status={...status,storageMode:storage.mode,storageError:opened.warning};
          if(typeof BroadcastChannel!=='undefined'){channel=new BroadcastChannel('the-last-garden-v1');channel.onmessage=onMessage;}
          await loadCurrent();status={...status,ready:true};await becomeLeader();
          if(!status.leader)markFollower();
          document.addEventListener('visibilitychange',onVisibility);window.addEventListener('storage',onStorage);window.addEventListener('pagehide',onPageHide);
          wasHidden=document.hidden;interval=setInterval(pulse,100);publish();
        }catch(error){updateStatus({ready:true,leader:false,storageError:`The garden cannot safely save or coordinate tabs. Enable browser storage, then reload. ${errorText(error)}`});}
      })();return initPromise;
    },
    dispatch(command){
      if(!status.ready||!status.leader||!isLeader()||status.recoveryRequired||yielding){const text=status.recoveryRequired?'Recover or import a valid save before continuing.':catchupPromise?'Offline progress is being restored. Controls will resume when it finishes.':'This tab is read-only. Take control to play.';message(text);return {state,ok:false,message:text};}
      if(!advanceLive(Date.now()))return {state,ok:false,message:'Offline progress is being restored. Try this action after recovery finishes.'};
      const result=dispatchCommand(state,command,`${owner}:${++commandIndex}`);
      if(!result.ok){message(result.message);return result;}
      if(requiresRecoveryCheckpoint(command)){
        try{
          if(!local)throw new Error('Backup storage is unavailable');const payload=serializeSave(state);saveEmergencyCheckpoint(local,payload);
          pendingSave=null;saving=saving.then(async()=>{if(storage&&isLeader())await storage.checkpoint(payload);}).catch(error=>{updateStatus({storageError:`The emergency backup is in localStorage; the IndexedDB checkpoint failed. ${errorText(error)}`});});
        }catch(error){const text=`This action was not applied because its recovery checkpoint could not be saved. Export a backup and free browser storage. ${errorText(error)}`;message(text);return {state,ok:false,message:text};}
      }
      state={...result.state,lastActiveAt:Date.now()};lastTick=Date.now();status={...status,notice:result.message||null};publish();broadcast();void persist();
      return {...result,state};
    },
    exportSave:()=>serializeSave(state),
    async importSave(text){
      const parsed=parseSave(text,catalog);if(!parsed.ok){message(parsed.message);return parsed;}
      if(yielding)return {ok:false,message:catchupPromise?'Wait for offline recovery to finish before importing.':'Another save operation is still in progress.'};
      if(!storage||!status.leader||!isLeader()){const text='Take control in this tab before importing a garden.';message(text);return {ok:false,message:text};}
      yielding=true;
      try{
        await saving;if(!isLeader())throw new Error('Another tab took control during import.');
        const original=corruptPayload??serializeSave(state);if(local)saveEmergencyCheckpoint(local,original);await storage.checkpoint(original);
        if(!isLeader())throw new Error('Another tab took control before the import was committed.');
        const incoming={...parsed.state,lastActiveAt:Date.now(),lastSavedAt:Date.now()};await storage.write(serializeSave(incoming));
        state=incoming;lastTick=Date.now();corruptPayload=null;updateStatus({recoveryRequired:false,notice:'Garden imported. A recovery checkpoint of the previous save is available.',storageError:status.storageMode==='localStorage'?status.storageError:null});broadcast();
        return {ok:true,message:'Garden imported successfully.'};
      }catch(error){const text=`Import was not completed: ${errorText(error)}`;message(text);return {ok:false,message:text};}
      finally{yielding=false;}
    },
    async takeControl(){
      if(isLeader())return;
      if(channel){await new Promise<void>(resolve=>{const timer=setTimeout(()=>{handoffResolve=null;resolve();},1500);handoffResolve=()=>{clearTimeout(timer);handoffResolve=null;resolve();};channel?.postMessage({type:'handoff-request',owner});});}
      await becomeLeader(true);
    },
    async listBackups(){
      if(!storage)return [];const slots:Exclude<SaveSlot,'current'>[]=['backup-1','backup-2','checkpoint'];const result:BackupInfo[]=[];
      for(const slot of slots){let item=await storage.read(slot);if(slot==='checkpoint'&&local){const emergency=await localSaveStorage(local).read(slot);if(emergency&&(!item||emergency.savedAt>item.savedAt))item=emergency;}
        if(item){const parsed=parseSave(item.payload,catalog);result.push({slot,savedAt:item.savedAt,valid:parsed.ok,message:parsed.ok?`Chapter ${parsed.state.chapter} · cycle ${parsed.state.legacy.cycle}`:parsed.message});}}
      return result;
    },
    async recoverBackup(slot){
      if(!storage)return {ok:false,message:'Storage is not initialized.'};
      if(!slot){const available=(await store.listBackups()).filter(item=>item.valid).sort((a,b)=>b.savedAt-a.savedAt);slot=available[0]?.slot;if(!slot)return {ok:false,message:'No valid recovery backup is available. Import an exported garden instead.'};}
      let item=await storage.read(slot);if(slot==='checkpoint'&&local){const emergency=await localSaveStorage(local).read(slot);if(emergency&&(!item||emergency.savedAt>item.savedAt))item=emergency;}
      if(!item)return {ok:false,message:'That backup is unavailable.'};return store.importSave(item.payload);
    },
    destroy(){
      destroyed=true;if(interval)clearInterval(interval);interval=null;
      if(typeof window!=='undefined'){document.removeEventListener('visibilitychange',onVisibility);window.removeEventListener('storage',onStorage);window.removeEventListener('pagehide',onPageHide);}
      onPageHide();void persist().finally(()=>{try{if(local)releaseLease(local,lease);}catch{/* Lease expires automatically. */}storage?.close();channel?.close();});listeners.clear();
    }
  };
  return store;
}

export { parseSave, validateSaveState, serializeSave, isValidAmount, MAX_SAVE_BYTES } from './validation';
