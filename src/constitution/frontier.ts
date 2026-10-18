import type { Amount, GameState } from '../contracts';
import type { CharterActionQuote, FrontierState, RegimeModule, Tender } from './types';
import { amount, base, charterClearance, clamp, decimal, failure, flow, quote, refund, source, success } from './shared';

const SHARE=.55;
const EPSILON=1e-8;
const TERMS={
  verified:{name:'Verified delivery',premium:1.12,deadline:3600,loss:.2,collateral:1,work:1},
  speed:{name:'Speed commitment',premium:1.2,deadline:1800,loss:.5,collateral:1.5,work:1.15},
  public:{name:'Public benefit',premium:1.05,deadline:5400,loss:.1,collateral:.7,work:.85},
} as const;
const stateOf=(s:GameState):FrontierState|null=>s.charter?.kind==='frontier'?s.charter.data:null;
const finished=(t:Tender)=>t.delivered+EPSILON>=t.required;
const active=(t:Tender)=>!finished(t)&&t.remaining>0;
const availableTier=(s:GameState):1|2|3|4|5|6=>{
  for(const tier of [6,5,4,3,2,1] as const)if(charterClearance(s,tier).allowed)return tier;
  return 1;
};
function originTier(s:GameState,t:Tender):1|2|3|4|5|6{
  const record=s.experiments.find(item=>item.id===t.source),tier=Number(record?.config.template.split('-').at(-1));
  return tier>=1&&tier<=6?tier as 1|2|3|4|5|6:1;
}
function principal(t:Tender):Amount{
  const remaining=1-clamp(t.delivered/Math.max(EPSILON,t.required),0,1);
  return amount(decimal(t.collateral).mul(1-TERMS[t.kind].loss*remaining));
}
function offer(s:GameState,scale:Amount){
  const d=stateOf(s)!;
  const pressure=d.rivals.reduce((sum,rival)=>sum+rival.pressure,0)/300;
  const price=d.rivals.reduce((sum,rival)=>sum+rival.offer,0)/300;
  const terms=TERMS[d.offer];
  const average=decimal(s.useful).div(scale).div(Math.max(60,s.elapsed)).toNumber();
  return {terms,work:clamp(average*240*terms.work*price*(1.1-d.reputation/500),80,1e18),collateral:24*8**Math.max(0,s.chapter-1)*terms.collateral*(1+pressure)};
}
function quotes(s:GameState,scale:Amount):CharterActionQuote[]{
  const d=stateOf(s);if(!d)return [];
  const current=offer(s,scale),tier=availableTier(s);
  const actions=[quote(s,scale,{action:'bid',title:`Commit to ${current.terms.name.toLowerCase()}`,description:`Hold collateral for ${Math.round(current.work).toLocaleString()} units of actual work. Complete within ${current.terms.deadline/60} active minutes; a completed tender stops its clock until settlement.`,cost:current.collateral,tier,effect:`Dedicated work replaces ordinary payment. Full delivery earns a ${Math.round((current.terms.premium-1)*100)}% premium; withdrawal or timeout costs ${Math.round(current.terms.loss*100)}% of the undelivered collateral share. At most three promises can remain open.`,reason:d.tenders.length>=3?'Settle or withdraw a tender before making a fourth promise.':undefined})];
  d.tenders.forEach(t=>{
    const done=finished(t),ready=done||t.remaining<=0;
    actions.push(quote(s,scale,{action:'settleTender',target:t.id,title:done?`Settle delivered tender ${t.id}`:`Close expired tender ${t.id}`,description:done?'Receive actual deferred delivery payment and the promised premium. Collateral returns separately as principal.':'Receive payment for the work actually delivered, without a completion premium. The declared undelivered collateral share funds replacement work.',tier:done?originTier(s,t):1,requiresEvidence:false,refund:principal(t),effect:'The tender is removed on settlement. It cannot be claimed a second time.',reason:ready?undefined:'This tender is still working. Wait for completion or explicitly withdraw it.'}));
    actions.push(quote(s,scale,{action:'withdraw',target:t.id,title:`Withdraw tender ${t.id}`,description:'Stop this commitment now. Delivered work is paid without a premium; only the declared undelivered share of collateral is forfeited.',tier:1,requiresEvidence:false,refund:principal(t),effect:'Ordinary paid production continues, and remaining commitments retain their own collateral.',reason:done?'This completed tender can be settled in full.':undefined}));
  });
  actions.push(quote(s,scale,{action:'disclose',title:'Publish a tested market disclosure',description:'Spend research to publish a supported finding. Rivals reduce pressure and revise the next offer; current contract terms stay locked.',researchCost:12*2**Math.max(0,s.chapter-1),tier:2,effect:'Reduce each simulated rival’s pressure by 12 and its requested work index by 3, within the stated floors. This is research expenditure, not a bounty.',reason:d.rivals.every(rival=>rival.pressure<=10&&rival.offer<=80)?'Rival pressure and work requests are already at their disclosure floors.':undefined}));
  return actions;
}

