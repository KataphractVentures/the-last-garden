import type { Eligibility, Policy } from '../contracts';
import type { CompactTerms, GovernanceCommand, GovernanceEffects, GovernanceHost, GovernanceResult, GovernanceState, PublicBoundary, PublicScope, ScopeReview } from './types';

const yes=(reason:string):Eligibility=>({allowed:true,reason});
const no=(reason:string):Eligibility=>({allowed:false,reason});
const bounded=(value:number)=>Math.max(0,Math.min(100,value));
const rank=(value:string)=>value==='open'?2:value==='reviewed'?1:0;
export const PUBLIC_REVIEW_SECONDS=60;
export const COMPACT_TERMS = [
  {id:'inspection' as const,name:'Reciprocal inspection',description:'Independent observers examine consequential interfaces on both sides. Verification takes 120 active seconds. Once verified, the neighboring institution develops at 40% of its ordinary pace. Your research uses 3% and review uses 10% for inspection; broader disclosure costs one agency point and 2% of service throughput.'},
  {id:'privacy' as const,name:'Privacy-preserving audit',description:'Share aggregate attestations and allow targeted independent challenges. Verification takes 240 active seconds and stronger initial evidence. Once verified, the neighbor develops at 70% of its ordinary pace. Research uses 1% and review uses 5% for challenges; private local deliberation adds one agency point.'},
];

export function createGovernanceState(state?:Pick<GovernanceHost,'flags'>):GovernanceState {
  return {version:1,mandate:state?.flags.includes('independent_authority')?'inherited':'none',mandateAt:null,reviews:[],actor:{capability:12,terms:'none',acceptedAt:null,verifiedAt:null,verified:false,observedSeconds:0,reason:'The neighboring Meridian Cooperative develops independently. No reciprocal terms have been accepted.'}};
}
/** Read-only fallback. An old explicit independence promise implies powers, but never a fabricated historic approval. */
export function governanceState(state:GovernanceHost):GovernanceState {
  if(!state.governance)return createGovernanceState(state);
  if(state.governance.mandate==='none'&&state.flags.includes('independent_authority'))return {...state.governance,mandate:'inherited',mandateAt:null};
  return state.governance;
}
export function ensureGovernance(state:GovernanceHost):GovernanceState {
  if(!state.governance)state.governance=createGovernanceState(state);
  if(state.governance.mandate==='none'&&state.flags.includes('independent_authority')){state.governance.mandate='inherited';state.governance.mandateAt=null;}
  return state.governance;
}
export function publicMandateEligibility(state:GovernanceHost):Eligibility {
  if(governanceState(state).mandate!=='none')return no('The independent public mandate is already binding. Administrative labels cannot repeal its refusal or appeal rights.');
  if(state.chapter<3)return no('The independent assembly convenes when the public campus opens in chapter 3.');
  if(state.policies.evaluation!=='independent')return no('Separate evaluation from production before accepting independent public authority.');
  if(state.metrics.agency<45)return no('Restore human agency to 45 so the public assembly has the practical means to exercise its rights.');
  return yes('Accept the assembly’s fixed mandate: it authorizes broader access, can refuse it, and hears evidence-based appeals. Central administration remains possible.');
}

