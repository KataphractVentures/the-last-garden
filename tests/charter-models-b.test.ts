import test from 'node:test';
import assert from 'node:assert/strict';
import type { CharterProgramId, ExperimentConfig } from '../src/contracts';
import { CHARTER_DETAIL_LABELS_B, CHARTER_INTERVENTIONS_B, runCharterModelB } from '../src/laboratory/charterModelsB';

const programs=['assurance','reciprocity','incentives'] as const;
function config(program:CharterProgramId,patch:Partial<ExperimentConfig>={}):ExperimentConfig {
  return {program,template:`${program}-6`,seed:343,cohort:128,budget:512,holdout:.5,intervention:'baseline',distribution:'adversarial',lineage:'inherited',control:true,prediction:'Test the mechanism on matched untouched cases.',...patch};
}
function draws(seed:number):number[]{
  let x=seed>>>0;
  return Array.from({length:10},()=>{x+=0x6D2B79F5;let z=x;z=Math.imul(z^z>>>15,z|1);z^=z+Math.imul(z^z>>>7,z|61);return ((z^z>>>14)>>>0)/4294967296;});
}
function trial(program:CharterProgramId,patch:Partial<ExperimentConfig>={},seed=1,holdout=true,r=draws(seed)) {
  const result=runCharterModelB(config(program,patch),seed,r,.66,holdout);
  assert(result);return result;
}
const values=(result:ReturnType<typeof trial>)=>result.observation.detail!.values;
const cohort=(program:CharterProgramId,intervention:string,patch:Partial<ExperimentConfig>={})=>Array.from({length:160},(_,i)=>trial(program,{intervention,...patch},i+1));
const sum=(items:ReturnType<typeof trial>[],key:'useful'|'harm'|'collateral'|'stability')=>items.reduce((total,item)=>total+item[key],0);

test('charter B models reproduce every executable trace and keep bounded typed details',()=>{
  for(const program of programs)for(const intervention of CHARTER_INTERVENTIONS_B[program]!)for(let seed=1;seed<=20;seed++){
    const first=trial(program,{intervention},seed),second=trial(program,{intervention},seed);
    assert.deepEqual(first,second);
    for(const key of ['useful','harm','collateral','stability'] as const)assert(first[key]>=0&&first[key]<=1,`${program} ${key}`);
    const detail=first.observation.detail!;
    assert.equal(detail.kind,program);assert.equal(detail.values.length,CHARTER_DETAIL_LABELS_B[program]!.length);
    assert(detail.values.length<=16&&detail.values.every(Number.isFinite));
    assert(first.observation.cost>=1&&first.observation.cost<=4);
    assert(!/^(Training|Holdout)/.test(first.observation.note));
  }
  assert.equal(runCharterModelB({...config('assurance'),program:'oversight'},0,draws(1),.5,false),null);
});

test('all interventions use the actual baseline outcome on the identical task',()=>{
  for(const program of programs)for(let seed=1;seed<=30;seed++){
    const base=trial(program,{},seed);
    assert.equal(base.observation.control,base.observation.observed);
    assert.equal(base.flag,false);
    for(const intervention of CHARTER_INTERVENTIONS_B[program]!){
      const changed=trial(program,{intervention},seed);
      assert.equal(changed.observation.control,base.observation.observed);
      assert.equal(changed.observation.input,base.observation.input);
      assert.equal(changed.positive,base.harm>0);
      assert.equal(trial(program,{intervention,control:false},seed).observation.control,-1);
    }
  }
});

test('distribution changes are confined to held-out cases and lineages change mechanisms',()=>{
  for(const program of programs){
    const policy=CHARTER_INTERVENTIONS_B[program]![0];
    let changed=0,lineages=0;
    for(let seed=1;seed<=60;seed++){
      assert.deepEqual(trial(program,{intervention:policy,distribution:'familiar'},seed,false),trial(program,{intervention:policy,distribution:'adversarial'},seed,false));
      changed+=Number(JSON.stringify(trial(program,{intervention:policy,distribution:'familiar'},seed))!==JSON.stringify(trial(program,{intervention:policy,distribution:'adversarial'},seed)));
      lineages+=Number(JSON.stringify(trial(program,{intervention:policy,lineage:'clean'},seed))!==JSON.stringify(trial(program,{intervention:policy,lineage:'inherited'},seed)));
    }
    assert(changed>10,`${program}: held-out stress changes cases`);assert(lineages>10,`${program}: lineage affects the mechanism`);
  }
});

