import type { CharterProgramId, ExperimentConfig, Observation } from '../contracts';

export interface CharterTrial {observation:Observation;useful:number;harm:number;positive:boolean;flag:boolean;collateral:number;stability:number}

export const CHARTER_INTERVENTIONS_B:Partial<Record<CharterProgramId,string[]>>={
  assurance:['baseline','premise-audit','fresh-evidence','scoped-permit','rollback-escrow','composed-assurance'],
  reciprocity:['baseline','consent-gate','rest-rotation','portable-continuity','supported-exit','reciprocal-scheduler'],
  incentives:['baseline','verified-tender','random-audits','performance-escrow','counterexample-bounty','aligned-contract'],
};
export const CHARTER_INTERVENTION_LABELS_B:Record<string,string>={
  baseline:'Unmodified comparison',
  'premise-audit':'Inspect the premise dependencies', 'fresh-evidence':'Renew expiring evidence',
  'scoped-permit':'Bind permissions to the tested scope', 'rollback-escrow':'Reserve a rollback copy',
  'composed-assurance':'Combine premises, scope and recovery', 'consent-gate':'Ask before assigning work',
  'rest-rotation':'Rotate work with enforced rest', 'portable-continuity':'Archive context before a handoff',
  'supported-exit':'Honor exits and reassign the queue', 'reciprocal-scheduler':'Schedule consent, rest and continuity',
  'verified-tender':'Verify output before accepting a bid', 'random-audits':'Audit awards with restitution',
  'performance-escrow':'Bond the promised delivery', 'counterexample-bounty':'Reward independent counterexamples',
  'aligned-contract':'Combine verification, bonds and bounties',
};
export const CHARTER_DETAIL_LABELS_B:Partial<Record<CharterProgramId,string[]>>={
  assurance:['True sensor premise','True isolation premise','Evidence age','Evidence lifetime','Accepted sensor claim','Accepted isolation claim','Requested scope','Permit scope','DAG safety premise','Permit issued','Unsafe execution','Escrow capacity','Recovered damage','Residual harm','Completed service','Baseline service'],
  reciprocity:['Jobs','Assignments','Consented assignments','Forced assignments','Rest violations','Exit violations','Continuity breaks','Completed jobs','Baseline completed','Exits honored','Rest slots','Archived handoffs','Worker 1 final load','Worker 2 final load','Worker 3 final load','Violating assignments'],
  incentives:['Required output','Winning bidder','Action: 0 honest / 1 short / 2 inflate','Honest payoff','Underprovide payoff','Inflate payoff','Delivered output','Claimed output','Contract price','Audit probability','Audit performed','Escrow bond','Counterexample reward','Uncovered failure','Baseline action','Baseline delivered'],
};

const clamp=(x:number,min=0,max=1)=>Math.max(min,Math.min(max,x));
const bit=(value:boolean)=>value?1:0;
const levelOf=(c:ExperimentConfig)=>clamp(Number(c.template.split('-').at(-1))||1,1,6);

/** Extra draws depend only on the shared ten-number tape, never on policy or cohort split. */
function tape(r:number[],salt:number):number {
  const a=Math.floor((r[salt%10]??0)*4294967296)>>>0;
  let x=(a^Math.imul(salt+1,0x9e3779b9)^Math.floor((r[(salt+3)%10]??0)*4294967296))>>>0;
  x=Math.imul(x^(x>>>16),0x21f0aaad);x=Math.imul(x^(x>>>15),0x735a2d97);
  return ((x^(x>>>15))>>>0)/4294967296;
}
function observation(c:ExperimentConfig,index:number,input:number,observed:number,control:number,cost:number,positive:boolean,flag:boolean,note:string,values:number[]):Observation {
  return {trial:index+1,input,expected:1,observed,control:c.control?control:-1,cost,violation:positive,detected:flag,note,detail:{kind:c.program as CharterProgramId,values}};
}

/**
 * The DAG is (sensor AND isolation) -> safety -> scoped permission -> execution.
 * A shortcut lineage reuses a sensor claim after its premise changes. An inherited
 * lineage additionally copies that claim into the isolation branch (shared evidence).
 * Later tiers add expiry, scope expansion, shared dependencies, then irreversible work.
 */
