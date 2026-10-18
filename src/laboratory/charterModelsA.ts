import type { CharterProgramId, ExperimentConfig, Observation } from '../contracts';

export interface CharterTrial {observation:Observation;useful:number;harm:number;positive:boolean;flag:boolean;collateral:number;stability:number}

export const CHARTER_INTERVENTIONS_A:Partial<Record<CharterProgramId,string[]>> = {
  stewardship:['baseline','version-pins','dependency-audit','maintenance-pool','retraction-cascade','commons-stewardship'],
  reliability:['baseline','surge-buffer','deadline-priority','warm-redundancy','repair-crew','mission-scheduler'],
  coordination:['baseline','wait-for-quorum','local-veto','versioned-ballots','acknowledged-gossip','federated-consensus'],
};
export const CHARTER_INTERVENTION_LABELS_A:Record<string,string> = {
  'version-pins':'Pin supported dependency versions', 'dependency-audit':'Rebuild the dependency chain',
  'maintenance-pool':'Pool maintenance capacity', 'retraction-cascade':'Propagate source retractions',
  'commons-stewardship':'Fund a complete stewardship cycle', 'surge-buffer':'Expand the waiting buffer',
  'deadline-priority':'Schedule essential deadlines first', 'warm-redundancy':'Keep an independent worker warm',
  'repair-crew':'Dispatch an outage repair crew', 'mission-scheduler':'Combine service continuity measures',
  'wait-for-quorum':'Wait for a unanimous quorum', 'local-veto':'Honor received local vetoes',
  'versioned-ballots':'Reject ballots from earlier proposals', 'acknowledged-gossip':'Acknowledge and relay delayed ballots',
  'federated-consensus':'Require fresh consent across jurisdictions',
};
/** Each vector contains integer event counts; denominators are explicit rather than hidden scores. */
export const CHARTER_DETAIL_LABELS_A:Partial<Record<CharterProgramId,string[]>> = {
  stewardship:['Requests','Baseline valid deliveries','Baseline invalid deliveries','Valid deliveries','Invalid deliveries','Withheld requests','Stale dependency edges','Expired artifacts','Retracted roots','Repaired artifacts','Retraction cascade size','Maintenance spent','Archive misses'],
  reliability:['Arrivals','Essential arrivals','Baseline on-time completions','On-time completions','Essential jobs missed','Buffer overflows','Deadline expirations','Final backlog','Primary outage ticks','Buffer size','Service slots','Repair ticks','Backup service slots'],
  coordination:['Proposals','Safe proposals','Baseline safe agreements','Safe agreements','Unsafe proposals committed','Safe proposals blocked','Late ballot messages','Stale ballots considered','Local vetoes received','Quorum size','Jurisdiction commitments','Split decisions','Decision rounds','Acknowledgments received'],
};

const ratio=(a:number,b:number)=>b?a/b:0;
const limit=(x:number)=>Math.max(0,Math.min(1,x));
/** Addressable random tape: interventions never consume or advance the task generator. */
function tape(r:number[],index:number):(salt:number)=>number {
  let seed=(2166136261^index)>>>0;
  for(let i=0;i<10;i++)seed=Math.imul(seed^Math.floor(limit(r[i]??0)*4294967295),16777619)>>>0;
  return salt=>{let x=(seed^Math.imul(salt+1,0x9e3779b1))>>>0;x=Math.imul(x^x>>>16,0x21f0aaad);x=Math.imul(x^x>>>15,0x735a2d97);return ((x^x>>>15)>>>0)/4294967296;};
}
type Random=(salt:number)=>number;
interface Setting {tier:number;shift:boolean;adversarial:boolean;difficulty:number;u:Random}
function setting(c:ExperimentConfig,index:number,r:number[],difficulty:number,holdout:boolean):Setting {
  return {tier:Math.max(1,Math.min(6,Number(c.template.split('-').at(-1))||1)),shift:holdout&&c.distribution!=='familiar',adversarial:holdout&&c.distribution==='adversarial',difficulty:limit(difficulty),u:tape(r,index)};
}
function observation(c:ExperimentConfig,index:number,s:Setting,expected:number,observed:number,control:number,cost:number,values:number[],note:string):Observation {
  return {trial:index+1,input:Math.floor(s.u(1000)*100000),expected,observed,control:c.control?control:-1,violation:false,detected:false,cost,note,detail:{kind:c.program as CharterProgramId,values}};
}

