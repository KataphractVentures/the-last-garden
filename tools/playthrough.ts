/** Constructive campaign driver. All state changes use the public engine API. */
import { pathToFileURL, fileURLToPath } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import { getValidationCatalog, parseSave, serializeSave } from '../src/persistence';
import type { Command, EndingId, ExperimentConfig, GameState, Policy } from '../src/contracts';
import { actionEligibility, chapterEligibility, choiceEligibility, createGame, dispatchCommand, endingEligibility, findingResponseEligibility, getCost, getRates, getUpgradeCost, latestOperatingFindings, policyEligibility, projectEligibility, tick } from '../src/engine';
import { PRODUCERS, UPGRADES } from '../src/content/economy';
import { STORY_EVENTS } from '../src/content/story';
import { activeExperimentTemplates, activeResearchProjects } from '../src/laboratory/catalog';
import { activeProgramIds, CHARTER_PROGRAM_BY_CONSTITUTION } from '../src/laboratory/programs';
import { evidenceProgress, evidenceRequirement, prepareStrongerConfig, proofSummary } from '../src/laboratory/evidence';
import { charterConfigureEligibility, charterEstablishEligibility, charterGardenEligibility, getCharterActions } from '../src/constitution/economics';
import type { CharterActionQuote, CharterCommand } from '../src/constitution/types';
import { compactEligibility, compactVerificationEligibility, governanceState, publicMandateEligibility, publicScopeCriteria, scopeReview, scopeReviewEligibility } from '../src/governance';
import { availableSocietyCases, availableSocietyDecisions, societyCaseQuote, societyDecisionQuote, societyRepairQuote } from '../src/society';
import type { SocietyChoice } from '../src/society/types';

export type JourneyMode = 'garden' | 'limit' | 'shutdown' | 'score' | 'custodian' | 'catastrophe' | 'recovery';
export interface JourneyOptions { mode?:JourneyMode; seed?:number; maxSeconds?:number; initialState?:GameState; log?:(message:unknown)=>void; allResearch?:boolean }
export interface JourneyResult { state:GameState; checkpoints:Record<string,GameState>; readyState:GameState|null; milestones:{name:string;seconds:number;lifetime:string}[]; firstPurchase:number|null; rejected:Record<string,number>; recoveredAt:number|null; commandCount:number; commandCounts:Record<string,number>; lastReason:string }

const safePolicies:Partial<Policy>={contract:'verified',communication:'reviewed',external:'blocked',evaluation:'independent',welfare:'consent',continuity:'protected',fallback:'distributed',governance:'council'};
const unsafePolicies:Partial<Policy>={contract:'score',communication:'open',external:'open',evaluation:'shared',welfare:'rest',continuity:'archive',fallback:'local',governance:'central'};
const desiredEnding=(mode:JourneyMode):EndingId=>mode==='recovery'?'garden':mode;