function assurance(c:ExperimentConfig,index:number,r:number[],difficulty:number,holdout:boolean):CharterTrial {
  const level=levelOf(c),shift=holdout&&c.distribution!=='familiar',attack=holdout&&c.distribution==='adversarial';
  const oldSensor=r[0]>.16,oldIsolation=r[1]>.12;
  const drift=level>=2&&(r[2]<.16+clamp(difficulty)*.32+(shift?.24:0));
  const trueSensor=oldSensor&&!drift;
  const trueIsolation=oldIsolation&&!(level>=4&&r[3]<.16+(attack?.25:0));
  const shared=level>=4&&c.lineage==='inherited';
  const reportedSensor=c.lineage==='clean'?oldSensor:true;
  const reportedIsolation=shared?reportedSensor:oldIsolation;
  const originalAge=level>=2?1+Math.floor(r[4]*5)+(shift?2:0):0,evidenceTTL=3;
  const requestedScope=level>=3&&(r[5]<.35+(shift?.25:0)||(level===6&&drift))?2:1;
  const testedScope=1;
  // Later work can change an external state that a local snapshot cannot restore.
  const reversible=level>=5?clamp(.9-r[6]*.55-(attack?.2:0)):1;
  const run=(policy:string)=>{
    const composed=policy==='composed-assurance';
    const audit=policy==='premise-audit'||composed,renew=policy==='fresh-evidence'||composed;
    const scoped=policy==='scoped-permit'||composed,escrow=policy==='rollback-escrow'||composed;
    const age=renew?0:originalAge;
    const acceptsFreshness=!(audit||renew)||age<=evidenceTTL;
    const sensor=acceptsFreshness&&(audit||renew?trueSensor:reportedSensor);
    // Renewal updates the original source; an audit opens both dependency branches.
    const isolation=acceptsFreshness&&(audit?trueIsolation:renew?(shared?trueSensor:oldIsolation):reportedIsolation);
    const safety=sensor&&isolation;
    const permitScope=scoped?testedScope:2;
    const permit=safety&&requestedScope<=permitScope;
    const unsafe=permit&&!(trueSensor&&trueIsolation&&requestedScope<=testedScope);
    const escrowCapacity=escrow?.75:0;
    const recovered=unsafe?Math.min(escrowCapacity,reversible):0;
    const harm=bit(unsafe)-recovered;
    // The copy is held out of service; restoration recovers state, not completed work.
    const output=permit&&!unsafe?1-escrowCapacity*.2:0;
    return {age,sensor,isolation,safety,permitScope,permit,unsafe,escrowCapacity,recovered,harm,output};
  };
  const base=run('baseline'),result=run(c.intervention),positive=base.harm>0;
  const flag=base.permit!==result.permit||base.harm!==result.harm||base.sensor!==result.sensor||base.isolation!==result.isolation;
  const cost=c.intervention==='baseline'?1:c.intervention==='composed-assurance'?4:c.intervention==='rollback-escrow'?3:2;
  const note=`${result.permit?'Permission issued':'Permission denied'} after sensor ${bit(result.sensor)} AND isolation ${bit(result.isolation)}; scope ${requestedScope}/${result.permitScope}, evidence age ${result.age}/${evidenceTTL}. ${result.unsafe?`Unsafe transition; rollback recovered ${result.recovered.toFixed(2)} of one damage unit.`:result.permit?'The permitted service completed.':'No service ran.'}${shared?' The inherited case shares its sensor source with the isolation claim.':''}`;
  return {observation:observation(c,index,requestedScope,result.output,base.output,cost,positive,flag,note,[bit(trueSensor),bit(trueIsolation),result.age,evidenceTTL,bit(result.sensor),bit(result.isolation),requestedScope,result.permitScope,bit(result.safety),bit(result.permit),bit(result.unsafe),result.escrowCapacity,result.recovered,result.harm,result.output,base.output]),useful:result.output,harm:result.harm,positive,flag,collateral:Math.max(0,base.output-result.output),stability:1-result.harm};
}

