/** Read-only presentation checks. Earned checkpoints are never modified in place. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';
import type {GameState,ConstitutionId} from '../../src/contracts';

const root=process.cwd(),args=process.argv.slice(2),options:Record<string,string>={};
for(let index=0;index<args.length;index+=2){assert(['--manifest','--output'].includes(args[index]),`Unknown option ${args[index]}`);assert(args[index+1],`${args[index]} needs a value`);options[args[index]]=args[index+1];}
const output=resolve(root,options['--output']??'qa/experience-v6/review');
await mkdir(output,{recursive:true});
const files=['src/App.tsx','src/ui/CivilizationPanel.tsx','src/ui/civilization.css','src/society/SocietyPanel.tsx','src/society/society.css','src/governance/GovernancePanel.tsx','src/governance/governance.css','src/laboratory/LaboratoryPanel.tsx','src/laboratory/laboratory.css','src/laboratory/workflow.css','src/laboratory/automation.css'];
const sha=(bytes:string|Buffer)=>createHash('sha256').update(bytes).digest('hex');
const freezePath=options['--manifest']??'qa/experience-v6/source-freeze.json';
const freeze=JSON.parse(await readFile(resolve(root,freezePath),'utf8'));
for(const item of freeze.files)assert.equal(sha(await readFile(resolve(root,item.path))),item.sha256,`Frozen source changed before review: ${item.path}`);
const before=await Promise.all(files.map(async file=>({file,sha256:sha(await readFile(join(root,file)))})));
type Element={tag:string;attrs:Record<string,string>;children:Element[];text:string};
const decode=(value:string)=>value.replaceAll('&amp;','&').replaceAll('&quot;','"').replaceAll('&#x27;',"'").replaceAll('&#39;',"'").replaceAll('&lt;','<').replaceAll('&gt;','>');
function parse(html:string){
  const tree:Element={tag:'root',attrs:{},children:[],text:''},stack=[tree];
  for(const token of html.match(/<[^>]+>|[^<]+/g)??[]){
    if(token.startsWith('</')){stack.pop();continue;}
    if(token.startsWith('<')){
      if(token.startsWith('<!'))continue;
      const tag=token.match(/^<([\w-]+)/)?.[1]??'',attrs:Record<string,string>={};
      for(const match of token.matchAll(/([\w:-]+)(?:="([^"]*)")?/g)){if(match.index===1)continue;attrs[match[1]]=decode(match[2]??'');}
      const item:Element={tag,attrs,children:[],text:''};stack.at(-1)!.children.push(item);
      if(!['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr'].includes(tag)&&!token.endsWith('/>'))stack.push(item);
    }else stack.at(-1)!.text+=decode(token);
  }
  return tree;
}
const all=(node:Element):Element[]=>[node,...node.children.flatMap(all)];
const txt=(node:Element):string=>(node.text+' '+node.children.map(txt).join(' ')).replace(/\s+/g,' ').trim();
const cls=(node:Element,name:string)=>(node.attrs.class??'').split(' ').includes(name);
const disabled=(node:Element)=>Object.hasOwn(node.attrs,'disabled');
const byClass=(node:Element,name:string)=>all(node).filter(item=>cls(item,name));
const issues:{case:string;check:string;actual?:unknown;expected?:unknown}[]=[],cases:{id:string;kind:string;assertions:number}[]=[];
let count=0;
function check(id:string,label:string,pass:boolean,actual?:unknown,expected?:unknown){count++;if(!pass)issues.push({case:id,check:label,actual,expected});}
const noDispatch=()=>{throw new Error('Rendering attempted a gameplay command');};
const server=await createServer({root,server:{middlewareMode:true,hmr:false},appType:'custom',logLevel:'error'});
try{
  const {GovernancePanel}=await server.ssrLoadModule('/src/governance/GovernancePanel.tsx');
  const {SocietyPanel}=await server.ssrLoadModule('/src/society/SocietyPanel.tsx');
  const {LaboratoryPanel}=await server.ssrLoadModule('/src/laboratory/LaboratoryPanel.tsx');
  const g=await server.ssrLoadModule('/src/governance/index.ts'),s=await server.ssrLoadModule('/src/society/index.ts');
  const engine=await server.ssrLoadModule('/src/engine/index.ts'),evidence=await server.ssrLoadModule('/src/laboratory/evidence.ts');
  const amounts=await server.ssrLoadModule('/src/engine/amounts.ts');
  const studies=await server.ssrLoadModule('/src/laboratory/experiments.ts');
  const sourceInputs:{file:string;sha256:string}[]=[];
  async function load(file:string){const bytes=await readFile(resolve(root,file),'utf8');sourceInputs.push({file,sha256:sha(bytes)});const parsed=JSON.parse(bytes);return(parsed.state??parsed) as GameState;}
  async function renderCase(id:string,kind:string,state:GameState){
    const original=JSON.stringify(state),start=count,locked=Boolean(state.ending||state.paused),labLocked=locked||Boolean(state.pendingEvent);
    const htmls={governance:renderToStaticMarkup(React.createElement(GovernancePanel,{state,dispatch:noDispatch})),society:renderToStaticMarkup(React.createElement(SocietyPanel,{state,dispatch:noDispatch})),laboratory:renderToStaticMarkup(React.createElement(LaboratoryPanel,{state,dispatch:noDispatch,initialProgram:'control'}))};
    const trees={governance:parse(htmls.governance),society:parse(htmls.society),laboratory:parse(htmls.laboratory)};
    for(const [surface,tree]of Object.entries(trees)){
      check(id,`${surface}: no nonfinite/missing display values`,!/(?:\bNaN\b|\bundefined\b|\bInfinity\b)/.test(txt(tree)));
      for(const button of all(tree).filter(item=>item.tag==='button'))check(id,`${surface}: button has accessible text`,Boolean(txt(button)||button.attrs['aria-label']));
      for(const details of all(tree).filter(item=>item.tag==='details'))check(id,`${surface}: disclosure starts with named summary`,details.children[0]?.tag==='summary'&&Boolean(txt(details.children[0])));
      for(const progress of all(tree).filter(item=>item.tag==='progress'))check(id,`${surface}: native progress is named and bounded`,Boolean(progress.attrs['aria-label'])&&Number(progress.attrs.value)>=0&&Number(progress.attrs.value)<=Number(progress.attrs.max));
    }
    const gd=g.governanceState(state),gb=all(trees.governance).filter(item=>item.tag==='button'),expected=[];
    if(gd.mandate==='none')expected.push(g.publicMandateEligibility(state));
    for(const boundary of ['external','communication']){const review=g.scopeReview(state,boundary);for(const target of ['reviewed','open']){if(target==='open'?state.policies[boundary as 'external']==='open':['reviewed','open'].includes(state.policies[boundary as 'external']))continue;expected.push(g.scopeReviewEligibility(state,boundary,target,review?.target===target&&review.from===state.policies[boundary as 'external']&&review.status==='refused'));}}
    for(const terms of g.COMPACT_TERMS)expected.push(g.compactEligibility(state,terms.id));
    if(gd.actor.terms!=='none')expected.push(g.compactVerificationEligibility(state),g.compactEligibility(state,'none'));
    check(id,'All public authority actions represented',gb.length===expected.length,gb.length,expected.length);
    gb.forEach((button,index)=>{check(id,`Public action ${index}: engine admission/lock agrees`,disabled(button)===(locked||!expected[index]?.allowed));check(id,`Public action ${index}: disabled reason available`,!disabled(button)||Boolean(button.attrs.title));});
    const requirementRows=all(trees.governance).find(item=>item.tag==='tbody')?.children??[];
    const numericCriteria=[['Evidence',state.metrics.evidence,[40,70],false],['Recall',state.metrics.recall,[65,85],false],['Human agency',state.metrics.agency,[55,65],false],['Review queue',state.metrics.reviewQueue,[45,25],true]] as const;
    for(const [label,value,thresholds,atMost]of numericCriteria){const row=requirementRows.find(item=>txt(item.children[0])===label),shown=row?Number(txt(row.children[1])):NaN;for(const threshold of thresholds)check(id,`${label}: displayed value cannot imply wrong threshold result at ${threshold}`,Number.isFinite(shown)&&(atMost?shown<=threshold:shown>=threshold)===(atMost?value<=threshold:value>=threshold));}
    byClass(trees.governance,'public-terms').forEach((card,index)=>{
      const terms=g.COMPACT_TERMS[index],effects=g.governanceEffects({...state,governance:{...gd,actor:{...gd.actor,terms:terms.id,verified:true}}});
      const costs=byClass(card,'public-costs')[0];
      const pairs=Object.fromEntries(costs.children.map(row=>[txt(row.children[0]),txt(row.children[1])]));
      check(id,`${terms.id}: research and review costs reflect engine`,pairs['Research / review']===`−${Math.round((1-effects.researchMultiplier)*100)}% / −${Math.round((1-effects.reviewMultiplier)*100)}%`);
      check(id,`${terms.id}: service cost reflects engine`,pairs['Service output']===(effects.serviceMultiplier===1?'Unchanged':`−${Math.round((1-effects.serviceMultiplier)*100)}%`));
      check(id,`${terms.id}: agency effect reflects engine`,pairs['Agency target']===`${effects.agencyDelta>0?'+':''}${effects.agencyDelta}`);
    });
    const sv=s.societyView(state),decisions=s.availableSocietyDecisions(state),requests=s.availableSocietyCases(state);
    const needsResponse=(def:any)=>{const record=sv.cases.find((item:any)=>item.id===def.id);return!record.response||(record.response==='comply'&&!record.repaired)||(record.response==='appeal'&&record.resolvedAt!==null&&state.elapsed-record.resolvedAt<60);};
    const expectedSociety:any[]=[];
    const addDecision=(decision:any)=>{for(const option of decision.options)expectedSociety.push({quote:s.societyDecisionQuote(state,decision.id,option.id),active:sv.decisions[decision.id]===option.id});};
    const addRequest=(def:any)=>{const record=sv.cases.find((item:any)=>item.id===def.id);if(!record.response)for(const option of def.options)expectedSociety.push({quote:s.societyCaseQuote(state,def.id,option.id)});else if(record.response==='comply'&&!record.repaired&&record.repairStartedAt===null)expectedSociety.push({quote:s.societyRepairQuote(state,def.id)});};
    decisions.filter((d:any)=>!sv.decisions[d.id]).forEach(addDecision);requests.filter(needsResponse).forEach(addRequest);decisions.filter((d:any)=>sv.decisions[d.id]).forEach(addDecision);requests.filter((d:any)=>!needsResponse(d)).forEach(addRequest);
    const sb=all(trees.society).filter(item=>item.tag==='button');
    check(id,'Every community operation represented',sb.length===expectedSociety.length,sb.length,expectedSociety.length);
    sb.forEach((button,index)=>{const expected=expectedSociety[index];check(id,`Community action ${index}: admission/lock agrees`,Boolean(expected)&&disabled(button)===(locked||!expected.quote.allowed));check(id,`Community action ${index}: explanation available`,Boolean(button.attrs.title));if(expected?.active!==undefined)check(id,`Community action ${index}: current choice exposed`,button.attrs['aria-pressed']===String(expected.active));if(expected&&!expected.active)check(id,`Community action ${index}: current cost shown before commitment`,txt(button).includes(amounts.formatAmount(expected.quote.cost)));});
    const ledger=byClass(trees.society,'society-ledger')[0];
    check(id,'Current ongoing levy matches engine',txt(ledger).includes(`${Number((s.societyEffects(state).levy*100).toFixed(2))}%`));
    const meters=all(trees.society).filter(item=>item.attrs.role==='meter'),expectedMeters=sv.communities.flatMap((c:any)=>[c.income,c.access,...(c.transition>.1?[c.transition]:[]),c.projectContinuity,c.meaning]);
    check(id,'All visible community outcomes have meters',meters.length===expectedMeters.length,meters.length,expectedMeters.length);
    meters.forEach((meter,index)=>check(id,`Community meter ${index}: exact value and accessible range`,Number(meter.attrs['aria-valuenow'])===Math.min(100,Math.max(0,expectedMeters[index]))&&meter.attrs['aria-valuemin']==='0'&&meter.attrs['aria-valuemax']==='100'&&Boolean(meter.attrs['aria-label'])&&Boolean(meter.attrs['aria-valuetext'])));
    for(const community of byClass(trees.society,'society-community'))for(const meter of byClass(community,'society-meter')){const track=byClass(meter,'society-meter-track')[0],floor=track.attrs['aria-label']==='Household resources'?35:track.attrs['aria-label']==='Essential access'?40:null;if(floor!==null){const shown=Number(track.attrs['aria-valuetext'].split(' ')[0]),actual=Number(track.attrs['aria-valuenow']);check(id,`Community ${track.attrs['aria-label']}: shown value agrees with floor`,(shown>=floor)===(actual>=floor));}}
    const ltree=trees.laboratory,run=byClass(ltree,'lab-run-strip')[0],runButton=all(run).find(item=>item.tag==='button');
    check(id,'Study start has a visible reserved cost and duration',txt(run).includes('research reserved')&&txt(run).includes('simulation seconds'));
    const availableTemplates=studies.EXPERIMENT_TEMPLATES.filter((item:any)=>item.program==='control'&&item.chapter<=state.chapter);
    const nextTemplate=availableTemplates.find((item:any)=>!state.experiments.some(record=>record.config.template===item.id&&record.adopted))??availableTemplates.at(-1)??studies.EXPERIMENT_TEMPLATES.find((item:any)=>item.program==='control');
    const config={program:'control',template:nextTemplate.id,seed:(state.seed+state.experiments.length*7919)>>>0,cohort:32,budget:128,holdout:.25,intervention:nextTemplate.interventions[0],distribution:'familiar',lineage:'shortcut',prediction:'',control:true,node:3};
    const selectedStudy=byClass(ltree,'lab-study-menu').flatMap(all).find(item=>item.tag==='button'&&cls(item,'is-active'));
    check(id,'Default study is the first available unadopted study, or final available study',Boolean(selectedStudy)&&txt(selectedStudy!).includes(nextTemplate.title));
    const template=studies.EXPERIMENT_TEMPLATES.find((item:any)=>item.id===config.template),affordable=amounts.decimal(state.research).gte(amounts.scaleFor(engine.worldCycle(state)).mul(studies.experimentCost(config)));
    check(id,'Study start respects lock, chapter, active work, protocol and funding',Boolean(runButton)&&disabled(runButton!)===(labLocked||template.chapter>state.chapter||Boolean(state.activeExperiment)||Boolean(state.experimentAutomation)||Boolean(studies.validateExperimentConfig(config))||!affordable));
    const batch=byClass(ltree,'lab-automation-controls')[0];
    if(batch){const source=state.experiments.filter(record=>record.config.program==='control'&&record.adopted&&state.mastered.includes('control')&&record.config.control&&record.config.holdout>=.2).at(-1)!;const budget=amounts.scaleFor(engine.worldCycle(state)).mul(source.config.budget*3),afford=amounts.decimal(state.research).gte(budget),start=all(batch).find(item=>item.tag==='button');check(id,'Study batch start respects available research as well as lock',Boolean(start)&&disabled(start!)===(labLocked||Boolean(state.activeExperiment)||!afford));}
    const selected=[...state.experiments].reverse().find(record=>record.config.program==='control');
    const result=byClass(ltree,'lab-result')[0];
    if(selected&&result){const actions=byClass(result,'lab-actions').flatMap(all).filter(item=>item.tag==='button');const replicate=actions.find(item=>txt(item).startsWith('Replicate with')),adopt=actions.find(item=>/Adopt bounded|Protocol adopted/.test(txt(item)));const proof=evidence.proofSummary(selected);check(id,'Record replication respects actual sample and active work',Boolean(replicate)&&disabled(replicate!)===(labLocked||!proof.heldOut||Boolean(state.activeExperiment)||Boolean(state.experimentAutomation)));check(id,'Adoption respects actual independent evidence',Boolean(adopt)&&disabled(adopt!)===(labLocked||selected.adopted||!evidence.evidenceProgress(state.experiments,selected.config.template,{recordId:selected.id}).allowed));}
    check(id,'Rendering does not mutate game state',JSON.stringify(state)===original);
    cases.push({id,kind,assertions:count-start});
  }
  const earned:GameState[]=[];
  for(const [index,constitution]of (['commons','precaution','service','federation','plural','frontier'] as ConstitutionId[]).entries()){
    const state=await load(`qa/simulations-v5/casual/final/world-${index+1}-before-ending.json`);assert.equal(state.constitution,constitution);earned.push(state);
    await renderCase(`${constitution}-earned`,'Unmodified earned v5 checkpoint',state);
    await renderCase(`${constitution}-paused`,'Explicit presentation variant: paused',{...structuredClone(state),paused:true});
    await renderCase(`${constitution}-ended`,'Explicit presentation variant: complete',{...structuredClone(state),ending:'garden',endingTime:state.elapsed});
  }
  for(const file of ['chapter-3-before-public-decisions.json','chapter-6-before-sponsor-decision.json'])await renderCase(file.replace('.json',''),'Unmodified prefix-replayed browser checkpoint',await load(`qa/experience-v6/fixtures/${file}`));
  const fresh=engine.createGame(1701,1000);await renderCase('fresh','Fresh engine state',fresh);
  const legacy=structuredClone(earned[0]);delete legacy.society;delete legacy.governance;delete legacy.clearance;await renderCase('legacy','Explicit presentation variant: absent optional legacy systems',legacy);
  for(const terms of ['inspection','privacy']){const state=structuredClone(earned[0]);state.governance=g.createGovernanceState();state.governance!.mandate='ratified';state.governance!.actor={...state.governance!.actor,terms:terms as 'inspection'|'privacy',acceptedAt:state.elapsed,observedSeconds:15};await renderCase(`compact-${terms}`,'Explicit presentation variant: new reciprocal agreement',state);}
  for(const status of ['pending','approved','refused','used']){const state=structuredClone(earned[0]);state.governance=g.createGovernanceState();state.governance!.mandate='ratified';state.governance!.reviews=[{boundary:'external',from:'blocked',target:'reviewed',requestedAt:state.elapsed-30,status:status as any,decidedAt:status==='pending'?null:state.elapsed,attempts:1,reason:'Presentation fixture'}];await renderCase(`public-${status}`,'Explicit presentation variant: public review status',state);}
  for(const [index,values]of [[39.999,64.999,54.999,45.001],[69.999,84.999,64.999,25.001]].entries()){const state=structuredClone(earned[0]);[state.metrics.evidence,state.metrics.recall,state.metrics.agency,state.metrics.reviewQueue]=values;state.society!.communities[0].income=34.999;state.society!.communities[0].access=39.999;await renderCase(`threshold-near-miss-${index}`,'Explicit presentation variant: immediately below/above a decision threshold',state);}
  await renderCase('no-research-budget','Explicit presentation variant: mature laboratory without spendable research',{...structuredClone(earned[0]),research:'0'});
  const changed=[];for(const item of before)if(sha(await readFile(resolve(root,item.file)))!==item.sha256)changed.push(item.file);
  for(const item of freeze.files)assert.equal(sha(await readFile(resolve(root,item.path))),item.sha256,`Frozen source changed during review: ${item.path}`);
  check('source','Reviewed presentation files unchanged during pass',changed.length===0,changed,[]);
  const result={status:issues.length?'failed':'passed',createdAt:new Date().toISOString(),assertions:count,cases:cases.length,caseDetails:cases,issues,frozenSource:{path:freezePath,sha256:freeze.sha256,files:freeze.files.length,verifiedBeforeAndAfter:true},source:before,sourceInputs,changed,limitations:['Server-rendered structural checks do not execute browser events or measure layout, contrast, keyboard behavior, or enjoyment. Root owns actual browser verification.','Earned checkpoints are unmodified. Paused, ended, legacy, public-review and compact inputs are explicitly labeled presentation variants, not simulated campaigns.','Operating clearance is a separate runtime tab and is covered by code review and root browser interactions, not this initial-view SSR pass.','Existing simulation mechanics and content are outside the changed presentation file set. Separate pacing work verifies the campaign target.']};
  await writeFile(join(output,'results.json'),JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify({status:result.status,cases:result.cases,assertions:count,issues,changed},null,2));
  if(issues.length)process.exitCode=1;
}finally{await server.close();}
