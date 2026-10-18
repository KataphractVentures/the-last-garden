import type { Amount, GameState } from '../contracts';
import type { CharterActionQuote, Quad, RegimeModule, ServiceState } from './types';
import { amount, base, charterClearance, clamp, decimal, failure, flow, quote, refund, shares, source, success } from './shared';

const LANES = ['water', 'learning', 'repair', 'logistics'] as const;
const PROFILES:Quad<number>[] = [[.30,.20,.20,.30],[.20,.35,.25,.20],[.25,.15,.40,.20],[.20,.20,.25,.35]];
const SHARE = .5;
const EPSILON = 1e-8;
const stateOf = (s:GameState):ServiceState | null => s.charter?.kind === 'service' ? s.charter.data : null;
const complete = (d:ServiceState) => d.active && d.lanes.every(lane=>lane.delivered + EPSILON >= lane.required);
const originTier = (s:GameState, id:string):1|2|3|4|5|6 => {
  const record=s.experiments.find(item=>item.id===id);
  const tier=Number(record?.config.template.split('-').at(-1));
  return tier>=1&&tier<=6 ? tier as 1|2|3|4|5|6 : 1;
};
const availableTier = (s:GameState):1|2|3|4|5|6 => {
  for(const tier of [6,5,4,3,2,1] as const)if(charterClearance(s,tier).allowed)return tier;
  return 1;
};
const fundingCost = (s:GameState) => 18 * 8 ** Math.max(0,s.chapter-1);
function volume(s:GameState,scale:Amount):number {
  // This is an explicit finite demand order, normalized to this world's units.
  // Historical throughput sizes the order; it does not create a payable balance.
  const average=decimal(s.useful).div(scale).div(Math.max(60,s.elapsed));
  return clamp(average.mul(180).toNumber(),60,1e18);
}
function progress(d:ServiceState):void {
  const total=d.lanes.reduce((sum,lane)=>sum+lane.required,0);
  d.progress=total>0?clamp(d.lanes.reduce((sum,lane)=>sum+lane.delivered,0)/total,0,1):0;
  for(const lane of d.lanes)lane.backlog=Math.max(0,lane.required-lane.delivered);
}
function quotes(s:GameState,scale:Amount):CharterActionQuote[] {
  const d=stateOf(s);if(!d)return [];
  const tier=availableTier(s), finished=complete(d);
  const refundValue=finished?d.funding:amount(decimal(d.funding).mul(.9+.1*d.progress));
  return [
    quote(s,scale,{action:'acceptService',title:'Accept a public service term',description:'Hold operating escrow and promise a finite order across water, learning, repairs, and logistics. Stored provision may serve the next order, without a second payment.',cost:fundingCost(s),tier,effect:`Half of production is offered to the four lanes. Each fulfilled unit replaces its ordinary payment; a completed term earns a 12% reliability premium. Demand order: ${Math.round(volume(s,scale)).toLocaleString()} service units.`,reason:d.active?'Settle or withdraw the active term before accepting another.':undefined}),
    quote(s,scale,{action:'settleService',title:'Settle the completed term',description:'Receive verified deferred payment plus its 12% completion premium. The held operating escrow returns separately as principal.',tier:finished&&decimal(d.earned).gt(0)?originTier(s,d.source):1,requiresEvidence:false,refund:d.active?d.funding:'0',effect:'This term closes once. Stored provision remains available and cannot earn a second payment.',reason:!d.active?'There is no active service term.':!finished?'Fulfill every lane before claiming the completion premium.':undefined}),
    quote(s,scale,{action:'withdraw',title:'Withdraw the service promise',description:'Pay for work already delivered, without a completion premium. Return escrow less 10% of the undelivered share, which funds continuity assistance.',tier:1,requiresEvidence:false,refund:d.active?refundValue:'0',effect:'Ordinary work remains available. Withdrawing cannot count as a completed constitutional application.',reason:!d.active?'There is no active service term.':finished?'The completed term can be settled in full.':undefined}),
  ];
}