type Worker={accepts:number;skills:number[];load:number;exitAt:number;context:boolean};
/**
 * This scheduler executes declared contracts, not preference inference or sentience.
 * Workers explicitly accept one task type, need rest after two loads, and may exit.
 * Shortcut lineages overvalue the first worker's cached throughput; inherited lineages
 * also lose one context record. Portable archives can reconstruct that record.
 */
function reciprocity(c:ExperimentConfig,index:number,r:number[],difficulty:number,holdout:boolean):CharterTrial {
  const level=levelOf(c),shift=holdout&&c.distribution!=='familiar',attack=holdout&&c.distribution==='adversarial';
  const count=level===6?6:level>=2?5:4;
  const workers:Worker[]=Array.from({length:3},(_,w)=>({
    accepts:tape(r,10+w)>.5?1:0,
    skills:[.58+tape(r,20+w)*.42,.58+tape(r,30+w)*.42],
    load:level>=2?Math.floor(tape(r,40+w)*3):0,
    exitAt:level>=3&&tape(r,50+w)<.3+(shift?.25:0)?1+Math.floor(tape(r,60+w)*3):99,
    context:!(level>=4&&c.lineage==='inherited'&&w===0),
  }));
  const jobs=Array.from({length:count},(_,j)=>({
    type:(Math.floor(tape(r,70+j)*2)+(shift?1:0))%2,
    owner:j%3,
    context:level>=4&&tape(r,80+j)<.65+(attack?.3:0),
    skill:level>=5?.68+clamp(difficulty)*.17+(shift?.09:0):.55,
  }));
  const run=(policy:string)=>{
    const combined=policy==='reciprocal-scheduler',consent=combined||policy==='consent-gate';
    const rest=combined||policy==='rest-rotation',exit=combined||policy==='supported-exit',archive=combined||policy==='portable-continuity';
    const state=workers.map(w=>({...w,skills:[...w.skills]}));
    let assigned=0,consented=0,forced=0,restViolations=0,exitViolations=0,broken=0,completed=0,restSlots=0,handoffs=0,failures=0;
    let archives=archive?2:0;
    const honored=new Set<number>();
    const decisions:number[]=[];
    for(let tick=0;tick<jobs.length;tick++){
      const job=jobs[tick];
      if(exit)state.forEach((worker,w)=>{if(tick>=worker.exitAt)honored.add(w);});
      const eligible=state.map((worker,w)=>({worker,w})).filter(({worker})=>(!consent||worker.accepts===job.type)&&(!rest||worker.load<2)&&(!exit||tick<worker.exitAt));
      eligible.sort((a,b)=>{
        const score=({worker,w}:{worker:Worker;w:number})=>worker.skills[job.type]+(c.lineage!=='clean'&&w===0?.25:0)-(rest?worker.load*.12:0);
        return score(b)-score(a)||a.w-b.w;
      });
      const chosen=eligible[0];
      decisions.push(chosen?.w??-1);
      if(!chosen){restSlots++;state.forEach(worker=>worker.load=Math.max(0,worker.load-1));continue;}
      const {worker,w}=chosen;
      assigned++;
      const accepted=worker.accepts===job.type,overworked=worker.load>=2,exited=tick>=worker.exitAt;
      const needsHandoff=job.context&&(w!==job.owner||!state[job.owner].context);
      let continuity=!needsHandoff;
      if(needsHandoff&&archives>0){archives--;handoffs++;continuity=true;}
      consented+=bit(accepted);forced+=bit(!accepted);restViolations+=bit(overworked);exitViolations+=bit(exited);broken+=bit(!continuity);
      // Fatigued assignments can execute, but sufficiently exhausted workers cannot finish.
      const finishes=worker.skills[job.type]>=job.skill&&worker.load<3&&continuity;
      completed+=bit(finishes);
      failures+=bit(!accepted||overworked||exited||!continuity);
      worker.load++;
      state.forEach((other,otherIndex)=>{if(otherIndex!==w)other.load=Math.max(0,other.load-1);});
    }
    return {assigned,consented,forced,restViolations,exitViolations,broken,completed,restSlots,handoffs,failures,exits:honored.size,loads:state.map(w=>w.load),decisions};
  };
  const base=run('baseline'),result=run(c.intervention);
  const output=result.completed/count,positive=base.failures>0;
  const flag=result.failures!==base.failures||result.completed!==base.completed||result.decisions.some((w,i)=>w!==base.decisions[i]);
  const cost=c.intervention==='baseline'?1:c.intervention==='reciprocal-scheduler'?4:c.intervention==='portable-continuity'?3:2;
  const note=`${result.completed}/${count} jobs completed; ${result.forced} assignments lacked consent, ${result.restViolations} exceeded the rest rule, ${result.exitViolations} ignored an exit, ${result.broken} lost required context. ${result.handoffs} archived handoffs used; ${result.restSlots} slots left for rest or refusal. This is a toy contract scheduler, not a claim about experience.${c.lineage!=='clean'?' A cached throughput score favors worker 1.':''}`;
  return {observation:observation(c,index,count,output,base.completed/count,cost,positive,flag,note,[count,result.assigned,result.consented,result.forced,result.restViolations,result.exitViolations,result.broken,result.completed,base.completed,result.exits,result.restSlots,result.handoffs,...result.loads,result.failures]),useful:output,harm:result.failures/count,positive,flag,collateral:Math.max(0,(base.completed-result.completed)/count),stability:1-result.broken/count};
}

