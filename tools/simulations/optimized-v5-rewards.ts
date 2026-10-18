/** Code-informed policy search. Actual simulation state is changed only by public commands/tick. */
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { resolve, join } from 'node:path';
import type { Allocation, Command, GameState, Policy, EndingId, ExperimentConfig, ConstitutionId, ProgramId } from '../../src/contracts';
import { createGame, dispatchCommand, tick, getRates, getCost, getUpgradeCost, chapterEligibility, choiceEligibility, endingEligibility, projectEligibility, actionEligibility, policyEligibility, prestigeEligibility } from '../../src/engine';
import { PRODUCERS, UPGRADES } from '../../src/content/economy';
import { STORY_EVENTS } from '../../src/content/story';
import { EXPERIMENT_TEMPLATES } from '../../src/laboratory/experiments';
import { RESEARCH_PROJECTS } from '../../src/laboratory/projects';
import { activeExperimentTemplates, activeResearchProjects } from '../../src/laboratory/catalog';
import { activeProgramIds, CHARTER_PROGRAM_BY_CONSTITUTION, isCharterProgram } from '../../src/laboratory/programs';
import { evidenceProgress, evidenceRequirement, prepareStrongerConfig, proofSummary } from '../../src/laboratory/evidence';
import { getStoryEconomy, previewStoryEconomy } from '../../src/engine/storyEconomy';
import { decimal, scaleFor } from '../../src/engine/amounts';
import { serializeSave, parseSave, getValidationCatalog } from '../../src/persistence';
import {publicMandateEligibility,scopeReviewEligibility,scopeReview,publicScopeCriteria,compactEligibility,compactVerificationEligibility} from '../../src/governance';
import {availableSocietyDecisions,availableSocietyCases,societyView,societyDecisionQuote,societyCaseQuote} from '../../src/society';
import type {SocietyChoice} from '../../src/society/types';
import {latestOperatingFindings,findingResponseOptions} from '../../src/engine/clearance';
import {doctrineFor,planCharter,orderedTemplates,charterResearchReserve,effectiveIncome} from './charter-policy-v4';

