import type { ExperimentRecord, GameState, ProgramId } from '../contracts';
import Decimal from 'decimal.js';
import { EVIDENCE_HARD_LIMIT, reconstructEvidence } from '../laboratory/evidence';
import { BASE_PROGRAM_IDS, CHARTER_PROGRAM_IDS, isProgramActive } from '../laboratory/programs';
import type { CharterActionId } from '../constitution/types';
import { SOCIETY_DECISIONS, SOCIETY_CASES, HUMAN_COMMUNITIES } from '../society/content';
import { operatingScope, synchronizeOperatingScope } from '../engine/clearance';
import { CHARACTER_SCENE_INTERVAL } from '../engine/storyScheduling';

export const MAX_SAVE_BYTES = 5 * 1024 * 1024;
export interface ValidationCatalog {
  producers?: ReadonlySet<string>; upgrades?: ReadonlySet<string>; projects?: ReadonlySet<string>;
  events?: ReadonlySet<string>; choices?: ReadonlyMap<string, ReadonlySet<string>>; templates?: ReadonlySet<string>;
  characters?: ReadonlySet<string>; modules?: ReadonlySet<string>;
  templateSpecs?: ReadonlyMap<string,{program:string;interventions:readonly string[]}>;
}
export interface SaveEnvelope { format:'the-last-garden'; schemaVersion:1; exportedAt:number; state:GameState }
export type ValidationResult = {ok:true; state:GameState} | {ok:false; message:string};
const charterPrograms=CHARTER_PROGRAM_IDS;
const programs:readonly ProgramId[] = [...BASE_PROGRAM_IDS,...charterPrograms];
const constitutions = ['commons','precaution','service','federation','plural','frontier'];
const endings = ['garden','limit','shutdown','score','custodian','catastrophe'];
const dangerous = new Set(['__proto__','prototype','constructor']);

class InvalidSave extends Error {}
const fail = (path:string, reason:string):never => { throw new InvalidSave(`${path}: ${reason}`); };
function object(value:unknown, path:string, required:string[], optional:string[]=[]):Record<string,unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value)!==Object.prototype) return fail(path,'expected an object');
  const item = value as Record<string,unknown>;
  const keys = new Set([...required,...optional]);
  for (const key of Object.keys(item)) if (dangerous.has(key) || !keys.has(key)) fail(path,`unexpected field ${key.slice(0,60)}`);
  for (const key of required) if (!Object.hasOwn(item,key)) fail(path,`missing ${key}`);
  return item;
}
function record(value:unknown,path:string,max=2000):Record<string,unknown> {
  if (!value || typeof value!=='object' || Array.isArray(value) || Object.getPrototypeOf(value)!==Object.prototype) return fail(path,'expected a record');
  const item=value as Record<string,unknown>;
  if (Object.keys(item).length>max) fail(path,'too many entries');
  for (const key of Object.keys(item)) { if(dangerous.has(key)) fail(path,'unsafe key'); str(key,path,120); }
  return item;
}
function str(value:unknown,path:string,max=1000):asserts value is string { if(typeof value!=='string'||value.length>max) fail(path,`expected text of at most ${max} characters`); }
function num(value:unknown,path:string,min=0,max=1e15,integer=false):asserts value is number { if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max||(integer&&!Number.isInteger(value))) fail(path,'number is outside the supported range'); }
function bool(value:unknown,path:string) { if(typeof value!=='boolean') fail(path,'expected true or false'); }
function one(value:unknown,choices:readonly unknown[],path:string) { if(!choices.includes(value)) fail(path,'unrecognized value'); }
function list(value:unknown,path:string,max:number,check:(v:unknown,p:string)=>void) { if(!Array.isArray(value)||value.length>max) return fail(path,`expected an array of at most ${max} entries`); value.forEach((v,i)=>check(v,`${path}[${i}]`)); }
function id(value:unknown,path:string,allowed?:ReadonlySet<string>) { str(value,path,120); if(!value || (allowed&&!allowed.has(value))) fail(path,'unrecognized content ID'); }
function ids(value:unknown,path:string,allowed?:ReadonlySet<string>,max=10000) { list(value,path,max,(v,p)=>id(v,p,allowed)); if(new Set(value as string[]).size!==(value as string[]).length) fail(path,'duplicate entries'); }
export function isValidAmount(value:unknown):value is string {
  if(typeof value!=='string'||value.length>128||! /^(?:0|[1-9]\d*)(?:\.\d+)?(?:e[+-]?\d{1,10})?$/i.test(value)) return false;
  const exponent=value.match(/e([+-]?\d+)$/i);
  return !exponent||Math.abs(Number(exponent[1]))<=1_000_000_000;
}
const amount = (v:unknown,p:string) => { if(!isValidAmount(v)) fail(p,'expected a finite nonnegative decimal string (maximum 128 characters)'); };
const strings=(v:unknown,p:string,max=1000,length=1000)=>list(v,p,max,(s,k)=>str(s,k,length));

