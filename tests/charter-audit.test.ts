import test from 'node:test';
import assert from 'node:assert/strict';
import type { Command, ConstitutionId, ExperimentConfig, GameState } from '../src/contracts';
import { createGame, dispatchCommand, getRates, tick } from '../src/engine';
import { createCharterEconomy, charterGardenEligibility, getCharterActions } from '../src/constitution/economics';
import { STORY_EVENTS } from '../src/content/story';
import { PRODUCERS } from '../src/content/economy';
import { activeExperimentTemplates, activeResearchProjects } from '../src/laboratory/catalog';
import { activeProgramIds, CHARTER_PROGRAM_BY_CONSTITUTION } from '../src/laboratory/programs';
import { runExperiment } from '../src/laboratory/experiments';
import { charterClearance } from '../src/laboratory/evidence';
import { decimal } from '../src/engine/amounts';
import { getStoryEconomy } from '../src/engine/storyEconomy';
import { getValidationCatalog } from '../src/persistence';
import { parseSave, serializeSave } from '../src/persistence/validation';

const constitutions:ConstitutionId[]=['commons','precaution','service','federation','plural','frontier'];
/** Explicit funded integration fixture, never represented as an earned campaign. */
function fixture(kind:ConstitutionId):GameState {
  const s=createGame(1701,1000); s.constitution=kind; s.charter=createCharterEconomy(kind);
  s.chapter=7; s.tokens='1000000000'; s.research='1000000000'; s.pendingEvent=null;
  s.decisions=Object.fromEntries(STORY_EVENTS.map(e=>[e.id,e.choices[0].id]));
  s.policies={contract:'verified',communication:'reviewed',external:'blocked',evaluation:'independent',welfare:'consent',continuity:'protected',fallback:'distributed',governance:'federated'};
  s.metrics={quality:95,distortion:0,agency:85,welfare:85,dependence:35,evidence:90,recall:95,coordination:85,pressure:15,continuity:90,humanWelfare:85,reviewQueue:0};
  s.projects=activeResearchProjects(kind).map(p=>p.id); s.mastered=activeProgramIds(kind);
  const program=CHARTER_PROGRAM_BY_CONSTITUTION[kind];
  for(const template of activeExperimentTemplates(kind).filter(t=>t.program===program)){
    const config:ExperimentConfig={program,template:template.id,seed:1701,cohort:128,budget:1024,holdout:.25,intervention:template.interventions[0],distribution:'familiar',lineage:'clean',prediction:'A fixed controlled comparison may support or reject this proposed mechanism.',control:true};
    const root=runExperiment(config);root.adopted=true;root.replicated=true;
    const shifted=runExperiment({...config,seed:1702,distribution:'shifted',replicateOf:root.id});shifted.replicated=true;
    const adversarial=runExperiment({...config,seed:1703,distribution:'adversarial',replicateOf:root.id});adversarial.replicated=true;
    s.experiments.push(root,shifted,adversarial);
  }
  assert.equal(charterClearance(s,6).allowed,true);return s;
}
function command(s:GameState,c:Command):GameState {const r=dispatchCommand(s,c);assert.equal(r.ok,true,r.message);return r.state;}
function valid(s:GameState):void {const r=parseSave(serializeSave(s,1000),getValidationCatalog());assert.equal(r.ok,true,r.ok?'valid':r.message);}
function earned(s:GameState){return {lifetime:s.lifetime,useful:s.useful,tokens:getStoryEconomy(s).tokens.earned,research:getStoryEconomy(s).research.earned};}
function amountEqual(a:string,b:string,label='amount'):void {assert(decimal(a).eq(b),`${label}: ${a} != ${b}`);}
function near(a:string,b:string,label='amount'):void {assert(decimal(a).sub(b).abs().lte(decimal(b).abs().mul('1e-12').add('1e-9')),`${label}: ${a} != ${b}`);}
function hardware(s:GameState):GameState {for(const p of PRODUCERS)if(p.category==='production'||p.category==='compute')s.producers[p.id]=100;return s;}
function held(s:GameState):string {
  let total=decimal(s.tokens).add(s.charter?.automation?.budgetRemaining??'0');const c=s.charter;
  if(c?.kind==='precaution')for(const t of c.data.tranches)total=total.add(t.bond);
  if(c?.kind==='service')total=total.add(c.data.funding).add(c.data.earned);
  if(c?.kind==='federation'){for(const d of c.data.districts)total=total.add(d.treasury);for(const t of c.data.transfers)total=total.add(t.amount);}
  if(c?.kind==='plural')total=total.add(c.data.careReserve);
  if(c?.kind==='frontier')for(const t of c.data.tenders)total=total.add(t.collateral).add(t.reward);
  return total.toString();
}

