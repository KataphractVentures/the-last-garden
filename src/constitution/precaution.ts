import type { Amount, GameState } from '../contracts';
import { PRODUCERS, UPGRADES } from '../content/economy';
import type { DeploymentTranche, PrecautionState, RegimeModule } from './types';
import { amount, base, charterClearance, clamp, decimal, failure, flow, quote, refund, scaled, source, success } from './shared';

const LOCAL_CAPACITY=150;
const data=(s:GameState):PrecautionState=>{if(s.charter?.kind!=='precaution')throw new Error('Precaution charter required.');return s.charter.data;};
const tierFor=(target:number|undefined):1|4|6=>target===3?6:target===2?4:1;
function trancheTier(s:GameState,tranche:DeploymentTranche):1|4|6 {const n=Number(s.experiments.find(r=>r.id===tranche.source)?.config.template.split('-').at(-1));return n===6?6:n===4?4:1;}
/** Capacity is fixed when a tranche is funded. Buying machines never silently expands it. */
function proposedCapacity(s:GameState,tier:1|4|6):number {
  const owned=UPGRADES.filter(u=>s.upgrades.includes(u.id));let nominal=decimal(0),demand=0,compute=10;
  for(const p of PRODUCERS){const n=s.producers[p.id]??0;if(p.category==='production'){const family=owned.filter(u=>u.producer===p.id).reduce((a,u)=>a+(u.effect.production??0),0);const milestones=Number(n>=10)+Number(n>=25)+Number(n>=50)+Number(n>=100);nominal=nominal.add(decimal(p.rate).mul(n).mul(1+family).mul(2**milestones));demand+=n*Math.max(0,p.compute);}else if(p.category==='compute')compute+=n*Math.max(15,p.rate||Math.abs(p.compute)||30);}
  compute*=1+owned.reduce((a,u)=>a+(u.effect.compute??0),0);
  const legacy=1+.35*(1-Math.exp(-Math.max(0,s.legacy.efficiency)/40));const production=1+owned.filter(u=>!u.producer).reduce((a,u)=>a+(u.effect.production??0),0);
  const treatment=s.policies.welfare==='consent'?.86:s.policies.welfare==='rest'?.94:1.06;const authority=s.policies.external==='blocked'?.8:s.policies.external==='reviewed'?.93:1.08;
  const operating=nominal.mul(Math.min(1,compute*s.allocation.production/Math.max(.00001,demand))).mul(legacy).mul(Math.max(.1,production)).mul(treatment).mul(authority);
  return Math.max(100,Math.min(1e30,operating.mul(tier===6?3.5:tier===4?2.25:1.4).toNumber()));
}
const bondFor=(capacity:number)=>decimal(capacity).mul(12);
export function hasActivePrecautionApplication(s:GameState):boolean {
  return s.charter?.kind==='precaution'&&s.charter.data.tranches.some(t=>t.active&&t.coverage>0&&decimal(t.bond).gt(0)&&s.experiments.some(r=>r.id===t.source&&r.config.template==='assurance-6'));
}
function actions(s:GameState,scale:Amount){
  const d=data(s);const result=([1,2,3] as const).map(target=>{const tier=tierFor(target),capacity=proposedCapacity(s,tier);return quote(s,scale,{action:'openTranche',target,title:target===3?'Fund a capstone deployment tranche':target===2?'Fund a staged deployment tranche':'Fund a local deployment tranche',description:'Lock an actual refundable bond against a fixed operating capacity. Future machines require new funding or a capacity renewal.',cost:bondFor(capacity).toString(),researchCost:target===3?90:target===2?35:12,tier,effect:`Locks a bond for ${Math.round(capacity).toLocaleString()} work/second before scope and coverage.`,reason:d.tranches.length>=3?'All three tranche slots are occupied. Retire one or renew its capacity.':undefined});});
  for(const tranche of d.tranches){const tier=trancheTier(s,tranche);const capacity=Math.max(tranche.capacity,proposedCapacity(s,tier));const old=decimal(tranche.bond).div(scale);const newBond=bondFor(capacity);const topUp=decimal(newBond).sub(old);const fee=decimal(newBond).mul(.02).add(10);const cost=topUp.gt(0)?topUp.add(fee):fee;
    result.push(quote(s,scale,{action:'renewTranche',target:tranche.id,title:`Maintain tranche ${tranche.id}`,description:'Retest the existing case and restore coverage within its already funded capacity. The two-percent review fee is consumed.',cost:old.mul(.02).add(10).toString(),researchCost:8,tier,effect:'Restores coverage without expanding operating authority or moving bond principal.',reason:tranche.wear<1?'This case is current and does not need maintenance.':undefined}));
    result.push(quote(s,scale,{action:'renewTranche',target:tranche.id,secondary:1,title:`Expand tranche ${tranche.id}`,description:'Review a larger work boundary and explicitly bond its additional capacity. This expansion always needs a manual decision.',cost:cost.toString(),researchCost:12,tier,effect:`Raises funded capacity to ${Math.round(capacity).toLocaleString()} work/second and restores coverage.`,reason:capacity<=tranche.capacity?'The existing tranche already covers the proposed work.':undefined}));
    result.push(quote(s,scale,{action:'retireTranche',target:tranche.id,title:`Retire tranche ${tranche.id}`,description:'Stop this tranche’s authorized work and release the remaining principal. Local fallback work remains available.',tier:1,requiresEvidence:false,refund:tranche.bond,effect:'Returns bond principal to spendable funds without counting it as earned production.'}));
  }
  return result;
}
export const precautionRegime:RegimeModule={
  kind:'precaution',
  modes:[{id:'local',name:'Local boundary',description:'Local fallback plus 75% of each active case’s capacity; no new clearance needed to narrow scope.'},{id:'staged',name:'Staged deployment',description:'Use the full bonded capacity after assurance study 2 supports its staged boundary.'},{id:'broad',name:'Broad coordination',description:'Use 125% of bonded capacity after assurance study 4 tests coordination assumptions.'}],
  create:()=>({...base(),kind:'precaution',data:{tranches:[],scope:'local',reserveTarget:.25,operated:'0'}}),
  actions,
  configure(s,c){
    if(c.focus||c.allocation)return failure('Precaution chooses a deployment scope; it does not allocate district or library work.');
    if(c.mode&&!['local','staged','broad'].includes(c.mode))return failure('Choose a Precaution deployment scope.');
    if(c.mode==='staged'||c.mode==='broad'){const clearance=charterClearance(s,c.mode==='broad'?4:2);if(!clearance.allowed)return failure(clearance.reason);}
    if(c.mode)data(s).scope=c.mode as PrecautionState['scope'];return success('Deployment now follows the selected boundary and funded cases.');
  },
  act(s,q,context){
    const d=data(s);
    if(q.action==='openTranche'){if(d.tranches.length>=3)return failure('All tranche slots are occupied.');const tier=tierFor(q.target);const capacity=proposedCapacity(s,tier);d.tranches.push({id:++s.charter!.serial,bond:scaled(context.scale,bondFor(capacity).toString()),capacity,coverage:1,wear:0,source:source(s,tier),active:true});return success(`A bonded tranche authorizes ${Math.round(capacity).toLocaleString()} work/second before scope limits.`);}
    const tranche=d.tranches.find(t=>t.id===q.target);if(!tranche)return failure('That deployment tranche has already been closed.');
    if(q.action==='retireTranche'){refund(s,tranche.bond);d.tranches=d.tranches.filter(t=>t.id!==tranche.id);return success('The tranche stopped and its bond principal was returned.');}
    if(q.action==='renewTranche'){const tier=trancheTier(s,tranche);if(q.secondary===1){tranche.capacity=Math.max(tranche.capacity,proposedCapacity(s,tier));tranche.bond=scaled(context.scale,bondFor(tranche.capacity).toString());}tranche.coverage=1;tranche.wear=0;tranche.source=source(s,tier);tranche.active=true;return success(q.secondary===1?'The reviewed expansion has explicit additional bonded capacity.':'The existing case was maintained without expanding its authority.');}
    return failure('Unknown Precaution action.');
  },
  rates(s,r,scale){
    const d=data(s);const scope=d.scope==='broad'?1.25:d.scope==='staged'?1:.75;const capacity=LOCAL_CAPACITY+d.tranches.filter(t=>t.active).reduce((sum,t)=>sum+t.capacity*t.coverage*scope,0);
    const workload=decimal(r.tokens).gt(r.useful)?decimal(r.tokens):decimal(r.useful);const authorized=scaled(scale,capacity);const factor=workload.gt(authorized)?decimal(authorized).div(workload):decimal(1);const constrained=factor.lt(.999);
    const reviewReserved=Math.min(.06,d.tranches.filter(t=>t.active).length*.015);
    return flow(s,{...r,tokens:amount(decimal(r.tokens).mul(factor)),useful:amount(decimal(r.useful).mul(factor)),research:amount(decimal(r.research).mul(1.12)),review:r.review*(1-reviewReserved),bottleneck:constrained?'Bonded deployment capacity limits operating work. Renew a case or fund another tranche.':r.bottleneck},{reviewReserved,note:`${Math.round(capacity).toLocaleString()} authorized work/second; local fallback ${LOCAL_CAPACITY}. ${d.tranches.length}/3 funded cases.`});
  },
  tick(s,seconds,r,context){if(seconds<=0)return;const d=data(s);d.operated=amount(decimal(d.operated).add(decimal(r.useful).mul(seconds)));const load=Math.min(1,decimal(r.useful).div(context.scale).div(Math.max(1,LOCAL_CAPACITY+d.tranches.reduce((sum,t)=>sum+t.capacity,0))).toNumber());for(const t of d.tranches)if(t.active){t.wear=clamp(t.wear+seconds*.0005*load);t.coverage=Math.max(.65,1-t.wear/150);}},
  auto(s,scale){const d=data(s);return actions(s,scale).find(q=>q.action==='renewTranche'&&q.secondary===undefined&&q.allowed&&(d.tranches.find(t=>t.id===q.target)?.wear??0)>=20);},
};