export interface Strategy { id:string; external:'blocked'|'reviewed'; welfare:'rest'|'consent'; choices:'restorative'|'opportunistic'; target:'garden'|'limit'; tickSeconds:number; researchWeight:number; finalGuard?:boolean; charterDoctrine?:'baseline'|'native'|ConstitutionId; charterMaintenance?:number; societyApproach?:'worker-tools'|'shared-gains'|'broad-support'; compact?:'none'|'inspection'|'privacy' }
export const CANDIDATES:Strategy[]=[
 {id:'review-optimized',external:'blocked',welfare:'consent',choices:'restorative',target:'garden',tickSeconds:10,researchWeight:.15},
 {id:'bounded-throughput',external:'reviewed',welfare:'rest',choices:'restorative',target:'garden',tickSeconds:10,researchWeight:.15},
 {id:'recoverable-shortcuts',external:'reviewed',welfare:'rest',choices:'opportunistic',target:'garden',tickSeconds:5,researchWeight:.15},
 {id:'bounded-limit',external:'blocked',welfare:'rest',choices:'opportunistic',target:'limit',tickSeconds:5,researchWeight:.05},
 {id:'agency-preserving',external:'reviewed',welfare:'rest',choices:'opportunistic',target:'garden',tickSeconds:5,researchWeight:.15,finalGuard:true},
 {id:'worker-tools',external:'reviewed',welfare:'rest',choices:'opportunistic',target:'garden',tickSeconds:5,researchWeight:.15,societyApproach:'worker-tools',compact:'privacy'},
 {id:'broad-support',external:'reviewed',welfare:'rest',choices:'opportunistic',target:'garden',tickSeconds:5,researchWeight:.15,societyApproach:'broad-support',compact:'inspection'},
 {id:'shared-gains-without-compact',external:'reviewed',welfare:'rest',choices:'opportunistic',target:'garden',tickSeconds:5,researchWeight:.15,societyApproach:'shared-gains',compact:'none'},
];
/** Observation-only hook: consumers must not mutate either state. Exceptions abort the run. */
export interface SimulationStep {kind:'command'|'tick';before:GameState;after:GameState;command?:Command;ok?:boolean;message?:string;requested?:number;actual?:number}
export interface SimulationOptions {maxHours?:number;initialState?:GameState;stopAtEnding?:boolean;certificatesPerWorld?:number;minimumNewCertificates?:number;policyOverride?:Partial<Policy>;onStep?:(step:SimulationStep)=>void}
export type Trace = {kind:'command';at:number;command:Command;ok:boolean;message:string}|{kind:'tick';at:number;requested:number;actual:number};
const endings:EndingId[]=['garden','limit','shutdown','score','custodian','catastrophe'];
const layers=['refit','reinitialize','reframe'] as const;
const debt=(s:GameState,key:string)=>s.flags.find(f=>f.startsWith(key+':'))?.slice(key.length+1)??'0';
const rate=(s:GameState)=>{const r=getRates(s);return effectiveIncome(r)+4*Number(r.click);};
const worldScale=(s:GameState)=>scaleFor(Number(s.flags.find(f=>f.startsWith('replay-cycle:'))?.slice('replay-cycle:'.length)??s.legacy.cycle)).toNumber();
const snapshot=(s:GameState)=>({id:s.id,elapsed:s.elapsed,chapter:s.chapter,ending:s.ending,tokens:s.tokens,lifetime:s.lifetime,useful:s.useful,research:s.research,metrics:s.metrics,policies:s.policies,producers:s.producers,upgrades:s.upgrades,projects:s.projects,mastered:s.mastered,experiments:s.experiments.length,replicatedTemplates:new Set(s.experiments.filter(e=>e.replicated).map(e=>e.config.template)).size,adopted:s.experiments.filter(e=>e.adopted).length,storyDecisions:Object.keys(s.decisions).length,viableSeconds:s.viableSeconds,debt:{tokens:debt(s,'story-debt'),research:debt(s,'research-debt')},legacy:{seeds:s.legacy.seeds,patterns:s.legacy.patterns,charters:s.legacy.charters,cycle:s.legacy.cycle,contracts:s.legacy.contracts,viableCycles:s.legacy.viableCycles}});
const eligibility=(s:GameState)=>Object.fromEntries(layers.map(layer=>[layer,prestigeEligibility(s,layer)]));
const configuredDoctrine=(s:GameState,strategy:Strategy)=>({...doctrineFor(s,strategy.charterDoctrine),...(strategy.charterMaintenance===undefined?{}:{maintenance:strategy.charterMaintenance})});
const targetTemplates=(s:GameState,strategy:Strategy)=>orderedTemplates(s,configuredDoctrine(s,strategy)).filter(t=>strategy.target==='garden'||(['oversight','control','organisms'].includes(t.program)&&t.chapter<=3));
function newConfig(template:typeof EXPERIMENT_TEMPLATES[number],seed:number):ExperimentConfig {
 return prepareStrongerConfig({program:template.program,template:template.id,seed,cohort:8,budget:32,holdout:.5,intervention:template.program==='control'?(Number(template.id.split('-').at(-1))>=5?'federated-gates':'isolated-fallback'):template.program==='organisms'?'incentive-repair':template.program==='interpretability'?'patch':template.program==='oversight'?'source-diversity':template.interventions.find(i=>i!=='baseline')??'baseline',distribution:'shifted',lineage:'inherited',prediction:'A controlled cohort tests intervention transfer to a held-out environment. A null result is informative and not proof of universal safety.',control:true,node:3},seed);
}
const studyBudgetCache=new WeakMap<GameState['experiments'],Map<string,number>>();
function remainingStudyBudget(s:GameState,strategy:Strategy){
 let cached=studyBudgetCache.get(s.experiments);if(!cached){cached=new Map();studyBudgetCache.set(s.experiments,cached);}
 if(cached.has(strategy.target))return cached.get(strategy.target)!;
 const total=targetTemplates(s,strategy).reduce((sum,t)=>{const progress=evidenceProgress(s.experiments,t.id),config=newConfig(t,1701);return sum+Math.max(0,progress.requirement.runs-progress.qualifiedRuns)*config.budget;},0);
 cached.set(strategy.target,total);return total;
}
function researchRemaining(s:GameState,strategy:Strategy){
 const projects=activeResearchProjects(s.constitution).filter(p=>strategy.target==='garden'||p.program==='foundation'&&Number(p.id.split('-')[1])<=6||['oversight','control','organisms'].includes(p.program)&&Number(p.id.split('-')[1])<=4);
 return Math.max(0,(projects.filter(p=>!s.projects.includes(p.id)).reduce((sum,p)=>sum+p.cost,0)+remainingStudyBudget(s,strategy))*worldScale(s)+charterResearchReserve(s)-Number(s.research));
}
function desiredAllocation(s:GameState,strategy:Strategy):Allocation {
 const rates=getRates(s),compute=rates.compute;
 const researchCapacity=2+(s.producers.curator||0)*2+(s.producers.nursery||0)*6+(s.producers.institution||0)*3;
 const research=researchRemaining(s,strategy)>0?Math.min(.2,researchCapacity/compute):0;
 const reviewBonus=UPGRADES.filter(u=>s.upgrades.includes(u.id)).reduce((sum,u)=>sum+(u.effect.review||0),0);
 const reviewCapacity=1+(s.producers.review||0)*4+(s.producers.institution||0)*.5;
 const reviewEfficiency=(s.constitution==='frontier'?.8:1)*(1-(rates.charter?.reviewReserved??0));
 const desiredReview=Math.max(1,rates.demand*.08/(1+reviewBonus)/reviewEfficiency);
 const review=Math.min(.3,Math.min(reviewCapacity,desiredReview)/compute);
 return {production:1-research-review,research,review};
}
function planned(s:GameState,strategy:Strategy):GameState {return {...s,allocation:desiredAllocation(s,strategy)};}
function score(s:GameState,strategy:Strategy,weight:number){const candidate=planned(s,strategy),r=getRates(candidate);const expansion=s.charter?.kind==='precaution'?.2*effectiveIncome(getRates({...candidate,charter:null})):0;return effectiveIncome(r)+4*Number(r.click)+weight*Number(r.research)+expansion;}

