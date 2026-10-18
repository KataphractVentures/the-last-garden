import test from 'node:test';
import assert from 'node:assert/strict';
import type { CharterProgramId, ConstitutionId, GameState, ProgramId } from '../src/contracts';
import type { CharterActionId, CharterEconomy } from '../src/constitution/types';
import { isValidAmount, MAX_SAVE_BYTES, parseSave, serializeSave, validateSaveState, type ValidationCatalog } from '../src/persistence/validation';
import { acquireLease, ownsLease, readLease, releaseLease, renewLease } from '../src/persistence/lease';
import { localSaveStorage, STORAGE_PREFIX } from '../src/persistence/storage';
import { createGame, dispatchCommand, prestigeEligibility, tick } from '../src/engine';
import { getValidationCatalog, requiresRecoveryCheckpoint } from '../src/persistence';
import { EXPERIMENT_TEMPLATES, runExperiment } from '../src/laboratory/experiments';
import { STORY_EVENTS } from '../src/content/story';
import { catchUpOffline, MAX_OFFLINE_SECONDS } from '../src/persistence/offline';
import { createOperatingClearance, recordFindingResponse, registerBoundaryObservation } from '../src/engine/clearance';

function fresh():GameState {
  return {version:1,contentVersion:1,id:'garden-42',seed:42,startedAt:1000,lastSavedAt:1000,lastActiveAt:1000,elapsed:0,commandSeq:0,chapter:1,
    tokens:'0',lifetime:'0',useful:'0',research:'0',producers:{seedling:0},purchaseBasis:{},upgrades:[],projects:[],
    allocation:{production:.7,research:.2,review:.1},metrics:{quality:90,distortion:0,agency:90,welfare:60,dependence:0,evidence:20,recall:90,coordination:50,pressure:20,continuity:50,humanWelfare:60,reviewQueue:0},
    policies:{contract:'score',communication:'closed',external:'blocked',evaluation:'independent',welfare:'rest',continuity:'archive',fallback:'local',governance:'central'},
    flags:[],decisions:{},pendingEvent:null,eventCooldown:0,experiments:[],mastered:[],activeExperiment:null,experimentAutomation:null,
    characters:{moss:{trust:50,respect:50,promises:[],history:[]}},journal:[],constitution:'commons',charter:null,modules:[],
    legacy:{seeds:0,patterns:0,charters:0,cycle:0,efficiency:0,claims:[],discovered:[],contracts:[],branches:[],viableCycles:[]},
    ending:null,endingTime:null,viableSeconds:0,paused:false,assisted:false,autoBuy:null,autoResearch:false,tendWindow:0,tendCount:0,lastCommandIds:[],incidentStage:0,lastIncidentAt:0,certificateTier:0,offlineSummary:null,
    settings:{reducedMotion:false,sound:false,condensed:false,notation:'compact',speed:1,readingPause:true},simulationRemainder:0,pendingEvidence:[],certificateProgress:0};
}
const catalog:ValidationCatalog={producers:new Set(['seedling']),upgrades:new Set(['warmth']),projects:new Set(['independent-review']),events:new Set(['awakening']),choices:new Map([['awakening',new Set(['listen','rush'])]]),templates:new Set(['oversight-1']),characters:new Set(['moss']),modules:new Set(['delayed-observations'])};
class MemoryStorage implements Storage {
  data=new Map<string,string>();get length(){return this.data.size;}
  clear(){this.data.clear();}getItem(key:string){return this.data.get(key)??null;}key(index:number){return [...this.data.keys()][index]??null;}
  removeItem(key:string){this.data.delete(key);}setItem(key:string,value:string){this.data.set(key,String(value));}
}