test('audit: fresh charter states and actual familiar-root economic provenance are saveable',()=>{
  valid(createGame(1701,1000));
  for(const kind of constitutions){let s=fixture(kind);valid(s);
    const action=kind==='commons'?{type:'charterAction',action:'publish',target:1}:kind==='precaution'?{type:'charterAction',action:'openTranche',target:3}:null;
    if(action){s=command(s,action as Command);valid(s);}
  }
});

test('audit: Precaution bond principal refunds once and earns no production',()=>{
  let s=fixture('precaution');const money=s.tokens,progress=earned(s);
  s=command(s,{type:'charterAction',action:'openTranche',target:3});assert.equal(s.charter?.kind,'precaution');
  if(s.charter?.kind!=='precaution')throw Error('kind');const id=s.charter.data.tranches[0].id;
  amountEqual(held(s),money);assert.deepEqual(earned(s),progress);valid(s);
  s=command(s,{type:'charterAction',action:'retireTranche',target:id});amountEqual(s.tokens,money);assert.deepEqual(earned(s),progress);
  assert.equal(dispatchCommand(s,{type:'charterAction',action:'retireTranche',target:id}).ok,false);valid(s);
  assert.equal(charterGardenEligibility(s).allowed,false,'An empty deployment institution cannot close its expanded Accord.');
});

test('audit: Commons Garden retains a working library after capstone application',()=>{
  let s=fixture('commons');s=command(s,{type:'charterAction',action:'publish',target:1});
  s=command(s,{type:'charterAction',action:'publish',target:6});valid(s);
  assert.equal(charterGardenEligibility(s).allowed,true);
  while(s.charter?.kind==='commons'&&s.charter.data.methods.length){const q=getCharterActions(s).find(q=>q.action==='retract'&&q.allowed)!;assert(q);s=command(s,{type:'charterAction',action:'retract',target:q.target});}
  assert.equal(charterGardenEligibility(s).allowed,false,'Historical application cannot mask an empty library.');valid(s);
});

test('audit: tending uses bounded post-charter production at the old world scale',()=>{
  const s=fixture('precaution');const producer=PRODUCERS.find(p=>p.category==='production')!;s.producers[producer.id]=1000;
  const initial=getRates(s);assert(decimal(initial.click).lte(decimal(initial.tokens).mul(.06).add(1)),'Tending may not derive from hardware outside bonded capacity.');
  const scaled=structuredClone(s);scaled.legacy.cycle=9;scaled.flags.push('replay-cycle:1');const old=getRates(scaled);
  amountEqual(decimal(old.click).div('1000000').toString(),initial.click,'historical tending scale');
});

test('audit: Federation transfers consume one fee and deliver principal once',()=>{
  let s=fixture('federation');const progress=earned(s);const start=held(s);
  s=command(s,{type:'charterAction',action:'fundDistrict',target:0});amountEqual(held(s),start);
  s=command(s,{type:'charterAction',action:'transferDistrict',target:0,secondary:1});if(s.charter?.kind!=='federation')throw Error('kind');
  const fee=s.charter.data.transfers[0].fee;const expected=decimal(start).sub(fee).toString();amountEqual(held(s),expected);assert.deepEqual(earned(s),progress);
  s=tick(s,18);amountEqual(held(s),expected);assert.equal(s.charter?.kind==='federation'&&s.charter.data.transfers.length,0);
  const after=held(s);s=tick(s,18);amountEqual(held(s),after);
  s=command(s,{type:'charterAction',action:'withdraw',target:0});s=command(s,{type:'charterAction',action:'withdraw',target:1});amountEqual(s.tokens,expected);valid(s);
});

test('audit: Plural care funds and returns principal without erasing commitments',()=>{
  let s=fixture('plural');const start=s.tokens,progress=earned(s);
  s=command(s,{type:'charterAction',action:'fundCare'});amountEqual(held(s),start);
  s=command(s,{type:'charterConfigure',mode:'matched'});s=command(s,{type:'charterAction',action:'negotiate',target:0});
  if(s.charter?.kind!=='plural')throw Error('kind');const cohorts=structuredClone(s.charter.data.cohorts),duty=s.charter.data.continuityDuty;
  s=command(s,{type:'charterAction',action:'withdraw'});assert.deepEqual(earned(s),progress);
  assert.equal(s.charter?.kind==='plural'&&s.charter.data.continuityDuty,duty);assert.deepEqual(s.charter?.kind==='plural'&&s.charter.data.cohorts,cohorts);
  assert.equal(dispatchCommand(s,{type:'charterAction',action:'withdraw'}).ok,false);valid(s);
});

