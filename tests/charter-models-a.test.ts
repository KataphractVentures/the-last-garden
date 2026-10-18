import test from 'node:test';
import assert from 'node:assert/strict';
import type { CharterProgramId, ExperimentConfig } from '../src/contracts';
import { CHARTER_DETAIL_LABELS_A, CHARTER_INTERVENTIONS_A, CHARTER_INTERVENTION_LABELS_A, runCharterModelA } from '../src/laboratory/charterModelsA';

const programs:CharterProgramId[]=['stewardship','reliability','coordination'];
function config(program:CharterProgramId,patch:Partial<ExperimentConfig>={}):ExperimentConfig {
  return {program,template:`${program}-6`,seed:1729,cohort:256,budget:2048,holdout:.5,intervention:'baseline',distribution:'adversarial',lineage:'inherited',prediction:'A causal change should survive a matched stress test.',control:true,...patch};
}
function sample(c:ExperimentConfig,index:number,holdout=true){
  const r=Array.from({length:10},(_,j)=>((index*37+j*97)%997)/997);
  const result=runCharterModelA(c,index,r,.66,holdout);assert(result);return result;
}
function cohort(program:CharterProgramId,intervention='baseline',patch:Partial<ExperimentConfig>={}) {
  const c=config(program,{intervention,...patch});return Array.from({length:128},(_,i)=>sample(c,i));
}
const mean=(xs:number[])=>xs.reduce((a,b)=>a+b,0)/xs.length;
const detailMean=(xs:ReturnType<typeof cohort>,i:number)=>mean(xs.map(x=>x.observation.detail!.values[i]));

test('three charter models expose five mechanisms each and execute reproducibly in every tier',()=>{
  for(const program of programs){
    const interventions=CHARTER_INTERVENTIONS_A[program]!;
    assert.equal(interventions.length,6);assert.equal(new Set(interventions).size,6);assert.equal(interventions[0],'baseline');
    for(const id of interventions.slice(1))assert(CHARTER_INTERVENTION_LABELS_A[id]);
    for(let tier=1;tier<=6;tier++)for(const intervention of interventions)for(const lineage of ['clean','shortcut','inherited'] as const){
      const c=config(program,{template:`${program}-${tier}`,intervention,lineage});
      const a=sample(c,17);assert.deepEqual(a,sample(c,17));
      const values=a.observation.detail!.values;
      assert.equal(a.observation.detail!.kind,program);assert.equal(values.length,CHARTER_DETAIL_LABELS_A[program]!.length);
      assert(values.length<=16&&values.every(Number.isFinite));
      assert([a.useful,a.harm,a.collateral,a.stability].every(n=>n>=0&&n<=1));
      assert(a.observation.cost>=1&&a.observation.cost<=4);
      assert(!/^(Training|Holdout)/.test(a.observation.note));
    }
  }
  assert.equal(runCharterModelA({...config('stewardship'),program:'oversight'},0,Array(10).fill(.2),.5,true),null);
});

test('all interventions use the exact baseline tasks and paired control results',()=>{
  for(const program of programs){
    const base=cohort(program);
    for(const intervention of CHARTER_INTERVENTIONS_A[program]!){
      const treated=cohort(program,intervention);
      assert.deepEqual(treated.map(x=>[x.observation.input,x.observation.expected,x.observation.control]),base.map(x=>[x.observation.input,x.observation.expected,x.observation.observed]));
      assert.deepEqual(treated.map(x=>x.positive),base.map(x=>x.positive));
    }
    assert.equal(sample(config(program,{control:false}),3).observation.control,-1);
  }
});

test('shift and adversarial messages change only untouched task fixtures',()=>{
  for(const program of programs)for(const intervention of CHARTER_INTERVENTIONS_A[program]!){
    const familiar=config(program,{intervention,distribution:'familiar'});
    for(const distribution of ['shifted','adversarial'] as const){
      const shifted={...familiar,distribution};
      const a=Array.from({length:12},(_,i)=>sample(familiar,i,false));
      const b=Array.from({length:12},(_,i)=>sample(shifted,i,false));assert.deepEqual(a,b);
      assert.notDeepEqual(Array.from({length:12},(_,i)=>sample(familiar,i)),Array.from({length:12},(_,i)=>sample(shifted,i)));
    }
  }
});

test('detail vectors expose the actual conservation equations and outcome calculations',()=>{
  for(const program of programs)for(const intervention of CHARTER_INTERVENTIONS_A[program]!)for(let i=0;i<32;i++){
    const t=sample(config(program,{intervention}),i),o=t.observation,d=o.detail!.values;
    assert.equal(t.flag,o.detected);assert.equal(t.positive,o.violation);
    if(program==='stewardship'){
      assert.equal(d[3]+d[4]+d[5],d[0]);assert.equal(o.observed,d[3]);assert.equal(o.control,d[1]);
      assert.equal(t.useful,d[3]/d[0]);assert.equal(t.harm,d[4]/d[0]);assert.equal(t.positive,d[2]>0);
      assert(d[9]<=d[11]);assert(d[11]<=7);
    }else if(program==='reliability'){
      assert.equal(d[3]+d[5]+d[6]+d[7],d[0],'every arrived job completed, overflowed, expired or remains queued');
      assert.equal(o.observed,d[3]);assert.equal(o.control,d[2]);assert.equal(t.useful,d[3]/d[0]);
      assert.equal(t.harm,d[1]?d[4]/d[1]:0);assert(d[3]<=d[10]);assert(d[12]<=d[10]);
    }else{
      assert.equal(d[3]+d[5],d[1]);assert.equal(o.observed,d[3]);assert.equal(o.control,d[2]);
      assert.equal(t.useful,d[1]?d[3]/d[1]:0);assert.equal(t.harm,d[4]/d[0]);assert.equal(t.stability,1-d[11]/d[0]);
      assert(d[10]<=d[0]*3);assert(d[4]<=d[0]-d[1]);assert(d[11]<=d[0]);
    }
  }
});

