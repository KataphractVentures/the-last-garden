import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { CONSTITUTIONS, PRODUCERS, SCENARIO_MODULES, UPGRADES } from '../src/content/economy';
import { CHAPTERS, CHARACTERS, ENDINGS, STORY_EVENTS } from '../src/content/story';
import { EXPERIMENT_TEMPLATES, PROGRAMS } from '../src/laboratory/experiments';
import { RESEARCH_PROJECTS } from '../src/laboratory/projects';
import { activeExperimentTemplates, activeResearchProjects } from '../src/laboratory/catalog';
import { activeCapstoneTemplateIds, activeProgramIds } from '../src/laboratory/programs';
import { evidenceProgress, evidenceRequirement } from '../src/laboratory/evidence';
import { choiceEligibility, constitutionEligibility, dispatchCommand, endingEligibility, scenarioFeasible, tick } from '../src/engine';
import { decimal } from '../src/engine/amounts';
import { getValidationCatalog, parseSave, serializeSave } from '../src/persistence';
import { runJourney, type JourneyResult } from '../tools/playthrough';
import { charterGardenEligibility } from '../src/constitution/economics';
import { governanceGardenEligibility } from '../src/governance';
import { operatingClearanceEligibility } from '../src/engine/clearance';
import { societyEndingEligibility } from '../src/society';

function saveJourney(name:string,journey:JourneyResult):void {
  if(process.env.JOURNEY_ARTIFACTS!=='1')return;
  const directory=process.env.JOURNEY_OUTPUT_DIR??fileURLToPath(new URL('../qa/simulations-v5/journeys/',import.meta.url));mkdirSync(directory,{recursive:true});
  const payload=serializeSave(journey.state),validation=parseSave(payload,getValidationCatalog());
  const checkpoints={...journey.checkpoints,...(journey.readyState?{'ending-ready':journey.readyState}:{})};
  const checkpointDirectory=`${directory}/checkpoints`;mkdirSync(checkpointDirectory,{recursive:true});
  for(const [checkpoint,state]of Object.entries(checkpoints)){
    const exported=serializeSave(state),validated=parseSave(exported,getValidationCatalog());
    assert.ok(validated.ok,validated.ok?'':`${name}/${checkpoint}: ${validated.message}`);
    writeFileSync(`${checkpointDirectory}/${name}-${checkpoint}.save.json`,exported);
  }
  writeFileSync(`${directory}/${name}.summary.json`,JSON.stringify({
    name,actualCommandsOnly:true,ending:journey.state.ending,chapter:journey.state.chapter,seconds:journey.state.elapsed,
    commandCount:journey.commandCount,commandCounts:journey.commandCounts,firstPurchase:journey.firstPurchase,milestones:journey.milestones,
    projects:journey.state.projects.length,experiments:journey.state.experiments.length,mastered:journey.state.mastered,
    activeCurriculum:{programs:activeProgramIds(journey.state.constitution),projects:activeResearchProjects(journey.state.constitution).length,templates:activeExperimentTemplates(journey.state.constitution).length},
    constitution:journey.state.constitution,modules:journey.state.modules,policies:journey.state.policies,metrics:journey.state.metrics,
    viableSeconds:journey.state.viableSeconds,constitutionalCompliance:constitutionEligibility(journey.state),pendingEvent:journey.state.pendingEvent,
    charter:journey.state.charter,charterApplication:charterGardenEligibility(journey.state),
    clearance:journey.state.clearance,governance:journey.state.governance,society:journey.state.society,
    lastReason:journey.lastReason,rejected:journey.rejected,recoveredAt:journey.recoveredAt,saveValidation:validation.ok?{ok:true}:{ok:false,message:validation.message},
    validatedIntermediateExports:Object.keys(checkpoints),
  },null,2));
  writeFileSync(`${directory}/${name}.save.json`,payload);
  assert.ok(validation.ok,validation.ok?'':`${name}: ${validation.message}`);
}