test('audit: charter quarter-ticks agree with batching and pauses preserve commitments',()=>{
  for(const kind of constitutions){let s=fixture(kind);
    if(kind==='federation'){s=command(s,{type:'charterAction',action:'fundDistrict',target:0});s=command(s,{type:'charterAction',action:'transferDistrict',target:0,secondary:1});}
    if(kind==='plural')s=command(s,{type:'charterAction',action:'fundCare'});
    const one=tick(s,40);let quarters=s;for(let i=0;i<160;i++)quarters=tick(quarters,.25);assert.deepEqual(one,quarters,kind);
    const fraction=tick(tick(s,.1),.15);assert.deepEqual(fraction,tick(s,.25),kind);
    const paused={...s,paused:true};assert.deepEqual(tick(paused,40).charter,paused.charter);
    const pending={...s,pendingEvent:'first_request',decisions:{...s.decisions}};delete pending.decisions.first_request;
    assert.deepEqual(tick(pending,40,true).charter,pending.charter);assert.equal(tick(pending,40,true).elapsed,pending.elapsed);
    const offline=tick(s,40,true);assert.deepEqual(offline.charter,one.charter);amountEqual(offline.tokens,one.tokens);valid(one);
  }
});

test('audit: authorizing and cancelling mastered batches returns only unused principal',()=>{
  let s=fixture('plural');s=command(s,{type:'charterAction',action:'fundCare'});s=command(s,{type:'charterConfigure',mode:'matched'});
  s=command(s,{type:'charterAction',action:'negotiate',target:0});s=command(s,{type:'charterAction',action:'negotiate',target:1});
  const balance=s.tokens,progress=earned(s);s=command(s,{type:'charterAutomation',enabled:true,runs:2,budget:'1000',reserveFloor:'100'});
  amountEqual(decimal(s.tokens).add(s.charter!.automation!.budgetRemaining).toString(),balance);assert.deepEqual(earned(s),progress);
  assert.equal(dispatchCommand(s,{type:'charterAutomation',enabled:true,runs:2,budget:'1000',reserveFloor:'100'}).ok,false);
  s=command(s,{type:'charterAutomation',enabled:false});amountEqual(s.tokens,balance);assert.deepEqual(earned(s),progress);
  s=command(s,{type:'charterAutomation',enabled:false});amountEqual(s.tokens,balance);valid(s);
});

test('audit: service and tender partitions withhold ordinary cash, count work once, and settle once',()=>{
  for(const kind of ['service','frontier'] as const){let s=hardware(fixture(kind));
    s=command(s,{type:'charterAction',action:kind==='service'?'acceptService':'bid'});
    const rates=getRates(s);const cash=kind==='service'?rates.charter!.serviceCash!:rates.charter!.tenderCash!;
    const lifetime=s.lifetime,useful=s.useful;const start=held(s);s=tick(s,.25);
    const accrued=s.charter?.kind==='service'?s.charter.data.earned:s.charter?.kind==='frontier'?s.charter.data.tenders[0].reward:'0';
    const totalCash=decimal(rates.tokens).add(cash).mul(.25);
    near(decimal(s.lifetime).sub(lifetime).add(accrued).toString(),totalCash.toString(),`${kind}: cash partition`);
    near(decimal(held(s)).sub(start).toString(),totalCash.toString(),`${kind}: total holdings`);
    amountEqual(decimal(s.useful).sub(useful).toString(),decimal(rates.useful).mul(.25).toString(),`${kind}: work once`);
    const q=getCharterActions(s).find(q=>q.action===(kind==='service'?'settleService':'settleTender')&&q.allowed);assert(q,`${kind}: small finite order delivered`);
    const before=earned(s);const beforeMoney=s.tokens;const reserve=kind==='service'&&s.charter?.kind==='service'?s.charter.data.funding:s.charter?.kind==='frontier'?s.charter.data.tenders[0].collateral:'0';
    const settlement={type:'charterAction',action:q.action,target:q.target,secondary:q.secondary} as Command;
    s=command(s,settlement);amountEqual(s.useful,before.useful,`${kind}: settlement does not redeliver`);
    const reward=decimal(accrued).mul(1.12);near(decimal(s.lifetime).sub(before.lifetime).toString(),reward.toString(),`${kind}: actual earned settlement`);
    near(decimal(s.tokens).sub(beforeMoney).toString(),reward.add(reserve).toString(),`${kind}: principal plus reward`);
    assert.equal(dispatchCommand(s,settlement).ok,false,`${kind}: same promise cannot settle twice`);valid(s);
  }
});