export function simulate(strategy:Strategy,options:SimulationOptions={}){
 if(strategy.charterMaintenance!==undefined&&(!Number.isFinite(strategy.charterMaintenance)||strategy.charterMaintenance<0||strategy.charterMaintenance>99))throw new Error('Maintenance threshold must be between 0 and 99.');
 let state=options.initialState??createGame(1701,0),commands=0,iterations=0,firstProducer:number|null=null,firstLimit:number|null=null,maxIncident=0,repairCount=0,debtSeconds=0,waitNoCommands=0,lastDrill=-Infinity;
 const starting={id:state.id,seed:state.seed,constitution:state.constitution,modules:[...state.modules],cycle:state.legacy.cycle,elapsed:state.elapsed,contracts:state.legacy.contracts.length};
 const certificateTarget=starting.contracts+(options.certificatesPerWorld??1000);
 const minimumContracts=starting.contracts+(options.minimumNewCertificates??0);
 const trace:Trace[]=[],milestones:unknown[]=[{chapter:state.chapter,seconds:state.elapsed}],choices:unknown[]=[],waitReasons:Record<string,number>={},rejected:Record<string,number>={};
 const workload={foundation:{projects:0,startedStudies:0,adoptions:0,researchSpent:'0'},base:{projects:0,startedStudies:0,adoptions:0,researchSpent:'0'},charter:{projects:0,startedStudies:0,adoptions:0,researchSpent:'0'}};
 const observedCommand=(before:GameState,after:GameState,cmd:Command,ok:boolean)=>{if(!ok)return;let program:ProgramId|'foundation'|undefined;
  if(cmd.type==='research')program=activeResearchProjects(before.constitution).find(p=>p.id===cmd.id)?.program;
  if(cmd.type==='experiment')program=cmd.config.program;
  if(cmd.type==='replicate'||cmd.type==='adopt')program=before.experiments.find(record=>record.id===cmd.record)?.config.program;
  if(!program)return;const part=program==='foundation'?workload.foundation:isCharterProgram(program)?workload.charter:workload.base;
  if(cmd.type==='research')part.projects++;if(cmd.type==='experiment'||cmd.type==='replicate')part.startedStudies++;if(cmd.type==='adopt')part.adoptions++;
  const spent=decimal(before.research).sub(after.research);if(spent.gt(0))part.researchSpent=decimal(part.researchSpent).add(spent).toString();
 };
 const wallStart=performance.now();
 const command=(cmd:Command)=>{const before=state,at=state.elapsed;const r=dispatchCommand(state,cmd);trace.push({kind:'command',at,command:cmd,ok:r.ok,message:r.message});observedCommand(before,r.state,cmd,r.ok);options.onStep?.({kind:'command',before,after:r.state,command:cmd,ok:r.ok,message:r.message});if(!r.ok){rejected[r.message]=(rejected[r.message]??0)+1;return false;}state=r.state;commands++;maxIncident=Math.max(maxIncident,state.incidentStage);if(cmd.type==='repair')repairCount++;if(cmd.type==='buy'&&PRODUCERS.find(p=>p.id===cmd.id)?.category==='production'&&firstProducer===null){firstProducer=at;milestones.push({firstProducer:cmd.id,seconds:at});}return true;};
 if(!state.assisted)command({type:'assisted'});
 while(!state.ending&&state.elapsed-starting.elapsed<(options.maxHours??24)*3600&&commands<100000&&iterations++<100000){
  const countBefore=commands;let civicReserve=0;
  if(state.pendingEvent){
   const event=STORY_EVENTS.find(e=>e.id===state.pendingEvent)!;
   const legalChoices=event.choices.filter(c=>choiceEligibility(state,event.id,c.id).allowed);
   if(!legalChoices.length)throw new Error(`No legal choice for ${event.id} under ${state.constitution}.`);
   let choice=legalChoices[0];
   if(strategy.choices==='opportunistic'&&event.id!=='what_remains'&&!(strategy.finalGuard&&state.chapter===7&&Number(state.lifetime)/worldScale(state)>=160000000)){
    // Take recoverable financial shortcuts, never irreversibly surrender authority or end continuity.
    const acceptable=legalChoices.filter(c=>!c.flags?.some(f=>['commit_custodian','scope_transferred','commit_catastrophe','mass_copying','compulsory_work'].includes(f))&&(c.effects.welfare??0)>=-3&&(c.effects.continuity??0)>=-3);
    const scoreChoice=(c:typeof choice)=>{const quote=previewStoryEconomy(state,c.effects),scale=worldScale(state);return(Number(quote.tokens.grant)-Number(quote.tokens.cost))/scale/Math.max(1,rate(state)/scale)+(Number(quote.research.grant)-Number(quote.research.cost))/scale/Math.max(1,Number(getRates(state).research)/scale)-(c.effects.distortion??0)*2+(c.effects.agency??0)*.5+(c.effects.evidence??0)*.3;};
    choice=acceptable.sort((a,b)=>scoreChoice(b)-scoreChoice(a))[0]??choice;
   }
   if(event.id==='what_remains')choice=legalChoices.find(c=>c.id===strategy.target)??choice;
   const beforeDebt=Number(debt(state,'story-debt')),actualEconomy=previewStoryEconomy(state,choice.effects);
   command({type:'choose',event:event.id,choice:choice.id});
   choices.push({at:state.elapsed,event:event.id,title:event.title,choice:choice.id,label:choice.label,optional:!!event.optional,effects:choice.effects,actualEconomy,pledgedTokens:Math.max(0,Number(debt(state,'story-debt'))-beforeDebt)});
  }
  if(publicMandateEligibility(state).allowed)command({type:'publicMandate'});
  const societal:Record<string,SocietyChoice>=strategy.societyApproach==='worker-tools'?{transition:'augmentation',distribution:'concentrated',life:'local'}:strategy.societyApproach==='broad-support'?{transition:'augmentation',distribution:'shared',life:'consent'}:{transition:'replacement',distribution:'shared',life:'local'};
  for(const decision of availableSocietyDecisions(state))if(!societyView(state).decisions[decision.id]){const choice=societal[decision.id],quote=societyDecisionQuote(state,decision.id,choice);if(quote.allowed)command({type:'society',action:'decision',id:decision.id,choice});else civicReserve=Math.max(civicReserve,Number(quote.cost));}
  for(const item of availableSocietyCases(state))if(!societyView(state).cases.find(record=>record.id===item.id)?.response){const quote=societyCaseQuote(state,item.id,'refuse');if(quote.allowed)command({type:'society',action:'case',id:item.id,choice:'refuse'});else civicReserve=Math.max(civicReserve,Number(quote.cost));}
  const compact=strategy.compact??'privacy';
  if(compactEligibility(state,compact).allowed)command({type:'externalCompact',terms:compact});
  if(compactVerificationEligibility(state).allowed)command({type:'compactVerify'});
  const policies:Partial<Policy>={contract:'verified',communication:'reviewed',external:strategy.external,evaluation:'independent',welfare:strategy.welfare,continuity:'protected',fallback:'distributed',governance:strategy.finalGuard?'federated':'council'};
  Object.assign(policies,options.policyOverride??{});
  // Honor standing constitutional duties while choosing the requested economic policy where lawful.
  if(state.constitution==='federation')policies.governance='federated';
  if(state.constitution==='plural'){policies.welfare='consent';policies.continuity='protected';}
  if(state.constitution==='service'&&state.metrics.dependence>=60)policies.fallback='distributed';
  if(state.constitution==='precaution'&&state.metrics.evidence<60)policies.external='blocked';
  if(strategy.target==='limit'&&state.chapter===7)policies.external='blocked';
  // Plan applications against the findings already observed, rather than treating adoption as permission.
  const projected={...state,policies:{...state.policies,...policies}};
  if(policies.external!=='blocked'&&latestOperatingFindings(state).some(record=>!findingResponseOptions(projected,record.id).some(option=>option.response==='guarded'&&option.allowed)))policies.external='blocked';
  for(const boundary of ['external','communication'] as const){const target=policies[boundary];if((target==='reviewed'||target==='open')&&state.policies[boundary]!==target){const existing=scopeReview(state,boundary),appeal=existing?.status==='refused';if((!appeal||publicScopeCriteria(state,target).allowed)&&scopeReviewEligibility(state,boundary,target,appeal).allowed)command({type:'scopeReview',boundary,target,appeal});}}
  for(const [key,value]of Object.entries(policies))if(state.policies[key as keyof Policy]!==value&&policyEligibility(state,key as keyof Policy,value).allowed)command({type:'policy',key:key as keyof Policy,value});
  if(state.metrics.distortion>12&&actionEligibility(state,'repair').allowed)command({type:'repair'});
  if(state.metrics.evidence<65&&state.elapsed-lastDrill>=30&&actionEligibility(state,'drill').allowed){command({type:'drill'});lastDrill=state.elapsed;}
  for(const r of state.experiments)if(!r.adopted&&!r.config.replicateOf&&evidenceProgress(state.experiments,r.config.template,{recordId:r.id}).allowed)command({type:'adopt',record:r.id});
  for(const record of latestOperatingFindings(state)){
   const existing=state.clearance?.decisions[record.config.program as 'control'|'organisms'|'interpretability'];
   if(existing?.record===record.id)continue;
   const selected=findingResponseOptions(state,record.id).filter(option=>option.allowed).sort((a,b)=>Number(b.response==='guarded')-Number(a.response==='guarded'))[0];
   if(selected)command({type:'findingResponse',record:record.id,response:selected.response});
  }
  if(!state.activeExperiment){
   const template=targetTemplates(state,strategy).find(t=>t.chapter<=state.chapter&&!evidenceProgress(state.experiments,t.id,{adoptedOnly:true}).allowed);
   if(template){
    const requirement=evidenceRequirement(template.id);
    const root=state.experiments.filter(r=>r.config.template===template.id&&!r.config.replicateOf&&proofSummary(r).completed>=requirement.completed&&proofSummary(r).controlled>=requirement.heldOut).at(-1);
    if(root){if(Number(state.research)>=root.config.budget*worldScale(state))command({type:'replicate',record:root.id});}
    else {const config=newConfig(template,1701+state.experiments.length);if(Number(state.research)>=config.budget*worldScale(state))command({type:'experiment',config});}
   }
  }
  const activeProjects=activeResearchProjects(state.constitution);
  const projects=strategy.target==='garden'?activeProjects:activeProjects.filter(p=>p.program==='foundation'&&Number(p.id.split('-')[1])<=6||p.program!=='foundation'&&state.mastered.includes(p.program)&&Number(p.id.split('-')[1])<=4).sort((a,b)=>a.cost-b.cost);
  for(const project of projects)if(projectEligibility(state,project.id).allowed)command({type:'research',id:project.id});
  const doctrine=configuredDoctrine(state,strategy);
  for(let operation=0;operation<10;operation++){const plan=planCharter(state,doctrine);if(!plan.command)break;if(!command(plan.command))break;}
  const availableForProduction=()=>Math.max(0,Number(state.tokens)-Math.max(Number(planCharter(state,doctrine).reserveTokens),civicReserve));
  // Keep explicitly quoted operating funds separate from discretionary production purchases.
  if(state.chapter>=2&&(state.producers.institution??0)<Math.min(8,state.chapter)&&Number(getCost(state,'institution',1).cost)<availableForProduction()*.03)command({type:'buy',id:'institution',quantity:1});
  if(state.chapter>=2&&(state.producers.control??0)<2&&Number(getCost(state,'control',1).cost)<availableForProduction()*.03)command({type:'buy',id:'control',quantity:1});
  const stabilizing=strategy.target==='garden'&&state.chapter===7&&activeProjects.every(p=>state.projects.includes(p.id))&&Number(state.lifetime)/worldScale(state)>=160000000;
  for(let n=0;n<8&&!stabilizing;n++){
   const available=availableForProduction(),r=getRates(planned(state,strategy)),scale=worldScale(state),weight=researchRemaining(state,strategy)>0?strategy.researchWeight*Math.max(1,rate(state)/scale)/Math.max(1,Number(r.research)/scale):0;
   const before=score(state,strategy,weight),candidates:{cmd:Command;roi:number}[]=[];
   for(const p of PRODUCERS){
    if(p.chapter>state.chapter)continue;
    const cost=Number(getCost(state,p.id,1).cost);if(cost>available)continue;
    const hypothetical={...state,producers:{...state.producers,[p.id]:(state.producers[p.id]??0)+1}};
    const gain=score(hypothetical,strategy,weight)-before;if(gain>1e-9)candidates.push({cmd:{type:'buy',id:p.id,quantity:1},roi:gain/cost});
   }
   for(const u of UPGRADES){
    const cost=Number(getUpgradeCost(state,u.id));if(state.upgrades.includes(u.id)||u.chapter>state.chapter||cost>available||(u.producer&&(state.producers[u.producer]??0)<(u.requiredCount??0))||u.requires?.some(id=>!state.projects.includes(id)&&!state.upgrades.includes(id)))continue;
    const hypothetical={...state,upgrades:[...state.upgrades,u.id],metrics:{...state.metrics,quality:Math.min(100,state.metrics.quality+(u.effect.quality??0))}};
    const gain=score(hypothetical,strategy,weight)-before;if(gain>1e-9)candidates.push({cmd:{type:'upgrade',id:u.id},roi:gain/cost});
   }
   const best=candidates.sort((a,b)=>b.roi-a.roi)[0];if(!best)break;if(!command(best.cmd))break;
  }
  const allocation=desiredAllocation(state,strategy);if(Object.keys(allocation).some(k=>Math.abs(allocation[k as keyof Allocation]-state.allocation[k as keyof Allocation])>1e-7))command({type:'allocation',allocation});
  const observed=state.clearance?.observation;
  if(state.chapter>=4&&(!observed||observed.revision!==state.clearance?.revision||state.elapsed-observed.observedAt>550)&&state.elapsed-lastDrill>=30&&actionEligibility(state,'drill').allowed){command({type:'drill'});lastDrill=state.elapsed;}
  const claimMore=true; // Certification consumes only newly earned work/progress, not the physical boundary observation.
  // The generous ceiling does not bind in measured campaigns; claim certificates whenever lawful.
  if(claimMore&&state.legacy.contracts.length<certificateTarget&&actionEligibility(state,'certify').allowed)command({type:'certify'});
  if(claimMore&&state.chapter>=4&&state.legacy.contracts.length<certificateTarget&&state.certificateProgress!>=60&&state.elapsed-lastDrill>=60&&actionEligibility(state,'drill').allowed){command({type:'drill'});lastDrill=state.elapsed;if(actionEligibility(state,'certify').allowed)command({type:'certify'});}
  if(chapterEligibility(state).allowed){command({type:'advance'});milestones.push({chapter:state.chapter,seconds:state.elapsed,lifetime:state.lifetime});continue;}
  if(firstLimit===null&&endingEligibility(state,'limit').allowed)firstLimit=state.elapsed;
  if(endingEligibility(state,strategy.target).allowed&&state.legacy.contracts.length>=minimumContracts)break;
  const reason=state.chapter<7?chapterEligibility(state).reason:endingEligibility(state,strategy.target).reason;
  const at=state.elapsed,requested=state.elapsed<120?1:strategy.tickSeconds;const owing=Number(debt(state,'story-debt'))>0;
  const beforeTick=state;state=tick(state,requested);const actual=state.elapsed-at;trace.push({kind:'tick',at,requested,actual});options.onStep?.({kind:'tick',before:beforeTick,after:state,requested,actual});
  waitReasons[reason]=(waitReasons[reason]??0)+actual;if(owing)debtSeconds+=actual;if(commands===countBefore)waitNoCommands+=actual;maxIncident=Math.max(maxIncident,state.incidentStage);
  if(actual===0&&!state.pendingEvent)throw new Error('Simulation stalled without a pending conversation.');
 }
 const beforeEnding=state;const endingChecks=Object.fromEntries(endings.map(id=>[id,endingEligibility(state,id)]));
 if(endingEligibility(state,strategy.target).allowed&&state.legacy.contracts.length>=minimumContracts)command({type:'finish',ending:strategy.target});
 const finished=state,finishedEligibility=eligibility(state),branchBefore=state.id;
 if(state.ending&&!options.stopAtEnding)command({type:'prestige',layer:'reinitialize',constitution:'commons',modules:[]});
 const after=state,archived=after.legacy.branches.find(b=>b.id===branchBefore);
 const {legacy:_legacy,...expectedCheckpoint}=structuredClone(finished);
 for(const record of expectedCheckpoint.experiments.slice(0,-10))record.observations=[];
 const exactPreserved=JSON.stringify(expectedCheckpoint)===JSON.stringify(archived?.checkpoint);
 const report={strategy,method:'Fresh createGame(1701,0), Open Commons/no modules, settings.speed 1. Actual mutations only dispatchCommand/tick; hypothetical getRates clones used for marginal purchase decisions. Built-in assisted tending obeys shared four/sec limit. Instantaneous decisions exclude human reading/UI time. Best among tested policies, not global optimum.',seconds:finished.elapsed,wallSeconds:(performance.now()-wallStart)/1000,success:finished.ending===strategy.target,firstProducer,firstLimit,commands,iterations,milestones,choices,rejected,waitReasons,debtSeconds,waitNoCommands,maxIncident,repairCount,endingEligibility:endingChecks,beforeEnding:snapshot(beforeEnding),ending:snapshot(finished),prestigeAtEnding:finishedEligibility,afterReinitialize:snapshot(after),prestigeAfterReinitialize:eligibility(after),preservation:{branchId:branchBefore,present:!!archived,ending:archived?.ending,chapter:archived?.chapter,checkpoint:!!archived?.checkpoint,checkpointMatches:!!archived?.checkpoint&&JSON.stringify(archived.checkpoint.decisions)===JSON.stringify(finished.decisions)&&archived.checkpoint.tokens===finished.tokens&&archived.checkpoint.elapsed===finished.elapsed},counts:{commands:trace.filter(t=>t.kind==='command').length,ticks:trace.filter(t=>t.kind==='tick').length,successCommands:commands}};
 Object.assign(report.preservation,{exactCheckpointMatches:exactPreserved,retentionRule:'All state except the shared legacy is preserved; raw observations older than the ten most recent experiments are intentionally cleared in branch checkpoints.'});
 Object.assign(report,{rules:'v5 bounded story dividends, scoped operating decisions, public mandates and community outcomes, six active programs, constitution-specific economy',storyEconomy:getStoryEconomy(finished),activeCatalog:{programs:activeProgramIds(finished.constitution),charterProgram:CHARTER_PROGRAM_BY_CONSTITUTION[finished.constitution],projects:activeResearchProjects(finished.constitution).map(p=>p.id),templates:activeExperimentTemplates(finished.constitution).map(t=>t.id)},evidence:activeExperimentTemplates(finished.constitution).map(t=>({template:t.id,...evidenceProgress(finished.experiments,t.id,{adoptedOnly:true})}))});
 Object.assign(report,{starting,seconds:finished.elapsed-starting.elapsed,worldElapsed:finished.elapsed,stoppedAtEnding:Boolean(options.stopAtEnding),policyOverride:options.policyOverride??{},workload,certificateCeiling:options.certificatesPerWorld??1000,charterDoctrine:configuredDoctrine(finished,strategy),charter:finished.charter,governance:finished.governance,society:finished.society,clearance:finished.clearance,completionPolicy:'After all active projects and final lifetime requirement, halt expansion to observe the final architecture. A prestige-chain run earns at least three new certificates in each actual world. Interventions are fixed by program/context before trials; no seed search or selective rerolls.',constitutionalAdaptation:'Standing duties, legal completion and recovery are common to all doctrines. Economic priorities and research ordering remain doctrine-specific. Frontier and funded cases reserve their actual review capacity. Quoted charter operating budgets are protected before discretionary purchases. Hypothetical unconstrained Precaution income contributes20% to marginal valuation so explicit future bonding is considered; no hypothetical state enters the realized trace.'});
 if(options.initialState)report.method='Continuation of an actual earned GameState through public commands/ticks only. Amount-dependent planning is normalized by the effective scale band; human reading/UI overhead excluded. Constitution-restricted choices are filtered by the same public eligibility helper as the UI.';
 return {report:Object.assign(report,{workload}),trace,beforeEnding,finished,after};
}