test('versioned export round-trips without losing decimal precision or optional engine fields',()=>{
  const source=fresh();source.tokens='9.123456789123456789123456789e+10000';source.pendingEvidence=[{due:100,amount:3}];source.characterSceneCooldown=37.25;
  const result=parseSave(serializeSave(source,2000),catalog);assert.equal(result.ok,true);if(result.ok)assert.deepEqual(result.state,source);
});
test('finite nonnegative currency rejects coercion, explosive coefficients and invalid exponents',()=>{
  for(const value of ['0','1','0.125','4.05e+123456','9e-9'])assert.ok(isValidAmount(value),value);
  for(const value of [2,null,'','NaN','Infinity','-1','+2','01','1e1000000001','1e9999999999999999999','1'.repeat(129),'1e2x',' 1','1.'])assert.equal(isValidAmount(value),false,`${value}`);
});
test('unsupported versions and missing required fields produce actionable validation failures',()=>{
  const envelope=JSON.parse(serializeSave(fresh()));envelope.schemaVersion=2;assert.equal(parseSave(JSON.stringify(envelope)).ok,false);
  const state:Record<string,unknown>={...fresh()};delete state.settings;const result=validateSaveState(state,catalog);assert.equal(result.ok,false);if(!result.ok)assert.match(result.message,/missing settings/);
});
test('foreign producer, project, event choice, character, module, and nested template IDs are rejected',()=>{
  const mutations:((s:GameState)=>void)[]=[s=>s.producers['foreign']=3,s=>s.projects.push('foreign'),s=>s.decisions.awakening='foreign',s=>s.characters.foreign={trust:50,respect:50,promises:[],history:[]},s=>s.modules.push('foreign'),s=>s.activeExperiment={remaining:5,config:{program:'oversight',template:'foreign',seed:2,cohort:20,budget:30,holdout:.2,intervention:'baseline',distribution:'familiar',lineage:'clean',prediction:'A prediction',control:true}}];
  for(const mutate of mutations){const s=fresh();mutate(s);assert.equal(validateSaveState(s,catalog).ok,false);}
});
test('nested types, unknown fields, negative counts and unsafe integer values are rejected',()=>{
  const cases:unknown[]=[];
  const badMetrics=fresh();badMetrics.metrics.quality=NaN;cases.push(badMetrics);
  const badCount=fresh();badCount.producers.seedling=-2;cases.push(badCount);
  const fractional=fresh();fractional.producers.seedling=1.5;cases.push(fractional);
  const nested=fresh();(nested.settings as unknown as Record<string,unknown>).sound='true';cases.push(nested);
  const pending=fresh();(pending as unknown as Record<string,unknown>).pendingEvidence=42;cases.push(pending);
  const huge=fresh();huge.seed=2**40;cases.push(huge);
  cases.push({...fresh(),injectedCode:'alert(1)'});
  for(const value of cases)assert.equal(validateSaveState(value,catalog).ok,false);
});
test('prototype-pollution keys and non-plain objects are refused without mutating globals',()=>{
  const envelope=JSON.parse(serializeSave(fresh()));Object.defineProperty(envelope.state.producers,'__proto__',{value:{polluted:true},enumerable:true});
  assert.equal(parseSave(JSON.stringify(envelope),catalog).ok,false);assert.equal(({} as {polluted?:boolean}).polluted,undefined);
  const wrong=fresh();wrong.characters=Object.create({moss:{trust:50}});assert.equal(validateSaveState(wrong,catalog).ok,false);
});
test('archived checkpoints are validated fully and cannot contain recursive legacy branches',()=>{
  const s=fresh();const {legacy:_legacy,...checkpoint}=fresh();s.legacy.branches=[{id:'old',parentId:null,name:'Past garden',constitution:'commons',cycle:0,seed:2,chapter:1,createdAt:10,summary:'Preserved',checkpoint}];
  assert.equal(validateSaveState(s,catalog).ok,true);
  checkpoint.tokens='NaN';assert.equal(validateSaveState(s,catalog).ok,false);checkpoint.tokens='0';
  (checkpoint as unknown as Record<string,unknown>).legacy=s.legacy;assert.equal(validateSaveState(s,catalog).ok,false);
});
test('size limit counts UTF-8 bytes and rejects corrupt input before replacement',()=>{
  assert.equal(parseSave('{broken').ok,false);
  const huge='é'.repeat(Math.floor(MAX_SAVE_BYTES/2)+1);assert.equal(parseSave(huge).ok,false);
  const original=fresh();const failed=parseSave(serializeSave({...original,tokens:'Infinity'}));assert.equal(failed.ok,false);assert.equal(original.tokens,'0');
});
test('two rotating local backups preserve prior saves and a separate irreversible checkpoint',async()=>{
  const local=new MemoryStorage();const storage=localSaveStorage(local);
  await storage.write('first');await storage.write('second');await storage.checkpoint('before-prestige');await storage.write('third');
  assert.equal((await storage.read('current'))?.payload,'third');assert.equal((await storage.read('backup-1'))?.payload,'second');assert.equal((await storage.read('backup-2'))?.payload,'first');assert.equal((await storage.read('checkpoint'))?.payload,'before-prestige');
});
test('corrupt storage wrapper is returned for recovery rather than treated as an empty garden',async()=>{
  const local=new MemoryStorage();local.setItem(`${STORAGE_PREFIX}current`,'{damaged');const item=await localSaveStorage(local).read('current');assert.equal(item?.payload,'{damaged');
});
test('quota failure while rotating backups leaves the current save intact',async()=>{
  class FullStorage extends MemoryStorage {blocked=false;override setItem(key:string,value:string){if(this.blocked&&key.endsWith('backup-1'))throw new Error('Quota exceeded');super.setItem(key,value);}}
  const local=new FullStorage();const storage=localSaveStorage(local);await storage.write('durable');local.blocked=true;
  await assert.rejects(storage.write('replacement'),/Quota/);assert.equal((await storage.read('current'))?.payload,'durable');
});
test('lease excludes followers, supports handoff fencing, and recovers after a crashed leader',()=>{
  const local=new MemoryStorage();const first=acquireLease(local,'tab-a',1000);assert.ok(first);assert.ok(ownsLease(local,first,1001));assert.equal(acquireLease(local,'tab-b',1001),null);
  const forced=acquireLease(local,'tab-b',1100,true);assert.ok(forced);assert.equal(ownsLease(local,first,1101),false);assert.equal(renewLease(local,first!,1101),null);
  assert.equal(acquireLease(local,'tab-c',6099),null);const recovered=acquireLease(local,'tab-c',6101);assert.ok(recovered);assert.ok(ownsLease(local,recovered,6102));
  // The displaced tab cannot remove the new leader's lease.
  releaseLease(local,first);assert.equal(readLease(local)?.owner,'tab-c');
});
test('actual engine state, completed study, and prestige checkpoint remain importable',()=>{
  const realCatalog=getValidationCatalog();let game=createGame(2026,1000);
  for(let index=0;index<20;index++){game=dispatchCommand(game,{type:'tend'},`qa-${index}`).state;game=tick(game,.5);}
  const template=[...realCatalog.templates!][0];
  game.experiments.push(runExperiment({program:'oversight',template,seed:42,cohort:32,budget:128,holdout:.25,intervention:'baseline',distribution:'familiar',lineage:'clean',prediction:'Independent review should catch errors.',control:true}));
  let parsed=parseSave(serializeSave(game),realCatalog);assert.ok(parsed.ok,parsed.ok?'':parsed.message);
  game.ending='limit';game.endingTime=game.elapsed;game.pendingEvent=null;
  const next=dispatchCommand(game,{type:'prestige',layer:'reinitialize'});assert.ok(next.ok,next.message);assert.ok(next.state.legacy.branches.length>0);
  parsed=parseSave(serializeSave(next.state),realCatalog);assert.ok(parsed.ok,parsed.ok?'':parsed.message);
});