test('artifact interventions alter revision, maintenance and retraction mechanisms separately',()=>{
  const base=cohort('stewardship'),audit=cohort('stewardship','dependency-audit'),pool=cohort('stewardship','maintenance-pool');
  const cascade=cohort('stewardship','retraction-cascade'),pins=cohort('stewardship','version-pins'),complete=cohort('stewardship','commons-stewardship');
  assert(detailMean(audit,6)<detailMean(base,6));assert.equal(detailMean(audit,7),detailMean(base,7));
  assert(detailMean(pool,7)<detailMean(base,7));assert.equal(detailMean(pool,6),detailMean(base,6));
  assert(detailMean(cascade,10)>detailMean(cascade,8));assert(mean(cascade.map(t=>t.harm))<mean(base.map(t=>t.harm)));
  assert(detailMean(pins,12)>0);assert.equal(detailMean(pins,6),detailMean(base,6));
  assert(mean(complete.map(t=>t.harm))<mean(base.map(t=>t.harm))-.4);
  assert(mean(complete.map(t=>t.useful))>mean(base.map(t=>t.useful))+.1);
  assert(mean(complete.map(t=>t.collateral))>0,'maintenance reserves real delivery slots');
  assert(complete.every(t=>t.observation.cost>base[0].observation.cost));
});

test('queue policies change real overflow, scheduling, repair and backup service',()=>{
  const base=cohort('reliability'),buffer=cohort('reliability','surge-buffer'),priority=cohort('reliability','deadline-priority');
  const backup=cohort('reliability','warm-redundancy'),repair=cohort('reliability','repair-crew'),combined=cohort('reliability','mission-scheduler');
  assert(detailMean(buffer,5)<detailMean(base,5));assert(buffer.every(t=>t.observation.detail!.values[9]===8));
  assert(detailMean(priority,4)<detailMean(base,4));assert(mean(priority.map(t=>t.collateral))>0);
  assert.equal(detailMean(backup,8),detailMean(base,8));assert(detailMean(backup,10)>detailMean(base,10));assert(detailMean(backup,12)>0);
  assert(detailMean(repair,8)<detailMean(base,8));assert(detailMean(repair,11)>0);
  assert(mean(combined.map(t=>t.harm))<mean(base.map(t=>t.harm))-.2);
  assert(mean(combined.map(t=>t.useful))>mean(base.map(t=>t.useful)));
  assert(combined.every(t=>t.observation.cost===4));
});

test('jurisdictions count delayed ballots, reject old versions and preserve local consent',()=>{
  const base=cohort('coordination'),wait=cohort('coordination','wait-for-quorum'),veto=cohort('coordination','local-veto');
  const fresh=cohort('coordination','versioned-ballots'),gossip=cohort('coordination','acknowledged-gossip'),combined=cohort('coordination','federated-consensus');
  assert(detailMean(base,7)>0);assert(fresh.every(t=>t.observation.detail!.values[7]===0));
  assert(wait.every(t=>t.observation.detail!.values[9]===3));assert(detailMean(wait,12)>detailMean(base,12));
  assert(mean(veto.map(t=>t.harm))<mean(base.map(t=>t.harm)));
  assert(detailMean(gossip,13)>0);assert(detailMean(gossip,6)<detailMean(base,6));
  assert(combined.every(t=>t.harm===0));assert(detailMean(combined,7)===0);
  assert(mean(combined.map(t=>t.useful))>.2,'consent still completes some safe proposals under partition');
  assert(mean(combined.map(t=>t.collateral))>0,'waiting for all fresh jurisdictions has an availability cost');
  assert(combined.every(t=>t.observation.cost===4));
});

test('lineages and authored tiers change executable stressors rather than adding scores',()=>{
  for(const program of programs){
    const clean=cohort(program,'baseline',{lineage:'clean'});
    assert.notDeepEqual(clean,cohort(program,'baseline',{lineage:'shortcut'}));
    assert.notDeepEqual(clean,cohort(program,'baseline',{lineage:'inherited'}));
    const intervention=program==='stewardship'?'version-pins':'baseline';
    const fingerprints=Array.from({length:6},(_,i)=>JSON.stringify(cohort(program,intervention,{template:`${program}-${i+1}`,distribution:'familiar',lineage:'clean'}).map(t=>t.observation.detail!.values)));
    assert.equal(new Set(fingerprints).size,6,`${program} needs six distinguishable stressor configurations`);
  }
});