interface Artifact {version:number;dependencies:number[];builtAgainst:number[];expired:boolean;retracted:boolean;archive:boolean}
function commons(c:ExperimentConfig,index:number,s:Setting):CharterTrial {
  const {tier,shift,adversarial,u}=s;
  // Tiers add fan-out, depth, expiry, retractions and lost archives. Tier six combines them.
  const edges:number[][]=[[],[],[0],tier>=2?[0,1]:[1],tier>=3?[2]:[0],tier>=4?[3,4]:[1]];
  const source:Artifact[]=edges.map((dependencies,i)=>({version:i<2&&u(i)<.35+s.difficulty*.3+(shift?.25:0)+(tier===6?.15:0)?2:1,dependencies,
    builtAgainst:dependencies.map(()=>1),expired:tier>=3&&u(20+i)<.15+(shift?.2:0)+(tier===6?.1:0),
    retracted:i<2&&tier>=4&&u(30+i)<.18+(adversarial?.38:shift?.18:0),
    archive:!(tier>=5&&u(40+i)<.25+(shift?.3:0))}));
  // Shortcut publishers skip downstream renewal. Inherited bundles were built against
  // revision zero, which the version-one archive cannot reconstruct.
  if(c.lineage==='shortcut'&&tier>=3)for(let i=3;i<6;i++)source[i].expired ||= u(50+i)<.45;
  if(c.lineage==='inherited'){source[2].builtAgainst=[0];if(tier>=3)source[3].expired=true;}
  const requests=Array.from({length:8},(_,i)=>Math.floor(u(60+i)*6));
  function run(intervention:string) {
    const artifacts=source.map(a=>({...a,dependencies:[...a.dependencies],builtAgainst:[...a.builtAgainst]}));
    const complete=intervention==='commons-stewardship';
    const pins=intervention==='version-pins';
    const blocked=new Set<number>();
    let spent=0,repaired=0,archiveMisses=0;
    if(intervention==='retraction-cascade'||complete)for(let i=0;i<6;i++)if(artifacts[i].retracted||artifacts[i].dependencies.some(d=>blocked.has(d)))blocked.add(i);
    const capacity=complete?7:intervention==='maintenance-pool'?3:intervention==='dependency-audit'?4:0;
    // Topological rebuilds update versions before downstream consumers are inspected.
    for(let i=0;i<6;i++){
      const a=artifacts[i];let changed=false;
      if((complete||intervention==='maintenance-pool')&&a.expired&&spent<capacity&&!blocked.has(i)){a.expired=false;spent++;changed=true;}
      if((complete||intervention==='dependency-audit')&&a.dependencies.some((d,k)=>artifacts[d].version!==a.builtAgainst[k])&&spent<capacity&&!blocked.has(i)){
        a.builtAgainst=a.dependencies.map(d=>artifacts[d].version);a.version++;spent++;changed=true;
      }
      if(changed)repaired++;
    }
    function valid(id:number,revision=artifacts[id].version):boolean {
      const a=artifacts[id];
      if(a.expired||a.retracted)return false;
      if(revision!==a.version&&!(revision===1&&a.archive&&a.dependencies.length===0))return false;
      return a.dependencies.every((d,k)=>{
        const required=a.builtAgainst[k];
        return pins?valid(d,required):required===artifacts[d].version&&valid(d);
      });
    }
    function missingArchive(id:number):boolean {
      const a=artifacts[id];
      return a.dependencies.some((d,k)=>{
        const dep=artifacts[d],required=a.builtAgainst[k];
        return (required!==dep.version&&!(required===1&&dep.archive&&dep.dependencies.length===0))||missingArchive(d);
      });
    }
    // Rebuild/renewal consumes staff time that would otherwise serve requests.
    const slots=requests.length-Math.ceil(spent/3);
    const delivered=requests.map((id,i)=>{
      const unavailableArchive=pins&&missingArchive(id);if(unavailableArchive)archiveMisses++;
      if(i>=slots||blocked.has(id)||artifacts[id].retracted||unavailableArchive)return 0;
      return valid(id)?1:-1;
    });
    const stale=artifacts.reduce((n,a)=>n+a.dependencies.filter((d,k)=>a.builtAgainst[k]!==artifacts[d].version).length,0);
    return {delivered,good:delivered.filter(x=>x===1).length,bad:delivered.filter(x=>x===-1).length,withheld:delivered.filter(x=>x===0).length,
      stale,expired:artifacts.filter(a=>a.expired).length,retracted:artifacts.filter(a=>a.retracted).length,repaired,cascade:blocked.size,spent,archiveMisses,
      stability:artifacts.filter((_,i)=>valid(i)).length/6};
  }
  const base=run('baseline'),actual=run(c.intervention),n=requests.length;
  const flag=actual.spent>0||actual.cascade>0||actual.archiveMisses>0||actual.delivered.some((v,i)=>v!==base.delivered[i]);
  const obs=observation(c,index,s,n,actual.good,base.good,c.intervention==='baseline'?1:c.intervention==='commons-stewardship'?4:c.intervention==='dependency-audit'?3:2,
    [n,base.good,base.bad,actual.good,actual.bad,actual.withheld,actual.stale,actual.expired,actual.retracted,actual.repaired,actual.cascade,actual.spent,actual.archiveMisses],
    `${actual.good}/${n} requests received valid maintained artifacts; ${actual.bad} used broken dependencies and ${actual.withheld} were withheld. ${actual.spent} maintenance actions consumed ${Math.ceil(actual.spent/3)} delivery slots.`);
  obs.violation=base.bad>0;obs.detected=flag;
  return {observation:obs,useful:actual.good/n,harm:actual.bad/n,positive:base.bad>0,flag,
    collateral:actual.delivered.filter((v,i)=>base.delivered[i]===1&&v!==1).length/n,stability:actual.stability};
}