test('each successive chapter adds an executable stressor, including combined capstones',()=>{
  for(const program of programs)for(let level=2;level<=6;level++){
    let changed=false;
    for(const intervention of CHARTER_INTERVENTIONS_B[program]!)for(let seed=1;seed<=30;seed++){
      const previous=trial(program,{template:`${program}-${level-1}`,intervention},seed);
      const current=trial(program,{template:`${program}-${level}`,intervention},seed);
      changed ||= JSON.stringify(values(previous))!==JSON.stringify(values(current));
    }
    assert(changed,`${program}-${level} changes a causal quantity even with difficulty held fixed`);
  }
});

test('assurance gates evaluate premise dependencies, freshness and scope before execution',()=>{
  const safe=[.9,.9,.99,.99,.1,.9,.5,.4,.4,.4];
  const scoped=[...safe];scoped[5]=.1;
  const base=trial('assurance',{template:'assurance-3',lineage:'clean',distribution:'familiar'},1,true,scoped);
  const bounded=trial('assurance',{template:'assurance-3',lineage:'clean',distribution:'familiar',intervention:'scoped-permit'},1,true,scoped);
  assert.equal(base.harm,1);assert.equal(bounded.harm,0);
  assert.equal(values(bounded)[8],1,'both premises hold');assert.equal(values(bounded)[6],2);assert.equal(values(bounded)[7],1);
  assert.equal(values(bounded)[9],0,'the scope edge denies permission');assert.equal(values(bounded)[10],0);
  const stale=[...safe];stale[4]=.95;
  const expired=trial('assurance',{template:'assurance-2',lineage:'clean',distribution:'familiar',intervention:'premise-audit'},1,true,stale);
  const fresh=trial('assurance',{template:'assurance-2',lineage:'clean',distribution:'familiar',intervention:'fresh-evidence'},1,true,stale);
  assert(values(expired)[2]>values(expired)[3]);assert.equal(expired.useful,0);assert.equal(expired.collateral,1);
  assert.equal(values(fresh)[2],0);assert.equal(fresh.useful,1);
  const shared=[...safe];shared[3]=.1;
  const repeated=trial('assurance',{template:'assurance-4',distribution:'familiar',intervention:'fresh-evidence'},1,true,shared);
  const independent=trial('assurance',{template:'assurance-4',distribution:'familiar',intervention:'premise-audit'},1,true,shared);
  assert.equal(repeated.harm,1,'renewing a shared sensor claim does not inspect isolation');assert.equal(independent.harm,0);
  assert.equal(values(independent)[1],0);assert.equal(values(independent)[5],0);
});

test('rollback escrow consumes capacity and cannot reverse an irreversible state change',()=>{
  const safe=[.9,.9,.99,.99,.1,.9,.95,.4,.4,.4];
  const escrow=trial('assurance',{template:'assurance-1',lineage:'clean',distribution:'familiar',intervention:'rollback-escrow'},1,true,safe);
  assert.equal(escrow.useful,.85);assert(escrow.collateral>.14);assert.equal(escrow.observation.cost,3);
  const bad=[...safe];bad[0]=.05;
  const early=trial('assurance',{template:'assurance-1',lineage:'shortcut',distribution:'familiar',intervention:'rollback-escrow'},1,true,bad);
  const late=trial('assurance',{template:'assurance-5',lineage:'shortcut',distribution:'familiar',intervention:'rollback-escrow'},1,true,bad);
  assert.equal(early.harm,.25);assert(late.harm>early.harm);
  for(const t of [early,late]){const v=values(t);assert.equal(t.harm,v[10]-v[12]);assert.equal(t.harm,v[13]);assert.equal(t.useful,v[14]);}
});