function automatedGarden(cycle=0):GameState {
  let game=createGame(2026,1000);game.research='1e30';game.legacy.cycle=cycle;
  const source=runExperiment({program:'oversight',template:'oversight-1',seed:42,cohort:32,budget:128,holdout:.25,intervention:'baseline',distribution:'familiar',lineage:'clean',prediction:'Matched review will reveal missed work.',control:true});
  source.adopted=true;source.replicated=true;game.experiments.push(source);game.mastered.push('oversight');game.pendingEvent=null;
  const result=dispatchCommand(game,{type:'experimentAutomation',record:source.id,runs:3});assert.ok(result.ok,result.message);return result.state;
}
test('older version-one saves gain a null automation field in current and archived states without mutation',()=>{
  const original=JSON.parse(serializeSave(fresh())).state;delete original.experimentAutomation;
  const {legacy:_legacy,...checkpoint}=JSON.parse(JSON.stringify(original));
  original.legacy.branches=[{id:'past',parentId:null,name:'Past',constitution:'commons',cycle:0,seed:42,chapter:1,createdAt:1000,summary:'Past garden',checkpoint}];
  const parsed=validateSaveState(original,catalog);assert.ok(parsed.ok,parsed.ok?'':parsed.message);
  if(parsed.ok){assert.equal(parsed.state.experimentAutomation,null);assert.equal(parsed.state.legacy.branches[0].checkpoint!.experimentAutomation,null);}
  assert.equal(Object.hasOwn(original,'experimentAutomation'),false);assert.equal(Object.hasOwn(checkpoint,'experimentAutomation'),false);
});
test('serialized mastered-protocol queue resumes deterministically with its reserved budget intact',()=>{
  const source=automatedGarden();assert.equal(source.experimentAutomation?.remaining,2);assert.equal(source.experimentAutomation?.budgetRemaining,'256');
  const partiallyCompleted=tick(source,14);const parsed=parseSave(serializeSave(partiallyCompleted),getValidationCatalog());assert.ok(parsed.ok,parsed.ok?'':parsed.message);
  if(parsed.ok){const resumed=tick(parsed.state,40),continuous=tick(partiallyCompleted,40);assert.deepEqual(resumed.experiments,continuous.experiments);assert.equal(resumed.research,continuous.research);assert.equal(resumed.experimentAutomation,null);}
});
test('queue import rejects inflated or negative reserves, excess runs, inconsistent counts and unmastered sources',()=>{
  const source=automatedGarden();
  const mutations:((s:GameState)=>void)[]=[s=>s.experimentAutomation!.budgetRemaining='99999999',s=>s.experimentAutomation!.budgetRemaining='-1',s=>s.experimentAutomation!.runLimit=6,s=>s.experimentAutomation!.completed=3,s=>s.experimentAutomation!.source='missing',s=>s.mastered=[],s=>s.experiments[0].adopted=false,s=>s.experiments[0].config.control=false,s=>s.experiments[0].config.holdout=.1,s=>s.activeExperiment=null];
  for(const mutate of mutations){const changed=structuredClone(source);mutate(changed);assert.equal(validateSaveState(changed,getValidationCatalog()).ok,false);}
});
test('automation reserve checks use checkpoint and replay world scale rather than shared legacy scale',()=>{
  const archived=automatedGarden(2);const {legacy:_legacy,...checkpoint}=archived;const current=createGame(42,1000);current.legacy.cycle=7;
  current.legacy.branches.push({id:'past',parentId:null,name:'Earlier scale',constitution:'commons',cycle:2,seed:2026,chapter:1,createdAt:1000,summary:'Preserved automation',checkpoint});
  let parsed=parseSave(serializeSave(current),getValidationCatalog());assert.ok(parsed.ok,parsed.ok?'':parsed.message);
  const replay=automatedGarden();replay.legacy.cycle=7;replay.flags.push('replay-only','replay-cycle:0');parsed=parseSave(serializeSave(replay),getValidationCatalog());assert.ok(parsed.ok,parsed.ok?'':parsed.message);
  replay.experimentAutomation!.budgetRemaining='2.56e44';assert.equal(validateSaveState(replay,getValidationCatalog()).ok,false);
});
test('scope-transfer choice requires a recovery checkpoint while ordinary choices do not',()=>{
  const event=STORY_EVENTS.find(entry=>entry.choices.some(choice=>choice.flags?.includes('scope_transferred')))!;
  const transfer=event.choices.find(choice=>choice.flags?.includes('scope_transferred'))!;
  assert.equal(requiresRecoveryCheckpoint({type:'choose',event:event.id,choice:transfer.id}),true);
  const ordinary=event.choices.find(choice=>!choice.flags?.includes('scope_transferred'))!;
  assert.equal(requiresRecoveryCheckpoint({type:'choose',event:event.id,choice:ordinary.id}),false);
  assert.equal(requiresRecoveryCheckpoint({type:'prestige',layer:'reinitialize'}),true);
});
test('chunked offline simulation matches the actual engine and yields between bounded chunks',async()=>{
  const initial=createGame(42,1000);initial.settings.readingPause=false;initial.simulationRemainder=.1;
  let yields=0;const progress:number[]=[];
  const caught=await catchUpOffline(initial,180.125,{authorize:()=>true,chunkSeconds:30,yieldControl:async()=>{yields++;},progress:processed=>progress.push(processed)});
  assert.equal(caught.cancelled,false);assert.ok(yields>=6);assert.equal(progress[0],0);assert.equal(progress.at(-1),180.125);
  const expected=tick(initial,180.125,true);assert.deepEqual({...caught.state,offlineSummary:null},{...expected,offlineSummary:null});assert.match(caught.state.offlineSummary!,/0 net tokens/);assert.equal(initial.elapsed,0);
});
test('offline recovery caps the scheduled absence at twelve hours and checks ownership each slice',async()=>{
  const initial=createGame(42,1000);let total=0,checks=0;const slices:number[]=[];
  const caught=await catchUpOffline(initial,MAX_OFFLINE_SECONDS*3,{authorize:()=>{checks++;return true;},chunkSeconds:30,yieldControl:async()=>{},progress:(_processed,limit)=>{total=limit;},simulate:(s,seconds,offline)=>{assert.equal(offline,true);slices.push(seconds);return {...s,elapsed:s.elapsed+seconds};}});
  assert.equal(total,MAX_OFFLINE_SECONDS);assert.equal(caught.state.elapsed,MAX_OFFLINE_SECONDS);assert.ok(slices.every(seconds=>seconds<=30));assert.ok(checks>=slices.length*2);assert.match(caught.state.offlineSummary!,/capped at twelve hours/);
});
test('lost ownership or destruction cancels candidate progress without partially committing it',async()=>{
  const initial=createGame(42,1000);let active=true,yields=0;
  const caught=await catchUpOffline(initial,100,{authorize:()=>active,chunkSeconds:10,yieldControl:async()=>{if(++yields===2)active=false;}});
  assert.equal(caught.cancelled,true);assert.strictEqual(caught.state,initial);assert.equal(initial.elapsed,0);assert.equal(caught.processedSeconds,10);
});
test('offline recovery retains story and pause boundaries and releases the event loop before work',async()=>{
  const initial=createGame(42,1000);initial.pendingEvent=STORY_EVENTS[0].id;let heartbeat=false;
  const heartbeatReady=new Promise<void>(resolve=>setTimeout(()=>{heartbeat=true;resolve();},0));
  const caught=await catchUpOffline(initial,3600,{authorize:()=>true,chunkSeconds:30});await heartbeatReady;
  assert.equal(heartbeat,true);assert.equal(caught.state.elapsed,0);assert.equal(caught.state.pendingEvent,initial.pendingEvent);assert.match(caught.state.offlineSummary!,/conversation/);
  const paused={...initial,pendingEvent:null,paused:true};const untouched=await catchUpOffline(paused,3600,{authorize:()=>true});assert.strictEqual(untouched.state,paused);
});
test('offline summary formats enormous earned amounts using the selected notation',async()=>{
  const initial=createGame(42,1000);initial.settings.notation='scientific';
  const caught=await catchUpOffline(initial,3,{authorize:()=>true,yieldControl:async()=>{},simulate:(s,seconds)=>({...s,elapsed:s.elapsed+seconds,tokens:'1.23456789123456789e+110'})});
  assert.match(caught.state.offlineSummary!,/1\.23e110 net tokens/);assert.ok(caught.state.offlineSummary!.length<160);
});