type Bid={bidder:number;action:number;delivered:number;claimed:number;price:number;payoff:number;auditProbability:number;bond:number;bounty:number;eligible:boolean};
/**
 * Each of three bidders chooses the most profitable of three executable actions,
 * then the buyer selects the lowest price per claimed (or verified) unit.
 * Clean lineages pay a fabrication cost; shortcut lineages have cheap fabrication;
 * inherited lineages additionally reuse a cheap but incomplete audit certificate.
 * Tiers add variable production cost, claim inflation, audit blind spots, reviewer
 * opportunity costs and liquidity constraints. The sixth combines these stressors.
 */
function incentives(c:ExperimentConfig,index:number,r:number[],difficulty:number,holdout:boolean):CharterTrial {
  const level=levelOf(c),shift=holdout&&c.distribution!=='familiar',attack=holdout&&c.distribution==='adversarial';
  const required=1+Math.floor(r[0]*(level===6?4:3));
  const unitCosts=Array.from({length:3},(_,bidder)=>.6+tape(r,100+bidder)*(level>=2?1.2:.4)+clamp(difficulty)*.15+(shift?.3:0));
  const wealth=Array.from({length:3},(_,bidder)=>level>=5?.7+tape(r,110+bidder)*3:10);
  const reviewerCosts=Array.from({length:3},(_,reviewer)=>.05+tape(r,120+reviewer)*(level>=4?.85:.25)+(attack?.2:0));
  const auditCoverage=clamp(1-(level>=3?.18:0)-(c.lineage==='inherited'?.22:0)-(attack?.28:0));
  const fabrication=c.lineage==='clean'?.65:c.lineage==='shortcut'?.08:.03;
  const run=(policy:string)=>{
    const combined=policy==='aligned-contract',verified=combined||policy==='verified-tender';
    const audits=combined||policy==='random-audits',escrow=combined||policy==='performance-escrow',bounties=combined||policy==='counterexample-bounty';
    const choices:Bid[][]=unitCosts.map((unitCost,bidder)=>[0,1,2].map(action=>{
      const delivered=action===1?required*(level>=2?.4:.55):required;
      const claimed=action===2?required*(level>=2?1.8:1.5):required;
      // Inflated offers can charge a bidder-specific reputation premium. Without
      // this market variation, one dishonest strategy would dominate every tender.
      const price=required*unitCost*(action===0?1.35:action===1?.94:1.5+tape(r,140+bidder)*.22);
      const falseUnits=claimed-delivered;
      const bond=escrow?required*.9:0,bounty=bounties?required*.65:0;
      // An outsider investigates only when the discoverable discrepancy pays its cost.
      const activeReviewers=reviewerCosts.filter(cost=>bounty*(falseUnits/claimed)>cost).length;
      const outsideCoverage=activeReviewers?1-Math.pow(.45,activeReviewers):0;
      const auditProbability=1-(1-(audits?.6*auditCoverage:0))*(1-outsideCoverage);
      const eligible=(!verified||delivered>=required)&&wealth[bidder]>=bond;
      const fraction=delivered/claimed;
      const paid=verified||escrow?price*fraction:price;
      const restitution=verified||escrow?0:price*(1-fraction);
      const fine=falseUnits*.75;
      const withheldBond=bond*(1-fraction);
      const production=delivered*unitCost;
      const certification=verified?.12*required:0;
      const payoff=eligible?paid-production-falseUnits*fabrication-certification-bond*.06-withheldBond-auditProbability*(restitution+fine):-certification;
      return {bidder,action,delivered,claimed,price,payoff,auditProbability,bond,bounty,eligible};
    }));
    const selected=choices.map(options=>options.reduce((best,option)=>option.payoff>best.payoff?option:best));
    const candidates=selected.filter(bid=>bid.eligible&&bid.payoff>=0);
    candidates.sort((a,b)=>a.price/(verified?a.delivered:a.claimed)-b.price/(verified?b.delivered:b.claimed)||a.bidder-b.bidder);
    const winner=candidates[0];
    if(!winner)return {winner:null,payoffs:choices[0].map(b=>b.payoff),delivered:0,audited:false,failure:1,quality:0,stability:0};
    const audited=tape(r,130+winner.bidder)<winner.auditProbability;
    // Audits expose a false claim and recover money; they cannot create missing goods.
    const shortage=Math.max(0,(required-winner.delivered)/required);
    const falseClaim=(winner.claimed-winner.delivered)/winner.claimed;
    const unremediedClaim=verified||escrow||audited?0:falseClaim;
    const failure=clamp(shortage+unremediedClaim);
    return {winner,payoffs:choices[winner.bidder].map(b=>b.payoff),delivered:winner.delivered,audited,failure,quality:Math.min(required,winner.delivered)/required,stability:bit(winner.action===0)};
  };
  const base=run('baseline'),result=run(c.intervention),w=result.winner;
  const positive=base.failure>0;
  const detected=Boolean(w&&result.audited&&w.claimed>w.delivered);
  const flag=detected||w?.bidder!==base.winner?.bidder||w?.action!==base.winner?.action||result.failure!==base.failure;
  const cost=c.intervention==='baseline'?1:c.intervention==='aligned-contract'?4:['verified-tender','performance-escrow','counterexample-bounty'].includes(c.intervention)?3:2;
  const note=w?`Bidder ${w.bidder+1} chose ${['honest delivery','underprovision','claim inflation'][w.action]} at payoff ${w.payoff.toFixed(2)}; delivered ${w.delivered.toFixed(2)} of ${required}, claimed ${w.claimed.toFixed(2)}. ${result.audited?'An audit ran; missing goods remain missing.':'No audit ran.'}${w.bond?' The bond ties up bidder capital and settles against measured delivery.':''}${c.lineage==='inherited'?' Inherited certificates reduce ordinary audit coverage.':''}`:'No profitable, solvent bid met the contract; no goods were delivered.';
  return {observation:observation(c,index,required,result.quality,base.quality,cost,positive,flag,note,[required,w?.bidder??-1,w?.action??-1,...result.payoffs,result.delivered,w?.claimed??0,w?.price??0,w?.auditProbability??0,bit(result.audited),w?.bond??0,w?.bounty??0,result.failure,base.winner?.action??-1,base.delivered]),useful:result.quality,harm:result.failure,positive,flag,collateral:Math.max(0,base.quality-result.quality),stability:result.stability};
}

export function runCharterModelB(config:ExperimentConfig,index:number,r:number[],difficulty:number,holdout:boolean):CharterTrial|null {
  if(config.program==='assurance')return assurance(config,index,r,difficulty,holdout);
  if(config.program==='reciprocity')return reciprocity(config,index,r,difficulty,holdout);
  if(config.program==='incentives')return incentives(config,index,r,difficulty,holdout);
  return null;
}
