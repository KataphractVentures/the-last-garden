import type { Amount, GameState, ProgramId, Rates } from '../contracts';
import { isProgramActive } from '../laboratory/programs';
import type { CommonsState, MethodPackage, RegimeModule } from './types';
import { amount, base, clamp, decimal, failure, flow, quote, source, success } from './shared';

const data = (s:GameState):CommonsState => { if(s.charter?.kind!=='commons')throw new Error('Commons charter required.');return s.charter.data; };
const live = (d:CommonsState) => d.methods.filter(m=>!m.retired);
/** A method can only be as maintainable as its weakest actual dependency. */
function methodCondition(d:CommonsState,m:MethodPackage,seen=new Set<number>()):number {
  if(m.retired||seen.has(m.id))return 0;
  const visited=new Set(seen).add(m.id);
  return Math.min(m.maintenance,...m.dependencies.map(id=>{const parent=d.methods.find(candidate=>candidate.id===id);return parent?methodCondition(d,parent,visited):0;}));
}
const reusable=(d:CommonsState,m:MethodPackage)=>methodCondition(d,m)>=30;
export function hasViableCommonsApplication(s:GameState):boolean {
  if(s.charter?.kind!=='commons')return false;
  const d=s.charter.data;return live(d).some(m=>reusable(d,m)&&s.experiments.some(r=>r.id===m.source&&r.config.template==='stewardship-6'));
}
function publishReason(s:GameState,tier:1|6):string|undefined {
  const d=data(s);const witness=source(s,tier);
  if(d.methods.length>=10)return 'The ten-package archive is full. Retract a leaf package to make room.';
  if(live(d).some(m=>m.program===d.focus&&m.source===witness))return 'This finding already has a live package in the selected research field. Choose another field or a stronger study.';
  if(tier===6&&!live(d).some(m=>reusable(d,m)))return 'The capstone must extend at least one maintained package.';
  return undefined;
}
function actions(s:GameState,scale:Amount){
  const d=data(s);const result=[quote(s,scale,{action:'publish',target:1,title:'Publish a reusable method',description:'Package the selected field with its evidence reference and dependencies on up to two maintained methods.',cost:75,researchCost:12,tier:1,effect:'Adds one maintained package. Its measured reuse can improve preparation throughput.',reason:publishReason(s,1)}),
    quote(s,scale,{action:'publish',target:6,title:'Publish the public correction standard',description:'Apply the stewardship capstone to a dependency-bearing method with a public correction path.',cost:900,researchCost:90,tier:6,effect:'Applies the charter capstone and creates a maintained package grounded in its study.',reason:publishReason(s,6)})];
  for(const m of live(d)){
    result.push(quote(s,scale,{action:'maintain',target:m.id,title:`Maintain method ${m.id}`,description:`Review its ${m.dependencies.length} dependency references and restore its maintenance condition. Reuse benefits follow the weakest condition in each dependency path; its other packages still need their own care. Three reuse credits cover part of preparation.`,cost:30,researchCost:d.credits>=3?2:8,tier:1,effect:'Restores this package to 100; spends three reuse credits when available. Authorized maintenance batches act below 75 condition.',reason:m.maintenance>=99?'This package is already maintained.':undefined}));
    result.push(quote(s,scale,{action:'retract',target:m.id,title:`Retract method ${m.id}`,description:'Remove this leaf package from the working library. Past reuse is not erased.',tier:1,requiresEvidence:false,effect:'Frees one archive slot; removes its future reuse contribution.',reason:live(d).some(child=>child.dependencies.includes(m.id))?'A live method depends on this package. Retract its dependents first.':undefined}));
  }
  return result;
}

