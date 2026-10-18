/** Same casual persona, adapted only to the revised visible evidence requirements. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import Decimal from 'decimal.js';
import {createGame,dispatchCommand,tick,getRates,getCost,getUpgradeCost,chapterEligibility,choiceEligibility,policyEligibility,actionEligibility,endingEligibility,prestigeEligibility} from '../../src/engine/index.ts';
import {PRODUCERS,UPGRADES} from '../../src/content/economy.ts';
import {STORY_EVENTS,ENDINGS,CHAPTERS} from '../../src/content/story.ts';
import {RESEARCH_PROJECTS} from '../../src/laboratory/projects.ts';
import {EXPERIMENT_TEMPLATES,INTERVENTION_LABELS,PROGRAMS} from '../../src/laboratory/experiments.ts';
import {evidenceRequirement,evidenceProgress,projectEvidenceEligibility,prepareStrongerConfig,proofSummary} from '../../src/laboratory/evidence.ts';
import {serializeSave,parseSave} from '../../src/persistence/validation.ts';
import type {Command,GameState,Policy,ExperimentConfig} from '../../src/contracts.ts';

const args=process.argv.slice(2),outIndex=args.indexOf('--out');
if(outIndex>=0&&!args[outIndex+1])throw new Error('--out needs an output directory.');
const outputRoot=path.resolve('qa/simulations-v2');
const out=path.resolve(outIndex>=0?args[outIndex+1]:'qa/simulations-v2/current');
if(!out.startsWith(outputRoot+path.sep))throw new Error('Keep v2 runs in a new child directory of qa/simulations-v2; original evidence is preserved.');
if(fs.existsSync(path.join(out,'casual-actions.jsonl')))throw new Error('This run directory already has a trace. Use a fresh --out directory to preserve each iteration.');
fs.mkdirSync(out,{recursive:true});
const policyBytes=fs.readFileSync(path.join(outputRoot,'casual-policy.json'));
const policy=JSON.parse(policyBytes.toString());
const sha=(v:string|Buffer)=>crypto.createHash('sha256').update(v).digest('hex');
fs.writeFileSync(path.join(out,'casual-policy.json'),policyBytes);
fs.copyFileSync(import.meta.filename,path.join(out,'casual-runner.ts.txt'));
const sourceFiles=(directory:string):string[]=>fs.readdirSync(directory,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?sourceFiles(path.join(directory,entry.name)):[path.join(directory,entry.name)]);
const sourceManifest=[...sourceFiles(path.resolve('src')),path.resolve('package.json'),path.resolve('package-lock.json')].sort().map(file=>({path:path.relative(process.cwd(),file).replaceAll('\\','/'),sha256:sha(fs.readFileSync(file))}));
const sourceAggregateSha256=sha(JSON.stringify(sourceManifest));
fs.writeFileSync(path.join(out,'casual-source-manifest.json'),JSON.stringify({sourceAggregateSha256,files:sourceManifest},null,2));
const now=Date.UTC(2026,9,15,16,0,0);
let state=createGame(1701,now),wall=0,reading=0,decision=0,waiting=0,paused=0,commands=0;
let visits=0,firstStudy=true,staleWarning=false,chapterSevenAt:number|null=null,chapterSevenWall:number|null=null;
let nextUpgrades=300,nextInstitutions=600,lastDrill=-100000,firstEligible:Record<string,unknown>={};
let maxTokenDebt=new Decimal(0),maxResearchDebt=new Decimal(0),maxIncident=0;
let previousChapter=1,lastStatusHour=-1;
const timeByCategory:Record<string,{requestedSeconds:number;engineSeconds:number;pausedSeconds:number}>={};
const commandTypes:Record<string,number>={},failureMessages:Record<string,number>={};
const choices:unknown[]=[],milestones:unknown[]=[{chapter:1,engineSeconds:0,wallSeconds:0}],incidents:unknown[]=[],observations:unknown[]=[];
const seenJournal=new Set<string>(),seenRecords=new Set<string>();
const tracePath=path.join(out,'casual-actions.jsonl');
const trace=fs.openSync(tracePath,'w');
const log=(data:unknown)=>fs.writeSync(trace,JSON.stringify(data)+'\n');
log({type:'init',seed:1701,now,policySha256:sha(policyBytes),policyId:policy.id,sourceAggregateSha256});
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
 const before=state.elapsed;state=tick(state,seconds);wall+=seconds;const actual=state.elapsed-before;paused+=Math.max(0,seconds-actual);
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
 const desired:Partial<Policy>={contract:'verified',evaluation:'independent',communication:'reviewed',external:'blocked',fallback:'distributed',governance:'council',welfare:'consent',continuity:'protected'};
 for(const [key,value]of Object.entries(desired) as [keyof Policy,string][]){if(!allowedToAct())break;if(state.policies[key]!==value&&policyEligibility(state,key,value).allowed)act({type:'policy',key,value},`Prefer ${value} from visible policy description`,12);}
 if(allowedToAct()&&getRates(state).bottleneck.includes('Research workstations')&&state.chapter>=2&&new Decimal(state.tokens).mul(.5).gte(getCost(state,'institution',1).cost))buy('institution','Visible research-workstation bottleneck');
 if(allowedToAct()&&actionEligibility(state,'certify').allowed)act({type:'certify'},'Certify button visibly available during tree browse',12);
}
function laboratory(){
 if(state.elapsed<120||!allowedToAct())return;
 for(let i=0;i<3&&allowedToAct();i++){
  const projects=RESEARCH_PROJECTS.filter(p=>!state.projects.includes(p.id)&&p.chapter<=state.chapter&&p.requires.every(id=>state.projects.includes(id))&&projectEvidenceEligibility(state,p).allowed&&(!p.capstone||state.mastered.includes(p.program as any))&&new Decimal(state.research).gte(p.cost));
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
   if(new Decimal(state.research).gte(config.budget))act({type:'experiment',config},`Visible evidence standard is unmet; use Prepare stronger study: ${progress.reason}`,25);return;
  }
  if(progress.allowed){act({type:'adopt',record:record.id},'Adopt enabled adequately sampled finding; retain unfavorable/null outcomes',25);return;}
  if(new Decimal(state.research).gte(record.config.budget))act({type:'replicate',record:record.id},`Use visible Replicate button for missing independent evidence: ${progress.reason}`,25);return;
 }
 let config:ExperimentConfig={program:template.program,template:template.id,seed:(state.seed+state.experiments.length*7919)>>>0,cohort:firstStudy?64:32,budget:firstStudy?32:128,holdout:.25,intervention:template.interventions[1]||'baseline',distribution:'familiar',lineage:'shortcut',prediction:`I predict ${template.claim.toLowerCase()} I will retain the alternative explanation: ${template.alternative}`,control:true,node:3};
 const requirement=evidenceRequirement(template.id);
 if(!firstStudy&&(config.cohort<requirement.completed||Math.floor(config.cohort*config.holdout)<requirement.heldOut))config=prepareStrongerConfig(config,config.seed);
 if(new Decimal(state.research).gte(config.budget)){const mistake=firstStudy;const ok=act({type:'experiment',config},mistake?'Predeclared novice budgeting mistake: submit despite visible insufficient-budget warning':`Try first substantive visible intervention: ${INTERVENTION_LABELS[config.intervention]}`,25);if(ok)firstStudy=false;}
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

while(state.elapsed<24*3600&&wall<30*3600&&!state.ending){
 visits++;
 if(state.pendingEvent){story();if(state.pendingEvent){pass(30,'waiting','No selectable story choice');}continue;}
 if(state.elapsed<150){for(let i=0;i<4&&allowedToAct();i++)act({type:'tend'},'Four deliberate early tending taps',1);}
 else if(!state.assisted)act({type:'assisted'},'Discover assisted tending to avoid repetitive input');
 if(allowedToAct())institution();
 if(allowedToAct())workshop();
 if(allowedToAct())laboratory();
 if(allowedToAct())progression();
 if(!state.ending)pass(state.elapsed<600?30:120,'waiting','Declared delayed check interval');
}
if(!state.ending&&state.chapter===7&&!state.pendingEvent&&endingEligibility(state,'shutdown').allowed)act({type:'finish',ending:'shutdown'},'At declared budget, choose reachable containment as last resort',20);
const primary=brief();const primaryEnding=state.ending;
const timingAtEndpoint={readingSeconds:reading,decisionSeconds:decision,waitingSeconds:waiting,pausedOrDiscardedTickSeconds:paused};
const timeCategoriesAtEndpoint=structuredClone(timeByCategory);
const commandsAtEndpoint=commands,commandTypesAtEndpoint={...commandTypes};
const primaryMilestones=milestones.slice();
const prestiges=Object.fromEntries((['refit','reinitialize','reframe'] as const).map(layer=>[layer,prestigeEligibility(state,layer)]));
const finalPrimaryState=state;
const primarySave=serializeSave(state,now+Math.round(wall*1000));
const valid=parseSave(primarySave);if(!valid.ok)throw new Error(`Primary save invalid: ${JSON.stringify(valid)}`);
fs.writeFileSync(path.join(out,'casual-final.json'),primarySave);
const priorId=state.id;let reinitialized=false;
if(prestiges.reinitialize.allowed)reinitialized=act({type:'prestige',layer:'reinitialize',constitution:'precaution',modules:[]},'First earned ending: preserve this world and try Public Precaution',20);
const reinitSave=serializeSave(state,now+Math.round(wall*1000));
if(!parseSave(reinitSave).ok)throw new Error('Reinitialized save invalid');
fs.writeFileSync(path.join(out,'casual-after-prestige.json'),reinitSave);
const result={policyId:policy.id,policySha256:sha(policyBytes),runnerSha256:sha(fs.readFileSync(import.meta.filename)),sourceAggregateSha256,sourceChangesDuringRun:sourceManifest.filter(file=>sha(fs.readFileSync(file.path))!==file.sha256).map(file=>file.path),startedAt:now,seed:1701,constitution:'commons',modules:[],simulationSpeed:1,
 outcome:primaryEnding||'budget-exhausted',primary,chapterSevenAt,chapterSevenWall,firstEligible,milestones:primaryMilestones,prestigeEligibility:prestiges,reinitialized,preservedOldBranch:state.legacy.branches.some(b=>b.id===priorId&&b.ending===primaryEnding),postPrestige:{chapter:state.chapter,constitution:state.constitution,seed:state.seed,branches:state.legacy.branches.length,legacy:{...state.legacy,branches:state.legacy.branches.map(({checkpoint,...branch})=>({...branch,hasCheckpoint:Boolean(checkpoint)}))}},
 time:{engineSeconds:primary.engineSeconds,modeledWallSecondsBeforePrestige:primary.wallSeconds,modeledWallSecondsIncludingPrestige:wall,...timingAtEndpoint,byCategory:timeCategoriesAtEndpoint,checkVisits:visits,postPrestigeDecisionSeconds:decision-timingAtEndpoint.decisionSeconds},
 counts:{attemptedCommands:commandsAtEndpoint,commandTypes:commandTypesAtEndpoint,commandsIncludingPrestige:commands,failedCommands:Object.values(failureMessages).reduce((a,b)=>a+b,0),failureMessages,storyChoices:choices.length,experiments:finalPrimaryState.experiments.length,adopted:finalPrimaryState.experiments.filter(r=>r.adopted).length,replicatedRecords:finalPrimaryState.experiments.filter(r=>r.replicated).length,studiesWithoutHoldout:observations.filter((r:any)=>r.holdouts===0).length,compactedEmptyObservationRecords:finalPrimaryState.experiments.filter(r=>!r.observations.length).length,projects:finalPrimaryState.projects.length,mastered:finalPrimaryState.mastered.length,producerUnits:Object.values(finalPrimaryState.producers).reduce((a,b)=>a+b,0),upgrades:finalPrimaryState.upgrades.length},
 maximumObligations:{tokens:maxTokenDebt.toString(),research:maxResearchDebt.toString()},maximumIncidentStage:maxIncident,incidents,choices,experimentObservations:observations,evidenceAtEndpoint:EXPERIMENT_TEMPLATES.map(template=>({template:template.id,...evidenceProgress(finalPrimaryState.experiments,template.id,{adoptedOnly:true})})),
 finalChapterEligibility:chapterEligibility(finalPrimaryState),finalEndingEligibility:Object.fromEntries(ENDINGS.map(e=>[e.id,endingEligibility(finalPrimaryState,e.id)])),
 limitation:'One deterministic scripted persona. UI information is read from exported catalogues and public selector functions, not physically through browser controls. Predeclared mistake, reading rate, purchase heuristics, and checking cadence are assumptions, not evidence about real users. No game source changes or outcome-driven policy retuning.'};
fs.writeFileSync(path.join(out,'casual-report.json'),JSON.stringify(result,null,2));
log({type:'done',outcome:result.outcome,engineSeconds:primary.engineSeconds,wallSeconds:wall,reinitialized});fs.closeSync(trace);
console.log(JSON.stringify({outcome:result.outcome,time:result.time,counts:result.counts,prestiges,reinitialized,preservedOldBranch:result.preservedOldBranch},null,2));