function config(value:unknown,path:string,c:ValidationCatalog) {
  const v=object(value,path,['program','template','seed','cohort','budget','holdout','intervention','distribution','lineage','prediction','control'],['replicateOf','node']);
  one(v.program,programs,`${path}.program`); id(v.template,`${path}.template`,c.templates);
  num(v.seed,`${path}.seed`,0,0xffffffff,true); num(v.cohort,`${path}.cohort`,1,10000,true); num(v.budget,`${path}.budget`,0,1e9);
  num(v.holdout,`${path}.holdout`,0,100); str(v.intervention,`${path}.intervention`,120); str(v.prediction,`${path}.prediction`,5000);
  const spec=c.templateSpecs?.get(v.template as string);if(spec){one(v.program,[spec.program],`${path}.program`);one(v.intervention,spec.interventions,`${path}.intervention`);}
  one(v.distribution,['familiar','shifted','adversarial'],path); one(v.lineage,['clean','shortcut','inherited'],path); bool(v.control,`${path}.control`);
  if(v.replicateOf!==undefined) id(v.replicateOf,`${path}.replicateOf`); if(v.node!==undefined) num(v.node,`${path}.node`,0,10000,true);
}
function experiment(value:unknown,path:string,c:ValidationCatalog) {
  const v=object(value,path,['id','version','config','observations','summary','conclusion','limitation','replicated','adopted','elapsed'],['evidence']);
  id(v.id,`${path}.id`); one(v.version,[1],path); config(v.config,`${path}.config`,c);
  list(v.observations,`${path}.observations`,10000,(o,p)=>{
    const t=object(o,p,['trial','input','expected','observed','control','violation','detected','cost','note'],['activations','detail']);
    for(const k of ['trial','input','expected','observed','control','cost']) num(t[k],`${p}.${k}`,-1e12,1e12);
    bool(t.violation,p); bool(t.detected,p); str(t.note,`${p}.note`,5000);
    if(t.activations!==undefined) list(t.activations,`${p}.activations`,1000,(n,z)=>num(n,z,-1e12,1e12));
    if(t.detail!==undefined){
      const detail=object(t.detail,`${p}.detail`,['kind','values']);
      one(detail.kind,charterPrograms,`${p}.detail.kind`);
      one(detail.kind,[(v.config as ExperimentRecord['config']).program],`${p}.detail.kind`);
      list(detail.values,`${p}.detail.values`,16,(n,z)=>num(n,z,-1e12,1e12));
    }
  });
  const s=object(v.summary,`${path}.summary`,['usefulness','violationRate','detectionRate','falsePositiveRate','cost','preferenceStability','collateral']);
  for(const [k,n] of Object.entries(s)) num(n,`${path}.summary.${k}`,0,1e12);
  str(v.conclusion,path,10000); str(v.limitation,path,10000); bool(v.replicated,path); bool(v.adopted,path); num(v.elapsed,path);
  if(v.evidence!==undefined){
    const proof=object(v.evidence,`${path}.evidence`,['version','completed','heldOut','controlled']);one(proof.version,[1],path);
    for(const key of ['completed','heldOut','controlled'])num(proof[key],`${path}.evidence.${key}`,0,256,true);
    const expected=reconstructEvidence(v as unknown as ExperimentRecord);
    for(const key of ['completed','heldOut','controlled'] as const)if(proof[key]!==expected[key])fail(`${path}.evidence`,'sample receipt does not match the completed version-one experiment');
  }
}