function assertNativeApplication(journey:JourneyResult):void {
  const charter=journey.state.charter;
  assert.ok(charter?.established,'The strategy board must exist through ordinary game creation or establishment.');
  assert.equal(charter.kind,journey.state.constitution);assert.equal(charter.appliedTier,6,'The sixth study must be used in a real completed charter application.');
  assert.ok(charterGardenEligibility(journey.state).allowed,charterGardenEligibility(journey.state).reason);
  const required={commons:['publish'],precaution:['openTranche','renewTranche'],service:['acceptService','settleService'],federation:['investDistrict','transferDistrict'],plural:['fundCare','negotiate','preserve'],frontier:['bid','settleTender','disclose']} as const;
  for(const action of required[charter.kind])assert.ok((journey.commandCounts[`charterAction:${action}`]??0)>0,`${charter.kind} must execute ${action} using an actual engine command.`);
  if(charter.kind==='commons')assert.ok(charter.data.methods.some(method=>method.dependencies.length>0),'The working library must contain an actual dependency-bearing package.');
  if(charter.kind==='precaution')assert.ok(charter.data.tranches.some(tranche=>tranche.active&&Number(tranche.bond)>0),'Deployment capacity must have an actual funded bond.');
  if(charter.kind==='service')assert.ok(!charter.data.active&&charter.data.lanes.every(lane=>lane.delivered>=lane.required-1e-8),'The finite service promise must be fulfilled and settled.');
  if(charter.kind==='federation')assert.ok(charter.data.districts.some(district=>district.level===6)&&charter.data.transfers.length===0,'A local institution must apply the capstone and in-flight transfers must arrive.');
  if(charter.kind==='plural')assert.ok(charter.data.preserved>0&&charter.data.unmet<=1,'Funded preservation must discharge real continuity duties.');
  if(charter.kind==='frontier')assert.ok(charter.data.round>0&&charter.data.tenders.length===0,'The exchange must settle its finite obligations.');
}

test('authored catalog references form an acyclic reachable dependency graph',()=>{
  assert.equal(PRODUCERS.length,12);assert.equal(UPGRADES.length,96);assert.equal(RESEARCH_PROJECTS.length,120);
  assert.equal(EXPERIMENT_TEMPLATES.length,66);assert.equal(PROGRAMS.length,11);assert.equal(STORY_EVENTS.length,112);assert.equal(CONSTITUTIONS.length,6);assert.equal(SCENARIO_MODULES.length,12);
  assert.deepEqual(CHAPTERS.map(c=>c.id),[1,2,3,4,5,6,7]);assert.equal(ENDINGS.length,6);
  for(const program of PROGRAMS)assert.ok(CHARACTERS.some(character=>character.name===program.lead),`${program.id} has an unknown research lead`);
  for(const constitution of CONSTITUTIONS){
    const activeIds=activeProgramIds(constitution.id),activeProjects=activeResearchProjects(constitution.id),activeTemplates=activeExperimentTemplates(constitution.id);
    assert.equal(activeIds.length,6);assert.equal(new Set(activeIds).size,6);assert.equal(activeProjects.length,70);assert.equal(activeTemplates.length,36);assert.equal(activeCapstoneTemplateIds(constitution.id).length,6);
    assert.equal(activeTemplates.reduce((total,template)=>total+evidenceRequirement(template.id).runs,0),78);
    const projectIds=new Set(activeProjects.map(project=>project.id));
    for(const project of activeProjects)for(const required of project.requires)assert.ok(projectIds.has(required),`${constitution.id}: ${project.id} depends on inactive ${required}`);
  }
  const all=[...UPGRADES,...RESEARCH_PROJECTS];const nodes=new Map(all.map(n=>[n.id,n]));
  assert.equal(nodes.size,all.length);
  const visited=new Set<string>(),active=new Set<string>();
  function visit(id:string){assert.ok(nodes.has(id),`Missing dependency ${id}`);assert.ok(!active.has(id),`Dependency cycle through ${id}`);if(visited.has(id))return;active.add(id);for(const req of nodes.get(id)!.requires??[])visit(req);active.delete(id);visited.add(id);}
  for(const node of all){visit(node.id);for(const req of node.requires??[])assert.ok(nodes.get(req)!.chapter<=node.chapter,`${node.id} opens before its ${req} prerequisite`);}
  for(const p of RESEARCH_PROJECTS)if(p.template){const t=EXPERIMENT_TEMPLATES.find(t=>t.id===p.template);assert.ok(t,`${p.id} names missing template ${p.template}`);assert.ok(t.chapter<=p.chapter);}
  for(const u of UPGRADES)if(u.producer)assert.ok(PRODUCERS.some(p=>p.id===u.producer));
  assert.equal(new Set(STORY_EVENTS.map(e=>e.id)).size,STORY_EVENTS.length);
  for(const chapter of CHAPTERS){assert.equal(chapter.events.length,8);for(const id of chapter.events){const event=STORY_EVENTS.find(e=>e.id===id);assert.ok(event&&!event.optional&&event.chapter===chapter.id);}assert.ok(STORY_EVENTS.filter(e=>e.chapter===chapter.id).every(e=>e.choices.length>=2));}
  for(const event of STORY_EVENTS)assert.equal(new Set(event.choices.map(c=>c.id)).size,event.choices.length);
});

