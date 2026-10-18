/** Public-board doctrines. These return commands; they never mutate the game. */
import type {Command,ConstitutionId,GameState,ProgramId,Rates} from '../../src/contracts';
import type {CharterActionQuote,CharterMode} from '../../src/constitution/types';
import {charterConfigureEligibility,charterEstablishEligibility,getCharterActions} from '../../src/constitution/economics';
import {charterClearance,evidenceProgress} from '../../src/laboratory/evidence';
import {activeExperimentTemplates,activeResearchProjects} from '../../src/laboratory/catalog';
import {activeProgramIds,CHARTER_PROGRAM_BY_CONSTITUTION} from '../../src/laboratory/programs';
import {decimal,scaleFor} from '../../src/engine/amounts';
import {getRates} from '../../src/engine';

export type DoctrineId='baseline'|ConstitutionId;
export interface Doctrine {
 id:DoctrineId;purpose:string;spendFraction:number;charterFirst:boolean;packages:number;maintenance:number;serviceAllocation:'equal'|'needs';districtAllocation:'equal'|'capacity'|'hub';
 modes:Record<ConstitutionId,CharterMode>;
}
const modes=(commons:CharterMode,precaution:CharterMode,service:CharterMode,federation:CharterMode,plural:CharterMode,frontier:CharterMode)=>({commons,precaution,service,federation,plural,frontier});
export const DOCTRINES:Record<DoctrineId,Doctrine>={
 baseline:{id:'baseline',purpose:'Conservative ordinary operation: modest commitments, equal shares, complete every promise, and preserve a treasury buffer.',spendFraction:.2,charterFirst:false,packages:2,maintenance:65,serviceAllocation:'equal',districtAllocation:'equal',modes:modes('focused','staged','buffers','ring','rotation','verified')},
 commons:{id:'commons',purpose:'Broad reusable knowledge and exchange; diversify methods and prioritize the evidence supporting shared infrastructure.',spendFraction:.25,charterFirst:true,packages:6,maintenance:70,serviceAllocation:'equal',districtAllocation:'capacity',modes:modes('open','broad','buffers','redundant','rotation','public')},
 precaution:{id:'precaution',purpose:'Fund explicit reversible expansion, reserve operating resources, and renew permission before throughput reaches its limit.',spendFraction:.4,charterFirst:true,packages:2,maintenance:85,serviceAllocation:'equal',districtAllocation:'equal',modes:modes('maintained','broad','buffers','ring','rotation','verified')},
 service:{id:'service',purpose:'Respond to observed unmet demand and settle one finite obligation before making the next.',spendFraction:.4,charterFirst:true,packages:3,maintenance:65,serviceAllocation:'needs',districtAllocation:'hub',modes:modes('focused','staged','urgent','hub','matched','public')},
 federation:{id:'federation',purpose:'Match work to independent local capacity, develop each district, and preserve redundant routes.',spendFraction:.35,charterFirst:true,packages:4,maintenance:70,serviceAllocation:'equal',districtAllocation:'capacity',modes:modes('open','staged','buffers','redundant','uniform','verified')},
 plural:{id:'plural',purpose:'Fund care before expanded commitments, accommodate distinct cohorts, and fulfill continuity duties.',spendFraction:.3,charterFirst:true,packages:2,maintenance:80,serviceAllocation:'needs',districtAllocation:'equal',modes:modes('maintained','local','balanced','ring','matched','public')},
 frontier:{id:'frontier',purpose:'Price delivery risk, use higher-premium terms after clearance, and recycle collateral only after a completed settlement.',spendFraction:.45,charterFirst:true,packages:2,maintenance:50,serviceAllocation:'equal',districtAllocation:'hub',modes:modes('focused','broad','balanced','hub','uniform','speed')},
};
export function doctrineFor(s:GameState,value:'native'|DoctrineId|undefined):Doctrine{return DOCTRINES[value==='native'||value===undefined?s.constitution:value];}
export const scale=(s:GameState)=>scaleFor(Number(s.flags.find(f=>f.startsWith('replay-cycle:'))?.slice(13)??s.legacy.cycle));
export const effectiveIncome=(rates:Rates)=>Number(rates.tokens)+.85*(Number(rates.charter?.serviceCash??0)+Number(rates.charter?.tenderCash??0));
const fundingReason=(q:CharterActionQuote)=>q.reason==='Not enough spendable tokens for this commitment.'||q.reason==='Keep enough research capacity for this operation; laboratory evidence alone does not pay its operating cost.';
const readyExceptFunding=(q:CharterActionQuote)=>q.allowed||fundingReason(q);
const commandFor=(q:CharterActionQuote):Command=>({type:'charterAction',action:q.action,target:q.target,secondary:q.secondary});
function currentMode(s:GameState):CharterMode|undefined{const c=s.charter;if(!c)return;switch(c.kind){case'commons':case'service':return c.data.mode;case'precaution':return c.data.scope;case'federation':return c.data.route;case'plural':return c.data.agreement;case'frontier':return c.data.offer;}}
function normalize(values:number[]):number[]{const total=values.reduce((sum,n)=>sum+n,0);return total>0?values.map(n=>n/total):values.map(()=>1/values.length);}
function differs(a:number[],b:number[]){return a.some((value,index)=>Math.abs(value-b[index])>.015);}
const reserveCache=new WeakMap<NonNullable<GameState['charter']>,number>();
export function charterResearchReserve(s:GameState):number{
 if(!s.charter?.established)return 0;
 const cached=reserveCache.get(s.charter);if(cached!==undefined)return cached;
 const eligible=getCharterActions(s).filter(q=>readyExceptFunding(q));
 const reserve=eligible.reduce((value,q)=>Math.max(value,Number(q.researchCost)),0);
 const value=Math.min(256*scale(s).toNumber(),Math.max(16*scale(s).toNumber(),reserve*1.2));reserveCache.set(s.charter,value);return value;
}
export function orderedTemplates(s:GameState,doctrine:Doctrine){
 const templates=activeExperimentTemplates(s.constitution);
 if(!doctrine.charterFirst)return templates;
 const own=CHARTER_PROGRAM_BY_CONSTITUTION[s.constitution];
 return [...templates].sort((a,b)=>a.chapter-b.chapter||Number(b.program===own)-Number(a.program===own));
}
export interface CharterPlan {command?:Command;reserveTokens:string;reserveResearch:number;reason:string;doctrine:DoctrineId}
/** Same legal completion/recovery adapter for native, baseline and transferred doctrines. */
export function planCharter(s:GameState,doctrine:Doctrine):CharterPlan{
 const result=(command:Command|undefined,reserveTokens='0',reason='No quoted operation is currently needed.'):CharterPlan=>({command,reserveTokens,reserveResearch:charterResearchReserve(s),reason,doctrine:doctrine.id});
 if(s.pendingEvent||s.ending)return result(undefined);
 if(!s.charter?.established)return result(charterEstablishEligibility(s).allowed?{type:'charterEstablish'}:undefined,'0','Open the legal empty strategy board.');
 const c=s.charter,all=getCharterActions(s),possible=all.filter(readyExceptFunding),allowed=all.filter(q=>q.allowed);
 const settlement=allowed.find(q=>q.action==='settleService'||q.action==='settleTender');
 if(settlement)return result(commandFor(settlement),'0','Complete and settle already delivered work before taking another commitment.');
 const closing=s.chapter===7&&Number(s.lifetime)/scale(s).toNumber()>=160000000&&activeResearchProjects(s.constitution).every(p=>s.projects.includes(p.id));
 const desiredMode=doctrine.modes[s.constitution];
 if(currentMode(s)!==desiredMode){const command:Extract<Command,{type:'charterConfigure'}>={type:'charterConfigure',mode:desiredMode};if(charterConfigureEligibility(s,command).allowed)return result(command,'0','Apply this doctrine’s publicly offered operating rule.');}
 if(c.kind==='service'&&c.data.active){
  const desired=doctrine.serviceAllocation==='needs'?normalize(c.data.lanes.map(l=>l.backlog)):[.25,.25,.25,.25];
  if(differs(desired,c.data.allocation)){const command:Extract<Command,{type:'charterConfigure'}>={type:'charterConfigure',allocation:desired};if(charterConfigureEligibility(s,command).allowed)return result(command,'0','Assign finite capacity using the doctrine’s demand rule.');}
 }
 if(c.kind==='federation'){
  const desired=doctrine.districtAllocation==='capacity'?normalize(c.data.districts.map(d=>1+.08*d.level)):doctrine.districtAllocation==='hub'?[.25,.5,.25]:[1/3,1/3,1/3];
  if(differs(desired,c.data.allocation)){const command:Extract<Command,{type:'charterConfigure'}>={type:'charterConfigure',allocation:desired};if(charterConfigureEligibility(s,command).allowed)return result(command,'0','Allocate work once across distinct district capacities.');}
 }
 let selected:CharterActionQuote|undefined,critical=false;
 if(c.kind==='commons'){
  const live=c.data.methods.filter(m=>!m.retired),worn=live.filter(m=>m.maintenance<doctrine.maintenance).sort((a,b)=>a.maintenance-b.maintenance)[0];
  selected=worn?possible.find(q=>q.action==='maintain'&&q.target===worn.id):undefined;
  if(!selected&&c.appliedTier<6&&charterClearance(s,6).allowed){selected=possible.find(q=>q.action==='publish'&&q.target===6);critical=true;}
  if(!selected&&live.length<doctrine.packages){
   const focus=activeProgramIds(s.constitution).find(program=>!live.some(m=>m.program===program));
   if(focus&&c.data.focus!==focus){const command:Extract<Command,{type:'charterConfigure'}>={type:'charterConfigure',focus};if(charterConfigureEligibility(s,command).allowed)return result(command,'0','Diversify the library within this doctrine’s finite package budget.');}
   selected=possible.find(q=>q.action==='publish'&&q.target===1);
  }
 }
 if(c.kind==='precaution'){
  const capstone=charterClearance(s,6).allowed&&c.appliedTier<6;
  if(capstone&&c.data.tranches.length>=3){const oldest=[...c.data.tranches].sort((a,b)=>a.capacity-b.capacity)[0];selected=allowed.find(q=>q.action==='retireTranche'&&q.target===oldest.id);critical=true;}
  else if(capstone){selected=possible.find(q=>q.action==='openTranche'&&q.target===3);critical=true;}
  if(!selected&&getRates(s).bottleneck.includes('Bonded deployment')){
   const expanding=possible.filter(q=>q.action==='renewTranche'&&q.secondary===1).sort((a,b)=>Number(a.cost)-Number(b.cost));
   selected=expanding[0];critical=!!selected;
  }
  if(!selected){const worn=[...c.data.tranches].filter(t=>t.coverage<.98).sort((a,b)=>a.coverage-b.coverage)[0];if(worn)selected=possible.find(q=>q.action==='renewTranche'&&q.target===worn.id&&q.secondary!==1);}
  if(!selected&&!c.data.tranches.length){selected=possible.find(q=>q.action==='openTranche'&&q.target===1);critical=true;}
  if(!selected&&doctrine.id==='baseline'&&c.data.tranches.length<2)selected=possible.find(q=>q.action==='openTranche'&&q.target===2);
 }
 if(c.kind==='service'&&!c.data.active&&(!closing||c.appliedTier<6)){selected=possible.find(q=>q.action==='acceptService');critical=c.appliedTier<6&&charterClearance(s,6).allowed;}
 if(c.kind==='federation'){
  const order=[0,1,2].sort((a,b)=>c.data.districts[a].level-c.data.districts[b].level);
  selected=order.map(target=>possible.find(q=>q.action==='investDistrict'&&q.target===target)).find(Boolean);
  if(!selected){const target=order.find(i=>c.data.districts[i].level<6);if(target!==undefined)selected=possible.find(q=>q.action==='fundDistrict'&&q.target===target);}
  // A funded but evidence-blocked investment remains a commitment. Return only
  // mature districts' surplus; withdrawing earlier causes a fund/withdraw loop.
  if(!selected){const surplus=[...allowed].filter(q=>q.action==='withdraw'&&typeof q.target==='number'&&c.data.districts[q.target]?.level===6&&Number(q.refund)>1000*scale(s).toNumber()).sort((a,b)=>Number(b.refund)-Number(a.refund));selected=surplus[0];}
 }
 if(c.kind==='plural'){
  if(Number(c.data.careReserve)/scale(s).toNumber()<40)selected=possible.find(q=>q.action==='fundCare');
  if(!selected)selected=possible.find(q=>q.action==='negotiate');
  if(!selected&&(c.appliedTier<6||c.data.unmet>.5||c.data.continuityDuty>4)){selected=possible.find(q=>q.action==='preserve');critical=!!selected;}
 }
 if(c.kind==='frontier'&&!c.data.tenders.length&&(!closing||c.appliedTier<6)){selected=possible.find(q=>q.action==='bid');critical=c.appliedTier<6&&charterClearance(s,6).allowed;}
 if(!selected)return result(undefined);
 // Reserve a complete quoted operating budget before further production purchases.
 // Critical recovery and the final application may use available funds directly.
 const reserve=decimal(selected.cost).div(critical?1:doctrine.spendFraction);
 const canSpend=selected.allowed&&decimal(s.tokens).gte(reserve);
 return result(canSpend?commandFor(selected):undefined,reserve.toString(),`${canSpend?'Execute':'Reserve for'} ${selected.title}. ${selected.effect}`);
}
