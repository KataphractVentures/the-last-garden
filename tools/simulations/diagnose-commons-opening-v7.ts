import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import Decimal from 'decimal.js';
import {createGame,dispatchCommand,tick,getRates,chapterEligibility,endingEligibility} from '../../src/engine/index.ts';
import {scaleFor} from '../../src/engine/amounts.ts';
import {STORY_EVENTS} from '../../src/content/story.ts';
import {activeExperimentTemplates,activeResearchProjects} from '../../src/laboratory/catalog.ts';
import {activeProgramIds} from '../../src/laboratory/programs.ts';
import {evidenceProgress,evidenceRequirement,projectEvidenceEligibility,prepareStrongerConfig,proofSummary} from '../../src/laboratory/evidence.ts';
import {plannedExperimentCost} from '../../src/laboratory/experiments.ts';
import {getCharterActions} from '../../src/constitution/economics.ts';
import type {ExperimentConfig} from '../../src/contracts.ts';
const directory=path.resolve('qa/opening-v7/pacing/final');
const output=path.resolve('qa/opening-v7/pacing/commons-diagnosis');
if(fs.existsSync(output))throw new Error('Preserve diagnosis outputs.');fs.mkdirSync(output,{recursive:true});
const rows=fs.readFileSync(path.join(directory,'actions.jsonl'),'utf8').trim().split('\n').map(line=>JSON.parse(line)).filter(row=>row.world===1);
const initial=rows.find(row=>row.type==='init');let state=createGame(initial.seed,initial.now),firstStudy=true;
const waits:any[]=[],spending:any[]=[],samples:any[]=[],chapters:any[]=[];
const stronger=(config:ExperimentConfig,seed:number)=>{const draft=prepareStrongerConfig(config,seed);return {...draft,budget:Math.max(draft.budget,2**Math.ceil(Math.log2(plannedExperimentCost(draft))))};};
function nextStudy(){
 const programs=activeProgramIds(state.constitution);
 const templates=activeExperimentTemplates(state.constitution).filter(t=>t.chapter<=state.chapter&&!evidenceProgress(state.experiments,t.id,{adoptedOnly:true}).allowed).sort((a,b)=>Number(a.id.split('-')[1])-Number(b.id.split('-')[1])||programs.indexOf(a.program)-programs.indexOf(b.program));
 const template=templates[0];if(!template)return null;
 const record=state.experiments.filter(r=>r.config.template===template.id).at(-1);
 if(record){
  const progress=evidenceProgress(state.experiments,template.id,{recordId:record.id}),receipt=proofSummary(record);
  if(receipt.completed<progress.requirement.completed||receipt.heldOut<progress.requirement.heldOut||receipt.controlled<progress.requirement.heldOut){const config=stronger(record.config,(record.config.seed+7919+state.experiments.length)>>>0);return {template:template.id,action:'stronger',budget:config.budget};}
  return {template:template.id,action:progress.allowed?'adopt':'replicate',budget:progress.allowed?0:record.config.budget};
 }
 let config:ExperimentConfig={program:template.program,template:template.id,seed:(state.seed+state.experiments.length*7919)>>>0,cohort:firstStudy?64:32,budget:firstStudy?32:128,holdout:.25,intervention:template.interventions[1]||'baseline',distribution:'familiar',lineage:'shortcut',prediction:'Diagnosis only; no experiment is submitted from this reconstruction.',control:true,node:3};
 const requirement=evidenceRequirement(template.id);if(!firstStudy&&(config.cohort<requirement.completed||Math.floor(config.cohort*config.holdout)<requirement.heldOut||plannedExperimentCost(config)>config.budget))config=stronger(config,config.seed);
 return {template:template.id,action:'experiment',budget:config.budget};
}
function snapshot(wall:number){
 const rates=getRates(state),scale=scaleFor(state.legacy.cycle),study=nextStudy();
 const candidates=activeResearchProjects(state.constitution).filter(p=>!state.projects.includes(p.id)&&p.chapter<=state.chapter&&p.requires.every(id=>state.projects.includes(id))&&projectEvidenceEligibility(state,p).allowed&&(!p.capstone||state.mastered.includes(p.program as any))).sort((a,b)=>a.cost-b.cost);
 const nextProject=candidates[0];
 const character=state.charter?.kind==='commons'?state.charter.data:null;
 const spendableResearch=new Decimal(state.research).div(scale).toNumber();
 return {chapter:state.chapter,wallSeconds:wall,engineSeconds:state.elapsed,tokens:new Decimal(state.tokens).div(scale).toNumber(),research:spendableResearch,lifetime:new Decimal(state.lifetime).div(scale).toNumber(),projects:state.projects.length,pending:state.pendingEvent,active:state.activeExperiment?{template:state.activeExperiment.config.template,remaining:state.activeExperiment.remaining}:null,study,studyFunded:!study||spendableResearch>=study.budget,nextProject:nextProject?{id:nextProject.id,cost:nextProject.cost,funded:spendableResearch>=nextProject.cost}:null,chapterGate:chapterEligibility(state).reason,endingGate:state.chapter===7?endingEligibility(state,'garden').reason:null,rates:{tokens:new Decimal(rates.tokens).div(scale).toNumber(),research:new Decimal(rates.research).div(scale).toNumber(),utilization:rates.utilization,bottleneck:rates.bottleneck,charter:rates.charter},methods:character?.methods.map(m=>({id:m.id,program:m.program,maintenance:m.maintenance,uses:m.uses,dependencies:m.dependencies})),credits:character?.credits,researchCostQuotes:getCharterActions(state).filter(q=>q.allowed).map(q=>({action:q.action,cost:q.cost,researchCost:q.researchCost}))};
}
for(const row of rows){
 if(row.type==='command'){
  if(row.command.type==='prestige')break;
  const beforeTokens=new Decimal(state.tokens),beforeResearch=new Decimal(state.research),chapter=state.chapter;
  const result=dispatchCommand(state,row.command);assert.equal(result.ok,row.ok);assert.equal(result.message,row.message);state=result.state;
  if(row.command.type==='experiment'&&result.ok)firstStudy=false;
  if(row.command.type==='advance')chapters.push(snapshot(row.wallSeconds));
  const dt=beforeTokens.sub(state.tokens).toNumber(),dr=beforeResearch.sub(state.research).toNumber();
  if(dt!==0||dr!==0)spending.push({chapter,wallSeconds:row.wallSeconds,engineSeconds:row.engineSeconds,type:row.command.type,id:row.command.id??row.command.event??row.command.action??row.command.config?.template??row.command.record??'',tokensDelta:-dt,researchDelta:-dr});
 }else if(row.type==='tick'){
  if(row.category==='waiting')waits.push({...snapshot(row.wallSeconds-row.seconds),requestedSeconds:row.seconds,actualSeconds:row.actualSeconds,pausedSeconds:row.seconds-row.actualSeconds});
  const previous=state.elapsed;state=tick(state,row.seconds);assert.equal(state.elapsed-previous,row.actualSeconds);
 }
 if(row.type==='visible-charter-choice'||row.type==='visible-evidence-status')samples.push(snapshot(row.wallSeconds));
}
const expected=JSON.parse(fs.readFileSync(path.join(directory,'world-1-ending.json'),'utf8')).state;
assert.deepEqual(JSON.parse(JSON.stringify(state)),expected,'World1 replay must match its earned ending.');
const add=(group:Record<string,any>,key:string,row:any)=>{const item=group[key]??={intervals:0,requestedSeconds:0,actualSeconds:0,pausedSeconds:0};item.intervals++;item.requestedSeconds+=row.requestedSeconds;item.actualSeconds+=row.actualSeconds;item.pausedSeconds+=row.pausedSeconds;};
const groups:Record<string,any>={},byChapter:Record<string,any>={},overlaps:Record<string,any>={};
for(const row of waits){
 let key=row.pending?'pending-decision':row.active?'active-study':row.study&&!row.studyFunded?'research-funding':row.study?'funded-study-or-adoption-awaits-next-check':row.nextProject&&!row.nextProject.funded?'project-funding':'no-unfinished-available-study';
 add(groups,key,row);add(byChapter,String(row.chapter),row);
 if(!row.pending&&!row.active&&row.study&&!row.studyFunded)add(overlaps,`research-funding-chapter-${row.chapter}`,row);
 if(!row.pending&&row.chapterGate.startsWith('Earn '))add(overlaps,`lifetime-token-gate-chapter-${row.chapter}`,row);
 if(row.rates.bottleneck.includes('pledged'))add(overlaps,`pledged-income-chapter-${row.chapter}`,row);
}
const spends:Record<string,any>={};for(const row of spending){const key=`${row.chapter}:${row.type}`;const item=spends[key]??={tokensSpent:0,researchSpent:0,tokensReceived:0,researchReceived:0,count:0};item.count++;item.tokensSpent+=Math.max(0,-row.tokensDelta);item.researchSpent+=Math.max(0,-row.researchDelta);item.tokensReceived+=Math.max(0,row.tokensDelta);item.researchReceived+=Math.max(0,row.researchDelta);}
const result={source:'33523f98ca441c6e1310564479abeb2994d3ad5009c183db98b4672a1e0089e3',world1CheckpointExactlyReplayed:true,groups,byChapter,overlaps,spends,chapters,waits,samples,spending,limitations:['Classifications describe state at the start of each predeclared wait, not a causal counterfactual or proof the whole wait was unavoidable.','Research funding uses the existing persona budget reservation. An available funded study or adoption is a fixed check cadence cost, not necessarily a resource bottleneck.','Command wallet changes exclude later story-debt repayment and include possible grants/refunds. They are not a complete income statement.']};
fs.writeFileSync(path.join(output,'diagnosis.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({world1CheckpointExactlyReplayed:true,groups,byChapter,overlaps,spends},null,2));