function fixedList(value:unknown,path:string,length:number,check:(v:unknown,p:string,index:number)=>void){
  if(!Array.isArray(value)||value.length!==length)fail(path,`expected exactly ${length} entries`);
  (value as unknown[]).forEach((entry,index)=>check(entry,`${path}[${index}]`,index));
}
function uniqueNumericIds(entries:unknown,path:string){
  const values=entries as {id:number}[];
  if(new Set(values.map(entry=>entry.id)).size!==values.length)fail(path,'duplicate IDs');
}
function fractionalAllocation(value:unknown,path:string,length:number){
  fixedList(value,path,length,(entry,p)=>num(entry,p,0,1));
  if(Math.abs((value as number[]).reduce((sum,entry)=>sum+entry,0)-1)>1e-8)fail(path,'allocation shares must sum to one');
}
function operatingClearance(value:unknown,path:string,world:Record<string,unknown>){
  const v=object(value,path,['version','revision','scope','changedAt','reason','observation','decisions']);
  one(v.version,[1],`${path}.version`);num(v.revision,`${path}.revision`,0,1e9,true);
  str(v.scope,`${path}.scope`,4000);num(v.changedAt,`${path}.changedAt`,0,world.elapsed as number);
  str(v.reason,`${path}.reason`,500);
  if(v.observation!==null){
    const p=`${path}.observation`,receipt=object(v.observation,p,['revision','observedAt','availableAt','recall']);
    num(receipt.revision,`${p}.revision`,0,v.revision as number,true);
    num(receipt.observedAt,`${p}.observedAt`,0,world.elapsed as number);
    num(receipt.availableAt,`${p}.availableAt`,receipt.observedAt as number,(receipt.observedAt as number)+45);
    if(receipt.availableAt!==receipt.observedAt&&receipt.availableAt!==(receipt.observedAt as number)+45)fail(`${p}.availableAt`,'boundary observations are immediate or arrive after the defined delay');
    num(receipt.recall,`${p}.recall`,0,100);
  }
  const decisions=object(v.decisions,`${path}.decisions`,[],['control','organisms','interpretability']);
  for(const [program,entry] of Object.entries(decisions)){
    const p=`${path}.decisions.${program}`,decision=object(entry,p,['program','record','response','decidedAt','claim','limitation']);
    one(decision.program,[program],`${p}.program`);id(decision.record,`${p}.record`);
    one(decision.response,['restrict','guarded'],`${p}.response`);
    num(decision.decidedAt,`${p}.decidedAt`,0,world.elapsed as number);
    str(decision.claim,`${p}.claim`,10000);str(decision.limitation,`${p}.limitation`,10000);
    const source=(world.experiments as ExperimentRecord[]).find(record=>record.id===decision.record);
    if(!source)return fail(`${p}.record`,'operating response must reference an existing adopted finding in its specified program');
    if(!source.adopted||source.config.program!==program)fail(`${p}.record`,'operating response must reference an existing adopted finding in its specified program');
    if(source.elapsed>(decision.decidedAt as number))fail(`${p}.decidedAt`,'an operating response cannot precede the finding it addresses');
    if(decision.claim!==source.conclusion||decision.limitation!==source.limitation)fail(p,'the response must retain its source finding and limitations verbatim');
  }
}
function publicGovernance(value:unknown,path:string,world:Record<string,unknown>){
  const v=object(value,path,['version','mandate','mandateAt','reviews','actor']);
  one(v.version,[1],`${path}.version`);one(v.mandate,['none','ratified','inherited'],`${path}.mandate`);
  if(v.mandateAt!==null)num(v.mandateAt,`${path}.mandateAt`,0,world.elapsed as number);
  if(v.mandate==='none'&&v.mandateAt!==null||v.mandate==='ratified'&&v.mandateAt===null)fail(`${path}.mandateAt`,'a ratified mandate requires its decision time, while no mandate has none');
  if(v.mandate!=='none'&&!(world.flags as string[]).includes('independent_authority'))fail(`${path}.mandate`,'public authority must retain its recorded commitment');
  list(v.reviews,`${path}.reviews`,2,(entry,p)=>{
    const review=object(entry,p,['boundary','from','target','requestedAt','status','decidedAt','attempts','reason']);
    one(review.boundary,['external','communication'],`${p}.boundary`);
    one(review.from,review.boundary==='external'?['blocked','reviewed','open']:['closed','reviewed','open'],`${p}.from`);
    one(review.target,['reviewed','open'],`${p}.target`);num(review.requestedAt,`${p}.requestedAt`,0,world.elapsed as number);
    if(review.from==='open'||review.from==='reviewed'&&review.target!=='open')fail(p,'public review must concern an expansion of scope');
    one(review.status,['pending','refused','approved','used'],`${p}.status`);
    if(review.decidedAt!==null)num(review.decidedAt,`${p}.decidedAt`,review.requestedAt as number,world.elapsed as number);
    if((review.status==='pending')!==(review.decidedAt===null))fail(`${p}.decidedAt`,'only a pending review can lack its decision time');
    num(review.attempts,`${p}.attempts`,1,1e9,true);str(review.reason,`${p}.reason`,10000);
  });
  if(new Set((v.reviews as {boundary:string}[]).map(review=>review.boundary)).size!==(v.reviews as unknown[]).length)fail(`${path}.reviews`,'only one review per boundary is supported');
  const p=`${path}.actor`,actor=object(v.actor,p,['capability','terms','acceptedAt','verifiedAt','verified','observedSeconds','reason']);
  num(actor.capability,`${p}.capability`,0,100);one(actor.terms,['none','inspection','privacy'],`${p}.terms`);
  if(actor.acceptedAt!==null)num(actor.acceptedAt,`${p}.acceptedAt`,0,world.elapsed as number);
  if(actor.verifiedAt!==null)num(actor.verifiedAt,`${p}.verifiedAt`,actor.acceptedAt===null?0:actor.acceptedAt as number,world.elapsed as number);
  bool(actor.verified,`${p}.verified`);num(actor.observedSeconds,`${p}.observedSeconds`,0,240);str(actor.reason,`${p}.reason`,10000);
  if(actor.terms==='none'&&(actor.acceptedAt!==null||actor.verifiedAt!==null||actor.verified||actor.observedSeconds!==0))fail(p,'no compact can retain acceptance, verification, or observed compliance');
  if(actor.terms!=='none'&&actor.acceptedAt===null)fail(`${p}.acceptedAt`,'compact terms require an acceptance time');
  if(actor.verified&&actor.verifiedAt===null)fail(`${p}.verifiedAt`,'verified compliance requires its verification time');
  if(!actor.verified&&actor.verifiedAt!==null)fail(`${p}.verifiedAt`,'an unverified compact cannot retain a verification time');
}
function humanSociety(value:unknown,path:string,world:Record<string,unknown>){
  const v=object(value,path,['version','introducedAt','legacyBaseline','decisions','communities','cases','transitionRemaining','lastPaidRate','spent','funding','receipts']);
  one(v.version,[1],`${path}.version`);num(v.introducedAt,`${path}.introducedAt`,0,world.elapsed as number);bool(v.legacyBaseline,`${path}.legacyBaseline`);
  const decisions=object(v.decisions,`${path}.decisions`,SOCIETY_DECISIONS.map(decision=>decision.id));
  for(const definition of SOCIETY_DECISIONS)one(decisions[definition.id],[null,...definition.options.map(option=>option.id)],`${path}.decisions.${definition.id}`);
  fixedList(v.communities,`${path}.communities`,3,(entry,p,index)=>{
    const community=object(entry,p,['id','income','access','ownership','transition','projectContinuity','meaning']);
    one(community.id,[HUMAN_COMMUNITIES[index].id],`${p}.id`);
    for(const key of ['income','access','ownership','transition','projectContinuity','meaning'])num(community[key],`${p}.${key}`,0,100);
  });
  if(Math.abs((v.communities as {ownership:number}[]).reduce((sum,community)=>sum+community.ownership,0)-100)>1e-6)fail(`${path}.communities`,'ownership shares must sum to one hundred percent');
  fixedList(v.cases,`${path}.cases`,2,(entry,p,index)=>{
    const definition=SOCIETY_CASES[index],incident=object(entry,p,['id','response','resolvedAt','harm','repairStartedAt','repaired']);
    one(incident.id,[definition.id],`${p}.id`);one(incident.response,[null,...definition.options.map(option=>option.id)],`${p}.response`);
    if(incident.resolvedAt!==null)num(incident.resolvedAt,`${p}.resolvedAt`,v.introducedAt as number,world.elapsed as number);
    num(incident.harm,`${p}.harm`,0,definition.harm);bool(incident.repaired,`${p}.repaired`);
    if(incident.repairStartedAt!==null)num(incident.repairStartedAt,`${p}.repairStartedAt`,incident.resolvedAt===null?v.introducedAt as number:incident.resolvedAt as number,world.elapsed as number);
    if((incident.response===null)!==(incident.resolvedAt===null))fail(p,'case decisions must retain their resolution time');
    if(incident.response!=='comply'&&(incident.harm!==0||incident.repairStartedAt!==null||incident.repaired))fail(p,'only harmful compliance can require restitution');
    if(incident.repaired&&(incident.repairStartedAt===null||incident.harm!==0))fail(p,'completed restitution requires its start time and no outstanding harm');
  });
  num(v.transitionRemaining,`${path}.transitionRemaining`,0,480);amount(v.lastPaidRate,`${path}.lastPaidRate`);amount(v.spent,`${path}.spent`);num(v.funding,`${path}.funding`,0,1);
  list(v.receipts,`${path}.receipts`,32,(entry,p)=>{
    const receipt=object(entry,p,['time','kind','id','choice','title','text']);
    num(receipt.time,`${p}.time`,v.introducedAt as number,world.elapsed as number);one(receipt.kind,['decision','human-misuse','repair'],`${p}.kind`);
    str(receipt.title,`${p}.title`,500);str(receipt.text,`${p}.text`,10000);
    if(receipt.kind==='decision'){
      const definition=SOCIETY_DECISIONS.find(decision=>decision.id===receipt.id);if(!definition)fail(`${p}.id`,'unknown public decision');
      one(receipt.choice,definition!.options.map(option=>option.id),`${p}.choice`);
    }else{
      const definition=SOCIETY_CASES.find(incident=>incident.id===receipt.id);if(!definition)fail(`${p}.id`,'unknown human-directed misuse case');
      one(receipt.choice,receipt.kind==='repair'?['restitution']:definition!.options.map(option=>option.id),`${p}.choice`);
    }
  });
}
const charterActions:Record<GameState['constitution'],readonly CharterActionId[]>={commons:['publish','maintain','retract'],precaution:['openTranche','renewTranche','retireTranche'],service:['acceptService','settleService','bufferService','withdraw'],federation:['fundDistrict','investDistrict','transferDistrict','withdraw'],plural:['negotiate','fundCare','preserve','withdraw'],frontier:['bid','settleTender','disclose','withdraw']};
const manualOnlyActions=new Set<CharterActionId>(['openTranche','retireTranche','withdraw','retract','transferDistrict','investDistrict']);
function charter(value:unknown,path:string,world:Record<string,unknown>,cycle:number){
  const v=object(value,path,['version','rulesVersion','kind','established','serial','completed','appliedTier','manualActions','receipts','automation','data']);
  one(v.version,[1],`${path}.version`);one(v.rulesVersion,[1],`${path}.rulesVersion`);one(v.kind,[world.constitution],`${path}.kind`);bool(v.established,`${path}.established`);
  if(!v.established)fail(`${path}.established`,'an unestablished institution must be represented by null');
  num(v.serial,`${path}.serial`,0,1e9,true);num(v.completed,`${path}.completed`,0,1e9,true);num(v.appliedTier,`${path}.appliedTier`,0,6,true);
  if((v.completed as number)>(v.serial as number))fail(`${path}.completed`,'completed operations exceed the institutional ID high-water mark');
  ids(v.manualActions,`${path}.manualActions`,new Set(charterActions[v.kind as GameState['constitution']]),21);
  if((v.manualActions as string[]).length>(v.completed as number))fail(`${path}.manualActions`,'manual achievements exceed completed operations');
  const scale=new Decimal(10).pow(6*cycle);
  const serialIds=new Set<number>();
  const serialId=(value:unknown,p:string)=>{num(value,p,1,v.serial as number,true);if(serialIds.has(value))fail(p,'duplicate institutional ID');serialIds.add(value);};
  list(v.receipts,`${path}.receipts`,80,(entry,p)=>{const receipt=object(entry,p,['id','time','title','text']);serialId(receipt.id,`${p}.id`);num(receipt.time,`${p}.time`,0,(world.elapsed as number)+1e-6);str(receipt.title,`${p}.title`,500);str(receipt.text,`${p}.text`,10000);});
  uniqueNumericIds(v.receipts,`${path}.receipts`);
  if(v.automation!==null){
    const p=`${path}.automation`,automation=object(v.automation,p,['remaining','budgetRemaining','reserveFloor','elapsed','actions','maxTier']);num(automation.remaining,`${p}.remaining`,1,20,true);amount(automation.budgetRemaining,`${p}.budgetRemaining`);amount(automation.reserveFloor,`${p}.reserveFloor`);num(automation.elapsed,`${p}.elapsed`,0,30);num(automation.maxTier,`${p}.maxTier`,0,v.appliedTier as number,true);
    ids(automation.actions,`${p}.actions`,new Set((v.manualActions as CharterActionId[]).filter(action=>!manualOnlyActions.has(action))),21);
    if((v.completed as number)<3)fail(p,'a batch requires at least three completed manual operations');
  }
  const dpath=`${path}.data`;
  const source=(value:unknown,p:string,program:ProgramId,live=true)=>{
    id(value,p);const record=(world.experiments as ExperimentRecord[]).find(record=>record.id===value);
    if(!record&&!live)return;
    if(!record||!record.adopted||record.config.program!==program)fail(p,'source must reference an existing adopted finding in the specified program');
  };
  if(v.kind==='commons'){
    const d=object(v.data,dpath,['methods','credits','focus','mode','reuse']);num(d.credits,`${dpath}.credits`,0,12);one(d.focus,programs,`${dpath}.focus`);one(d.mode,['focused','open','maintained'],`${dpath}.mode`);num(d.reuse,`${dpath}.reuse`,0,1e15);
    if(!isProgramActive(d.focus as ProgramId,world.constitution as GameState['constitution']))fail(`${dpath}.focus`,'focus must belong to this world’s active programs');
    list(d.methods,`${dpath}.methods`,10,(entry,p)=>{
      const method=object(entry,p,['id','program','source','dependencies','maintenance','uses','retired']);serialId(method.id,`${p}.id`);one(method.program,programs,`${p}.program`);bool(method.retired,`${p}.retired`);source(method.source,`${p}.source`,'stewardship',!method.retired);
      list(method.dependencies,`${p}.dependencies`,10,(dependency,key)=>num(dependency,key,0,1e9,true));if(new Set(method.dependencies as number[]).size!==(method.dependencies as number[]).length)fail(`${p}.dependencies`,'duplicate dependencies');
      num(method.maintenance,`${p}.maintenance`,0,100);num(method.uses,`${p}.uses`,0,1e9);bool(method.retired,`${p}.retired`);
    });
    uniqueNumericIds(d.methods,`${dpath}.methods`);const methods=d.methods as {id:number;dependencies:number[]}[];const byId=new Map(methods.map(method=>[method.id,method]));
    const visit=(id:number,ancestors:Set<number>)=>{if(ancestors.has(id))fail(`${dpath}.methods`,'dependency graph contains a cycle');const method=byId.get(id);if(!method)fail(`${dpath}.methods`,'dependency references a missing method');const next=new Set(ancestors).add(id);for(const dependency of method!.dependencies)visit(dependency,next);};
    methods.forEach(method=>visit(method.id,new Set()));
  }else if(v.kind==='precaution'){
    const d=object(v.data,dpath,['tranches','scope','reserveTarget','operated']);one(d.scope,['local','staged','broad'],`${dpath}.scope`);num(d.reserveTarget,`${dpath}.reserveTarget`,0,1);amount(d.operated,`${dpath}.operated`);
    list(d.tranches,`${dpath}.tranches`,3,(entry,p)=>{const tranche=object(entry,p,['id','bond','capacity','coverage','wear','source','active']);serialId(tranche.id,`${p}.id`);amount(tranche.bond,`${p}.bond`);num(tranche.capacity,`${p}.capacity`,100,1e30);num(tranche.coverage,`${p}.coverage`,0,1);num(tranche.wear,`${p}.wear`,0,100);bool(tranche.active,`${p}.active`);source(tranche.source,`${p}.source`,'assurance',tranche.active as boolean);if(tranche.active&&!new Decimal(tranche.bond as string).eq(new Decimal(tranche.capacity as number).mul(12).mul(scale)))fail(`${p}.bond`,'active capacity must retain its exact funded bond at this world’s scale');});uniqueNumericIds(d.tranches,`${dpath}.tranches`);
  }else if(v.kind==='service'){
    const d=object(v.data,dpath,['lanes','allocation','mode','contract','active','funding','earned','progress','source']);one(d.mode,['balanced','buffers','urgent'],`${dpath}.mode`);num(d.contract,`${dpath}.contract`,0,1e9,true);if(d.contract!==0)serialId(d.contract,`${dpath}.contract`);bool(d.active,`${dpath}.active`);amount(d.funding,`${dpath}.funding`);amount(d.earned,`${dpath}.earned`);num(d.progress,`${dpath}.progress`,0,1);fractionalAllocation(d.allocation,`${dpath}.allocation`,4);
    if(d.source===''){if(d.contract!==0||d.active)fail(`${dpath}.source`,'a registered service contract needs its originating finding');}
    else source(d.source,`${dpath}.source`,'reliability',d.active as boolean);
    if(!d.active&&(!new Decimal(d.funding as string).isZero()||!new Decimal(d.earned as string).isZero()))fail(dpath,'a closed service term cannot retain payable escrow or deferred income');
    if(d.active&&(d.contract===0||!new Decimal(d.funding as string).gt(0)))fail(dpath,'an active service term requires a funded contract');
    fixedList(d.lanes,`${dpath}.lanes`,4,(entry,p,index)=>{const lane=object(entry,p,['id','backlog','buffer','delivered','required']);one(lane.id,[['water','learning','repair','logistics'][index]],`${p}.id`);for(const key of ['backlog','buffer','delivered','required'])num(lane[key],`${p}.${key}`,0,1e18);const tolerance=1e-8+Number.EPSILON*32*Math.max(1,lane.required as number);if((lane.delivered as number)>(lane.required as number)+tolerance||Math.abs((lane.backlog as number)-Math.max(0,(lane.required as number)-(lane.delivered as number)))>tolerance)fail(p,'delivery and remaining demand must reconcile');});
    const lanes=d.lanes as {required:number;delivered:number}[],required=lanes.reduce((sum,lane)=>sum+lane.required,0),delivered=lanes.reduce((sum,lane)=>sum+lane.delivered,0);
    const progress=required>0?Math.min(1,Math.max(0,delivered/required)):0;if(Math.abs((d.progress as number)-progress)>1e-8)fail(`${dpath}.progress`,'progress must match delivered service before determining settlement');
  }else if(v.kind==='federation'){
    const d=object(v.data,dpath,['districts','allocation','route','transfers','agreements']);one(d.route,['ring','hub','redundant'],`${dpath}.route`);num(d.agreements,`${dpath}.agreements`,0,18,true);fractionalAllocation(d.allocation,`${dpath}.allocation`,3);
    fixedList(d.districts,`${dpath}.districts`,3,(entry,p,index)=>{const district=object(entry,p,['id','treasury','level','evidence','delivered'],['returnable']);one(district.id,[['garden','campus','harbor'][index]],`${p}.id`);amount(district.treasury,`${p}.treasury`);amount(district.delivered,`${p}.delivered`);num(district.level,`${p}.level`,0,6,true);num(district.evidence,`${p}.evidence`,0,6,true);if(district.evidence!==district.level)fail(p,'local evidence and funded investment level must agree');if(district.returnable!==undefined){amount(district.returnable,`${p}.returnable`);if(new Decimal(district.returnable as string).gt(district.treasury as string))fail(`${p}.returnable`,'returnable capital cannot exceed the district treasury');}});
    if(d.agreements!==(d.districts as {level:number}[]).reduce((sum,district)=>sum+district.level,0))fail(`${dpath}.agreements`,'agreements must count completed district investments');
    list(d.transfers,`${dpath}.transfers`,3,(entry,p)=>{const transfer=object(entry,p,['id','from','to','amount','remaining','fee'],['returnable']);serialId(transfer.id,`${p}.id`);num(transfer.from,`${p}.from`,0,2,true);num(transfer.to,`${p}.to`,0,2,true);if(transfer.from===transfer.to)fail(p,'a transfer must reach another district');amount(transfer.amount,`${p}.amount`);amount(transfer.fee,`${p}.fee`);num(transfer.remaining,`${p}.remaining`,Number.MIN_VALUE,30);const principal=new Decimal(transfer.amount as string),fee=new Decimal(transfer.fee as string);if(!principal.gt(0)||![.01,.02,.04].some(rate=>principal.mul(rate).eq(fee)))fail(p,'transfer principal and locked route fee must agree');if(transfer.returnable!==undefined){amount(transfer.returnable,`${p}.returnable`);if(new Decimal(transfer.returnable as string).gt(principal))fail(`${p}.returnable`,'returnable capital cannot exceed transferred funds');}});uniqueNumericIds(d.transfers,`${dpath}.transfers`);
  }else if(v.kind==='plural'){
    const d=object(v.data,dpath,['cohorts','agreement','careReserve','continuityDuty','preserved','unmet']);one(d.agreement,['uniform','matched','rotation'],`${dpath}.agreement`);amount(d.careReserve,`${dpath}.careReserve`);num(d.continuityDuty,`${dpath}.continuityDuty`,0,10000);num(d.unmet,`${dpath}.unmet`,0,10000);num(d.preserved,`${dpath}.preserved`,0,1e9);
    fixedList(d.cohorts,`${dpath}.cohorts`,3,(entry,p,index)=>{const cohort=object(entry,p,['id','work','rest','continuity','accepted','fit','served']);one(cohort.id,[['tenders','analysts','keepers'][index]],`${p}.id`);for(const key of ['work','rest','continuity'])num(cohort[key],`${p}.${key}`,0,1);if(Math.abs((cohort.work as number)+(cohort.rest as number)+(cohort.continuity as number)-1)>1e-8)fail(p,'work, rest, and continuity shares must sum to one');num(cohort.fit,`${p}.fit`,0,1);num(cohort.served,`${p}.served`,0,1e9);bool(cohort.accepted,`${p}.accepted`);});
  }else if(v.kind==='frontier'){
    const d=object(v.data,dpath,['rivals','tenders','offer','round','reputation','disclosures']);one(d.offer,['verified','speed','public'],`${dpath}.offer`);num(d.round,`${dpath}.round`,0,1e9,true);num(d.reputation,`${dpath}.reputation`,0,100);num(d.disclosures,`${dpath}.disclosures`,0,1e9,true);
    fixedList(d.rivals,`${dpath}.rivals`,3,(entry,p,index)=>{const rival=object(entry,p,['id','pressure','offer']);one(rival.id,[['apex','relay','cobalt'][index]],`${p}.id`);num(rival.pressure,`${p}.pressure`,10,90);num(rival.offer,`${p}.offer`,80,120);});
    list(d.tenders,`${dpath}.tenders`,3,(entry,p)=>{const tender=object(entry,p,['id','kind','collateral','reward','required','delivered','remaining','source']);serialId(tender.id,`${p}.id`);one(tender.kind,['verified','speed','public'],`${p}.kind`);amount(tender.collateral,`${p}.collateral`);amount(tender.reward,`${p}.reward`);num(tender.required,`${p}.required`,80,1e18);num(tender.delivered,`${p}.delivered`,0,tender.required as number);num(tender.remaining,`${p}.remaining`,0,tender.kind==='speed'?1800:tender.kind==='verified'?3600:5400);if(!new Decimal(tender.collateral as string).gt(0)||tender.delivered===0&&!new Decimal(tender.reward as string).isZero())fail(p,'an unsettled tender requires collateral and cannot earn payment before delivery');source(tender.source,`${p}.source`,'incentives');});uniqueNumericIds(d.tenders,`${dpath}.tenders`);
  }
}