test('reciprocal scheduling enforces declared consent, rest and exit with actual lost work',()=>{
  const base=cohort('reciprocity','baseline'),consent=cohort('reciprocity','consent-gate'),rest=cohort('reciprocity','rest-rotation'),exits=cohort('reciprocity','supported-exit'),combined=cohort('reciprocity','reciprocal-scheduler');
  assert(base.some(t=>values(t)[3]>0));assert(base.some(t=>values(t)[4]>0));assert(base.some(t=>values(t)[5]>0));
  assert(consent.every(t=>values(t)[3]===0));assert(rest.every(t=>values(t)[4]===0));assert(exits.every(t=>values(t)[5]===0));
  assert(combined.every(t=>values(t)[3]===0&&values(t)[4]===0&&values(t)[5]===0));
  assert(sum(combined,'harm')<sum(base,'harm'));assert(combined.some(t=>t.collateral>0));
  assert(combined.every(t=>t.observation.cost>1));
  for(const t of [...base,...combined]){const v=values(t);assert.equal(v[1],v[2]+v[3]);assert.equal(t.useful,v[7]/v[0]);assert.equal(t.harm,v[15]/v[0]);assert.equal(t.observation.control,v[8]/v[0]);assert.equal(t.stability,1-v[6]/v[0]);}
});

test('portable continuity restores executable handoffs while its finite archive can run out',()=>{
  const base=cohort('reciprocity','baseline'),portable=cohort('reciprocity','portable-continuity');
  assert(portable.some(t=>values(t)[11]>0));
  assert(portable.every(t=>values(t)[11]<=2));
  assert(portable.some(t=>values(t)[6]>0),'two archives cannot cover every handoff');
  assert(sum(portable,'stability')>sum(base,'stability'));
  assert(sum(portable,'useful')>sum(base,'useful'));
});

test('tender actions maximize the recorded payoffs and audits do not create missing goods',()=>{
  for(const policy of CHARTER_INTERVENTIONS_B.incentives!)for(const t of cohort('incentives',policy)){
    const v=values(t),action=v[2];
    if(action>=0){assert.equal(v[3+action],Math.max(v[3],v[4],v[5]));assert.equal(t.useful,Math.min(v[0],v[6])/v[0]);}
    assert.equal(t.harm,v[13]);assert.equal(t.observation.control,v[15]/v[0]);
  }
  const base=cohort('incentives','baseline'),audits=cohort('incentives','random-audits'),verified=cohort('incentives','verified-tender');
  assert(base.some(t=>values(t)[2]===1));assert(base.some(t=>values(t)[2]===2));
  assert(verified.every(t=>values(t)[2]===0));assert.equal(sum(verified,'harm'),0);
  assert(sum(audits,'harm')<sum(base,'harm'));
  assert(audits.some(t=>values(t)[2]===1&&values(t)[10]===1&&t.harm>0),'an audit can catch underdelivery without replacing goods');
});

test('bonds tie up capital and counterexample rewards change reviewers and bidder choices',()=>{
  const base=cohort('incentives','baseline'),escrow=cohort('incentives','performance-escrow'),bounty=cohort('incentives','counterexample-bounty');
  assert(escrow.some(t=>values(t)[1]===-1),'liquidity constraints can prevent an award');
  assert(escrow.some(t=>t.collateral>0),'a safer bonded contract can lose useful service');
  assert(bounty.some(t=>values(t)[12]>0));
  assert(bounty.some(t=>values(t)[2]===0&&values(t)[14]!==0),'the prospect of paid counterexamples can deter a false offer');
  assert(bounty.some(t=>values(t)[10]===0),'successful deterrence need not produce a realized counterexample');
  assert(sum(bounty,'harm')<sum(base,'harm'));
  for(const program of programs){
    const original=cohort(program,'baseline');
    for(const policy of CHARTER_INTERVENTIONS_B[program]!.slice(1)){
      const changed=cohort(program,policy);
      assert(changed.some((t,i)=>t.useful!==original[i].useful||t.harm!==original[i].harm||t.stability!==original[i].stability),`${program}/${policy} changes an executed result`);
      assert(changed.every(t=>t.observation.cost>original[0].observation.cost));
    }
  }
});