export const commonsRegime:RegimeModule={
  kind:'commons',
  modes:[
    {id:'focused',name:'Focused library',description:'Selected-field methods provide twice the reuse contribution. Maintenance follows actual use.'},
    {id:'open',name:'Open exchange',description:'All maintained methods can be reused. Exchange earns credits faster and wears packages 30% faster than focused use.'},
    {id:'maintained',name:'Maintained commons',description:'Reserve 0.8% preparation per usable method, up to 6%, for continuous care. Actual-use wear is 90% lower than focused use. Authorized maintenance batches renew demonstrated methods below 75 condition.'},
  ],
  create:()=>({...base(),kind:'commons',data:{methods:[],credits:0,focus:'oversight',mode:'focused',reuse:0}}),
  actions,
  configure(s,command){
    if(command.mode&&!['focused','open','maintained'].includes(command.mode))return failure('Select a Commons library mode.');
    if(command.focus&&!isProgramActive(command.focus,s.constitution))return failure('Select one of this civilization’s six research programs.');
    if(command.allocation)return failure('Commons uses a focus and library mode, not district allocation.');
    const d=data(s);if(command.mode)d.mode=command.mode as CommonsState['mode'];if(command.focus)d.focus=command.focus as ProgramId;
    return success('The library will apply the selected reuse and maintenance rules.');
  },
  act(s,q){
    const d=data(s);
    if(q.action==='publish'){
      const tier=q.target===6?6:1;const reason=publishReason(s,tier);if(reason)return failure(reason);
      const dependencies=live(d).filter(m=>reusable(d,m)&&m.program!==d.focus).slice(-2).map(m=>m.id);
      if(tier===6&&!dependencies.length){const parent=live(d).find(m=>reusable(d,m));if(parent)dependencies.push(parent.id);}
      d.methods.push({id:++s.charter!.serial,program:d.focus,source:source(s,tier),dependencies,maintenance:100,uses:0,retired:false});
      return success(`Published a ${d.focus} method with ${dependencies.length} explicit dependencies.`);
    }
    const m=d.methods.find(method=>method.id===q.target&&!method.retired);if(!m)return failure('That method is no longer in the working library.');
    if(q.action==='maintain'){m.maintenance=100;if(d.credits>=3)d.credits-=3;return success(`Method ${m.id} and its dependency references were maintained.`);}
    if(q.action==='retract'){
      if(live(d).some(child=>child.dependencies.includes(m.id)))return failure('Retract dependent methods first.');
      d.methods=d.methods.filter(method=>method.id!==m.id);return success(`Method ${m.id} was retracted from future reuse.`);
    }
    return failure('Unknown Commons action.');
  },
  rates(s,r){
    const d=data(s);const methods=live(d).filter(m=>reusable(d,m));
    const contribution=methods.reduce((sum,m)=>sum+Math.min(1,m.uses/120)*(d.mode==='focused'?(m.program===d.focus?2:.35):1)*methodCondition(d,m)/100,0);
    const reuse=Math.min(.15,contribution*.018);const reserved=d.mode==='maintained'&&methods.length?Math.min(.06,methods.length*.008):0;
    return flow(s,{...r,research:amount(decimal(r.research).mul(1+reuse-reserved))},{researchReserved:reserved,note:`${methods.length} dependency-valid methods; ${Math.round(reuse*100)}% demonstrated reuse benefit${reserved?'; preparation reserved for maintenance':''}.`});
  },
  tick(s,seconds,r,context){
    if(seconds<=0)return;const d=data(s);const methods=live(d).filter(m=>reusable(d,m));if(!methods.length)return;
    const normalized=decimal(r.research).div(context.scale);const totalUse=Math.min(seconds*2,normalized.mul(seconds).div(250).toNumber());
    // Observed first-campaign use is ~176 per package for expert exchange,
    // ~1,700 for the casual maintained library. Wear follows actual reuse;
    // the time cap prevents a late production burst from exhausting a method.
    for(const m of methods){const weight=d.mode==='focused'?(m.program===d.focus?2:.35):1;const use=totalUse*weight/methods.length;m.uses=clamp(m.uses+use,0,1e9);m.maintenance=clamp(m.maintenance-Math.min(seconds*.02,use*.20)*(d.mode==='maintained'?.1:d.mode==='open'?1.3:1));}
    d.reuse=clamp(d.reuse+totalUse,0,1e12);d.credits=clamp(d.credits+totalUse*(d.mode==='open'?.018:.012),0,12);
  },
  auto(s,scale){const choices=actions(s,scale);const d=data(s);return choices.find(q=>q.action==='maintain'&&q.allowed&&(d.methods.find(m=>m.id===q.target)?.maintenance??100)<75)??choices.find(q=>q.action==='publish'&&q.allowed&&q.target===1);},
};