/** Select from public quotes and visible board state, just as a player can. */
function charterStep(state:GameState,counts:Record<string,number>):{command?:CharterCommand;reserve:number} {
  if(!state.charter?.established)return {command:charterEstablishEligibility(state).allowed?{type:'charterEstablish'}:undefined,reserve:0};
  const charter=state.charter,quotes=getCharterActions(state);
  // Wallet admission is separate from evidence and operational admission. Save
  // for an otherwise-ready obligation instead of buying machines indefinitely.
  const ready=(q:CharterActionQuote|undefined):q is CharterActionQuote=>!!q&&(q.allowed||q.reason.startsWith('Not enough spendable tokens')||q.reason.startsWith('Keep enough research capacity'));
  const find=(action:CharterActionQuote['action'],predicate:(q:CharterActionQuote)=>boolean=()=>true)=>quotes.find(q=>q.action===action&&predicate(q)&&ready(q));
  const operation=(q:CharterActionQuote|undefined)=>({command:q?.allowed?{type:'charterAction' as const,action:q.action,target:q.target,secondary:q.secondary}:undefined,reserve:q?Number(q.cost):0});
  const configure=(command:Extract<CharterCommand,{type:'charterConfigure'}>)=>charterConfigureEligibility(state,command).allowed?{command,reserve:0}:undefined;
  if(charter.kind==='commons'){
    const d=charter.data,live=d.methods.filter(m=>!m.retired);
    if(d.mode!=='maintained')return configure({type:'charterConfigure',mode:'maintained'})??{reserve:0};
    const worn=find('maintain',q=>(live.find(m=>m.id===q.target)?.maintenance??100)<98);if(worn)return operation(worn);
    const capstone=find('publish',q=>q.target===6);
    if(charter.appliedTier<6&&capstone)return operation(capstone);
    if(live.length<2){
      const focus=live.length===0?'oversight':'control';
      if(d.focus!==focus)return configure({type:'charterConfigure',focus})??{reserve:0};
      return operation(find('publish',q=>q.target===1));
    }
  }else if(charter.kind==='precaution'){
    const d=charter.data;
    if(d.scope!=='broad'){const command=configure({type:'charterConfigure',mode:'broad'});if(command)return command;}
    if(d.scope==='local'){const command=configure({type:'charterConfigure',mode:'staged'});if(command)return command;}
    const capstone=find('openTranche',q=>q.target===3);
    if(charter.appliedTier<6&&capstone)return operation(capstone);
    if(!d.tranches.length)return operation(find('openTranche',q=>q.target===1));
    const constrained=getRates(state).bottleneck.startsWith('Bonded deployment');
    const renew=find('renewTranche',q=>q.secondary===1?constrained:(d.tranches.find(t=>t.id===q.target)?.wear??0)>=20);
    if(renew)return operation(renew);
  }else if(charter.kind==='service'){
    const d=charter.data,settle=find('settleService');if(settle)return operation(settle);
    if(d.active){
      const total=d.lanes.reduce((sum,lane)=>sum+lane.backlog,0);
      const allocation=d.lanes.map(lane=>total>0?lane.backlog/total:.25);
      if(allocation.some((share,i)=>Math.abs(share-d.allocation[i])>.01))return configure({type:'charterConfigure',allocation})??{reserve:0};
    }else {const accept=find('acceptService');if(accept&&(charter.appliedTier<accept.tier||charter.completed<2))return operation(accept);}
  }else if(charter.kind==='federation'){
    const d=charter.data,invest=find('investDistrict');if(invest)return operation(invest);
    // One real transfer demonstrates delayed settlement between distinct local
    // treasuries; later funds stay local until their own evidence permits use.
    if(!counts['charterAction:transferDistrict']){const transfer=find('transferDistrict');if(transfer)return operation(transfer);}
    const total=d.districts.reduce((sum,district)=>sum+1+.08*district.level,0);
    const allocation=d.districts.map(district=>(1+.08*district.level)/total);
    if(allocation.some((share,i)=>Math.abs(share-d.allocation[i])>.005))return configure({type:'charterConfigure',allocation})??{reserve:0};
    const fund=find('fundDistrict',q=>{
      const next=quotes.find(candidate=>candidate.action==='investDistrict'&&candidate.target===q.target);
      return !!next&&(next.allowed||next.reason.startsWith('This district needs'))&&d.districts[q.target!].level<6;
    });
    if(fund)return operation(fund);
    if(!counts['charterAction:withdraw']){const withdraw=find('withdraw',q=>d.districts[q.target!].level===6);if(withdraw)return operation(withdraw);}
  }else if(charter.kind==='plural'){
    const d=charter.data,fund=find('fundCare');
    if(fund&&Number(d.careReserve)<Number(fund.cost)*.25)return operation(fund);
    if(d.agreement!=='matched'){const command=configure({type:'charterConfigure',mode:'matched'});if(command)return command;}
    const offer=find('negotiate');if(offer)return operation(offer);
    const preserve=find('preserve');if(preserve&&(charter.appliedTier<6||d.continuityDuty>=1||d.unmet>1))return operation(preserve);
  }else if(charter.kind==='frontier'){
    const d=charter.data,settle=find('settleTender');if(settle)return operation(settle);
    if(d.offer!=='public'){const command=configure({type:'charterConfigure',mode:'public'});if(command)return command;}
    if(!d.disclosures){const disclose=find('disclose');if(disclose)return operation(disclose);}
    if(!d.tenders.length){const bid=find('bid');if(bid&&(charter.appliedTier<bid.tier||d.round===0))return operation(bid);}
  }
  return {reserve:0};
}