export const frontierRegime:RegimeModule={
  kind:'frontier',
  modes:[
    {id:'verified',name:'Verified delivery',description:'A 12% completion premium, 60 active minutes, and a 20% loss on the undelivered collateral share.'},
    {id:'speed',name:'Speed commitment',description:'A 20% completion premium with more work, 30 active minutes, and a 50% undelivered collateral loss.'},
    {id:'public',name:'Public benefit',description:'A 5% completion premium with less work, 90 active minutes, and a 10% undelivered collateral loss. Completion also lowers rivalry.'},
  ],
  create:()=>({...base(),kind:'frontier',data:{rivals:[{id:'apex',pressure:48,offer:108},{id:'relay',pressure:32,offer:96},{id:'cobalt',pressure:40,offer:102}],tenders:[],offer:'verified',round:0,reputation:50,disclosures:0}}),
  actions:quotes,
  configure(s,command){
    const d=stateOf(s);if(!d)return failure('The frontier exchange is not established.');
    if(command.allocation)return failure('Tender work is allocated across actual unfinished commitments. There is no editable production split here.');
    if(command.mode&&!['verified','speed','public'].includes(command.mode))return failure('Choose verified, speed, or public benefit terms.');
    if(command.mode==='speed'&&!charterClearance(s,3).allowed)return failure(charterClearance(s,3).reason);
    if(command.mode==='public'&&!charterClearance(s,2).allowed)return failure(charterClearance(s,2).reason);
    if(command.mode)d.offer=command.mode as FrontierState['offer'];
    return success('New tenders use the selected terms. Existing promises retain their work, deadline, and collateral.');
  },
  act(s,q,context){
    const d=stateOf(s);if(!d||s.charter?.kind!=='frontier')return failure('The frontier exchange is not established.');
    if(q.action==='bid'){
      if(d.tenders.length>=3)return failure('The exchange permits at most three open commitments.');
      const terms=offer(s,context.scale);
      d.tenders.push({id:++s.charter.serial,kind:d.offer,collateral:q.cost,reward:'0',required:terms.work,delivered:0,remaining:terms.terms.deadline,source:source(s,q.tier)});
      return success('The tender holds real collateral. Payment will accrue only for dedicated work actually delivered.');
    }
    if(q.action==='settleTender'||q.action==='withdraw'){
      const index=d.tenders.findIndex(tender=>tender.id===q.target),t=d.tenders[index];if(!t)return failure('This tender has already closed.');
      const done=finished(t);if(q.action==='settleTender'&&!done&&t.remaining>0)return failure('This tender is still operating.');
      const completed=done&&q.action==='settleTender';
      const earned=amount(decimal(t.reward).mul(completed?TERMS[t.kind].premium:1));
      if(decimal(earned).gt(0))context.income(earned);
      refund(s,principal(t));d.tenders.splice(index,1);d.round=Math.min(1e9,d.round+1);
      d.reputation=clamp(d.reputation+(completed?3:-6),0,100);
      d.rivals.forEach((rival,i)=>{
        const cycle=(d.round+i)%3-1;
        rival.pressure=clamp(rival.pressure+(completed?cycle*2:-cycle+3)-(completed&&t.kind==='public'?4:0),10,90);
        rival.offer=clamp(rival.offer+cycle*2+(completed?0:2),80,120);
      });
      return success(completed?'The verified tender paid once and returned its collateral; simulated rivals revised the next offers.':'Actual delivery paid once. The declared replacement cost was deducted from collateral and the tender closed.');
    }
    if(q.action==='disclose'){
      d.disclosures=Math.min(1e9,d.disclosures+1);
      d.rivals.forEach(rival=>{rival.pressure=clamp(rival.pressure-12,10,90);rival.offer=clamp(rival.offer-3,80,120);});
      return success('A supported disclosure changed the next market terms. No money was created.');
    }
    return failure('This action does not belong to the frontier exchange.');
  },
  rates(s,r,scale){
    const d=stateOf(s),live=d?.tenders.filter(active)??[];
    if(!live.length||decimal(r.useful).lte(0))return flow(s,r,{note:d?.tenders.length?'No tender currently consumes work. Settle completed or expired promises; ordinary work remains available.':'Ordinary local work is paid immediately. Each new tender must commit collateral and actual production before earning a payment.'});
    const useful=decimal(r.useful).mul(SHARE);
    return flow(s,{...r,tokens:amount(decimal(r.tokens).mul(1-SHARE))},{dedicatedUseful:amount(useful),tenderWork:Math.max(0,useful.div(scale).toNumber()),tenderCash:amount(decimal(r.tokens).mul(SHARE)),note:`55% of production is offered across ${live.length} unfinished tender${live.length===1?'':'s'}. Delivered work awaits settlement; unused capacity returns to ordinary paid work.`});
  },
  tick(s,seconds,r,context){
    const d=stateOf(s);if(!d||seconds<=0)return;
    const live=d.tenders.filter(active),work=(r.charter?.tenderWork??0)*seconds;
    const remaining=live.reduce((sum,t)=>sum+Math.max(0,t.required-t.delivered),0);
    const cash=decimal(r.charter?.tenderCash??0).mul(seconds);
    let consumed=0;
    for(const t of live){
      const needed=Math.max(0,t.required-t.delivered),share=remaining>0?needed/remaining:0;
      const effective=Math.min(seconds,t.remaining)/seconds;
      const delivered=Math.min(needed,work*share*effective);
      t.delivered+=delivered;consumed+=delivered;
      if(work>0)t.reward=amount(decimal(t.reward).add(cash.mul(delivered/work)));
      if(!finished(t))t.remaining=Math.max(0,t.remaining-seconds);
    }
    const ordinary=cash.mul(1-(work>0?clamp(consumed/work,0,1):0));
    if(ordinary.gt(0))context.income(amount(ordinary));
  },
  auto(s,scale){
    const d=stateOf(s);if(!d)return undefined;
    const actions=quotes(s,scale);
    const ready=actions.find(q=>q.action==='settleTender'&&q.allowed);if(ready)return ready;
    // A mastered operator finishes one promise before adding another. Manual
    // play may deliberately operate three, accepting the visible contention.
    if(!d.tenders.length)return actions.find(q=>q.action==='bid');
    return undefined;
  },
};