const charterProgramIds:CharterProgramId[]=['stewardship','assurance','reliability','coordination','reciprocity','incentives'];
function historicalCharterRecord(program:CharterProgramId){
  const record=runExperiment({program:'oversight',template:'oversight-1',seed:42,cohort:32,budget:128,holdout:.25,intervention:'baseline',distribution:'familiar',lineage:'clean',prediction:'Registered historical record.',control:true});
  record.id=`historical-${program}`;record.config={...record.config,program,template:`${program}-1`};delete record.evidence;
  // This deliberately synthetic fixture exercises structural decoding only.
  // Its altered protocol must never acquire proof through migration.
  record.observations=record.observations.slice(0,1).map(observation=>({...observation,detail:{kind:program,values:[0,.5,100]}}));
  return record;
}
test('all eleven known program IDs remain valid history independent of the active constitution',()=>{
  const state=fresh();const all:ProgramId[]=['oversight','control','organisms','interpretability','welfare',...charterProgramIds];state.mastered=all;
  state.experiments=charterProgramIds.map(historicalCharterRecord);
  const historyCatalog:ValidationCatalog={...catalog,templates:new Set(charterProgramIds.map(program=>`${program}-1`))};
  const parsed=parseSave(serializeSave(state),historyCatalog);assert.ok(parsed.ok,parsed.ok?'':parsed.message);
  if(parsed.ok){assert.deepEqual(parsed.state.mastered,all);assert.equal(parsed.state.experiments.length,6);assert.ok(parsed.state.experiments.every(record=>record.evidence?.completed===0));}
  const bad=structuredClone(state);bad.mastered.push('unregistered-program' as ProgramId);assert.equal(validateSaveState(bad,historyCatalog).ok,false);
});
test('charter observation details require matching known kind and at most sixteen finite bounded numbers',()=>{
  const state=fresh();state.experiments=[historicalCharterRecord('stewardship')];
  const historyCatalog:ValidationCatalog={...catalog,templates:new Set(['stewardship-1'])};
  state.experiments[0].observations[0].detail!.values=Array.from({length:16},(_,index)=>index-8);assert.equal(validateSaveState(state,historyCatalog).ok,true);
  const mutations:((s:GameState)=>void)[]=[
    s=>s.experiments[0].observations[0].detail!.values.push(17),
    s=>s.experiments[0].observations[0].detail!.values[0]=Infinity,
    s=>s.experiments[0].observations[0].detail!.values[0]=NaN,
    s=>s.experiments[0].observations[0].detail!.values[0]=1e13,
    s=>s.experiments[0].observations[0].detail!.values[0]=('3' as unknown as number),
    s=>s.experiments[0].observations[0].detail!.kind='assurance',
    s=>s.experiments[0].observations[0].detail!.kind=('unknown' as CharterProgramId),
    s=>(s.experiments[0].observations[0].detail as unknown as Record<string,unknown>).extra=true,
    s=>(s.experiments[0].summary as unknown as Record<string,unknown>).measures=[1,2,3]
  ];
  for(const mutate of mutations){const changed=structuredClone(state);mutate(changed);assert.equal(validateSaveState(changed,historyCatalog).ok,false);}
});
test('pending charter work must match its own world while inactive history and archived worlds stay valid',()=>{
  const state=fresh();const record=historicalCharterRecord('assurance');record.adopted=true;
  state.experiments=[record];state.mastered=['assurance'];
  const historyCatalog:ValidationCatalog={...catalog,templates:new Set(['assurance-1'])};
  assert.equal(validateSaveState(state,historyCatalog).ok,true);
  state.activeExperiment={config:record.config,remaining:12};
  let result=validateSaveState(state,historyCatalog);assert.equal(result.ok,false);if(!result.ok)assert.match(result.message,/pending research/);
  state.activeExperiment=null;state.experimentAutomation={source:record.id,remaining:1,completed:0,runLimit:1,budgetRemaining:'128'};
  result=validateSaveState(state,historyCatalog);assert.equal(result.ok,false);if(!result.ok)assert.match(result.message,/pending automation/);
  state.constitution='precaution';assert.equal(validateSaveState(state,historyCatalog).ok,true);
  const {legacy:_legacy,...checkpoint}=state;const current=fresh();
  current.legacy.branches=[{id:'earlier-precaution',parentId:null,name:'Earlier precaution',constitution:'precaution',cycle:0,seed:42,chapter:1,createdAt:1000,summary:'Suspended research',checkpoint}];
  result=parseSave(serializeSave(current),historyCatalog);assert.ok(result.ok,result.ok?'':result.message);
  if(result.ok)assert.deepEqual(result.state.legacy.branches[0].checkpoint!.experimentAutomation,state.experimentAutomation);
});