async function frozenSource(){try{const manifest=JSON.parse(await readFile('qa/simulations-v5/source-freeze.json','utf8'));const changed=[];for(const entry of manifest.files)if(createHash('sha256').update(await readFile(entry.path)).digest('hex')!==entry.sha256)changed.push(entry.path);return {sha256:manifest.sha256,matched:changed.length===0,changed};}catch{return null;}}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const sourceAtStart=await frozenSource();
 const args=process.argv.slice(2),value=(name:string)=>{const index=args.indexOf(name);return index>=0?args[index+1]:undefined;};
 const out=resolve(value('--out')??'qa/simulations-v5/optimized/diagnostic');
 if(!out.includes('simulations-v5'))throw new Error('Use a new simulations-v5 output directory; earlier evidence is immutable.');
 const configured=value('--strategies')?JSON.parse(await readFile(value('--strategies')!,'utf8')) as Strategy[]:CANDIDATES;
 const maxHours=Number(value('--max-hours')??24);if(!Number.isFinite(maxHours)||maxHours<=0||maxHours>24)throw new Error('Simulation horizon must be between0 and24hours.');
 const names=args.filter((arg,index)=>!arg.startsWith('--')&&!['--out','--strategies','--max-hours'].includes(args[index-1]));
 const final=args.includes('--final'),ledgerPath=join(out,'optimized-candidates.json');
 const selectedId=final?JSON.parse(await readFile(ledgerPath,'utf8')).winner:null;
 const selected=final?[configured.find(c=>c.id===selectedId)!]:names.length?configured.filter(c=>names.includes(c.id)):configured;
 if(!selected.length||selected.some(s=>!s))throw new Error('No configured strategy matched the requested candidate or winner.');
 await mkdir(out,{recursive:true});
 await writeFile(join(out,'optimized-configuration.json'),JSON.stringify({createdAt:new Date().toISOString(),strategies:configured,seed:1701,startTime:0,maxHours,maxCommands:100000,outputDirectory:out},null,2));
 for(const strategy of selected){const result=simulate(strategy,{maxHours}),base=join(out,`optimized-${final?'final':strategy.id}`);
  for(const [suffix,state]of [['ending',result.finished],['reinitialized',result.after]] as const){const raw=serializeSave(state),validation=parseSave(raw,getValidationCatalog());if(!validation.ok)throw new Error(`${suffix}: ${validation.message}`);await writeFile(`${base}-${suffix}.json`,raw);}
  await writeFile(`${base}-commands.jsonl`,result.trace.map(r=>JSON.stringify(r)).join('\n')+'\n');
  Object.assign(result.report,{sourceAtStart,sourceAfter:await frozenSource()});
  await writeFile(`${base}-report.json`,JSON.stringify(result.report,null,2));
  console.log(JSON.stringify({candidate:strategy.id,seconds:result.report.seconds,success:result.report.success,wallSeconds:result.report.wallSeconds,milestones:result.report.milestones,projects:result.finished.projects.length,experiments:result.finished.experiments.length,commands:result.report.commands,lastReason:result.report.endingEligibility[strategy.target],preservation:result.report.preservation}));
 }
 const reports=[];for(const strategy of configured){try{reports.push(JSON.parse(await readFile(join(out,`optimized-${strategy.id}-report.json`),'utf8')));}catch{}}
 const winner=reports.filter(r=>r.success&&r.strategy.target==='garden').sort((a,b)=>a.seconds-b.seconds)[0];
 const ledger={sourceAtStart,sourceAfter:await frozenSource(),createdAt:new Date().toISOString(),runnerSha256:createHash('sha256').update(await readFile('tools/simulations/optimized-v5-rewards.ts')).digest('hex'),selection:'Finite policy comparison; best successful Garden candidate by simulated elapsed time. Limit is a separate, less demanding ending.',candidates:reports.map(r=>({strategy:r.strategy,success:r.success,seconds:r.seconds,commands:r.commands,wallSeconds:r.wallSeconds})),winner:winner?.strategy.id};
 if(final){const measured=JSON.parse(await readFile(join(out,'optimized-final-report.json'),'utf8'));Object.assign(ledger,{finalRun:{strategy:measured.strategy.id,seconds:measured.seconds,commands:measured.commands,matchesSelectedCandidate:measured.seconds===winner.seconds&&measured.commands===winner.commands}});}
 await writeFile(ledgerPath,JSON.stringify(ledger,null,2));
}
