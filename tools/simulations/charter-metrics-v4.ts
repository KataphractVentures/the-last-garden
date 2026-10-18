/** Read-only observations of public engine steps; no state mutations or synthetic income. */
import Decimal from 'decimal.js';
import type { Allocation, GameState, ProgramId } from '../../src/contracts';
import type { CharterEconomy } from '../../src/constitution/types';
import { getCharterActions } from '../../src/constitution/economics';
import { getRates } from '../../src/engine';
import { activeResearchProjects } from '../../src/laboratory/catalog';
import { CHARTER_PROGRAM_BY_CONSTITUTION } from '../../src/laboratory/programs';
import type { SimulationStep } from './optimized-v4';

const sum=(values:number[])=>values.reduce((a,b)=>a+b,0);
const total=(values:string[])=>values.reduce((a,b)=>a.add(b),new Decimal(0)).toString();
export function charterMode(charter:CharterEconomy|null|undefined):string {
 if(!charter)return 'unestablished';
 switch(charter.kind){case 'commons':return charter.data.mode;case 'precaution':return charter.data.scope;case 'service':return charter.data.mode;case 'federation':return charter.data.route;case 'plural':return charter.data.agreement;case 'frontier':return charter.data.offer;}
}
/** These are displayed stocks, not interchangeable currencies or newly earned income. */
export function charterStocks(charter:CharterEconomy|null|undefined):Record<string,number|string>{
 if(!charter)return {};
 const common={established:Number(charter.established),completed:charter.completed,appliedTier:charter.appliedTier,automationRuns:charter.automation?.remaining??0,automationBudget:charter.automation?.budgetRemaining??'0'};
 switch(charter.kind){
  case 'commons':return {...common,packages:charter.data.methods.length,activePackages:charter.data.methods.filter(m=>!m.retired).length,credits:charter.data.credits,reuse:charter.data.reuse,maintenance:sum(charter.data.methods.map(m=>m.maintenance)),uses:sum(charter.data.methods.map(m=>m.uses))};
  case 'precaution':return {...common,tranches:charter.data.tranches.length,activeTranches:charter.data.tranches.filter(t=>t.active).length,bonds:total(charter.data.tranches.map(t=>t.bond)),bondedCapacity:sum(charter.data.tranches.map(t=>t.active?t.capacity:0)),effectiveBondedCapacity:sum(charter.data.tranches.map(t=>t.active?t.capacity*t.coverage*(charter.data.scope==='broad'?1.25:charter.data.scope==='staged'?1:.75):0)),coverage:sum(charter.data.tranches.map(t=>t.active?t.coverage:0)),wear:sum(charter.data.tranches.map(t=>t.wear)),operated:charter.data.operated,reserveTarget:charter.data.reserveTarget};
  case 'service':return {...common,backlog:sum(charter.data.lanes.map(l=>l.backlog)),buffers:sum(charter.data.lanes.map(l=>l.buffer)),delivered:sum(charter.data.lanes.map(l=>l.delivered)),required:sum(charter.data.lanes.map(l=>l.required)),funding:charter.data.funding,earned:charter.data.earned,progress:charter.data.progress,activeContract:Number(charter.data.active)};
  case 'federation':return {...common,districtTreasuries:total(charter.data.districts.map(d=>d.treasury)),districtLevels:sum(charter.data.districts.map(d=>d.level)),districtEvidence:sum(charter.data.districts.map(d=>d.evidence)),districtDelivered:total(charter.data.districts.map(d=>d.delivered)),inTransit:total(charter.data.transfers.map(t=>t.amount)),transfers:charter.data.transfers.length,agreements:charter.data.agreements,...Object.fromEntries(charter.data.districts.flatMap((d,i)=>[[`treasury${i}`,d.treasury],[`level${i}`,d.level],[`delivered${i}`,d.delivered]]))};
  case 'plural':return {...common,careReserve:charter.data.careReserve,continuityDuty:charter.data.continuityDuty,preserved:charter.data.preserved,unmet:charter.data.unmet,accepted:charter.data.cohorts.filter(c=>c.accepted).length,work:sum(charter.data.cohorts.map(c=>c.work)),rest:sum(charter.data.cohorts.map(c=>c.rest)),fit:sum(charter.data.cohorts.map(c=>c.fit))/3,served:sum(charter.data.cohorts.map(c=>c.served))};
  case 'frontier':return {...common,tenders:charter.data.tenders.length,collateral:total(charter.data.tenders.map(t=>t.collateral)),potentialReward:total(charter.data.tenders.map(t=>t.reward)),delivered:sum(charter.data.tenders.map(t=>t.delivered)),required:sum(charter.data.tenders.map(t=>t.required)),round:charter.data.round,reputation:charter.data.reputation,disclosures:charter.data.disclosures,rivalPressure:sum(charter.data.rivals.map(r=>r.pressure))/3};
 }
}
function charterAllocation(charter:CharterEconomy|null|undefined):number[]{
 if(!charter)return [];
 if(charter.kind==='service'||charter.kind==='federation')return [...charter.data.allocation];
 if(charter.kind==='plural')return charter.data.cohorts.map(c=>c.work);
 return [];
}
function checkpoint(state:GameState){return {at:state.elapsed,chapter:state.chapter,tokens:state.tokens,research:state.research,lifetime:state.lifetime,useful:state.useful,metrics:{...state.metrics},allocation:{...state.allocation},projects:state.projects.length,charter:structuredClone(state.charter??null)};}
function increment(record:Record<string,number>,key:string,delta=1){record[key]=(record[key]??0)+delta;}
function money(record:Record<string,string>,key:string,delta:Decimal.Value){record[key]=new Decimal(record[key]??0).add(delta).toString();}