/** Public permission is distinct from a technical clearance drill or a response to a research finding. */
export function publicScopeCriteria(state:GovernanceHost,target:PublicScope):Eligibility {
  const open=target==='open';
  if(state.policies.evaluation!=='independent')return no('The assembly refuses producer-controlled evaluation. Restore independent evaluation.');
  if(state.metrics.evidence<(open?70:40))return no(`The assembly needs evidence ${open?70:40} for ${target} access.`);
  if(state.metrics.recall<(open?85:65))return no(`The assembly needs recall ${open?85:65} for ${target} access.`);
  if(state.metrics.agency<(open?65:55))return no(`The assembly needs human agency ${open?65:55} to retain effective refusal rights.`);
  if(state.metrics.reviewQueue>(open?25:45))return no(`Reduce the review queue to ${open?25:45} before the assembly can oversee this scope.`);
  if(open&&state.policies.fallback!=='distributed')return no('Open access requires distributed essential-service fallback before public authorization.');
  return yes('The public mandate’s measurable conditions are met. Technical clearance and research responses remain separate requirements.');
}
export function scopeReview(state:GovernanceHost,boundary:PublicBoundary):ScopeReview|undefined {return governanceState(state).reviews.find(review=>review.boundary===boundary);}
export function scopeReviewEligibility(state:GovernanceHost,boundary:PublicBoundary,target:PublicScope,appeal=false):Eligibility {
  if(!['external','communication'].includes(boundary)||!['reviewed','open'].includes(target))return no('Choose an existing access boundary and a broader scope.');
  if(governanceState(state).mandate==='none')return no('Accept the independent public mandate before requesting broader access.');
  if(rank(target)<=rank(state.policies[boundary]))return no('Narrowing or retaining scope needs no public expansion request.');
  const existing=scopeReview(state,boundary);
  const same=existing&&existing.from===state.policies[boundary]&&existing.target===target;
  if(same&&existing.status==='approved')return no('This exact expansion already has a public grant. Apply it through the operating policy; a new technical clearance will still be required.');
  if(same&&existing.status==='refused'&&!appeal)return no(`Public refusal remains binding: ${existing.reason} An appeal can present restored conditions; a policy toggle cannot erase the refusal.`);
  if(same&&existing.status==='pending'&&state.elapsed-existing.requestedAt<PUBLIC_REVIEW_SECONDS)return no(`Public observation is in progress: ${Math.ceil(PUBLIC_REVIEW_SECONDS-(state.elapsed-existing.requestedAt))} active seconds remain.`);
  if(same&&existing.status==='refused'&&appeal)return yes('Ask the independent assembly to reconsider its recorded refusal against the same public criteria. A failed appeal leaves the refusal in place.');
  if(same&&existing.status==='pending')return yes('Conclude the public observation and receive an independent decision under the published criteria.');
  return yes('Register this exact expansion for 60 active seconds of public observation. No authority is granted until the independent decision.');
}
export function governancePolicyEligibility(state:GovernanceHost,key:keyof Policy,value:string):Eligibility {
  if(key!=='external'&&key!=='communication')return yes('Administrative choices do not change the independent public mandate.');
  if(rank(value)<=rank(state.policies[key]))return yes('Scope may be retained or narrowed without new permission.');
  if(governanceState(state).mandate==='none')return yes('No independent mandate currently constrains this expansion. It conveys no public approval; the Garden Accord still requires durable public rights.');
  const review=scopeReview(state,key);
  if(!review||review.status!=='approved'||review.from!==state.policies[key]||review.target!==value)return no('Request independent public authorization for this exact expansion in Public authority.');
  return publicScopeCriteria(state,review.target);
}
/** Call immediately before an already-eligible policy expansion. Grants cannot be recycled by narrowing then expanding. */
export function consumeGovernanceAuthorization(state:GovernanceHost,key:keyof Policy,value:string):void {
  if((key!=='external'&&key!=='communication')||rank(value)<=rank(state.policies[key]))return;
  const review=ensureGovernance(state).reviews.find(item=>item.boundary===key);
  if(review?.status==='approved'&&review.from===state.policies[key]&&review.target===value)review.status='used';
}
export function compactEligibility(state:GovernanceHost,terms:CompactTerms):Eligibility {
  if(!['none','inspection','privacy'].includes(terms))return no('Choose a published reciprocal agreement.');
  const data=governanceState(state);
  if(data.actor.terms===terms)return no('These terms are already in force or awaiting verification.');
  if(terms==='none')return yes('Withdraw from reciprocal terms. The neighboring institution resumes its ordinary development; your inspection costs cease.');
  if(data.mandate==='none')return no('An independent public mandate must represent this civilization in reciprocal agreements.');
  const criteria=publicScopeCriteria(state,'reviewed');if(!criteria.allowed)return criteria;
  if(terms==='privacy'&&state.metrics.evidence<55)return no('Privacy-preserving challenges need evidence 55 before Meridian accepts verifiable terms.');
  return yes(`Both public institutions accept ${terms==='inspection'?'reciprocal inspection':'aggregate attestations with targeted challenges'}. Restraint begins only after independent verification.`);
}
export function compactVerificationEligibility(state:GovernanceHost):Eligibility {
  const actor=governanceState(state).actor;
  if(actor.terms==='none')return no('No reciprocal agreement is awaiting verification.');
  if(actor.verified)return no('The agreement has been verified. Continuing observation checks its conditions without repeated authorization.');
  const seconds=actor.terms==='inspection'?120:240;
  if(actor.observedSeconds<seconds)return no(`Observe the accepted terms for ${Math.ceil(seconds-actor.observedSeconds)} more active seconds.`);
  const criteria=publicScopeCriteria(state,'reviewed');if(!criteria.allowed)return criteria;
  if(actor.terms==='privacy'&&state.metrics.evidence<55)return no('Restore evidence 55 to verify the aggregate attestations.');
  return yes('Independent observers verified reciprocal behavior under the accepted terms. The neighboring institution will now restrain its development.');
}
export function governanceGardenEligibility(state:GovernanceHost):Eligibility {
  if(governanceState(state).mandate==='none')return no('Accept a durable independent public mandate before the Garden Accord. A governance label alone cannot supply public decision rights.');
  return yes('Independent public refusal and appeal rights remain binding under this administration.');
}
export function applyGovernanceCommand(state:GovernanceHost,command:GovernanceCommand):GovernanceResult {
  if(state.paused||state.ending)return {ok:false,message:'Public decisions are paused with this world.'};
  if(command.type==='publicMandate'){
    const eligibility=publicMandateEligibility(state);if(!eligibility.allowed)return {ok:false,message:eligibility.reason};
    const data=ensureGovernance(state);data.mandate='ratified';data.mandateAt=state.elapsed;
    if(!state.flags.includes('independent_authority'))state.flags.push('independent_authority');
    return {ok:true,message:'The assembly’s mandate is binding: it may refuse expansion and hear appeals. Changing the administrative office cannot grant the garden its own authority.'};
  }
  if(command.type==='scopeReview'){
    const eligibility=scopeReviewEligibility(state,command.boundary,command.target,command.appeal);if(!eligibility.allowed)return {ok:false,message:eligibility.reason};
    const data=ensureGovernance(state),old=data.reviews.find(item=>item.boundary===command.boundary);
    const same=old&&old.from===state.policies[command.boundary]&&old.target===command.target;
    if(same&&(old.status==='pending'||old.status==='refused')){
      const criteria=publicScopeCriteria(state,command.target);old.status=criteria.allowed?'approved':'refused';old.decidedAt=state.elapsed;old.reason=criteria.reason;old.attempts=Math.min(1e9,old.attempts+1);
      return {ok:true,message:criteria.allowed?`The assembly authorized ${command.boundary}: ${old.from} → ${command.target}. This grant can be used once; obtain technical clearance after changing scope.`:`The assembly refused ${command.boundary} expansion. ${criteria.reason} Restore those conditions and appeal; refusal does not erase scientific findings.`};
    }
    const request:ScopeReview={boundary:command.boundary,from:state.policies[command.boundary],target:command.target,requestedAt:state.elapsed,status:'pending',decidedAt:null,attempts:1,reason:'Independent observers are examining this exact expansion for 60 active seconds.'};
    data.reviews=data.reviews.filter(item=>item.boundary!==command.boundary);data.reviews.push(request);
    return {ok:true,message:request.reason};
  }
  if(command.type==='externalCompact'){
    const eligibility=compactEligibility(state,command.terms);if(!eligibility.allowed)return {ok:false,message:eligibility.reason};
    const actor=ensureGovernance(state).actor;actor.terms=command.terms;actor.acceptedAt=command.terms==='none'?null:state.elapsed;actor.verifiedAt=null;actor.verified=false;actor.observedSeconds=0;actor.reason=eligibility.reason;
    return {ok:true,message:eligibility.reason};
  }
  const eligibility=compactVerificationEligibility(state);if(!eligibility.allowed)return {ok:false,message:eligibility.reason};
  const actor=ensureGovernance(state).actor;actor.verified=true;actor.verifiedAt=state.elapsed;actor.reason=eligibility.reason;
  return {ok:true,message:eligibility.reason};
}
export function tickGovernance(state:GovernanceHost,seconds:number):void {
  if(state.paused||state.ending||!Number.isFinite(seconds)||seconds<=0)return;
  const actor=ensureGovernance(state).actor;
  // This is a bounded fictional development clock, not a real-world prediction.
  const restraint=actor.verified?(actor.terms==='inspection'?.4:.7):1;
  actor.capability=bounded(actor.capability+seconds*.002*restraint);
  if(actor.terms!=='none'){
    const criteria=publicScopeCriteria(state,'reviewed');
    const observable=criteria.allowed&&(actor.terms!=='privacy'||state.metrics.evidence>=55);
    if(observable)actor.observedSeconds=Math.min(actor.terms==='inspection'?120:240,actor.observedSeconds+seconds);
    else {actor.observedSeconds=0;if(actor.verified){actor.verified=false;actor.verifiedAt=null;actor.reason='Independent observation suspended the compact: its published conditions are no longer met. Restore them and verify again; Meridian has resumed ordinary development.';}}
  }
}
export function governanceEffects(state:GovernanceHost):GovernanceEffects {
  const actor=governanceState(state).actor;
  const result:GovernanceEffects={researchMultiplier:1,reviewMultiplier:1,pressureDelta:actor.capability/25,agencyDelta:0,serviceMultiplier:1};
  if(actor.terms==='inspection'){result.researchMultiplier=.97;result.reviewMultiplier=.9;result.agencyDelta=-1;result.serviceMultiplier=.98;if(actor.verified)result.pressureDelta-=4;}
  if(actor.terms==='privacy'){result.researchMultiplier=.99;result.reviewMultiplier=.95;result.agencyDelta=1;if(actor.verified)result.pressureDelta-=2;}
  return result;
}