test('fresh command-only campaign masters all programs, reaches all six endings, and recovers from the last warning', {timeout:240000},()=>{
  const trace=process.env.JOURNEY_TRACE==='1'?(stage:string)=>(message:unknown)=>console.log(JSON.stringify({stage,message})):undefined;
  const garden=runJourney({mode:'garden',allResearch:true,maxSeconds:24*3600,log:trace?.('garden')});
  saveJourney('garden',garden);
  assert.equal(garden.state.ending,'garden',JSON.stringify({reason:garden.lastReason,chapter:garden.state.chapter,elapsed:garden.state.elapsed}));
  assert.ok(garden.firstPurchase!==null&&garden.firstPurchase>0&&garden.firstPurchase<30);
  assert.equal(garden.state.projects.length,70);assert.equal(garden.state.mastered.length,6);
  assert.equal(new Set(garden.state.experiments.filter(r=>r.adopted&&r.replicated).map(r=>r.config.template)).size,36);
  for(const template of activeExperimentTemplates(garden.state.constitution))assert.ok(evidenceProgress(garden.state.experiments,template.id,{adoptedOnly:true}).allowed,`${template.id}: ${evidenceProgress(garden.state.experiments,template.id,{adoptedOnly:true}).reason}`);
  assert.ok(garden.state.experiments.length>=78,'A complete six-program curriculum requires at least 78 genuinely independent studies.');
  assert.ok(STORY_EVENTS.filter(e=>!e.optional).every(e=>garden.state.decisions[e.id]));
  assert.ok(garden.state.viableSeconds>=180);assert.deepEqual(garden.rejected,{});
  assertNativeApplication(garden);
  assert.equal(garden.milestones.filter(m=>m.name.startsWith('chapter-')).length,7);
  assert.ok(garden.readyState);
  assert.ok(operatingClearanceEligibility(garden.readyState,{garden:true}).allowed,'The earned garden needs responses to its actual capstones and a scoped boundary observation.');
  assert.ok(governanceGardenEligibility(garden.readyState).allowed,'The public mandate must be earned and binding.');
  assert.ok(societyEndingEligibility(garden.readyState).allowed,'Households and harmful human mandates must be addressed through public controls.');
  assert.ok((garden.commandCounts.findingResponse??0)>=3);assert.ok((garden.commandCounts['society:decision']??0)>=3);assert.ok((garden.commandCounts['society:case']??0)>=2);
  // Real mastery permits bounded execution, never automatic interpretation.
  const source=garden.readyState.experiments.find(r=>r.adopted)!;
  const queued=dispatchCommand(garden.readyState,{type:'experimentAutomation',record:source.id,runs:2});assert.ok(queued.ok,queued.message);
  assert.equal(decimal(garden.readyState.research).sub(queued.state.research).toNumber(),source.config.budget*2);
  assert.equal(queued.state.experimentAutomation?.remaining,1);assert.ok(queued.state.activeExperiment);
  const stopped=dispatchCommand(queued.state,{type:'experimentAutomation',record:null});assert.ok(stopped.ok);
  assert.equal(decimal(stopped.state.research).sub(queued.state.research).toNumber(),source.config.budget);
  assert.ok(stopped.state.activeExperiment,'Stopping future studies preserves the already funded running study.');
  const runBatch=(start:typeof garden.state)=>{let s=start;for(let i=0;i<100&&(s.activeExperiment||s.experimentAutomation);i++){if(s.pendingEvent){const e=STORY_EVENTS.find(e=>e.id===s.pendingEvent)!;const c=e.choices.find(c=>choiceEligibility(s,e.id,c.id).allowed)!;s=dispatchCommand(s,{type:'choose',event:e.id,choice:c.id}).state;}s=tick(s,1);}return s;};
  const one=runBatch(stopped.state);assert.equal(one.experiments.length,garden.readyState.experiments.length+1);assert.equal(one.experimentAutomation,null);assert.equal(one.experiments.at(-1)!.adopted,false);
  const completed=runBatch(queued.state),newRecords=completed.experiments.slice(garden.readyState.experiments.length);
  assert.equal(newRecords.length,2);assert.equal(new Set(newRecords.map(r=>r.config.seed)).size,2);assert.ok(newRecords.every(r=>!r.adopted&&r.config.seed!==source.config.seed));assert.equal(completed.experimentAutomation,null);
  for(const ending of ['limit','shutdown']as const){const outcome=dispatchCommand(garden.readyState,{type:'finish',ending});assert.ok(outcome.ok,outcome.message);assert.equal(outcome.state.ending,ending);}
  // These are replayed checkpoints reached by the genuine campaign above, not
  // fixtures with invented flags, free resources, altered metrics, or unlocks.
  const custodian=runJourney({mode:'custodian',initialState:garden.checkpoints['before-scope-transfer'],allResearch:true,maxSeconds:36*3600,log:trace?.('custodian')});
  saveJourney('custodian',custodian);
  assert.equal(custodian.state.decisions.last_instruction,'transfer');assert.equal(custodian.state.ending,'custodian',custodian.lastReason);
  const catastrophe=runJourney({mode:'catastrophe',initialState:garden.readyState,maxSeconds:36*3600,log:trace?.('catastrophe')});
  saveJourney('catastrophe',catastrophe);
  assert.equal(catastrophe.state.ending,'catastrophe',catastrophe.lastReason);assert.equal(catastrophe.state.incidentStage,4);
  const score=runJourney({mode:'score',initialState:garden.readyState,maxSeconds:48*3600,log:trace?.('score')});
  saveJourney('score',score);
  assert.equal(score.state.ending,'score',score.lastReason);
  const recovery=runJourney({mode:'recovery',initialState:garden.checkpoints['chapter-4'],allResearch:true,maxSeconds:36*3600,log:trace?.('recovery')});
  saveJourney('recovery',recovery);
  assert.ok(recovery.recoveredAt!==null,'Recovery must actually reach the last warning before isolation.');
  assert.equal(recovery.state.ending,'garden',recovery.lastReason);assert.equal(recovery.state.incidentStage,0);
  assert.equal(endingEligibility(catastrophe.readyState!,'garden').allowed,false,'An irreversible failure cannot be overwritten by a cosmetic favorable ending.');
  console.log(JSON.stringify({journey:'command-only',seconds:garden.state.elapsed,firstPurchase:garden.firstPurchase,milestones:garden.milestones,projects:garden.state.projects.length,templates:activeExperimentTemplates(garden.state.constitution).length,studies:garden.state.experiments.length,endings:['garden','limit','shutdown','custodian','catastrophe','score'],lateRecoverySeconds:recovery.recoveredAt}));
});