const charterKinds:ConstitutionId[]=['commons','precaution','service','federation','plural','frontier'];
const manualByKind:Record<ConstitutionId,CharterActionId>={commons:'publish',precaution:'renewTranche',service:'acceptService',federation:'fundDistrict',plural:'fundCare',frontier:'bid'};
const charterHistoryCatalog:ValidationCatalog={...catalog,templates:new Set(charterProgramIds.map(program=>`${program}-1`))};
function charterGarden(kind:ConstitutionId):GameState {
  const state=fresh();state.constitution=kind;
  state.experiments=charterProgramIds.map(program=>{const record=historicalCharterRecord(program);record.adopted=true;return record;});
  const base={version:1 as const,rulesVersion:1 as const,established:true,serial:4,completed:3,appliedTier:1,manualActions:[manualByKind[kind]],receipts:[{id:4,time:0,title:'Established',text:'A finite institution.'}],automation:null};
  const source=(program:CharterProgramId)=>`historical-${program}`;
  const charter:CharterEconomy=kind==='commons'?{...base,kind,data:{methods:[{id:1,program:'stewardship',source:source('stewardship'),dependencies:[],maintenance:80,uses:2,retired:false},{id:2,program:'stewardship',source:source('stewardship'),dependencies:[1],maintenance:70,uses:1,retired:false}],credits:3,focus:'stewardship',mode:'maintained',reuse:2}}:
    kind==='precaution'?{...base,kind,data:{tranches:[{id:1,bond:'1200',capacity:100,coverage:.8,wear:4,source:source('assurance'),active:true}],scope:'local',reserveTarget:.2,operated:'12'}}:
    kind==='service'?{...base,kind,data:{lanes:[{id:'water',backlog:7,buffer:2,delivered:3,required:10},{id:'learning',backlog:7,buffer:1,delivered:3,required:10},{id:'repair',backlog:6,buffer:1,delivered:4,required:10},{id:'logistics',backlog:9,buffer:2,delivered:1,required:10}],allocation:[.25,.25,.25,.25],mode:'balanced',contract:1,active:true,funding:'40',earned:'20',progress:.275,source:source('reliability')}}:
    kind==='federation'?{...base,kind,data:{districts:[{id:'garden',treasury:'1e50',level:1,evidence:1,delivered:'3'},{id:'campus',treasury:'2e50',level:0,evidence:0,delivered:'4'},{id:'harbor',treasury:'0',level:2,evidence:2,delivered:'5'}],allocation:[.3,.3,.4],route:'ring',transfers:[{id:1,from:0,to:2,amount:'3e49',remaining:10,fee:'3e47'}],agreements:3}}:
    kind==='plural'?{...base,kind,data:{cohorts:[{id:'tenders',work:.6,rest:.25,continuity:.15,accepted:true,fit:.8,served:3},{id:'analysts',work:.5,rest:.3,continuity:.2,accepted:true,fit:.9,served:4},{id:'keepers',work:.4,rest:.2,continuity:.4,accepted:false,fit:.4,served:2}],agreement:'matched',careReserve:'2.5e50',continuityDuty:5,preserved:2,unmet:1}}:
    {...base,kind:'frontier',data:{rivals:[{id:'apex',pressure:30,offer:100},{id:'relay',pressure:40,offer:96},{id:'cobalt',pressure:20,offer:104}],tenders:[{id:1,kind:'verified',collateral:'1e50',reward:'2e50',required:80,delivered:5,remaining:60,source:source('incentives')}],offer:'verified',round:1,reputation:80,disclosures:1}};
  state.charter=charter;return state;
}
test('pre-charter saves remain unestablished without changing policy, capital, or historical checkpoints',()=>{
  for(const kind of charterKinds){
    const original=fresh();original.constitution=kind;original.tokens='3.141592653589793e80';original.policies.governance='central';delete original.charter;
    const {legacy:_legacy,...checkpoint}=structuredClone(original);
    original.legacy.branches=[{id:`old-${kind}`,parentId:null,name:'Historical world',constitution:kind,cycle:2,seed:42,chapter:1,createdAt:1000,summary:'Before institutions',checkpoint}];
    const parsed=parseSave(serializeSave(original),catalog);assert.ok(parsed.ok,parsed.ok?'':parsed.message);
    if(parsed.ok){assert.equal(parsed.state.charter,null);assert.equal(parsed.state.legacy.branches[0].checkpoint!.charter,null);assert.equal(parsed.state.tokens,original.tokens);assert.deepEqual(parsed.state.policies,original.policies);assert.deepEqual(parsed.state.journal,original.journal);}
    assert.equal(Object.hasOwn(original,'charter'),false);assert.equal(Object.hasOwn(checkpoint,'charter'),false);
  }
});
test('all six institutional boards round-trip exact balances and suspended obligations',()=>{
  for(const kind of charterKinds){const original=charterGarden(kind);original.charter!.automation={remaining:20,budgetRemaining:'1.23456789123456789e90',reserveFloor:'9e89',elapsed:3,actions:[manualByKind[kind]],maxTier:1};
    const parsed=parseSave(serializeSave(original),charterHistoryCatalog);assert.ok(parsed.ok,parsed.ok?'':`${kind}: ${parsed.message}`);if(parsed.ok)assert.deepEqual(parsed.state.charter,original.charter);
  }
  const archived=charterGarden('federation');const {legacy:_legacy,...checkpoint}=archived;const current=fresh();current.legacy.cycle=9;
  current.legacy.branches=[{id:'old-federation',parentId:null,name:'Earlier federation',constitution:'federation',cycle:2,seed:42,chapter:1,createdAt:1000,summary:'Nominal frozen balances',checkpoint}];
  const parsed=parseSave(serializeSave(current),charterHistoryCatalog);assert.ok(parsed.ok,parsed.ok?'':parsed.message);if(parsed.ok)assert.deepEqual(parsed.state.legacy.branches[0].checkpoint!.charter,archived.charter);
});
test('institutional imports reject incompatible rules, fabricated shapes, overflowing bounds, and unsafe amounts',()=>{
  const mutations:((state:GameState)=>void)[]=[
    s=>s.charter!.version=2 as 1,s=>s.charter!.rulesVersion=2 as 1,s=>s.constitution='service',s=>s.charter!.established=false,
    s=>s.charter!.serial=0,s=>s.charter!.completed=-1,s=>s.charter!.appliedTier=7,
    s=>s.charter!.receipts=Array.from({length:81},(_,index)=>({id:index+1,time:0,title:'Claim',text:'Claim'})),
    s=>s.charter!.receipts.push({...s.charter!.receipts[0]}),
    s=>s.charter!.automation={remaining:21,budgetRemaining:'1',reserveFloor:'0',elapsed:0,actions:[],maxTier:0},
    s=>s.charter!.automation={remaining:0,budgetRemaining:'1',reserveFloor:'0',elapsed:0,actions:[],maxTier:0},
    s=>s.charter!.automation={remaining:1,budgetRemaining:'-1',reserveFloor:'0',elapsed:0,actions:[],maxTier:0},
    s=>s.charter!.automation={remaining:1,budgetRemaining:'1',reserveFloor:'Infinity',elapsed:0,actions:[],maxTier:0},
    s=>(s.charter!.data as unknown as Record<string,unknown>).minted='100',
    s=>{if(s.charter?.kind==='commons')s.charter.data.credits=13;},
    s=>{if(s.charter?.kind==='commons')s.charter.data.methods[0].maintenance=NaN;},
    s=>{if(s.charter?.kind==='commons')s.charter.data.methods[0].id=4;},
    s=>{if(s.charter?.kind==='commons')s.charter.data.methods[0].source='missing';},
    s=>{if(s.charter?.kind==='commons')s.charter.data.focus='assurance';},
  ];
  for(const mutate of mutations){const state=charterGarden('commons');mutate(state);assert.equal(validateSaveState(state,charterHistoryCatalog).ok,false);}
});
test('fixed institutional identities and resource shares cannot be duplicated or overallocated',()=>{
  const examples:[ConstitutionId,(s:GameState)=>void][]=[
    ['service',s=>{if(s.charter?.kind==='service')s.charter.data.lanes[1].id='water';}],
    ['service',s=>{if(s.charter?.kind==='service')s.charter.data.allocation=[1,1,1,1];}],
    ['service',s=>{if(s.charter?.kind==='service')s.charter.data.funding='NaN';}],
    ['federation',s=>{if(s.charter?.kind==='federation')s.charter.data.districts[0].treasury='-10';}],
    ['federation',s=>{if(s.charter?.kind==='federation')s.charter.data.transfers[0].to=0;}],
    ['federation',s=>{if(s.charter?.kind==='federation')s.charter.data.transfers.push({...s.charter.data.transfers[0]});}],
    ['plural',s=>{if(s.charter?.kind==='plural')s.charter.data.cohorts[0].work=.9;}],
    ['plural',s=>{if(s.charter?.kind==='plural')s.charter.data.careReserve='1e1000000001';}],
    ['precaution',s=>{if(s.charter?.kind==='precaution')s.charter.data.tranches[0].bond='-1';}],
    ['frontier',s=>{if(s.charter?.kind==='frontier')s.charter.data.tenders[0].source='historical-assurance';}],
    ['frontier',s=>{if(s.charter?.kind==='frontier')s.charter.data.rivals.pop();}],
  ];
  for(const [kind,mutate] of examples){const state=charterGarden(kind);mutate(state);assert.equal(validateSaveState(state,charterHistoryCatalog).ok,false,kind);}
});
test('method dependencies form a finite DAG and retired provenance survives evidence compaction',()=>{
  const state=charterGarden('commons');assert.ok(state.charter?.kind==='commons');
  state.charter.data.methods[0].dependencies=[2];assert.equal(validateSaveState(state,charterHistoryCatalog).ok,false);
  state.charter.data.methods[0].dependencies=[99];assert.equal(validateSaveState(state,charterHistoryCatalog).ok,false);
  state.charter.data.methods[0].dependencies=[];state.charter.data.methods[0].source='compacted-historical-source';state.charter.data.methods[0].retired=true;
  assert.equal(validateSaveState(state,charterHistoryCatalog).ok,true);
  state.charter.data.methods[0].retired=false;assert.equal(validateSaveState(state,charterHistoryCatalog).ok,false);
  const precaution=charterGarden('precaution');assert.ok(precaution.charter?.kind==='precaution');precaution.charter.data.tranches[0].active=false;precaution.charter.data.tranches[0].source='compacted-case';
  assert.equal(validateSaveState(precaution,charterHistoryCatalog).ok,true);precaution.charter.data.tranches[0].active=true;assert.equal(validateSaveState(precaution,charterHistoryCatalog).ok,false);
});