test('audit: multiple Frontier promises share one work budget and failed promises refund only principal less penalty',()=>{
  let s=hardware(fixture('frontier'));for(let i=0;i<3;i++)s=command(s,{type:'charterAction',action:'bid'});
  const r=getRates(s),before=s.lifetime;s=tick(s,.25);if(s.charter?.kind!=='frontier')throw Error('kind');
  const rewards=s.charter.data.tenders.reduce((sum,t)=>sum.add(t.reward),decimal(0));
  near(decimal(s.lifetime).sub(before).add(rewards).toString(),decimal(r.tokens).add(r.charter!.tenderCash!).mul(.25).toString(),'three contracts do not triple cash');
  const work=s.charter.data.tenders.reduce((sum,t)=>sum+t.delivered,0);assert(work<=r.charter!.tenderWork!*.25+1e-8);
  let noWork=fixture('frontier');const initial=noWork.tokens,progress=earned(noWork);noWork=command(noWork,{type:'charterAction',action:'bid'});
  if(noWork.charter?.kind!=='frontier')throw Error('kind');const collateral=noWork.charter.data.tenders[0].collateral;
  const withdrawal=getCharterActions(noWork).find(q=>q.action==='withdraw'&&q.allowed)!;
  noWork=command(noWork,{type:'charterAction',action:'withdraw',target:withdrawal.target});near(noWork.tokens,decimal(initial).sub(decimal(collateral).mul(.2)).toString());assert.deepEqual(earned(noWork),progress);valid(noWork);
});

test('audit: actual batch execution charges its locked budget once and cancel returns only the remainder',()=>{
  let s=fixture('plural');s=command(s,{type:'charterAction',action:'fundCare'});s=command(s,{type:'charterConfigure',mode:'matched'});
  s=command(s,{type:'charterAction',action:'negotiate',target:0});s=command(s,{type:'charterAction',action:'negotiate',target:1});
  const start=s.tokens;s=command(s,{type:'charterAutomation',enabled:true,runs:2,budget:'1000',reserveFloor:'100'});
  s=tick(s,30);assert(s.charter?.automation);amountEqual(s.charter.automation.budgetRemaining,'960');amountEqual(s.tokens,decimal(start).sub(1000).toString());
  s=command(s,{type:'charterAutomation',enabled:false});amountEqual(s.tokens,decimal(start).sub(40).toString());valid(s);
});

test('audit: accepted automation amount inputs round-trip through the save validator',()=>{
  let s=fixture('plural');s=command(s,{type:'charterAction',action:'fundCare'});s=command(s,{type:'charterConfigure',mode:'matched'});
  s=command(s,{type:'charterAction',action:'negotiate',target:0});s=command(s,{type:'charterAction',action:'negotiate',target:1});
  const result=dispatchCommand(s,{type:'charterAutomation',enabled:true,runs:2,budget:'0'.repeat(150)+'1000',reserveFloor:'0'.repeat(150)+'100'});
  if(result.ok)valid(result.state);else assert.match(result.message,/budget|finite|amount|reserve/i);
});

test('audit: stale tender commands cannot close a different promise after list compaction',()=>{
  let s=fixture('frontier');s=command(s,{type:'charterAction',action:'bid'});s=command(s,{type:'charterAction',action:'bid'});
  const withdrawal=getCharterActions(s).find(q=>q.action==='withdraw'&&q.allowed)!;
  const c={type:'charterAction',action:'withdraw',target:withdrawal.target} as Command;s=command(s,c);
  if(s.charter?.kind!=='frontier')throw Error('kind');assert.equal(s.charter.data.tenders.length,1);const unchanged=structuredClone(s.charter.data.tenders);
  assert.equal(dispatchCommand(s,c).ok,false);assert.deepEqual(s.charter.data.tenders,unchanged);valid(s);
});

test('audit: Refit preserves actual funded charter commitments while a new world gets an empty board',()=>{
  for(const kind of constitutions){let s=fixture(kind);
    const c:Command=kind==='commons'?{type:'charterAction',action:'publish',target:1}:kind==='precaution'?{type:'charterAction',action:'openTranche',target:1}:kind==='service'?{type:'charterAction',action:'acceptService'}:kind==='federation'?{type:'charterAction',action:'fundDistrict',target:0}:kind==='plural'?{type:'charterAction',action:'fundCare'}:{type:'charterAction',action:'bid'};
    s=command(s,c);s.legacy.discovered.push('ending:limit');s.legacy.seeds=1;const institution=structuredClone(s.charter),income=earned(s);
    s=command(s,{type:'prestige',layer:'refit'});assert.deepEqual(s.charter,institution,kind);assert.deepEqual(earned(s),income,kind);valid(s);
    s=command(s,{type:'finish',ending:'shutdown'});const priorId=s.id;
    s=command(s,{type:'prestige',layer:'reinitialize',constitution:kind,modules:[]});assert.equal(s.charter?.completed,0);assert.equal(s.charter?.appliedTier,0);assert.equal(s.charter?.automation,null);
    assert.deepEqual(s.legacy.branches.find(b=>b.id===priorId)?.checkpoint?.charter,institution,kind);valid(s);
  }
});