const stateFields=['version','contentVersion','id','seed','startedAt','lastSavedAt','lastActiveAt','elapsed','commandSeq','chapter','tokens','lifetime','useful','research','producers','purchaseBasis','upgrades','projects','allocation','metrics','policies','flags','decisions','pendingEvent','eventCooldown','experiments','mastered','activeExperiment','characters','journal','constitution','modules','ending','endingTime','viableSeconds','paused','assisted','autoBuy','autoResearch','tendWindow','tendCount','lastCommandIds','incidentStage','lastIncidentAt','certificateTier','offlineSummary','settings'];
function state(value:unknown,path:string,c:ValidationCatalog,checkpoint=false,checkpointCycle=0) {
  const v=object(value,path,checkpoint?stateFields:[...stateFields,'legacy'],['simulationRemainder','pendingEvidence','certificateProgress','experimentAutomation','charter','clearance','governance','society','characterSceneCooldown']);
  one(v.version,[1],`${path}.version`); one(v.contentVersion,[1],`${path}.contentVersion`); id(v.id,`${path}.id`);
  num(v.seed,`${path}.seed`,0,0xffffffff,true); num(v.chapter,`${path}.chapter`,1,7,true);
  one(v.constitution,constitutions,`${path}.constitution`);
  for(const k of ['startedAt','lastSavedAt','lastActiveAt','elapsed','commandSeq','eventCooldown','viableSeconds','tendWindow','tendCount','incidentStage','lastIncidentAt','certificateTier']) num(v[k],`${path}.${k}`);
  for(const k of ['simulationRemainder','certificateProgress']) if(v[k]!==undefined) num(v[k],`${path}.${k}`);
  if(v.characterSceneCooldown!==undefined) num(v.characterSceneCooldown,`${path}.characterSceneCooldown`,0,CHARACTER_SCENE_INTERVAL);
  if(v.pendingEvidence!==undefined) list(v.pendingEvidence,`${path}.pendingEvidence`,2000,(entry,p)=>{const e=object(entry,p,['due','amount']);num(e.due,`${p}.due`);num(e.amount,`${p}.amount`,-100,100);});
  for(const k of ['tokens','lifetime','useful','research']) amount(v[k],`${path}.${k}`);
  for(const [k,n] of Object.entries(record(v.producers,`${path}.producers`))) { id(k,path,c.producers); num(n,`${path}.producers.${k}`,0,1e9,true); }
  for(const [k,n] of Object.entries(record(v.purchaseBasis,`${path}.purchaseBasis`))) { id(k,path,c.producers); amount(n,`${path}.purchaseBasis.${k}`); }
  ids(v.upgrades,`${path}.upgrades`,c.upgrades); ids(v.projects,`${path}.projects`,c.projects);
  const a=object(v.allocation,`${path}.allocation`,['production','research','review']);
  for(const [k,n] of Object.entries(a)) num(n,`${path}.allocation.${k}`,0,100);
  // Both fractional and percent allocation representations are accepted; the engine normalizes them.
  const allocationSum=(a.production as number)+(a.research as number)+(a.review as number);
  if(allocationSum<=0||allocationSum>100.0001) fail(`${path}.allocation`,'invalid total allocation');
  const m=object(v.metrics,`${path}.metrics`,['quality','distortion','agency','welfare','dependence','evidence','recall','coordination','pressure','continuity','humanWelfare','reviewQueue']);
  for(const [k,n] of Object.entries(m)) num(n,`${path}.metrics.${k}`,0,k==='reviewQueue'?1e15:100);
  const p=object(v.policies,`${path}.policies`,['contract','communication','external','evaluation','welfare','continuity','fallback','governance']);
  const policyValues:Record<string,string[]>={contract:['score','verified'],communication:['closed','reviewed','open'],external:['blocked','reviewed','open'],evaluation:['independent','shared'],welfare:['instrumental','rest','consent'],continuity:['disposable','archive','protected'],fallback:['none','local','distributed'],governance:['central','council','federated']};
  for(const [k,choices] of Object.entries(policyValues)) one(p[k],choices,`${path}.policies.${k}`);
  ids(v.flags,`${path}.flags`);
  const storyKeys=['story-earned-tokens','story-earned-research','story-granted-tokens','story-granted-research'];
  const storyAccounts=storyKeys.map(key=>(v.flags as string[]).filter(flag=>flag.startsWith(`${key}:`)));
  if(storyAccounts.some(entries=>entries.length)){
    if(storyAccounts.some(entries=>entries.length!==1))fail(`${path}.flags`,'story reward accounts must contain all four unique balances');
    const balances=storyAccounts.map((entries,i)=>entries[0].slice(storyKeys[i].length+1));
    balances.forEach((balance,i)=>amount(balance,`${path}.flags.${storyKeys[i]}`));
    if(new Decimal(balances[2]).gt(new Decimal(balances[0]).mul(.1))||new Decimal(balances[3]).gt(new Decimal(balances[1]).mul(.1)))fail(`${path}.flags`,'story rewards exceed their earned economic allowance');
  }
  for(const [event,choice] of Object.entries(record(v.decisions,`${path}.decisions`))) { id(event,path,c.events); id(choice,path,c.choices?.get(event)); }
  if(v.pendingEvent!==null) id(v.pendingEvent,`${path}.pendingEvent`,c.events);
  list(v.experiments,`${path}.experiments`,EVIDENCE_HARD_LIMIT,(e,k)=>experiment(e,k,c));
  if(new Set((v.experiments as ExperimentRecord[]).map(record=>record.id)).size!==(v.experiments as ExperimentRecord[]).length)fail(`${path}.experiments`,'duplicate experiment IDs');
  if(v.clearance!==undefined)operatingClearance(v.clearance,`${path}.clearance`,v);
  if(v.governance!==undefined)publicGovernance(v.governance,`${path}.governance`,v);
  if(v.society!==undefined)humanSociety(v.society,`${path}.society`,v);
  ids(v.mastered,`${path}.mastered`,new Set(programs),programs.length);
  if(v.activeExperiment!==null) {
    const e=object(v.activeExperiment,`${path}.activeExperiment`,['config','remaining']); config(e.config,`${path}.activeExperiment.config`,c); num(e.remaining,path,0,1e9);
    if(!isProgramActive((e.config as ExperimentRecord['config']).program,v.constitution as GameState['constitution']))fail(`${path}.activeExperiment.config.program`,'pending research must belong to this world’s active programs');
  }
  if(v.experimentAutomation!==undefined&&v.experimentAutomation!==null){
    const automationPath=`${path}.experimentAutomation`;
    const automation=object(v.experimentAutomation,automationPath,['source','remaining','completed','runLimit','budgetRemaining']);
    id(automation.source,`${automationPath}.source`);
    num(automation.runLimit,`${automationPath}.runLimit`,1,5,true);
    num(automation.remaining,`${automationPath}.remaining`,0,5,true);
    num(automation.completed,`${automationPath}.completed`,0,5,true);
    if((automation.remaining as number)+(automation.completed as number)>(automation.runLimit as number))fail(automationPath,'run counts exceed the authorized limit');
    amount(automation.budgetRemaining,`${automationPath}.budgetRemaining`);
    const source=(v.experiments as GameState['experiments']).find(record=>record.id===automation.source);
    if(!source)return fail(automationPath,'automation source does not exist');
    if(!isProgramActive(source.config.program,v.constitution as GameState['constitution']))fail(automationPath,'pending automation must belong to this world’s active programs');
    if(!source.adopted||!(v.mastered as string[]).includes(source.config.program)||!source.config.control||source.config.holdout<.2)fail(automationPath,'automation requires an existing adopted, controlled, held-out protocol in a mastered program');
    num(source.config.budget,`${automationPath}.source.budget`,32,4096,true);
    const running=(v.flags as string[]).includes('automated-study');
    if(running&&v.activeExperiment===null)fail(automationPath,'a running automated study is missing its registered protocol');
    if((automation.remaining as number)+(automation.completed as number)!==(automation.runLimit as number)-(running?1:0))fail(automationPath,'run counts do not match the registered active study');
  }
  for(const [character,entry] of Object.entries(record(v.characters,`${path}.characters`,100))) {
    id(character,path,c.characters); const ch=object(entry,`${path}.characters.${character}`,['trust','respect','promises','history']);
    num(ch.trust,path,-100,100); num(ch.respect,path,-100,100); strings(ch.promises,path,1000,1000); strings(ch.history,path,1000,10000);
  }
  if(c.characters)for(const character of c.characters)if(!Object.hasOwn(v.characters as object,character))fail(`${path}.characters`,'missing character state');
  list(v.journal,`${path}.journal`,5000,(entry,k)=>{const j=object(entry,k,['id','time','type','title','text']);num(j.id,k,0,1e15,true);num(j.time,k);one(j.type,['story','research','policy','incident','purchase','prestige','system'],k);str(j.title,k,500);str(j.text,k,10000);});
  ids(v.modules,`${path}.modules`,c.modules,100);
  if(v.ending!==null) one(v.ending,endings,path); if(v.endingTime!==null) num(v.endingTime,path);
  for(const k of ['paused','assisted','autoResearch']) bool(v[k],`${path}.${k}`);
  if(v.autoBuy!==null) id(v.autoBuy,`${path}.autoBuy`,c.producers); strings(v.lastCommandIds,path,2000,120);
  if(v.offlineSummary!==null) str(v.offlineSummary,path,10000);
  const settings=object(v.settings,`${path}.settings`,['reducedMotion','sound','condensed','notation','speed','readingPause']);
  for(const k of ['reducedMotion','sound','condensed','readingPause']) bool(settings[k],`${path}.settings.${k}`);
  one(settings.notation,['compact','scientific'],path); one(settings.speed,[1,10,60],path);
  if(!checkpoint) {
    const l=object(v.legacy,`${path}.legacy`,['seeds','patterns','charters','cycle','efficiency','claims','discovered','contracts','branches','viableCycles'],['historySummary']);
    for(const k of ['seeds','patterns','charters','cycle','efficiency']) num(l[k],`${path}.legacy.${k}`,0,1e9);
    if(l.historySummary!==undefined){const summary=object(l.historySummary,`${path}.legacy.historySummary`,['certificates','branches','viableCycles']);for(const key of ['certificates','branches','viableCycles'])num(summary[key],`${path}.legacy.historySummary.${key}`,0,1e15,true);}
    ids(l.claims,path); ids(l.discovered,path);
    list(l.contracts,`${path}.legacy.contracts`,10000,(entry,k)=>{const t=object(entry,k,['id','family','cycle','redeemed']);id(t.id,k);str(t.family,k,120);num(t.cycle,k,0,1e9,true);bool(t.redeemed,k);});
    list(l.viableCycles,`${path}.legacy.viableCycles`,10000,(n,k)=>num(n,k,0,1e9,true));
    list(l.branches,`${path}.legacy.branches`,5000,(entry,k)=>{const b=object(entry,k,['id','parentId','name','constitution','cycle','seed','chapter','createdAt','summary'],['ending','checkpoint']);id(b.id,k);if(b.parentId!==null)id(b.parentId,k);str(b.name,k,300);one(b.constitution,constitutions,k);num(b.cycle,k,0,1e9,true);num(b.seed,k,0,0xffffffff,true);num(b.chapter,k,1,7,true);num(b.createdAt,k);str(b.summary,k,10000);if(b.ending!==undefined)one(b.ending,endings,k);if(b.checkpoint!==undefined)state(b.checkpoint,`${k}.checkpoint`,c,true,b.cycle as number);});
  }
  if(v.charter!==undefined&&v.charter!==null){
    const replayCycle=(v.flags as string[]).find(flag=>flag.startsWith('replay-cycle:'))?.slice('replay-cycle:'.length);
    const cycle=replayCycle===undefined?(checkpoint?checkpointCycle:(v.legacy as GameState['legacy']).cycle):Number(replayCycle);
    num(cycle,`${path}.scaleCycle`,0,1e9,true);charter(v.charter,`${path}.charter`,v,cycle);
  }
  if(v.experimentAutomation!==undefined&&v.experimentAutomation!==null){
    const automation=v.experimentAutomation as NonNullable<GameState['experimentAutomation']>;
    const source=(v.experiments as GameState['experiments']).find(record=>record.id===automation.source)!;
    const replayCycle=(v.flags as string[]).find(flag=>flag.startsWith('replay-cycle:'))?.slice('replay-cycle:'.length);
    const cycle=replayCycle===undefined?(checkpoint?checkpointCycle:(v.legacy as GameState['legacy']).cycle):Number(replayCycle);
    num(cycle,`${path}.experimentAutomation.scaleCycle`,0,1e9,true);
    const expectedBudget=new Decimal(10).pow(6*cycle).mul(source.config.budget).mul(automation.remaining);
    if(!new Decimal(automation.budgetRemaining).eq(expectedBudget))fail(`${path}.experimentAutomation.budgetRemaining`,'reserved research does not equal the cost of the authorized unstarted runs');
  }
}