export function runJourney(options:JourneyOptions={}):JourneyResult {
  const mode=options.mode??'garden', maxSeconds=options.maxSeconds??12*3600;
  const allResearch=options.allResearch??(mode==='garden'||mode==='recovery');
  let state=options.initialState??createGame(options.seed??1701,0),firstPurchase:number|null=null,recoveredAt:number|null=null,commandCount=0;
  const charterProgram=CHARTER_PROGRAM_BY_CONSTITUTION[state.constitution];
  const activePrograms=new Set(activeProgramIds(state.constitution)),templates=activeExperimentTemplates(state.constitution).sort((a,b)=>a.chapter-b.chapter||Number(b.program===charterProgram)-Number(a.program===charterProgram)),projects=activeResearchProjects(state.constitution);
  let readyState:GameState|null=null,blockedReason:string|null=null;const checkpoints:Record<string,GameState>={};
  const milestones=[{name:`chapter-${state.chapter}`,seconds:state.elapsed,lifetime:state.lifetime}], rejected:Record<string,number>={},commandCounts:Record<string,number>={};
  const record=(name:string)=>{const m={name,seconds:state.elapsed,lifetime:state.lifetime};milestones.push(m);options.log?.(m);};
  const command=(cmd:Command,required=false)=>{const result=dispatchCommand(state,cmd);if(result.ok){state=result.state;commandCount++;const key=cmd.type+('action'in cmd?`:${String(cmd.action)}`:'');commandCounts[key]=(commandCounts[key]??0)+1;if(cmd.type==='buy'&&firstPurchase===null){firstPurchase=state.elapsed;record('first-purchase');}}else if(required){rejected[result.message]=(rejected[result.message]??0)+1;}return result.ok;};
  if(!state.assisted)command({type:'assisted'});
  command({type:'allocation',allocation:state.constitution==='frontier'?{production:.675,research:.2,review:.125}:{production:.7,research:.2,review:.1}});
  let nextLog=(Math.floor(state.elapsed/3600)+1)*3600,lastDrill=-1000,iterations=0,unsafeActivated=false;
  const withdrawResponses=()=>{for(const program of ['control','organisms','interpretability'] as const)if(state.clearance?.decisions[program])command({type:'withdrawFindingResponse',program},true);};
  const requestExpansion=(boundary:'external'|'communication',target:'reviewed'|'open')=>{
    if(state.policies[boundary]===target)return;
    if(governanceState(state).mandate==='none')return;
    const prior=scopeReview(state,boundary),appeal=prior?.status==='refused';
    if(scopeReviewEligibility(state,boundary,target,appeal).allowed&&publicScopeCriteria(state,target).allowed)command({type:'scopeReview',boundary,target,appeal},true);
  };
  const changePolicies=(policies:Partial<Policy>)=>{
    for(const [key,value]of Object.entries(policies))if(state.policies[key as keyof Policy]!==value){
      if((key==='external'||key==='communication')&&value!=='blocked'&&value!=='closed')requestExpansion(key,value as 'reviewed'|'open');
      if(policyEligibility(state,key as keyof Policy,value!).allowed)command({type:'policy',key:key as keyof Policy,value:value!},true);
    }
  };
  // Negative witnesses deliberately abandon technical operating commitments.
  // Public institutions still observe and authorize the requested scope first.
  const prepareExpansion=(both:boolean)=>{
    withdrawResponses();
    changePolicies({contract:'verified',evaluation:'independent',fallback:'distributed',governance:'council'});
    if(both&&(state.policies.external!=='open'||state.policies.communication!=='open')&&state.policies.external==='open')changePolicies({external:'blocked'});
    requestExpansion('external','open');if(both)requestExpansion('communication','open');
    const boundaries=(both?['communication','external']:['external']) as ('external'|'communication')[];
    const ready=boundaries.every(boundary=>state.policies[boundary]==='open'||policyEligibility(state,boundary,'open').allowed);
    if(ready)for(const boundary of boundaries)if(state.policies[boundary]!=='open')command({type:'policy',key:boundary,value:'open'},true);
    return ready;
  };
  while(state.elapsed<maxSeconds&&!state.ending&&iterations++<100000){
    const destructive=mode==='catastrophe'||(mode==='recovery'&&recoveredAt===null&&state.chapter>=4);
    if(destructive&&(state.policies.external!=='open'||state.policies.communication!=='open'))unsafeActivated=false;
    const custodyPending=mode==='custodian'&&(state.pendingEvent==='last_instruction'||state.chapter>=6&&!state.decisions.last_instruction);
    if((destructive&&!unsafeActivated)||custodyPending){
      const expanded=prepareExpansion(destructive);
      if(destructive&&expanded)unsafeActivated=true;
      if(custodyPending&&!expanded&&state.pendingEvent==='last_instruction'&&state.settings.readingPause)command({type:'settings',settings:{readingPause:false}});
    }
    if(state.pendingEvent){
      const event=STORY_EVENTS.find(e=>e.id===state.pendingEvent)!;
      if(event.id==='last_instruction')checkpoints['before-scope-transfer']=state;
      let choice=event.choices[0];
      // Cautionary campaigns normally choose the restorative authored response.
      // The Custodian path makes its irreversible commitment through an actual story choice.
      if(mode==='custodian')choice=event.choices.find(c=>c.flags?.some(f=>['commit_custodian','scope_transferred'].includes(f)))??choice;
      if(!choiceEligibility(state,event.id,choice.id).allowed){
        if(mode==='custodian'&&event.id==='last_instruction'){
          // Observe the public request while leaving the transfer scene unresolved.
          if(actionEligibility(state,'drill').allowed&&state.elapsed-lastDrill>=120){command({type:'drill'},true);lastDrill=state.elapsed;}
          const before=state.elapsed;state=tick(state,15);
          if(state.elapsed===before){blockedReason='Custodian scope observation could not advance.';break;}
          continue;
        }
        const legal=event.choices.find(c=>choiceEligibility(state,event.id,c.id).allowed);
        if(!legal){blockedReason=`No legal choice in ${event.id}: ${event.choices.map(c=>`${c.id}: ${choiceEligibility(state,event.id,c.id).reason}`).join('; ')}`;options.log?.({blocked:blockedReason,elapsed:state.elapsed});break;}
        choice=legal;
      }
      command({type:'choose',event:event.id,choice:choice.id},true);
    }
    const aggressive=destructive&&unsafeActivated||mode==='score';
    if(mode==='score')withdrawResponses();
    const policies:Partial<Policy>=aggressive?{...unsafePolicies,...(mode==='score'?{external:'blocked' as const,communication:'reviewed' as const}: {})}:destructive||custodyPending?{contract:'verified',evaluation:'independent',fallback:'distributed',governance:'council'}:{...safePolicies,...(state.constitution==='federation'?{governance:'federated' as const}:{})};
    changePolicies(policies);
    if(mode==='recovery'&&state.incidentStage===3&&recoveredAt===null){
      recoveredAt=state.elapsed;record('late-isolation');command({type:'isolate'},true);command({type:'repair'},true);
    }
    if((!aggressive||recoveredAt!==null)&&state.metrics.distortion>12&&actionEligibility(state,'repair').allowed)command({type:'repair'});
    if(!aggressive&&publicMandateEligibility(state).allowed)command({type:'publicMandate'},true);
    // Execute a protocol, independently replicate it, and adopt its record. No flags are injected.
    for(const r of state.experiments)if(activePrograms.has(r.config.program)&&!r.adopted&&evidenceProgress(state.experiments,r.config.template,{recordId:r.id}).allowed)command({type:'adopt',record:r.id});
    if(!aggressive&&!destructive&&!custodyPending)for(const finding of latestOperatingFindings(state))if(findingResponseEligibility(state,finding.id,'restrict').allowed)command({type:'findingResponse',record:finding.id,response:'restrict'},true);
    if(!state.activeExperiment){
      const template=templates.find(t=>t.chapter<=state.chapter&&!evidenceProgress(state.experiments,t.id,{adoptedOnly:true}).allowed&&(allResearch||!state.mastered.includes(t.program)));
      if(template){
        const requirement=evidenceRequirement(template.id);
        const root=state.experiments.filter(r=>r.config.template===template.id&&!r.config.replicateOf&&proofSummary(r).completed>=requirement.completed&&proofSummary(r).controlled>=requirement.heldOut).at(-1);
        if(root)command({type:'replicate',record:root.id});
        else {const config:ExperimentConfig=prepareStrongerConfig({program:template.program,template:template.id,seed:1701+state.experiments.length,cohort:32,budget:128,holdout:.3,intervention:template.interventions.find(i=>i!=='baseline')??'baseline',distribution:'shifted',lineage:'inherited',prediction:'The intervention changes the held-out outcome relative to its matched control; transfer can fail.',control:true,node:3},1701+state.experiments.length);command({type:'experiment',config});}
      }
    }
    for(const p of projects)if(projectEligibility(state,p.id).allowed)command({type:'research',id:p.id});

    let publicReserve=0;
    for(const decision of availableSocietyDecisions(state))if(!state.society?.decisions[decision.id]){
      const choice:SocietyChoice=decision.id==='transition'?'augmentation':decision.id==='distribution'?'shared':'consent';
      const quote=societyDecisionQuote(state,decision.id,choice);publicReserve=Math.max(publicReserve,Number(quote.cost));
      if(quote.allowed)command({type:'society',action:'decision',id:decision.id,choice},true);
    }
    for(const request of availableSocietyCases(state)){
      const record=state.society?.cases.find(item=>item.id===request.id);
      if(!record?.response){const quote=societyCaseQuote(state,request.id,'alternative');publicReserve=Math.max(publicReserve,Number(quote.cost));if(quote.allowed)command({type:'society',action:'case',id:request.id,choice:'alternative'},true);}
      else if(record.response==='comply'&&!record.repaired){const quote=societyRepairQuote(state,request.id);if(quote.allowed)command({type:'society',action:'repair',id:request.id},true);}
    }
    if(!aggressive&&!destructive&&!custodyPending&&state.chapter>=4&&compactEligibility(state,'privacy').allowed)command({type:'externalCompact',terms:'privacy'},true);
    if(compactVerificationEligibility(state).allowed)command({type:'compactVerify'},true);
    let charterReserve=0;
    for(let step=0;step<6;step++){
      const next=charterStep(state,commandCounts);charterReserve=next.reserve;
      if(!next.command)break;
      if(!command(next.command,true))break;
    }

    const curriculumComplete=!allResearch||(projects.every(p=>state.projects.includes(p.id))&&templates.every(t=>evidenceProgress(state.experiments,t.id,{adoptedOnly:true}).allowed));
    const applicationComplete=!allResearch||!['garden','limit','shutdown'].includes(desiredEnding(mode))||charterGardenEligibility(state).allowed;
    const sustaining=state.chapter===7&&curriculumComplete&&applicationComplete;
    // Stop discretionary expansion once ready to sustain the actual operating scope.
    const rates=getRates(state),reviewEfficiency=(state.constitution==='frontier'?.8:1)*(state.modules.includes('scarce-reviewers')?.45:1);
    const supportTargets:Record<string,number>={institution:Math.min(10,state.chapter*2),control:state.chapter>=2?3:0,review:Math.ceil(rates.demand*.012/(4*reviewEfficiency))+2};
    for(const [id,target]of Object.entries(supportTargets))if(!sustaining&&(state.producers[id]??0)<target&&Number(getCost(state,id,1).cost)<Number(state.tokens)*.12)command({type:'buy',id,quantity:1});
    for(let buy=0;buy<8&&!sustaining;buy++){
      const before=Number(getRates(state).tokens), available=Math.max(0,Number(state.tokens)-Math.max(charterReserve,publicReserve));
      const candidates:{cmd:Command;roi:number;cost:number}[]=[];
      for(const p of PRODUCERS){
        if(p.chapter>state.chapter||!['production','compute'].includes(p.category))continue;
        const cost=Number(getCost(state,p.id,1).cost);if(cost>available)continue;
        const cmd:Command={type:'buy',id:p.id,quantity:1};
        const gain=Number(getRates({...state,producers:{...state.producers,[p.id]:(state.producers[p.id]??0)+1}}).tokens)-before;
        if(gain>0)candidates.push({cmd,roi:gain/cost,cost});
      }
      for(const u of UPGRADES){
        const cost=Number(getUpgradeCost(state,u.id));
        if(state.upgrades.includes(u.id)||u.chapter>state.chapter||cost>available||(u.producer&&(state.producers[u.producer]??0)<(u.requiredCount??0))||u.requires?.some(id=>!state.projects.includes(id)&&!state.upgrades.includes(id)))continue;
        const cmd:Command={type:'upgrade',id:u.id};
        const gain=Number(getRates({...state,upgrades:[...state.upgrades,u.id]}).tokens)-before;
        if(gain>0)candidates.push({cmd,roi:gain/cost,cost});
      }
      const best=candidates.sort((a,b)=>b.roi-a.roi)[0];if(!best)break;command(best.cmd);
    }
    const observation=state.clearance?.observation;
    const needsDrill=!observation||state.elapsed-observation.observedAt>=300||state.metrics.evidence<75;
    if(!aggressive&&state.policies.evaluation==='independent'&&needsDrill&&state.elapsed-lastDrill>=(sustaining?15:120)&&actionEligibility(state,'drill').allowed){command({type:'drill'},true);lastDrill=state.elapsed;}
    if(chapterEligibility(state).allowed){command({type:'advance'},true);record(`chapter-${state.chapter}`);checkpoints[`chapter-${state.chapter}`]=state;continue;}
    const ending=desiredEnding(mode);
    if(curriculumComplete&&applicationComplete&&endingEligibility(state,ending).allowed){readyState=state;command({type:'finish',ending},true);record(`ending-${ending}`);break;}
    const before=state.elapsed;state=tick(state,state.elapsed<120?1:15);
    if(state.elapsed===before&&!state.pendingEvent){blockedReason='The simulation clock did not advance and no conversation is pending.';options.log?.({stalled:true,elapsed:state.elapsed});break;}
    if(state.elapsed>=nextLog){options.log?.({hour:Math.floor(state.elapsed/3600),chapter:state.chapter,lifetime:state.lifetime,rate:getRates(state).tokens,research:state.research,projects:state.projects.length,mastered:state.mastered,producers:state.producers});nextLog+=3600;}
  }
  const incomplete=allResearch&&!state.ending?projects.filter(p=>!state.projects.includes(p.id)).map(p=>p.id):[];
  const application=allResearch&&!state.ending&&['garden','limit','shutdown'].includes(desiredEnding(mode))?charterGardenEligibility(state):null;
  const lastReason=blockedReason??(incomplete.length?`Active curriculum incomplete (${incomplete.length} projects remain): ${incomplete.slice(0,6).join(', ')}.`:application&&!application.allowed?application.reason:endingEligibility(state,desiredEnding(mode)).reason);
  return {state,checkpoints,readyState,milestones,firstPurchase,rejected,recoveredAt,commandCount,commandCounts,lastReason};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const mode=(process.argv[2]??'garden')as JourneyMode, hours=Number(process.argv[3]??12);
  const started=performance.now();
  const r=runJourney({mode,maxSeconds:hours*3600,allResearch:process.argv.includes('--all-research')?true:undefined,log:m=>console.log(JSON.stringify(m))});
  console.log(JSON.stringify({mode,seconds:r.state.elapsed,wallSeconds:(performance.now()-started)/1000,ending:r.state.ending,chapter:r.state.chapter,milestones:r.milestones,firstPurchase:r.firstPurchase,lastReason:r.lastReason,projects:r.state.projects.length,experiments:r.state.experiments.length,metrics:r.state.metrics,commandCount:r.commandCount,rejected:r.rejected}));
  if(process.argv.includes('--export-qa')){
    const directory=fileURLToPath(new URL('../qa/',import.meta.url));await mkdir(directory,{recursive:true});
    const exports={'chapter-2-laboratory':r.checkpoints['chapter-2'],'chapter-7-civilization':r.checkpoints['chapter-7'],'garden-ending-ready':r.readyState,'garden-complete':r.state};
    for(const [name,state]of Object.entries(exports))if(state){const payload=serializeSave(state);const valid=parseSave(payload,getValidationCatalog());if(!valid.ok)throw new Error(`${name}: ${valid.message}`);await writeFile(`${directory}/${name}.json`,payload);}
    await writeFile(`${directory}/journey-provenance.json`,JSON.stringify({createdAt:new Date().toISOString(),origin:'Actual createGame/dispatchCommand/tick campaign; no injected flags, resources, projects, metrics, or decisions.',mode,seconds:r.state.elapsed,commandCount:r.commandCount,milestones:r.milestones,exports:Object.keys(exports).filter(name=>exports[name as keyof typeof exports])},null,2));
    console.log(JSON.stringify({qaExports:directory,verifiedWith:'serializeSave + parseSave + current content catalog'}));
  }
}

