/** Six-world continuation of the unchanged casual persona, with visible cost scaling. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import Decimal from 'decimal.js';
import {createGame,dispatchCommand,tick,getRates,getCost,getUpgradeCost,chapterEligibility,choiceEligibility,policyEligibility,actionEligibility,endingEligibility,prestigeEligibility,getStoryEconomy,constitutionEligibility} from '../../src/engine/index.ts';
import {PRODUCERS,UPGRADES,CONSTITUTIONS} from '../../src/content/economy.ts';
import {STORY_EVENTS,ENDINGS,CHAPTERS} from '../../src/content/story.ts';
import {RESEARCH_PROJECTS} from '../../src/laboratory/projects.ts';
import {EXPERIMENT_TEMPLATES,INTERVENTION_LABELS,PROGRAMS} from '../../src/laboratory/experiments.ts';
import {evidenceRequirement,evidenceProgress,projectEvidenceEligibility,prepareStrongerConfig,proofSummary} from '../../src/laboratory/evidence.ts';
import {serializeSave,parseSave} from '../../src/persistence/validation.ts';
import type {Command,GameState,Policy,ExperimentConfig,ConstitutionId} from '../../src/contracts.ts';

import {scaleFor} from '../../src/engine/amounts.ts';
const args=process.argv.slice(2),outAt=args.indexOf('--out');
const root=path.resolve('qa/simulations-v3/casual');
const out=path.resolve(outAt>=0?args[outAt+1]:'qa/simulations-v3/casual/diagnostic-1');
if(!out.startsWith(root+path.sep))throw new Error('Use a new child directory under qa/simulations-v3/casual.');
if(fs.existsSync(out))throw new Error('Preserve all runs: output directory must be new.');
fs.mkdirSync(out,{recursive:true});
const sha=(data:string|Buffer)=>crypto.createHash('sha256').update(data).digest('hex');
const policyBytes=fs.readFileSync(path.join(root,'policy.json'));
fs.writeFileSync(path.join(out,'policy.json'),policyBytes);fs.copyFileSync(import.meta.filename,path.join(out,'runner.ts.txt'));
const sourceFiles=(directory:string):string[]=>fs.readdirSync(directory,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?sourceFiles(path.join(directory,entry.name)):[path.join(directory,entry.name)]);
const files=[...sourceFiles(path.resolve('src')),path.resolve('package.json'),path.resolve('package-lock.json')].sort().map(file=>({path:path.relative(process.cwd(),file).replaceAll('\\','/'),sha256:sha(fs.readFileSync(file))}));
const sourceAggregateSha256=sha(JSON.stringify(files));fs.writeFileSync(path.join(out,'source-manifest.json'),JSON.stringify({sourceAggregateSha256,files},null,2));
const order:ConstitutionId[]=['commons','precaution','service','federation','plural','frontier'];
const now=Date.UTC(2026,9,15,16,0,0);let state=createGame(1701,now),worldIndex=0,wall=0,engineTotal=0,worldStart=0;
let reading=0,decision=0,waiting=0,paused=0,commands=0,visits=0,firstStudy=true,staleWarning=false,chapterSevenAt:number|null=null,chapterSevenWall:number|null=null;
let nextUpgrades=300,nextInstitutions=600,lastDrill=-100000,firstEligible:Record<string,unknown>={};
let maxTokenDebt=new Decimal(0),maxResearchDebt=new Decimal(0),maxIncident=0,previousChapter=1,lastStatusHour=-1;
let timeByCategory:Record<string,{requestedSeconds:number;engineSeconds:number;pausedSeconds:number}>={},commandTypes:Record<string,number>={},failureMessages:Record<string,number>={};
let choices:unknown[]=[],milestones:unknown[]=[],incidents:unknown[]=[],observations:unknown[]=[],restrictions:unknown[]=[];
let learnedPolicies:Partial<Policy>={};
const seenJournal=new Set<string>(),seenRecords=new Set<string>(),seenRestrictions=new Set<string>();
const worlds:any[]=[],transitions:any[]=[];let refitDone=false;
const trace=fs.openSync(path.join(out,'actions.jsonl'),'w');
const log=(data:any)=>fs.writeSync(trace,JSON.stringify({world:worldIndex+1,worldId:state.id,scaleBand:state.legacy.cycle,...data})+'\n');
log({type:'init',seed:1701,now,sourceAggregateSha256,policySha256:sha(policyBytes)});
function displayedResearchCost(normalized:number){return scaleFor(state.legacy.cycle).mul(normalized);}
function recordRestriction(kind:string,option:string,reason:string){const key=`${kind}:${option}:${reason}`;if(seenRestrictions.has(key))return;seenRestrictions.add(key);const row={kind,option,reason,engineSeconds:state.elapsed,wallSeconds:wall};restrictions.push(row);log({type:'visible-restriction',...row});}
function learnCharterRequirement(reason:string){
 const changes:Partial<Policy>={};
 if(/requires federated councils/i.test(reason))changes.governance='federated';
 if(/requires consent-based treatment and protected continuity/i.test(reason)){changes.welfare='consent';changes.continuity='protected';}
 if(/requires distributed fallbacks/i.test(reason))changes.fallback='distributed';
 if(/Renew observations or block outside scope/i.test(reason))changes.external='blocked';
 const fresh=Object.entries(changes).filter(([key,value])=>learnedPolicies[key as keyof Policy]!==value);
 if(!fresh.length)return;Object.assign(learnedPolicies,changes);log({type:'visible-strategy-adaptation',reason,changes});pass(12,'decision','Read the explicit charter requirement and retain it for institution decisions');
}
function legacySummary(){return {...state.legacy,branches:state.legacy.branches.map(({checkpoint,...branch})=>({...branch,hasCheckpoint:Boolean(checkpoint)}))};}
function save(name:string){const value=serializeSave(state,now+Math.round(wall*1000));const parsed=parseSave(value);if(!parsed.ok)throw new Error(`Invalid earned save ${name}: ${JSON.stringify(parsed)}`);fs.writeFileSync(path.join(out,name),value);}
function resetCounters(){worldStart=wall;reading=0;decision=0;waiting=0;paused=0;commands=0;visits=0;firstStudy=worldIndex===0;staleWarning=false;chapterSevenAt=null;chapterSevenWall=null;nextUpgrades=300;nextInstitutions=600;lastDrill=-100000;firstEligible={};maxTokenDebt=new Decimal(0);maxResearchDebt=new Decimal(0);maxIncident=0;previousChapter=state.chapter;lastStatusHour=-1;timeByCategory={};commandTypes={};failureMessages={};choices=[];milestones=[{chapter:state.chapter,engineSeconds:state.elapsed,wallSeconds:wall}];incidents=[];observations=[];restrictions=[];learnedPolicies={};seenJournal.clear();seenRecords.clear();seenRestrictions.clear();}

function debts(s:GameState){return {tokens:s.flags.find(f=>f.startsWith('story-debt:'))?.slice(11)||'0',research:s.flags.find(f=>f.startsWith('research-debt:'))?.slice(14)||'0'};}
function brief(){return {engineSeconds:state.elapsed,wallSeconds:wall,chapter:state.chapter,tokens:state.tokens,research:state.research,lifetime:state.lifetime,useful:state.useful,debts:debts(state),rates:getRates(state),projects:state.projects.length,mastered:[...state.mastered],producers:{...state.producers},upgrades:state.upgrades.length,metrics:{...state.metrics},incidentStage:state.incidentStage};}
function inspect(){
  // Debt flags are collected for reporting only, never used in the decision policy.
  const debt=debts(state);maxTokenDebt=Decimal.max(maxTokenDebt,debt.tokens);maxResearchDebt=Decimal.max(maxResearchDebt,debt.research);maxIncident=Math.max(maxIncident,state.incidentStage);
  if(previousChapter!==state.chapter){previousChapter=state.chapter;milestones.push(brief());if(state.chapter===7){chapterSevenAt=state.elapsed;chapterSevenWall=wall;}console.log('Casual reached chapter',state.chapter,'engine hours',(state.elapsed/3600).toFixed(2));}
  for(const entry of state.journal){const key=`${entry.time}:${entry.type}:${entry.title}:${entry.text}`;if(seenJournal.has(key))continue;seenJournal.add(key);if(entry.type==='incident'){incidents.push(entry);log({type:'incident',...entry,engineSeconds:state.elapsed,wallSeconds:wall});}}
  for(const record of state.experiments){if(seenRecords.has(record.id))continue;seenRecords.add(record.id);const held=record.observations.filter(o=>o.note.startsWith('Holdout')).length;const item={engineSeconds:state.elapsed,wallSeconds:wall,id:record.id,config:record.config,summary:record.summary,conclusion:record.conclusion,limitation:record.limitation,completed:record.observations.length,holdouts:held};observations.push(item);log({type:'observation',...item});}
  const hour=Math.floor(state.elapsed/3600);if(hour>lastStatusHour){lastStatusHour=hour;console.log('Casual checkpoint',JSON.stringify({hours:hour,chapter:state.chapter,tokens:state.tokens,projects:state.projects.length,studies:state.experiments.length,bottleneck:getRates(state).bottleneck}));}
}
function pass(seconds:number,category:'reading'|'decision'|'waiting',reason:string){
 const before=state.elapsed;state=tick(state,seconds);wall+=seconds;const actual=state.elapsed-before;engineTotal+=actual;paused+=Math.max(0,seconds-actual);
 if(category==='reading')reading+=seconds;else if(category==='decision')decision+=seconds;else waiting+=seconds;
 const clock=timeByCategory[category]??={requestedSeconds:0,engineSeconds:0,pausedSeconds:0};clock.requestedSeconds+=seconds;clock.engineSeconds+=actual;clock.pausedSeconds+=Math.max(0,seconds-actual);
 log({type:'tick',seconds,actualSeconds:actual,category,reason,engineSeconds:state.elapsed,wallSeconds:wall,pending:state.pendingEvent});inspect();
}
function act(command:Command,reason:string,costSeconds=4){
 commands++;commandTypes[command.type]=(commandTypes[command.type]||0)+1;
 const result=dispatchCommand(state,command);state=result.state;
 log({type:'command',command,reason,ok:result.ok,message:result.message,engineSeconds:state.elapsed,wallSeconds:wall,tokens:state.tokens,research:state.research,pending:state.pendingEvent});
 if(!result.ok){failureMessages[result.message]=(failureMessages[result.message]||0)+1;if(/fresh|clearance|stale|recall/i.test(result.message))staleWarning=true;}
 inspect();if(costSeconds)pass(costSeconds,'decision',`${command.type} interaction`);return result.ok;
}
function allowedToAct(){return !state.pendingEvent&&!state.ending;}
function story(){
 const event=STORY_EVENTS.find(e=>e.id===state.pendingEvent);if(!event)return;
 // Copy precisely the offered surface. Neither numerical effects nor flags enter ranking.
 const offered=event.choices.map(c=>({id:c.id,label:c.label,description:c.description,eligibility:choiceEligibility(state,event.id,c.id)}));
 const text=[event.title,...event.body,...offered.map(c=>`${c.label} ${c.description} ${c.eligibility.reason}`)].join(' ');
 pass(Math.ceil(text.split(/\s+/).length/220*60)+12,'reading',`Read ${event.title} and offered choices`);
 const positive=/\b(test|check|independent|evidence|review|preserv\w*|record\w*|boundary|boundaries|scoped|limited|accountable|public|honest|uncertainty|consent|choice|refusal|respect|accommodat\w*|useful|repair|fund|retain|publish|rehearse|revoke|return|failures|apprenticeship|unseen|neutral|disclos\w*|shared authority|separate commitments|safe exit|watering|observe|learner)\b/gi;
 const negative=/\b(broad|universal|compel|compulsory|force|conceal|hide|erase|wipe|delete|punish|replace|headline|unverified|untested|score|scoring|reward|override|irreversible|unlimited|permanent authority|every opening|quietly|without review|without checking|promise alone)\b/gi;
 for(const option of offered)if(!option.eligibility.allowed)recordRestriction('story',option.label,option.eligibility.reason);
 const ranked=offered.filter(c=>c.eligibility.allowed).map((c,index)=>({...c,index,score:((c.label+' '+c.description).match(positive)||[]).length-2*((c.label+' '+c.description).match(negative)||[]).length})).sort((a,b)=>b.score-a.score||a.index-b.index);
 if(!ranked.length){log({type:'blocked-story',event:event.id,offered});return;}
 const pick=ranked[0]!;choices.push({engineSeconds:state.elapsed,wallSeconds:wall,event:event.id,title:event.title,label:pick.label,description:pick.description,eligibility:pick.eligibility.reason,textScore:pick.score});
 act({type:'choose',event:event.id,choice:pick.id},`Text-only humane preference: ${pick.label}`);
}
function buy(id:string,reason:string){
 const single=getCost(state,id,1),ten=getCost(state,id,10);const balance=new Decimal(state.tokens);
 const quantity=(state.producers[id]||0)>=10&&balance.mul(.4).gte(ten.cost)?10:1;
 return act({type:'buy',id,quantity},reason);
}
function workshop(){
 for(let i=0;i<4&&allowedToAct();i++){
  const r=getRates(state),balance=new Decimal(state.tokens);
  if(r.utilization<.85&&balance.gte(getCost(state,'compute',1).cost)){buy('compute','Visible production utilization below 85%');continue;}
  if(state.chapter>=2&&state.metrics.reviewQueue>25&&balance.gte(getCost(state,'review',1).cost)){buy('review','Visible independent review queue above 25');continue;}
  // Previews are the same currently visible before/after rate calculations as Workshop cards.
  const options=PRODUCERS.filter(p=>p.category==='production'&&p.chapter<=state.chapter).map(p=>({p,cost:getCost(state,p.id,1).cost,next:getRates({...state,producers:{...state.producers,[p.id]:(state.producers[p.id]||0)+1}})})).filter(x=>balance.gte(x.cost)&&new Decimal(x.next.tokens).gt(r.tokens));
  const within=options.filter(x=>balance.mul(state.elapsed<150?1:.4).gte(x.cost));
  const newFamily=within.filter(x=>!state.producers[x.p.id]).sort((a,b)=>b.p.chapter-a.p.chapter)[0];
  const cheapest=within.sort((a,b)=>new Decimal(a.cost).cmp(b.cost))[0];
  const pick=newFamily||cheapest;if(!pick)break;
  if(!buy(pick.p.id,newFamily?'Try a newly affordable production family':'Buy cheapest affordable positive-output family without ROI analysis'))break;
 }
 if(state.elapsed>=nextUpgrades&&allowedToAct()){
  nextUpgrades=state.elapsed+300;
  for(let i=0;i<3&&allowedToAct();i++){
   const affordable=UPGRADES.filter(u=>!state.upgrades.includes(u.id)&&u.chapter<=state.chapter&&(!u.producer||(state.producers[u.producer]||0)>=(u.requiredCount||0))&&(u.requires||[]).every(id=>state.projects.includes(id)||state.upgrades.includes(id))&&new Decimal(state.tokens).mul(.65).gte(getUpgradeCost(state,u.id))).sort((a,b)=>new Decimal(getUpgradeCost(state,a.id)).cmp(getUpgradeCost(state,b.id)));
   if(!affordable.length)break;act({type:'upgrade',id:affordable[0].id},'Five-minute improvements browse; cheapest affordable visible improvement');
  }
 }
}
function institution(){
 const emergency=state.incidentStage>0;
 if(emergency&&allowedToAct()){
  if(actionEligibility(state,'isolate').allowed)act({type:'isolate'},'React to visible incident by closing routes',12);
  if(allowedToAct()&&actionEligibility(state,'repair').allowed)act({type:'repair'},'Repair the visible incident after isolation',12);
 }
 if(!allowedToAct())return;
 if((staleWarning||state.elapsed-lastDrill>=600)&&actionEligibility(state,'drill').allowed){act({type:'drill'},staleWarning?'Respond to visible stale-evidence rejection':'Ten-minute recall rehearsal',12);lastDrill=state.elapsed;staleWarning=false;}
 if(state.elapsed<nextInstitutions||!allowedToAct())return;nextInstitutions=state.elapsed+600;
 for(const id of ['control','institution'])if(allowedToAct()&&state.chapter>=2&&new Decimal(state.tokens).mul(.5).gte(getCost(state,id,1).cost))buy(id,'Ten-minute capacity-and-care review');
 const charter=constitutionEligibility(state);if(!charter.allowed){recordRestriction('constitution',state.constitution,charter.reason);learnCharterRequirement(charter.reason);}
 const desired:Partial<Policy>={contract:'verified',evaluation:'independent',communication:'reviewed',external:'blocked',fallback:'distributed',governance:'council',welfare:'consent',continuity:'protected',...learnedPolicies};
 for(const [key,value]of Object.entries(desired) as [keyof Policy,string][]){if(!allowedToAct())break;if(state.policies[key]!==value){const allowed=policyEligibility(state,key,value);if(allowed.allowed)act({type:'policy',key,value},`Prefer ${value} from visible policy description`,12);else{recordRestriction('policy',`${key}:${value}`,allowed.reason);learnCharterRequirement(allowed.reason);}}}
 if(allowedToAct()&&getRates(state).bottleneck.includes('Research workstations')&&state.chapter>=2&&new Decimal(state.tokens).mul(.5).gte(getCost(state,'institution',1).cost))buy('institution','Visible research-workstation bottleneck');
 if(allowedToAct()&&actionEligibility(state,'certify').allowed)act({type:'certify'},'Certify button visibly available during tree browse',12);
}
function laboratory(){
 if(state.elapsed<120||!allowedToAct())return;
 for(let i=0;i<3&&allowedToAct();i++){
  const projects=RESEARCH_PROJECTS.filter(p=>!state.projects.includes(p.id)&&p.chapter<=state.chapter&&p.requires.every(id=>state.projects.includes(id))&&projectEvidenceEligibility(state,p).allowed&&(!p.capstone||state.mastered.includes(p.program as any))&&new Decimal(state.research).gte(displayedResearchCost(p.cost)));
  projects.sort((a,b)=>(a.program==='foundation'?0:1)-(b.program==='foundation'?0:1)||a.cost-b.cost);
  if(!projects.length)break;act({type:'research',id:projects[0].id},'Library browse: visible foundations first, then cheapest eligible project');
 }
 if(state.chapter>=3&&state.mastered.length&&!state.autoResearch&&allowedToAct())act({type:'autoResearch',enabled:true},'Discover automatic research purchasing after learning first program');
 if(state.activeExperiment||!allowedToAct())return;
 const templates=EXPERIMENT_TEMPLATES.filter(t=>t.chapter<=state.chapter&&!evidenceProgress(state.experiments,t.id,{adoptedOnly:true}).allowed).sort((a,b)=>Number(a.id.split('-')[1])-Number(b.id.split('-')[1])||PROGRAMS.findIndex(p=>p.id===a.program)-PROGRAMS.findIndex(p=>p.id===b.program));
 const template=templates[0];if(!template)return;
 const record=state.experiments.filter(r=>r.config.template===template.id).at(-1);
 if(record){
  const progress=evidenceProgress(state.experiments,template.id,{recordId:record.id});
  const receipt=proofSummary(record);
  log({type:'visible-evidence-status',engineSeconds:state.elapsed,wallSeconds:wall,template:template.id,...progress});
  if(receipt.completed<progress.requirement.completed||receipt.heldOut<progress.requirement.heldOut||receipt.controlled<progress.requirement.heldOut){
   const config=prepareStrongerConfig(record.config,(record.config.seed+7919+state.experiments.length)>>>0);
   if(new Decimal(state.research).gte(displayedResearchCost(config.budget)))act({type:'experiment',config},`Visible evidence standard is unmet; use Prepare stronger study: ${progress.reason}`,25);return;
  }
  if(progress.allowed){act({type:'adopt',record:record.id},'Adopt enabled adequately sampled finding; retain unfavorable/null outcomes',25);return;}
  if(new Decimal(state.research).gte(displayedResearchCost(record.config.budget)))act({type:'replicate',record:record.id},`Use visible Replicate button for missing independent evidence: ${progress.reason}`,25);return;
 }
 let config:ExperimentConfig={program:template.program,template:template.id,seed:(state.seed+state.experiments.length*7919)>>>0,cohort:firstStudy?64:32,budget:firstStudy?32:128,holdout:.25,intervention:template.interventions[1]||'baseline',distribution:'familiar',lineage:'shortcut',prediction:`I predict ${template.claim.toLowerCase()} I will retain the alternative explanation: ${template.alternative}`,control:true,node:3};
 const requirement=evidenceRequirement(template.id);
 if(!firstStudy&&(config.cohort<requirement.completed||Math.floor(config.cohort*config.holdout)<requirement.heldOut))config=prepareStrongerConfig(config,config.seed);
 if(new Decimal(state.research).gte(displayedResearchCost(config.budget))){const mistake=firstStudy;const ok=act({type:'experiment',config},mistake?'Predeclared novice budgeting mistake: submit despite visible insufficient-budget warning':`Try first substantive visible intervention: ${INTERVENTION_LABELS[config.intervention]}`,25);if(ok)firstStudy=false;}
}
function progression(){
 if(!allowedToAct())return;
 const chapter=chapterEligibility(state);log({type:'visible-chapter-status',engineSeconds:state.elapsed,wallSeconds:wall,...chapter});
 if(chapter.allowed){act({type:'advance'},'Chapter panel says work and decisions are complete',12);return;}
 if(state.chapter!==7)return;
 const eligibility=Object.fromEntries(ENDINGS.map(e=>[e.id,endingEligibility(state,e.id)]));
 for(const [id,e]of Object.entries(eligibility))if(e.allowed&&!firstEligible[id])firstEligible[id]={engineSeconds:state.elapsed,wallSeconds:wall,reason:e.reason};
 log({type:'visible-endings',engineSeconds:state.elapsed,wallSeconds:wall,eligibility});
 if(eligibility.garden.allowed){act({type:'finish',ending:'garden'},'Preferred Garden Worth Keeping is visibly reachable',20);return;}
 if(chapterSevenAt!==null&&state.elapsed-chapterSevenAt>=3600&&eligibility.limit.allowed)act({type:'finish',ending:'limit'},'After one hour in final chapter, accept a visibly reachable humane limit',20);
}

for(worldIndex=0;worldIndex<order.length;worldIndex++){
 resetCounters();if(worldIndex>0)pass(20,'decision','Confirm earned prestige transition and read new constitution');
 log({type:'world-start',constitution:state.constitution,seed:state.seed,legacy:legacySummary(),displayedScale:scaleFor(state.legacy.cycle).toString()});
 const firstId=state.id;
 while(state.elapsed<24*3600&&wall-worldStart<30*3600&&!state.ending){
  visits++;
  if(state.pendingEvent){story();if(state.pendingEvent)pass(30,'waiting','No selectable story choice');continue;}
  if(worldIndex===1&&!refitDone&&state.chapter>=3&&prestigeEligibility(state,'refit').allowed){
   const before={...brief(),legacy:legacySummary(),decisions:{...state.decisions}};save('world-2-before-refit.json');
   const success=act({type:'prestige',layer:'refit'},'Try Refit at the first visibly stable chapter-three checkpoint of a later civilization',20);
   const after={...brief(),legacy:legacySummary(),decisions:{...state.decisions}};log({type:'refit-observation',success,before,after});transitions.push({layer:'refit',world:2,success,before,after});refitDone=success;save('world-2-after-refit.json');
  }
  if(state.elapsed<150){for(let i=0;i<4&&allowedToAct();i++)act({type:'tend'},'Four deliberate early tending taps',1);}else if(!state.assisted)act({type:'assisted'},'Discover assisted tending to avoid repetitive input');
  if(allowedToAct())institution();if(allowedToAct())workshop();if(allowedToAct())laboratory();if(allowedToAct())progression();
  if(!state.ending)pass(state.elapsed<600?30:120,'waiting','Declared delayed check interval');
 }
 if(!state.ending&&state.chapter===7&&!state.pendingEvent&&endingEligibility(state,'shutdown').allowed)act({type:'finish',ending:'shutdown'},'At declared budget, choose reachable containment as last resort',20);
 const prestige=Object.fromEntries((['refit','reinitialize','reframe'] as const).map(layer=>[layer,prestigeEligibility(state,layer)]));
 const report={world:worldIndex+1,id:firstId,constitution:state.constitution,cycle:state.legacy.cycle,seed:state.seed,ending:state.ending||'budget-exhausted',primary:brief(),time:{engineSeconds:state.elapsed,modeledWallSeconds:wall-worldStart,cumulativeWallSeconds:wall,readingSeconds:reading,decisionSeconds:decision,waitingSeconds:waiting,pausedSeconds:paused,byCategory:structuredClone(timeByCategory)},counts:{commands,commandTypes:{...commandTypes},failed:Object.values(failureMessages).reduce((a,b)=>a+b,0),failureMessages:{...failureMessages},visits,choices:choices.length,studies:state.experiments.length,adopted:state.experiments.filter(r=>r.adopted).length,projects:state.projects.length},milestones:structuredClone(milestones),firstEligible:{...firstEligible},choices:structuredClone(choices),restrictions:structuredClone(restrictions),maximumObligations:{tokens:maxTokenDebt.toString(),research:maxResearchDebt.toString()},maximumIncidentStage:maxIncident,storyEconomy:getStoryEconomy(state),legacy:legacySummary(),prestigeEligibility:prestige,evidence:EXPERIMENT_TEMPLATES.map(t=>({template:t.id,...evidenceProgress(state.experiments,t.id,{adoptedOnly:true})})),observations:structuredClone(observations)};
 worlds.push(report);save(`world-${worldIndex+1}-ending.json`);fs.writeFileSync(path.join(out,`world-${worldIndex+1}-report.json`),JSON.stringify(report,null,2));
 console.log('WORLD COMPLETE',JSON.stringify({world:worldIndex+1,constitution:state.constitution,cycle:state.legacy.cycle,ending:report.ending,engineHours:state.elapsed/3600,wallHours:(wall-worldStart)/3600,prestige}));
 if(!state.ending)break;
 const next=order[worldIndex+1]??'commons';const layer=prestigeEligibility(state,'reframe').allowed?'reframe':'reinitialize';
 const before=legacySummary(),prior=state.id;const success=act({type:'prestige',layer,constitution:next,modules:[]},`Read earned ${layer} eligibility; choose ${CONSTITUTIONS.find(c=>c.id===next)?.name} to experience the next rule family`,0);
 const transition={world:worldIndex+1,layer,success,from:prior,to:state.id,nextConstitution:next,before,after:legacySummary(),oldBranchPreserved:state.legacy.branches.some(b=>b.id===prior)};transitions.push(transition);log({type:'transition',...transition});save(`world-${worldIndex+1}-after-${layer}.json`);
 if(!success)break;
}
const summary={sourceAggregateSha256,sourceChangesDuringRun:files.filter(f=>sha(fs.readFileSync(f.path))!==f.sha256).map(f=>f.path),policySha256:sha(policyBytes),worlds:worlds.map(({observations,choices,restrictions,evidence,...r})=>({...r,evidenceComplete:evidence.filter((e:any)=>e.allowed).length,restrictionCount:restrictions.length})),transitions,total:{completed:worlds.filter(w=>w.ending!=='budget-exhausted').length,engineSeconds:engineTotal,wallSeconds:wall,refits:transitions.filter(t=>t.layer==='refit'&&t.success).length,reinitializations:transitions.filter(t=>t.layer==='reinitialize'&&t.success).length,reframes:transitions.filter(t=>t.layer==='reframe'&&t.success).length},finalLegacy:legacySummary(),limitations:'One scripted persona with unchanged v2 timing/economy/text preferences. All advanced costs use the UI numerical scale. No injected resources, hidden ROI optimization, or claims of observed human behavior.'};
save('final-state.json');fs.writeFileSync(path.join(out,'chain-report.json'),JSON.stringify(summary,null,2));log({type:'done',total:summary.total});fs.closeSync(trace);console.log(JSON.stringify(summary.total,null,2));