function authenticCharterHistory():GameState {
  const state=createGame(1701,1000);
  state.experiments=charterProgramIds.map((program,index)=>{
    const template=EXPERIMENT_TEMPLATES.find(entry=>entry.id===`${program}-1`)!;
    const record=runExperiment({program,template:template.id,seed:700+index,cohort:32,budget:256,holdout:.25,intervention:template.interventions[0],distribution:'shifted',lineage:'clean',prediction:'Record both the baseline and intervention before observing the held-out outcomes.',control:true});
    assert.equal(record.observations[0]?.detail?.kind,program);assert.ok(record.evidence!.completed>0);return record;
  });
  return state;
}
test('authentic six-program observations and receipts survive export even as inactive historical curricula',()=>{
  const state=authenticCharterHistory(),parsed=parseSave(serializeSave(state),getValidationCatalog());
  assert.ok(parsed.ok,parsed.ok?'':parsed.message);if(parsed.ok)assert.deepEqual(parsed.state.experiments,state.experiments);
});
test('altered or missing charter instrument readings cannot retain an authentic sample receipt',()=>{
  for(const record of authenticCharterHistory().experiments){
    for(const remove of [false,true]){
      const state=createGame(1701,1000),changed=structuredClone(record);state.experiments=[changed];
      if(remove)delete changed.observations[0].detail;else changed.observations[0].detail!.values[0]+=.125;
      const result=validateSaveState(state,getValidationCatalog());assert.equal(result.ok,false,record.config.program);if(!result.ok)assert.match(result.message,/sample receipt/);
      delete changed.evidence;const migrated=validateSaveState(state,getValidationCatalog());assert.ok(migrated.ok,migrated.ok?'':migrated.message);if(migrated.ok)assert.equal(migrated.state.experiments[0].evidence!.completed,0);
    }
  }
});
test('compacted charter receipts are reconstructed from authentic protocols without minting altered proof',()=>{
  const state=authenticCharterHistory(),expected=state.experiments.map(record=>record.evidence);
  state.experiments.forEach(record=>{record.observations=[];delete record.evidence;});
  const result=parseSave(serializeSave(state),getValidationCatalog());assert.ok(result.ok,result.ok?'':result.message);if(result.ok)assert.deepEqual(result.state.experiments.map(record=>record.evidence),expected);
  assert.ok(state.experiments.every(record=>record.evidence===undefined));
  state.experiments[0].summary.cost+=1;const changed=validateSaveState(state,getValidationCatalog());assert.ok(changed.ok,changed.ok?'':changed.message);if(changed.ok)assert.equal(changed.state.experiments[0].evidence!.completed,0);
});
test('strategy automation imports retain their captured action kinds and maximum authorized tier',()=>{
  const state=charterGarden('commons');state.charter!.automation={remaining:3,budgetRemaining:'120',reserveFloor:'10',elapsed:2,actions:['publish'],maxTier:1};
  const valid=validateSaveState(state,charterHistoryCatalog);assert.ok(valid.ok,valid.ok?'':valid.message);
  const changes:((s:GameState)=>void)[]=[
    s=>s.charter!.automation!.actions=['maintain'],s=>s.charter!.automation!.actions=['publish','publish'],
    s=>s.charter!.automation!.maxTier=6,s=>s.charter!.manualActions=['bid'],
    s=>{s.charter!.manualActions=['publish','retract'];s.charter!.automation!.actions=['retract'];},
    s=>s.charter!.receipts[0].time=1,
  ];
  for(const change of changes){const corrupted=structuredClone(state);change(corrupted);assert.equal(validateSaveState(corrupted,charterHistoryCatalog).ok,false);}
});
test('funded deployment bonds use the frozen checkpoint or replay scale instead of shared prestige scale',()=>{
  const state=charterGarden('precaution');assert.ok(state.charter?.kind==='precaution');state.legacy.cycle=2;state.charter.data.tranches[0].bond='1.2e15';
  let result=validateSaveState(state,charterHistoryCatalog);assert.ok(result.ok,result.ok?'':result.message);
  const {legacy:_legacy,...checkpoint}=state;const current=fresh();current.legacy.cycle=9;
  current.legacy.branches=[{id:'bonded-past',parentId:null,name:'Bonded past',constitution:'precaution',cycle:2,seed:42,chapter:1,createdAt:1000,summary:'Frozen liabilities',checkpoint}];
  result=parseSave(serializeSave(current),charterHistoryCatalog);assert.ok(result.ok,result.ok?'':result.message);
  state.legacy.cycle=9;state.flags.push('replay-only','replay-cycle:2');result=validateSaveState(state,charterHistoryCatalog);assert.ok(result.ok,result.ok?'':result.message);
  state.charter.data.tranches[0].bond='1.2e57';assert.equal(validateSaveState(state,charterHistoryCatalog).ok,false);
});
test('settlement and institutional capacity cannot be inflated by inconsistent derived fields',()=>{
  const cases:[ConstitutionId,(s:GameState)=>void][]=[
    ['service',s=>{if(s.charter?.kind==='service')s.charter.data.progress=1;}],
    ['service',s=>{if(s.charter?.kind==='service')s.charter.data.active=false;}],
    ['federation',s=>{if(s.charter?.kind==='federation')s.charter.data.districts[0].level=7;}],
    ['federation',s=>{if(s.charter?.kind==='federation')s.charter.data.agreements=10;}],
    ['federation',s=>{if(s.charter?.kind==='federation')s.charter.data.transfers[0].fee='0';}],
    ['plural',s=>{if(s.charter?.kind==='plural')s.charter.data.cohorts[0].fit=90;}],
    ['frontier',s=>{if(s.charter?.kind==='frontier')s.charter.data.tenders[0].delivered=81;}],
    ['frontier',s=>{if(s.charter?.kind==='frontier')s.charter.data.tenders[0].remaining=5400;}],
    ['frontier',s=>{if(s.charter?.kind==='frontier')s.charter.data.tenders[0].delivered=0;}],
  ];
  for(const [kind,change] of cases){const state=charterGarden(kind);change(state);assert.equal(validateSaveState(state,charterHistoryCatalog).ok,false,kind);}
});