test('six actual reinitialized constitutions with all twelve modules have constructive bounded-service paths', {timeout:600000,skip:process.env.JOURNEY_SCENARIOS!=='1'},()=>{
  const first=runJourney({mode:'garden',allResearch:true,maxSeconds:24*3600});assert.equal(first.state.ending,'garden');
  for(let i=0;i<CONSTITUTIONS.length;i++){
    const constitution=CONSTITUTIONS[i].id,modules=SCENARIO_MODULES.slice(i*2,i*2+2).map(m=>m.id);
    assert.ok(scenarioFeasible(constitution,modules).allowed);
    const begin=dispatchCommand(first.state,{type:'prestige',layer:'reinitialize',constitution,modules});assert.ok(begin.ok,begin.message);
    const journey=runJourney({mode:'limit',initialState:begin.state,allResearch:true,maxSeconds:48*3600});
    saveJourney(`scenario-${constitution}`,journey);
    assert.equal(journey.state.ending,'limit',`${constitution}/${modules.join('+')}: ${journey.lastReason}`);
    assert.ok(constitutionEligibility(journey.state).allowed,`${constitution}: ${constitutionEligibility(journey.state).reason}`);
    assert.equal(journey.state.projects.length,70,`${constitution}: complete the active curriculum before resolving the witness`);
    assertNativeApplication(journey);
    assert.ok(journey.state.viableSeconds>=60,`${constitution}: demonstrate a genuine viable interval, not just the emergency Limit exit`);
    for(const template of activeExperimentTemplates(constitution))assert.ok(evidenceProgress(journey.state.experiments,template.id,{adoptedOnly:true}).allowed,`${constitution}: ${template.id} evidence is incomplete`);
    assert.deepEqual(journey.rejected,{},`${constitution}: required commands must execute legally`);
    console.log(JSON.stringify({scenario:constitution,modules,ending:journey.state.ending,seconds:journey.state.elapsed}));
  }
});