export const serviceRegime:RegimeModule = {
  kind:'service',
  modes:[
    {id:'balanced',name:'Balanced allocation',description:'Divide work equally. Finite queues reveal where equal capacity leaves unmet needs.'},
    {id:'urgent',name:'Follow outstanding needs',description:'Distribute work in proportion to each remaining queue. Reapplying this rule changes the allocation as needs change.'},
    {id:'buffers',name:'Provision continuity buffers',description:'An allocated lane can store up to 20% of its order as real backup provision. That reserve is paid once and can be used later.'},
  ],
  create:()=>({...base(),kind:'service',data:{lanes:LANES.map(id=>({id,backlog:0,buffer:0,delivered:0,required:0})) as ServiceState['lanes'],allocation:[.25,.25,.25,.25],mode:'balanced',contract:0,active:false,funding:'0',earned:'0',progress:0,source:''}}),
  actions:quotes,
  configure(s,command){
    const d=stateOf(s);if(!d)return failure('The public service institution is not established.');
    if(command.mode&&!['balanced','buffers','urgent'].includes(command.mode))return failure('Choose a public service allocation rule.');
    if(command.allocation&&!shares(command.allocation,4))return failure('Four nonnegative lane shares must sum to one.');
    if(command.mode==='buffers'&&!charterClearance(s,2).allowed)return failure(charterClearance(s,2).reason);
    if(command.mode==='urgent'&&!charterClearance(s,3).allowed)return failure(charterClearance(s,3).reason);
    if(command.mode){
      d.mode=command.mode as ServiceState['mode'];
      if(d.mode==='balanced')d.allocation=[.25,.25,.25,.25];
      else if(d.mode==='urgent'){
        const total=d.lanes.reduce((sum,lane)=>sum+lane.backlog,0);
        d.allocation=total>0?d.lanes.map(lane=>lane.backlog/total) as Quad<number>:[...PROFILES[d.contract%PROFILES.length]];
      }
    }
    if(command.allocation)d.allocation=[...command.allocation] as Quad<number>;
    return success('The next work is divided according to these four lane shares. Existing delivery and reserves are retained.');
  },
  act(s,q,context){
    const d=stateOf(s);if(!d||s.charter?.kind!=='service')return failure('The public service institution is not established.');
    if(q.action==='acceptService'){
      if(d.active)return failure('A service term is already active.');
      const demand=volume(s,context.scale),profile=PROFILES[d.contract%PROFILES.length];
      d.contract=++s.charter.serial;d.active=true;d.funding=q.cost;d.earned='0';d.source=source(s,q.tier);
      d.lanes.forEach((lane,index)=>{
        lane.required=demand*profile[index];
        const supplied=Math.min(lane.buffer,lane.required);
        lane.buffer-=supplied;lane.delivered=supplied;lane.backlog=lane.required-supplied;
      });
      if(d.mode==='urgent'){
        const remaining=d.lanes.reduce((sum,lane)=>sum+lane.backlog,0);
        d.allocation=remaining>0?d.lanes.map(lane=>lane.backlog/remaining) as Quad<number>:[.25,.25,.25,.25];
      }
      progress(d);
      return success('A finite public term is funded. Existing provision has been allocated without billing it again.');
    }
    if(q.action==='settleService'||q.action==='withdraw'){
      if(!d.active)return failure('This public term has already closed.');
      const finished=complete(d);
      if(q.action==='settleService'&&!finished)return failure('All four lanes must be delivered before final settlement.');
      const paid=amount(decimal(d.earned).mul(finished&&q.action==='settleService'?1.12:1));
      const principal=finished?d.funding:amount(decimal(d.funding).mul(.9+.1*d.progress));
      if(decimal(paid).gt(0))context.income(paid);
      refund(s,principal);d.funding='0';d.earned='0';d.active=false;
      return success(finished?'The completed service term paid once; its operating escrow returned as principal.':'Delivered work was paid once; the outstanding promise closed with its declared continuity cost.');
    }
    return failure('This action does not belong to public service provision.');
  },
  rates(s,r,scale){
    const d=stateOf(s);
    if(!d?.active||complete(d)||decimal(r.useful).lte(0))return flow(s,r,{note:d?.active?'All four service promises are fulfilled. Settle the term to release payment and operating escrow.':'Ordinary local work is paid immediately. Accept a finite public term to route work through four service lanes.'});
    const useful=decimal(r.useful).mul(SHARE),work=Math.max(0,useful.div(scale).toNumber());
    return flow(s,{...r,tokens:amount(decimal(r.tokens).mul(1-SHARE))},{dedicatedUseful:amount(useful),laneWork:d.allocation.map(share=>work*share) as Quad<number>,serviceCash:amount(decimal(r.tokens).mul(SHARE)),note:'Half of production is allocated across four service lanes. Fulfilled work waits for settlement; unused allocation returns to ordinary paid work.'});
  },
  tick(s,seconds,r,context){
    const d=stateOf(s),work=r.charter?.laneWork;
    if(!d?.active||!work||seconds<=0)return;
    const incoming=work.reduce((sum,n)=>sum+n,0)*seconds;
    let accepted=0;
    d.lanes.forEach((lane,index)=>{
      const supplied=work[index]*seconds,delivered=Math.min(lane.backlog,supplied);
      lane.delivered+=delivered;accepted+=delivered;
      const reserve=d.mode==='buffers'?Math.min(Math.max(0,lane.required*.2-lane.buffer),Math.max(0,supplied-delivered)):0;
      lane.buffer+=reserve;accepted+=reserve;
    });
    const held=decimal(r.charter?.serviceCash??0).mul(seconds),fraction=incoming>0?clamp(accepted/incoming,0,1):0;
    const earned=held.mul(fraction),ordinary=held.sub(earned);
    d.earned=amount(decimal(d.earned).add(earned));
    if(ordinary.gt(0))context.income(amount(ordinary));
    progress(d);
  },
  auto(s,scale){const actions=quotes(s,scale),d=stateOf(s);return d?.active?(complete(d)?actions.find(q=>q.action==='settleService'):undefined):actions.find(q=>q.action==='acceptService');},
};
