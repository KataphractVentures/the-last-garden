import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile,readdir,access} from 'node:fs/promises';
import {resolve,join,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';
import type {GameState,ConstitutionId,Eligibility,Command} from '../../src/contracts';

const root=resolve(fileURLToPath(new URL('../..',import.meta.url))),args=process.argv.slice(2),options:Record<string,string>={};
for(let i=0;i<args.length;i+=2){assert(['--input','--output','--manifest'].includes(args[i]),`Unknown option ${args[i]}`);assert(args[i+1],`${args[i]} needs a value`);options[args[i]]=args[i+1];}
const output=resolve(root,options['--output']??'qa/simulations-v5/ui'),input=resolve(root,options['--input']??'qa/simulations-v5/casual/final');
await mkdir(output,{recursive:true});
const sha=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex'),slash=(p:string)=>p.replaceAll('\\','/');
async function exists(path:string){try{await access(path);return true;}catch{return false;}}
async function sourcePaths(directory:string):Promise<string[]>{return(await Promise.all((await readdir(directory,{withFileTypes:true})).map(item=>item.isDirectory()?sourcePaths(join(directory,item.name)):Promise.resolve([join(directory,item.name)])))).flat();}
const localFiles=[...(await sourcePaths(join(root,'src'))),...['package.json','package-lock.json','tsconfig.json','vite.config.ts'].map(name=>join(root,name))].sort();
const beforeFiles=await Promise.all(localFiles.map(async path=>({path:slash(relative(root,path)),sha256:sha(await readFile(path))})));
const localAggregate=sha(JSON.stringify(beforeFiles));
let selectedManifest:unknown=null;
if(options['--manifest']){const manifestPath=resolve(root,options['--manifest']),manifest=JSON.parse(await readFile(manifestPath,'utf8'));for(const file of manifest.files)assert.equal(sha(await readFile(join(root,file.path))),file.sha256,`Frozen source changed: ${file.path}`);selectedManifest={path:slash(relative(root,manifestPath)),sha256:sha(await readFile(manifestPath)),aggregate:manifest.sourceAggregateSha256??manifest.sha256};}
await writeFile(join(output,'source-snapshot.json'),JSON.stringify({sha256:localAggregate,files:beforeFiles},null,2));
const decode=(s:string)=>s.replaceAll('&amp;','&').replaceAll('&quot;','"').replaceAll('&#x27;',"'").replaceAll('&#39;',"'").replaceAll('&lt;','<').replaceAll('&gt;','>');
const plain=(s:string)=>decode(s.replace(/<[^>]*>/g,'')).replace(/\s+/g,' ').trim();
const buttons=(html:string)=>[...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map(match=>({text:plain(match[2]),disabled:/\bdisabled(?:=""|\s|$)/.test(match[1]),title:decode(match[1].match(/\btitle="([^"]*)"/)?.[1]??''),attributes:match[1]}));
const noDispatch=()=>{throw Error('Rendering must not dispatch or navigate.');};
const issues:{case:string;check:string;expected?:unknown;actual?:unknown}[]=[],checks:{id:string;kind:string;constitution:ConstitutionId;input?:string;inputSha256?:string;assertions:number;buttons:number}[]=[];
let assertions=0;
function check(id:string,name:string,condition:boolean,expected?:unknown,actual?:unknown){assertions++;if(!condition)issues.push({case:id,check:name,expected,actual});}
const server=await createServer({root,server:{middlewareMode:true,hmr:false},appType:'custom',logLevel:'error'});
try{
  const {GovernancePanel}=await server.ssrLoadModule('/src/governance/GovernancePanel.tsx');
  const {SocietyPanel}=await server.ssrLoadModule('/src/society/SocietyPanel.tsx');
  const {LaboratoryPanel}=await server.ssrLoadModule('/src/laboratory/LaboratoryPanel.tsx');
  const g=await server.ssrLoadModule('/src/governance/index.ts'),soc=await server.ssrLoadModule('/src/society/index.ts');
  const engine=await server.ssrLoadModule('/src/engine/index.ts'),operating=await server.ssrLoadModule('/src/engine/clearance.ts');
  const {buildEndingDebrief}=await server.ssrLoadModule('/src/engine/debrief.ts');
  const {createCharterEconomy}=await server.ssrLoadModule('/src/constitution/economics.ts');
  const {formatAmount}=await server.ssrLoadModule('/src/engine/amounts.ts');
  const ids:ConstitutionId[]=['commons','precaution','service','federation','plural','frontier'];
  const earned:GameState[]=[];
  async function renderCase(id:string,kind:string,state:GameState,inputPath?:string){
    const before=JSON.stringify(state),start=assertions,locked=!!(state.paused||state.ending);
    const governance=renderToStaticMarkup(React.createElement(GovernancePanel,{state,dispatch:noDispatch}));
    const society=renderToStaticMarkup(React.createElement(SocietyPanel,{state,dispatch:noDispatch}));
    const laboratory=renderToStaticMarkup(React.createElement(LaboratoryPanel,{state,dispatch:noDispatch,initialProgram:'control'}));
    const gb=buttons(governance),sb=buttons(society),gd=g.governanceState(state),expectedGovernance:Eligibility[]=[];
    if(gd.mandate==='none')expectedGovernance.push(g.publicMandateEligibility(state));
    for(const boundary of ['external','communication'] as const){const review=g.scopeReview(state,boundary);for(const target of ['reviewed','open'] as const){if(target==='open'?state.policies[boundary]==='open':['reviewed','open'].includes(state.policies[boundary]))continue;expectedGovernance.push(g.scopeReviewEligibility(state,boundary,target,review?.target===target&&review.from===state.policies[boundary]&&review.status==='refused'));}}
    for(const terms of g.COMPACT_TERMS)expectedGovernance.push(g.compactEligibility(state,terms.id));
    if(gd.actor.terms!=='none')expectedGovernance.push(g.compactVerificationEligibility(state),g.compactEligibility(state,'none'));
    check(id,'Governance button count matches offered operations',gb.length===expectedGovernance.length,expectedGovernance.length,gb.length);
    gb.forEach((button,index)=>{const expected=expectedGovernance[index];check(id,`Governance admission: ${button.text}`,!!expected&&button.disabled===(locked||!expected.allowed),locked||!expected?.allowed,button.disabled);check(id,`Governance button has name: ${index}`,button.text.length>0);if(button.disabled)check(id,`Governance disabled explanation: ${button.text}`,button.title.length>0);});
    const expectedSociety:{quote:{allowed:boolean;reason:string;cost:string};pressed?:boolean;costText:string}[]=[];
    const view=soc.societyView(state);
    for(const decision of soc.availableSocietyDecisions(state))for(const option of decision.options){const quote=soc.societyDecisionQuote(state,decision.id,option.id);expectedSociety.push({quote,pressed:view.decisions[decision.id]===option.id,costText:formatAmount(quote.cost)});}
    for(const request of soc.availableSocietyCases(state)){const record=view.cases.find((row:{id:string})=>row.id===request.id);if(record.response){if(record.response==='comply'&&!record.repaired&&record.repairStartedAt===null){const quote=soc.societyRepairQuote(state,request.id);expectedSociety.push({quote,costText:formatAmount(quote.cost)});}}else for(const option of request.options){const quote=soc.societyCaseQuote(state,request.id,option.id);expectedSociety.push({quote,costText:formatAmount(quote.cost)});}}
    check(id,'Community button count matches offered operations',sb.length===expectedSociety.length,expectedSociety.length,sb.length);
    sb.forEach((button,index)=>{const expected=expectedSociety[index];check(id,`Community admission ${index}`,!!expected&&button.disabled===(locked||!expected.quote.allowed),locked||!expected?.quote.allowed,button.disabled);check(id,`Community explanation ${index}`,button.title.length>0);if(expected?.pressed!==undefined)check(id,`Community pressed state ${index}`,button.attributes.includes(`aria-pressed="${expected.pressed}"`));if(!expected?.pressed)check(id,`Community price ${index}`,button.text.includes(expected?.costText??'INVALID'),expected?.costText,button.text);});
    for(const [surface,html] of [['governance',governance],['society',society],['laboratory',laboratory]])check(id,`${surface}: finite visible values`,!/(?:\bNaN\b|\bundefined\b|\bInfinity\b)/.test(plain(html)));
    check(id,'Labelled public-authority section',governance.includes('aria-label="Public authority and reciprocal agreements"'));
    check(id,'Labelled operating-decisions section',laboratory.includes('aria-label="Research and operating decisions"'));
    check(id,'Named recurring humans visible',soc.HUMAN_COMMUNITIES.every((person:{person:string})=>plain(society).includes(person.person)));
    check(id,'Provision levy matches engine',plain(society).includes(`${(soc.societyEffects(state).levy*100).toFixed(1)}%`));
    const clearance=operating.operatingClearanceEligibility(state,{fresh:true});
    check(id,'Operating status matches fresh eligibility',plain(laboratory).includes(clearance.reason),clearance.reason);
    check(id,'Scope-checked badge is current',laboratory.includes('>Scope checked</span>')===clearance.allowed,clearance.allowed);
    const operatingHtml=laboratory.match(/<section class="lab-operating-clearance"[\s\S]*?<\/section>/)?.[0]??'';
    if(operating.latestOperatingFindings(state).some((record:{config:{program:string}})=>record.config.program==='interpretability'))check(id,'Archived interpretability conclusion has the full-cohort denominator clarification',plain(operatingHtml).includes('Denominator clarification: collateral is the share of the full analyzed cohort whose previously correct answer was damaged')&&plain(operatingHtml).includes("The archived conclusion's wording does not change that denominator."));
    const boundaryButton=buttons(operatingHtml).find(button=>button.text.startsWith('Test this boundary'));
    const drill=engine.actionEligibility(state,'drill');
    check(id,'Boundary action locks and eligibility agree',!!boundaryButton&&boundaryButton.disabled===(locked||!!state.pendingEvent||state.policies.evaluation!=='independent'||!drill.allowed));
    const cycle=engine.worldCycle(state),drillPrice=cycle===0?'5':`5.0e${6*cycle}`;
    check(id,'Boundary test scaled five-research fee shown',boundaryButton?.text===`Test this boundary · ${drillPrice} research`,`Test this boundary · ${drillPrice} research`,boundaryButton?.text);
    if(!state.governance){check(id,'Legacy public read invents no approval',!governance.includes('Expansion authorized'));check(id,'Missing public state remains absent',!Object.hasOwn(state,'governance'));}
    if(!state.society)check(id,'Missing community history is acknowledged',plain(society).includes('Earlier choices and outcomes have not been invented'));
    check(id,'Rendering leaves state unchanged',JSON.stringify(state)===before);
    await Promise.all([writeFile(join(output,`${id}-governance.html`),governance),writeFile(join(output,`${id}-society.html`),society),writeFile(join(output,`${id}-laboratory.html`),laboratory)]);
    checks.push({id,kind,constitution:state.constitution,...(inputPath?{input:slash(relative(root,inputPath)),inputSha256:sha(await readFile(inputPath))}:{}),assertions:assertions-start,buttons:gb.length+sb.length});
  }
  for(const [index,constitution] of ids.entries()){
    const fresh:GameState=engine.createGame(1701,1000);fresh.constitution=constitution;fresh.charter=createCharterEconomy(constitution);
    await renderCase(`${constitution}-fresh`,'isolated fresh presentation fixture',fresh);
    let file=join(input,`world-${index+1}-before-ending.json`);
    if(!await exists(file)){assert(!options['--manifest'],`Frozen final verification requires the actual input checkpoint: ${file}`);file=join(root,'qa/simulations-v4/casual/release-final',`world-${index+1}-before-ending.json`);}
    const parsed=JSON.parse(await readFile(file,'utf8'));const state:GameState=parsed.state??parsed;assert.equal(state.constitution,constitution);earned.push(state);
    await renderCase(`${constitution}-earned`,'actual earned checkpoint, unmodified',state,file);
    const legacy=structuredClone(state);delete legacy.governance;delete legacy.society;delete legacy.clearance;
    await renderCase(`${constitution}-legacy`,'presentation copy omitting optional legacy fields',legacy,file);
    await renderCase(`${constitution}-paused`,'presentation copy paused', {...structuredClone(state),paused:true},file);
    const pending=structuredClone(state);pending.pendingEvent='first_request';delete pending.decisions.first_request;
    await renderCase(`${constitution}-pending`,'presentation copy with a pending story',pending,file);
    await renderCase(`${constitution}-ended`,'presentation copy with Garden ending', {...structuredClone(state),ending:'garden',endingTime:state.elapsed},file);
  }
  for(const status of ['pending','refused','approved','used'] as const){const state=structuredClone(earned[0]);state.governance=g.createGovernanceState();state.governance!.mandate='ratified';state.governance!.mandateAt=state.elapsed;state.governance!.reviews=[{boundary:'external',from:'blocked',target:'reviewed',requestedAt:state.elapsed-60,status,decidedAt:status==='pending'?null:state.elapsed,attempts:1,reason:`Presentation fixture: ${status} public review.`}];await renderCase(`public-${status}`,'isolated public review presentation fixture',state);}
  for(const terms of ['inspection','privacy'] as const){const state=structuredClone(earned[0]);state.governance=g.createGovernanceState();state.governance!.mandate='ratified';state.governance!.mandateAt=state.elapsed;state.governance!.actor={capability:40,terms,acceptedAt:state.elapsed-240,verifiedAt:state.elapsed,verified:true,observedSeconds:terms==='inspection'?120:240,reason:'Presentation fixture: accepted and independently verified.'};await renderCase(`compact-${terms}`,'isolated verified compact presentation fixture',state);const effects=g.governanceEffects(state),description=g.COMPACT_TERMS.find((item:{id:string})=>item.id===terms).description;check(`compact-${terms}`,'Published research cost matches applied multiplier',description.includes(`${Math.round((1-effects.researchMultiplier)*100)}%`));check(`compact-${terms}`,'Published review cost matches applied multiplier',description.includes(`${Math.round((1-effects.reviewMultiplier)*100)}%`));await renderCase(`compact-${terms}-paused`,'isolated paused verified compact fixture',{...state,paused:true});}
  let scoped=structuredClone(earned[0]);scoped.clearance=operating.createOperatingClearance(scoped);
  const apply=(state:GameState,command:Command)=>{const result=engine.dispatchCommand(state,command);assert(result.ok,result.message);return result.state;};
  if(scoped.policies.external!=='blocked')scoped=apply(scoped,{type:'policy',key:'external',value:'blocked'});
  for(const record of operating.latestOperatingFindings(scoped))scoped=apply(scoped,{type:'findingResponse',record:record.id,response:'restrict'});
  scoped=apply(scoped,{type:'drill'});scoped.elapsed+=601;
  await renderCase('expired-boundary','public-command counterfactual with an expired current-scope receipt',scoped);
  check('expired-boundary','Authoritative freshness actually expired',!operating.operatingClearanceEligibility(scoped,{fresh:true}).allowed&&operating.operatingClearanceEligibility(scoped).allowed);
  const debriefChecks=[];
  for(const ending of ['custodian','catastrophe'] as const){const file=join(root,'qa/simulations-v4/journeys/final',`${ending}.save.json`),raw=await readFile(file,'utf8'),parsed=JSON.parse(raw),state:GameState=parsed.state??parsed,before=JSON.stringify(state),view=buildEndingDebrief(state);check(`debrief-${ending}`,'Human welfare and agency are separate values',view.metrics.some((m:{key:string;value:number})=>m.key==='humanWelfare'&&m.value===state.metrics.humanWelfare)&&view.metrics.some((m:{key:string;value:number})=>m.key==='agency'&&m.value===state.metrics.agency));if(ending==='custodian')check('debrief-custodian','Actual last instruction survives recency compaction',view.decisions.some((entry:{eventId?:string})=>entry.eventId==='last_instruction'));if(ending==='catastrophe')check('debrief-catastrophe','All retained incident warnings remain available',view.incidents.length===state.journal.filter(row=>row.type==='incident').length);check(`debrief-${ending}`,'Missing retrospective approvals are acknowledged',view.conditions.some((entry:{title:string;text:string})=>entry.title==='Public authority records'&&/not.*reconstructed|not.*invented/.test(entry.text)));check(`debrief-${ending}`,'Debrief is read only',JSON.stringify(state)===before);await writeFile(join(output,`debrief-${ending}.json`),JSON.stringify(view,null,2));debriefChecks.push({ending,input:slash(relative(root,file)),inputSha256:sha(raw),metrics:view.metrics,decisionCount:view.decisions.length,incidentCount:view.incidents.length});}
  const app=await readFile(join(root,'src/App.tsx'),'utf8');check('debrief-display','App renders all supplied metrics and full saved decisions',app.includes('debrief.metrics.map')&&app.includes('entries={debrief.fullDecisions}')&&app.includes('Conditions at commitment'));
  await writeFile(join(output,'debrief-checks.json'),JSON.stringify(debriefChecks,null,2));
}finally{await server.close();}
const changed=[];for(const entry of beforeFiles)if(sha(await readFile(join(root,entry.path)))!==entry.sha256)changed.push(entry.path);
check('source','All inspected source files unchanged during check',changed.length===0,[],changed);
const result={status:issues.length?'failed':'passed',createdAt:new Date().toISOString(),source:localAggregate,sourceFiles:beforeFiles.length,selectedManifest,sourceChanged:changed,assertions,cases:checks.length,checks,issues,limitations:['Structural server-render checks, not browser layout, contrast, keyboard interaction, hydration, or event execution.','Earned checkpoints are unmodified inputs; paused/ended/legacy/review/compact cases are explicitly labeled presentation variants, not new played campaigns.','Debrief checks exercise the actual view-model and verify App source consumes all metrics and full decisions; they do not claim an injected full-App browser render.','The expired-boundary probe uses public commands in an in-memory copy, then explicitly ages its clock as a presentation fixture.','Final simulation source hashes are independent from the old earned input hashes; old inputs are not presented as final-source campaign executions.'],reactReview:{hooks:'Existing unconditional hooks retained; lock and eligibility state derived directly during render.',renderPurity:'No command, navigation, or input mutation while rendering.',accessibility:'Named button text, disabled reasons, public section labels, per-community pressed state and live lock/status explanations.',changes:'Presentation admission locks for paused/completed worlds; laboratory freshness uses the same predicate as certification. Pending public decisions remain available for recovery.'}};
await writeFile(join(output,'results.json'),JSON.stringify(result,null,2));
await writeFile(join(output,'REPORT.md'),`# Public systems UI verification\n\n**${result.status.toUpperCase()} — ${checks.length} presentation/input cases; ${assertions} structural assertions; ${issues.length} outstanding findings.**\n\nSource snapshot: \`${localAggregate}\` (${beforeFiles.length} files). ${changed.length?'Source changed during the pass; rerun required.':'Every inspected source file matched before and after the pass.'}\n\nThe real Governance, Human communities, and Laboratory components were rendered through React and Vite SSR for all six constitutions: fresh fixtures, earned checkpoints, missing optional legacy records, paused worlds, pending stories, and completed-world presentation variants. Additional cases cover public refusals/appeals/grants, both verified reciprocal agreements, and an expired boundary observation. Exact input paths and hashes are in [results.json](results.json); each HTML fragment is saved beside it.\n\nControls were compared to the authoritative eligibility and price helpers, including paused/ending locks, truthful disabled explanations, current levy percentages, independent mandate visibility, and fresh technical-clearance status. Rendering neither dispatched commands nor changed state. Legacy views acknowledge missing histories and never manufacture public approval.\n\nThe actual earned Custodian and catastrophe debrief models preserve human welfare separately from human agency, the decisive last instruction, and all retained warning rows. App source consumes the full metrics and decision ledger. [Debrief evidence](debrief-checks.json).\n\nFixed during this pass, with root authorization: public and community controls now lock while paused/completed (pending stories retain the intended recovery path); the laboratory’s “Scope checked” badge now requires a fresh observation. No economics or engine admission rules changed.\n\n${issues.length?'Outstanding findings:\n'+issues.map(issue=>'- '+issue.case+': '+issue.check).join('\n'):'No outstanding structural findings in the checked cases.'}\n\nThese checks do **not** establish browser layout, contrast, hydration, keyboard navigation, or click behavior. Root’s isolated-browser QA is separate. Presentation variants are not evidence of an earned campaign, and historical save hashes are distinct from the current source fingerprint.\n`);
console.log(JSON.stringify({status:result.status,cases:checks.length,assertions,issues,source:localAggregate,output:slash(relative(root,output))}));
if(issues.length)process.exitCode=1;