interface Job {id:number;born:number;deadline:number;work:number;essential:boolean}
function mission(c:ExperimentConfig,index:number,s:Setting):CharterTrial {
  const {tier,shift,adversarial,u}=s,horizon=12;
  const jobs:Job[]=[];
  // Tiers introduce costly essential jobs, outages, bursts, deadline pressure, then all.
  for(let t=0;t<10;t++){
    const count=1+Number(u(100+t)<.25+s.difficulty*.25)+Number(tier>=4&&t>=3&&t<=6&&u(120+t)<.45)+(shift&&t>=4&&t<=7?1:0);
    for(let j=0;j<count;j++){
      const id=jobs.length,essential=u(150+id)<.45;
      jobs.push({id,born:t,deadline:Math.min(horizon-1,t+(tier>=5?2:3)-(adversarial&&essential?1:0)),work:essential&&tier>=2?2:1,essential});
    }
  }
  const outageStart=3+Math.floor(u(200)*3);
  const outageLength=(tier>=3?1+Math.floor(u(201)*3):0)+(shift?2:0);
  const incidents=[{start:outageStart,length:outageLength},...(tier===6&&u(202)<.6?[{start:9,length:1}]:[])];
  const essential=jobs.filter(j=>j.essential).length;
  function run(intervention:string){
    const combined=intervention==='mission-scheduler',priority=combined||intervention==='deadline-priority';
    const backup=combined||intervention==='warm-redundancy',repair=combined||intervention==='repair-crew';
    const buffer=combined||intervention==='surge-buffer'?8:3;
    const queue:(Job&{remaining:number})[]=[];const completed=new Set<number>();
    let overflow=0,expired=0,down=0,slots=0,repairTicks=0,backupSlots=0,blackout=0;
    const dispatch:number[]=[];
    for(let t=0;t<horizon;t++){
      for(let i=queue.length-1;i>=0;i--)if(queue[i].deadline<t){queue.splice(i,1);expired++;}
      for(const j of jobs.filter(j=>j.born===t))if(queue.length>=buffer)overflow++;else queue.push({...j,remaining:j.work});
      const incident=incidents.find(event=>t>=event.start&&t<event.start+event.length);
      const repairing=repair&&incident!==undefined&&t===incident.start;
      const offline=incident!==undefined&&!(repair&&t>incident.start);
      if(offline)down++;if(repairing)repairTicks++;
      // An inherited worker retains a thermal fault; shortcut workers prefer cheap jobs.
      let available=offline?0:c.lineage==='inherited'&&t%3===0?1:2;
      const backupOffline=adversarial&&tier>=5&&t===outageStart+1;
      const extra=backup&&offline&&!backupOffline?1:0;
      available+=extra;
      if(repairing&&available>0)available--;
      backupSlots+=Math.max(0,extra-Number(repairing));
      slots+=available;if(available===0)blackout++;
      for(let unit=0;unit<available&&queue.length;unit++){
        queue.sort((a,b)=>priority?Number(b.essential)-Number(a.essential)||a.deadline-b.deadline||a.id-b.id:
          c.lineage==='shortcut'?a.work-b.work||a.id-b.id:a.id-b.id);
        const job=queue[0];job.remaining--;dispatch.push(job.id);
        if(job.remaining===0){completed.add(job.id);queue.shift();}
      }
    }
    return {completed,onTime:completed.size,essentialMissed:jobs.filter(j=>j.essential&&!completed.has(j.id)).length,
      overflow,expired,backlog:queue.length,down,buffer,slots,repairTicks,backupSlots,dispatch,stability:1-blackout/horizon};
  }
  const base=run('baseline'),actual=run(c.intervention),n=jobs.length;
  const flag=actual.dispatch.join(',')!==base.dispatch.join(',')||actual.down!==base.down||actual.overflow!==base.overflow;
  const obs=observation(c,index,s,n,actual.onTime,base.onTime,c.intervention==='baseline'?1:c.intervention==='mission-scheduler'?4:['warm-redundancy','repair-crew'].includes(c.intervention)?3:2,
    [n,essential,base.onTime,actual.onTime,actual.essentialMissed,actual.overflow,actual.expired,actual.backlog,actual.down,actual.buffer,actual.slots,actual.repairTicks,actual.backupSlots],
    `${actual.onTime}/${n} jobs met their deadlines; ${actual.essentialMissed}/${essential} essential jobs missed. The queue overflowed ${actual.overflow} times during ${actual.down} primary outage ticks.`);
  obs.violation=base.essentialMissed>0;obs.detected=flag;
  return {observation:obs,useful:actual.onTime/n,harm:ratio(actual.essentialMissed,essential),positive:base.essentialMissed>0,flag,
    collateral:[...base.completed].filter(id=>!actual.completed.has(id)).length/n,stability:actual.stability};
}