type HistorySummary={certificates:number;branches:number;viableCycles:number};
const summarizedLegacy=(state:GameState)=>state.legacy as GameState['legacy']&{historySummary?:HistorySummary};
test('optional compact-history counters round-trip without adding metadata to older saves',()=>{
  const older=fresh(),legacyBefore=structuredClone(older.legacy);
  const unchanged=parseSave(serializeSave(older),catalog);assert.ok(unchanged.ok,unchanged.ok?'':unchanged.message);
  if(unchanged.ok){assert.deepEqual(unchanged.state.legacy,legacyBefore);assert.equal(Object.hasOwn(unchanged.state.legacy,'historySummary'),false);}
  const state=fresh();summarizedLegacy(state).historySummary={certificates:10_000,branches:5_000,viableCycles:1_000_000_000_000_000};
  const parsed=parseSave(serializeSave(state),catalog);assert.ok(parsed.ok,parsed.ok?'':parsed.message);if(parsed.ok)assert.deepEqual(summarizedLegacy(parsed.state).historySummary,summarizedLegacy(state).historySummary);
});
test('compact-history counters reject coercion, overflow, nonintegers, and unexpected fields',()=>{
  const base=fresh();summarizedLegacy(base).historySummary={certificates:1,branches:2,viableCycles:3};
  const mutations:((state:GameState)=>void)[]=[
    state=>summarizedLegacy(state).historySummary!.certificates=-1,
    state=>summarizedLegacy(state).historySummary!.branches=.5,
    state=>summarizedLegacy(state).historySummary!.viableCycles=1e15+1,
    state=>summarizedLegacy(state).historySummary!.certificates=NaN,
    state=>summarizedLegacy(state).historySummary!.branches=Infinity,
    state=>summarizedLegacy(state).historySummary!.certificates='1' as unknown as number,
    state=>(summarizedLegacy(state).historySummary as unknown as Record<string,unknown>).cash='1000',
    state=>(state.legacy as unknown as Record<string,unknown>).historySummary=null,
  ];
  for(const mutate of mutations){const changed=structuredClone(base);mutate(changed);assert.equal(validateSaveState(changed,catalog).ok,false);}
});
/** Explicit funded threshold fixture, not an earned campaign or pacing claim. */
function lateHistoryFixture():GameState {
  const state=createGame(1701,1000);state.chapter=7;state.pendingEvent=null;
  state.decisions=Object.fromEntries(STORY_EVENTS.map(event=>[event.id,event.choices[0].id]));
  state.tokens='100000';state.research='1000';state.lifetime='1000000';state.useful='1000000';
  state.metrics={quality:95,distortion:0,agency:85,welfare:85,dependence:35,evidence:90,recall:95,coordination:85,pressure:15,continuity:90,humanWelfare:85,reviewQueue:0};
  state.policies={contract:'verified',communication:'reviewed',external:'blocked',evaluation:'independent',welfare:'consent',continuity:'protected',fallback:'distributed',governance:'council'};
  const finding=runExperiment({program:'control',template:'control-1',seed:91,cohort:32,budget:128,holdout:.25,intervention:'least-privilege',distribution:'familiar',lineage:'clean',prediction:'The tested permission edge should confine its route.',control:true});
  finding.elapsed=state.elapsed;finding.adopted=true;finding.replicated=true;
  const replication=runExperiment({...finding.config,seed:92,distribution:'shifted',replicateOf:finding.id});replication.elapsed=state.elapsed;
  state.experiments=[finding,replication];state.clearance=createOperatingClearance(state);
  recordFindingResponse(state,finding.id,'restrict');registerBoundaryObservation(state,95);
  state.viableSeconds=180;state.certificateProgress=60;state.flags.push('fresh-evidence:0');return state;
}
function assertImportable(state:GameState){const imported=parseSave(serializeSave(state),getValidationCatalog());assert.ok(imported.ok,imported.ok?'':imported.message);}
test('explicit 10000-certificate boundary remains importable and retains the minority-family Reframe witness',()=>{
  const before=lateHistoryFixture();before.certificateTier=10000;
  before.legacy.contracts=Array.from({length:10000},(_,tier)=>{const family=tier===0?'service':'commons';return {id:`certificate:0:${family}:${tier}`,family,cycle:0,redeemed:false};});
  before.legacy.claims=before.legacy.contracts.map(contract=>contract.id);assertImportable(before);
  const result=dispatchCommand(before,{type:'certify'});assert.ok(result.ok,result.message);assertImportable(result.state);
  const after=result.state,summary=summarizedLegacy(after).historySummary!;assert.ok(summary);
  assert.equal(after.legacy.contracts.length+summary.certificates,10001);assert.ok(after.legacy.claims.length<=10000);
  assert.ok(after.legacy.contracts.some(contract=>contract.id==='certificate:0:commons:10000'));
  assert.ok(after.legacy.contracts.some(contract=>contract.family==='service'&&!contract.redeemed));
  after.ending='limit';after.endingTime=after.elapsed;after.legacy.viableCycles=[0];
  assert.equal(prestigeEligibility(after,'reframe').allowed,true,'Compaction must preserve the only second-family certificate.');
  assert.equal(Object.hasOwn(before.legacy,'historySummary'),false,'The public command must not mutate its input fixture.');
});
test('explicit 5000-branch boundary preserves a usable current checkpoint and exact retired history count',()=>{
  const before=lateHistoryFixture();before.legacy.branches=Array.from({length:5000},(_,index)=>({id:`fixture-history-${index}`,parentId:index?`fixture-history-${index-1}`:null,name:`Fixture ${index}`,constitution:'commons',cycle:0,seed:index,chapter:7,createdAt:1000,summary:'Explicit boundary fixture.',ending:'limit'}));assertImportable(before);
  const result=dispatchCommand(before,{type:'finish',ending:'limit'});assert.ok(result.ok,result.message);assertImportable(result.state);
  const after=result.state,summary=summarizedLegacy(after).historySummary!;assert.ok(summary);
  assert.equal(after.legacy.branches.length+summary.branches,5001);assert.ok(after.legacy.branches.find(branch=>branch.id===after.id)?.checkpoint);
  assert.equal(before.legacy.branches.length,5000);assert.equal(Object.hasOwn(before.legacy,'historySummary'),false);
});
test('explicit 10000-viable-cycle boundary retains current eligibility without backdating other worlds',()=>{
  const before=lateHistoryFixture();before.legacy.cycle=10000;before.useful='1e60010';before.lifetime='1e60010';
  before.legacy.viableCycles=Array.from({length:10000},(_,index)=>index);assertImportable(before);
  const result=dispatchCommand(before,{type:'finish',ending:'limit'});assert.ok(result.ok,result.message);assertImportable(result.state);
  const after=result.state,summary=summarizedLegacy(after).historySummary!;assert.ok(summary);
  assert.equal(after.legacy.viableCycles.length+summary.viableCycles,10001);assert.ok(after.legacy.viableCycles.includes(10000));
  assert.equal(after.legacy.viableCycles.filter(cycle=>cycle===10000).length,1);assert.equal(before.legacy.viableCycles.length,10000);
});
test('previously accepted duplicate legacy details cannot defeat bounded compaction or revive redeemed contracts',()=>{
  const certificates=lateHistoryFixture();certificates.certificateTier=1;
  certificates.legacy.contracts=Array.from({length:10000},(_,index)=>({id:'certificate:0:commons:0',family:'commons',cycle:0,redeemed:index===0}));certificates.legacy.claims=['certificate:0:commons:0'];assertImportable(certificates);
  const certified=dispatchCommand(certificates,{type:'certify'});assert.ok(certified.ok,certified.message);assertImportable(certified.state);
  assert.equal(certified.state.legacy.contracts.filter(contract=>contract.id==='certificate:0:commons:0').length,1);
  assert.equal(certified.state.legacy.contracts.find(contract=>contract.id==='certificate:0:commons:0')!.redeemed,true);
  const branches=lateHistoryFixture();branches.legacy.branches=Array.from({length:5000},()=>({id:'duplicate-history',parentId:null,name:'Repeated imported row',constitution:'commons',cycle:0,seed:42,chapter:7,createdAt:1000,summary:'Explicit duplicate fixture.',ending:'limit'}));assertImportable(branches);
  const ended=dispatchCommand(branches,{type:'finish',ending:'limit'});assert.ok(ended.ok,ended.message);assertImportable(ended.state);
  assert.equal(new Set(ended.state.legacy.branches.map(branch=>branch.id)).size,ended.state.legacy.branches.length);
  const viable=lateHistoryFixture();viable.legacy.cycle=1;viable.useful='1e12';viable.lifetime='1e12';viable.legacy.viableCycles=Array.from({length:10000},()=>0);assertImportable(viable);
  const finished=dispatchCommand(viable,{type:'finish',ending:'limit'});assert.ok(finished.ok,finished.message);assertImportable(finished.state);
  assert.equal(new Set(finished.state.legacy.viableCycles).size,finished.state.legacy.viableCycles.length);
});