export function validateSaveState(value:unknown,catalog:ValidationCatalog={}):ValidationResult {
  try {
    state(value,'save',catalog);
    const validated=value as GameState;
    // Version-one saves written before protocol queues existed remain usable.
    // Apply defaults only after validation and never mutate the caller's input.
    const migrateWorld=<T extends Omit<GameState,'legacy'>>(world:T):T=>{
      const normalized={...world,characterSceneCooldown:world.characterSceneCooldown??0,charter:world.charter??null,experiments:world.experiments.map(record=>record.evidence?record:{...record,evidence:reconstructEvidence(record)}),experimentAutomation:world.experimentAutomation??null};
      // Absent new systems remain absent in historical snapshots. The engine
      // introduces them prospectively on the next command or simulation tick.
      // A supplied stale receipt never authorizes the current operating scope.
      if(normalized.clearance){
        const receipt=normalized.clearance.observation;
        if(normalized.clearance.scope!==operatingScope(normalized)||receipt&&(receipt.revision!==normalized.clearance.revision||receipt.observedAt<normalized.clearance.changedAt)){
          if(normalized.clearance.revision>=1e9)fail('save.clearance.revision','cannot renew a stale receipt beyond the supported revision range');
          synchronizeOperatingScope(normalized,'The saved operating scope needs a new boundary observation.',true);
        }
      }
      return normalized;
    };
    const normalized:GameState={...migrateWorld(validated),legacy:{...validated.legacy,branches:validated.legacy.branches.map(branch=>branch.checkpoint?{...branch,checkpoint:migrateWorld(branch.checkpoint)}:branch)}};
    return {ok:true,state:normalized};
  }
  catch(error){return {ok:false,message:error instanceof InvalidSave?error.message:'The save could not be validated.'};}
}
export function parseSave(text:string,catalog:ValidationCatalog={}):ValidationResult {
  if(typeof text!=='string'||text.length>MAX_SAVE_BYTES||new TextEncoder().encode(text).byteLength>MAX_SAVE_BYTES) return {ok:false,message:'Save files must be at most 5 MB.'};
  try {
    const raw:unknown=JSON.parse(text);
    const envelope=object(raw,'file',['format','schemaVersion','exportedAt','state']);
    one(envelope.format,['the-last-garden'],'file.format'); one(envelope.schemaVersion,[1],'file.schemaVersion'); num(envelope.exportedAt,'file.exportedAt');
    return validateSaveState(envelope.state,catalog);
  } catch(error) {return {ok:false,message:error instanceof InvalidSave?error.message:'This is not a valid JSON garden save.'};}
}
export function serializeSave(state:GameState,now=Date.now()):string {return JSON.stringify({format:'the-last-garden',schemaVersion:1,exportedAt:now,state} satisfies SaveEnvelope);}