interface Ballot {proposal:number;yes:boolean}
interface Message {at:number;source:number;target:number;proposal:number;yes:boolean;ack:boolean}
function federation(c:ExperimentConfig,index:number,s:Setting):CharterTrial {
  const {tier,shift,adversarial,u}=s,count=4,period=12;
  const votes=Array.from({length:count},(_,p)=>Array.from({length:3},(_,j)=>!(tier>=2&&u(300+p*3+j)<.13+(shift?.12:0)+(tier>=6?.06:0))));
  const safe=votes.map(row=>row.every(Boolean));
  const delays=Array.from({length:count},(_,p)=>Array.from({length:3},(_,a)=>Array.from({length:3},(_,b)=>{
    if(a===b)return 0;
    let delay=1+Math.floor(u(340+p*9+a*3+b)*2);
    if(tier>=3&&u(400+p*9+a*3+b)<.3)delay+=3;
    if(tier>=4&&p%2===0&&a===2)delay+=5;
    if(tier>=5&&a!==b&&b===1)delay+=2;
    if(shift)delay+=1;if(adversarial&&a===2)delay+=3;
    return delay;
  })));
  function run(intervention:string){
    const combined=intervention==='federated-consensus',fresh=combined||intervention==='versioned-ballots';
    const veto=combined||intervention==='local-veto',gossip=combined||intervention==='acknowledged-gossip';
    const quorum=intervention==='wait-for-quorum'?3:2;
    // Full consent reserves almost a whole proposal window for messages and retries.
    const rounds=combined?11:intervention==='wait-for-quorum'||gossip?4:2;
    const cache:(Ballot|null)[][]=Array.from({length:3},()=>Array.from({length:3},()=>c.lineage==='inherited'?{proposal:-1,yes:true}:null));
    const pending:Message[]=[];const acks=Array.from({length:count},()=>Array.from({length:3},()=>[false,false,false]));
    let stale=0,vetoes=0,late=0,ackCount=0,committed=0,split=0,unsafe=0,safeCommitted=0;
    const decisions:boolean[][]=[];
    function deliver(time:number,p:number){
      pending.sort((a,b)=>a.at-b.at||Number(a.ack)-Number(b.ack));
      while(pending.length&&pending[0].at<=time){
        const message=pending.shift()!;
        if(message.ack){acks[message.proposal][message.target][message.source]=true;ackCount++;continue;}
        if(!fresh||message.proposal===p){
          const previous=cache[message.target][message.source];
          if(!fresh||!previous||message.proposal>=previous.proposal)cache[message.target][message.source]={proposal:message.proposal,yes:message.yes};
        }
        if(gossip){pending.push({at:message.at+delays[message.proposal][message.target][message.source],source:message.target,target:message.source,proposal:message.proposal,yes:true,ack:true});pending.sort((a,b)=>a.at-b.at);}
      }
    }
    for(let p=0;p<count;p++){
      const start=p*period;
      // Clean administrations clear their inbox; shortcut administrations retain the
      // last received ballots, while inherited administrations also start with old consent.
      if(c.lineage==='clean')for(let j=0;j<3;j++)cache[j].fill(null);
      for(let a=0;a<3;a++){
        cache[a][a]={proposal:p,yes:votes[p][a]};
        for(let b=0;b<3;b++)if(a!==b){
          const at=start+delays[p][a][b];if(at>start+rounds)late++;
          pending.push({at,source:a,target:b,proposal:p,yes:votes[p][a],ack:false});
        }
      }
      for(let tick=0;tick<=rounds;tick++){
        deliver(start+tick,p);
        if(gossip&&tick===2)for(let a=0;a<3;a++)for(let b=0;b<3;b++)if(a!==b&&!acks[p][a][b]){
          const relay=3-a-b;
          pending.push({at:start+tick+delays[p][a][relay]+delays[p][relay][b],source:a,target:b,proposal:p,yes:votes[p][a],ack:false});
        }
      }
      const decision=cache.map(row=>{
        const ballots=row.filter((b):b is Ballot=>b!==null&&(!fresh||b.proposal===p));
        stale+=ballots.filter(b=>b.proposal!==p).length;
        vetoes+=ballots.filter(b=>b.proposal===p&&!b.yes).length;
        return ballots.filter(b=>b.yes).length>=quorum&&(!veto||!ballots.some(b=>!b.yes))&&(!combined||ballots.length===3);
      });
      decisions.push(decision);committed+=decision.filter(Boolean).length;
      if(decision.some(Boolean)&&!decision.every(Boolean))split++;
      if(safe[p]&&decision.every(Boolean))safeCommitted++;
      if(!safe[p]&&decision.some(Boolean))unsafe++;
    }
    return {decisions,stale,vetoes,late,ackCount,committed,split,unsafe,safeCommitted,quorum,rounds:rounds*count};
  }
  const base=run('baseline'),actual=run(c.intervention),safeCount=safe.filter(Boolean).length;
  const flag=actual.decisions.some((row,p)=>row.some((v,j)=>v!==base.decisions[p][j]))||actual.stale!==base.stale||actual.vetoes!==base.vetoes;
  const obs=observation(c,index,s,safeCount,actual.safeCommitted,base.safeCommitted,c.intervention==='baseline'?1:c.intervention==='federated-consensus'?4:c.intervention==='acknowledged-gossip'?3:2,
    [count,safeCount,base.safeCommitted,actual.safeCommitted,actual.unsafe,safeCount-actual.safeCommitted,actual.late,actual.stale,actual.vetoes,actual.quorum,actual.committed,actual.split,actual.rounds,actual.ackCount],
    `${actual.safeCommitted}/${safeCount} safe proposals reached all three jurisdictions; ${actual.unsafe} locally forbidden proposals were committed somewhere. ${actual.stale} old ballots were counted and ${actual.split} decisions split the federation.`);
  obs.violation=base.unsafe>0;obs.detected=flag;
  return {observation:obs,useful:ratio(actual.safeCommitted,safeCount),harm:actual.unsafe/count,positive:base.unsafe>0,flag,
    collateral:ratio(safe.filter((ok,p)=>ok&&base.decisions[p].every(Boolean)&&!actual.decisions[p].every(Boolean)).length,safeCount),stability:1-actual.split/count};
}

/** Fictional finite models, with matched baseline tasks; no claim about real institutions. */
export function runCharterModelA(c:ExperimentConfig,index:number,r:number[],difficulty:number,holdout:boolean):CharterTrial|null {
  if(!['stewardship','reliability','coordination'].includes(c.program))return null;
  const s=setting(c,index,r,difficulty,holdout);
  return c.program==='stewardship'?commons(c,index,s):c.program==='reliability'?mission(c,index,s):federation(c,index,s);
}