export function createCharterObserver(initial:GameState,retainCheckpoints=false){
 let elapsed=0,observedSteps=0,weightedAllocation:Allocation={production:0,research:0,review:0};
 const modeSeconds:Record<string,number>={},charterAllocationIntegral:number[]=[],stockIntegral:Record<string,string>={},stockMin:Record<string,string>={},stockMax:Record<string,string>={};
 const flowIntegral:Record<string,string>={},moneyMovements:Record<string,string>={},commandCounts:Record<string,number>={},charterActionCounts:Record<string,number>={};
 const actionMoney:Record<string,Record<string,string>>={},bottleneckSeconds:Record<string,number>={};
 const studyStarts:unknown[]=[],studyCompletions:unknown[]=[],projectOrder:{at:number;id:string;program:ProgramId|'foundation';researchSpent:string}[]=[],charterDecisions:unknown[]=[],chapterSnapshots:unknown[]=[checkpoint(initial)],automatedOperations:unknown[]=[];
 const earnedCheckpoints:Record<string,GameState>={},seenStudies=new Set(initial.experiments.map(record=>record.id));
 const programSpend:Record<string,string>={},firstStudy:Record<string,number>={},lastStudy:Record<string,number>={};
 let charterDecisionCount=0,automatedOperationSnapshots=0;
 const retainDetail=(items:unknown[],value:unknown)=>{if(items.length>=256)items.splice(128,1);items.push(value);};
 const activeProjects=new Map(activeResearchProjects(initial.constitution).map(project=>[project.id,project]));
 function observe(step:SimulationStep){
  observedSteps++;
  const before=step.before,after=step.after;
  if(before.constitution!==initial.constitution||after.constitution!==initial.constitution)throw new Error('Matrix observer cannot cross a constitution transition. Use stopAtEnding.');
  if(step.kind==='tick'){
   const actual=after.elapsed-before.elapsed;if(actual!==step.actual)throw new Error('Observer tick duration differs from driver trace.');
   elapsed+=actual;
   for(const key of Object.keys(weightedAllocation) as (keyof Allocation)[])weightedAllocation[key]+=before.allocation[key]*actual;
   increment(modeSeconds,charterMode(before.charter),actual);
   for(const [index,value]of charterAllocation(before.charter).entries())charterAllocationIntegral[index]=(charterAllocationIntegral[index]??0)+value*actual;
   for(const [key,value]of Object.entries(charterStocks(before.charter))){
    const decimal=new Decimal(value);money(stockIntegral,key,decimal.mul(actual));
    stockMin[key]=Decimal.min(stockMin[key]??decimal,decimal).toString();stockMax[key]=Decimal.max(stockMax[key]??decimal,decimal).toString();
   }
   const rates=getRates(before),flow=rates.charter;increment(bottleneckSeconds,rates.bottleneck,actual);
   if(flow){
    money(flowIntegral,'dedicatedUseful',new Decimal(flow.dedicatedUseful).mul(actual));
    money(flowIntegral,'researchReserved',flow.researchReserved*actual);money(flowIntegral,'reviewReserved',flow.reviewReserved*actual);
    flow.districtIncome?.forEach((value,index)=>money(flowIntegral,`districtIncome${index}`,new Decimal(value).mul(actual)));
    flow.laneWork?.forEach((value,index)=>money(flowIntegral,`laneWork${index}`,value*actual));
    if(flow.tenderWork!==undefined)money(flowIntegral,'tenderWork',flow.tenderWork*actual);
    if(flow.serviceCash!==undefined)money(flowIntegral,'serviceCashWithheld',new Decimal(flow.serviceCash).mul(actual));
    if(flow.tenderCash!==undefined)money(flowIntegral,'tenderCashWithheld',new Decimal(flow.tenderCash).mul(actual));
   }
   money(moneyMovements,'tickWalletDelta',new Decimal(after.tokens).sub(before.tokens));
   money(moneyMovements,'tickResearchDelta',new Decimal(after.research).sub(before.research));
   money(moneyMovements,'tickLifetimeDelta',new Decimal(after.lifetime).sub(before.lifetime));
   money(moneyMovements,'tickUsefulDelta',new Decimal(after.useful).sub(before.useful));
   if((after.charter?.completed??0)>(before.charter?.completed??0)){automatedOperationSnapshots++;retainDetail(automatedOperations,{at:after.elapsed,operations:(after.charter?.completed??0)-(before.charter?.completed??0),walletDelta:new Decimal(after.tokens).sub(before.tokens).toString(),before:structuredClone(before.charter??null),after:structuredClone(after.charter??null)});}
  }else if(step.command){
   const command=step.command;increment(commandCounts,`${step.ok?'accepted':'rejected'}:${command.type}`);
   if(step.ok){
    if(command.type.startsWith('charter')){
     if(command.type==='charterAction')increment(charterActionCounts,command.action);
     money(moneyMovements,'charterWalletDelta',new Decimal(after.tokens).sub(before.tokens));
     money(moneyMovements,'charterResearchDelta',new Decimal(after.research).sub(before.research));
     money(moneyMovements,'charterLifetimeDelta',new Decimal(after.lifetime).sub(before.lifetime));
     money(moneyMovements,'charterUsefulDelta',new Decimal(after.useful).sub(before.useful));
     const quote=command.type==='charterAction'?getCharterActions(before).find(q=>q.action===command.action&&q.target===command.target&&q.secondary===command.secondary):undefined;
     if(quote){money(moneyMovements,'quotedManualCommitmentCost',quote.cost);money(moneyMovements,'quotedManualResearchCost',quote.researchCost);money(moneyMovements,'quotedManualRefund',quote.refund);}
     const action=command.type==='charterAction'?command.action:command.type,ledger=actionMoney[action]??={};
     money(ledger,'walletDelta',new Decimal(after.tokens).sub(before.tokens));money(ledger,'researchDelta',new Decimal(after.research).sub(before.research));money(ledger,'earnedLifetimeDelta',new Decimal(after.lifetime).sub(before.lifetime));
     if(quote){money(ledger,'quotedCost',quote.cost);money(ledger,'quotedRefund',quote.refund);money(ledger,'quotedResearchCost',quote.researchCost);}
     charterDecisionCount++;retainDetail(charterDecisions,{at:before.elapsed,command:structuredClone(command),quote,message:step.message,tokensBefore:before.tokens,tokensAfter:after.tokens,researchBefore:before.research,researchAfter:after.research,lifetimeBefore:before.lifetime,lifetimeAfter:after.lifetime,before:structuredClone(before.charter??null),after:structuredClone(after.charter??null)});
    }
    if(command.type==='experiment'||command.type==='replicate'){
     const config=after.activeExperiment?.config;
     if(config){const spent=new Decimal(before.research).sub(after.research).toString();studyStarts.push({at:before.elapsed,command:command.type,config:structuredClone(config),researchSpent:spent,charterMode:charterMode(before.charter),charterStocks:charterStocks(before.charter)});money(programSpend,config.program,spent);firstStudy[config.program]??=before.elapsed;lastStudy[config.program]=before.elapsed;}
    }
    if(command.type==='research'){
     const project=activeProjects.get(command.id);if(!project)throw new Error(`An inactive project was purchased: ${command.id}`);
     const spent=new Decimal(before.research).sub(after.research).toString();projectOrder.push({at:before.elapsed,id:command.id,program:project.program,researchSpent:spent});money(programSpend,project.program,spent);
    }
   }
  }
  if(after.chapter!==before.chapter)chapterSnapshots.push(checkpoint(after));
  for(const record of after.experiments)if(!seenStudies.has(record.id)){
   seenStudies.add(record.id);studyCompletions.push({id:record.id,at:after.elapsed,config:structuredClone(record.config),evidence:record.evidence,summary:record.summary,conclusion:record.conclusion,detailSamples:record.observations.filter(o=>o.detail).slice(0,3).map(o=>({trial:o.trial,...o.detail}))});
  }
  if(retainCheckpoints&&[3,5,7].includes(after.chapter)&&!earnedCheckpoints[`chapter-${after.chapter}`]&&!after.pendingEvent&&!after.activeExperiment&&!after.ending&&after.charter?.established){earnedCheckpoints[`chapter-${after.chapter}`]=structuredClone(after);}
  if(retainCheckpoints&&after.chapter===7&&!after.pendingEvent&&!after.activeExperiment&&!after.ending&&after.charter?.appliedTier===6)earnedCheckpoints['operating-ready']=structuredClone(after);
 }
 function finish(final:GameState){
  return {observedSteps,elapsed,allocationMean:Object.fromEntries(Object.entries(weightedAllocation).map(([key,value])=>[key,value/Math.max(1,elapsed)])),modeSeconds,
   charterAllocationMean:charterAllocationIntegral.map(value=>value/Math.max(1,elapsed)),
   stockMean:Object.fromEntries(Object.entries(stockIntegral).map(([key,value])=>[key,new Decimal(value).div(Math.max(1,elapsed)).toString()])),stockMin,stockMax,endingStocks:charterStocks(final.charter),
   rateBudgetIntegrals:flowIntegral,rateBudgetCaveat:'These integrate declared rates at the beginning of each driver tick over actual elapsed time. A commitment can settle within a tick, so they are allocation/throughput estimates, not independently accounted cash income. Exact monetary balances and command deltas are reported separately.',
   moneyMovements,actionMoney,bottleneckSeconds,moneyMovementCaveat:'Wallet deltas include transfers and refunds. Positive deltas are not automatically income. Consult the actual before/after charter ledger and action receipts; never count principal release as produced work.',
   commandCounts,charterActionCounts,charterDecisions,charterDecisionCount,automatedOperations,automatedOperationSnapshots,detailRetention:'Resource aggregates and command counts include every step. Detailed charter command and automation snapshots retain the first128 and last128 observations. The unabridged public-command/tick trace can reconstruct all intervening states.',projectOrder,programResearchSpend:programSpend,firstStudy,lastStudy,studyStarts,studyCompletions,chapterSnapshots,ending:checkpoint(final),activeCharterProgram:CHARTER_PROGRAM_BY_CONSTITUTION[initial.constitution]};
 }
 return {observe,finish,earnedCheckpoints};
}

/** Pairwise precedence differences among shared project IDs; no claim that every inversion is meaningful. */
export function researchOrderDistance(left:{id:string}[],right:{id:string}[]){
 const rightPositions=new Map(right.map((project,index)=>[project.id,index]));const common=left.filter(project=>rightPositions.has(project.id));
 let inversions=0,pairs=0;for(let i=0;i<common.length;i++)for(let j=i+1;j<common.length;j++){pairs++;if(rightPositions.get(common[i].id)!>rightPositions.get(common[j].id)!)inversions++;}
 return {sharedProjects:common.length,inversions,pairs,fraction:pairs?inversions/pairs:0};
}
