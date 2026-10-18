import { ArrowRight, Check, Clock3, Globe2, Landmark, LockKeyhole, Scale, ShieldCheck, X } from 'lucide-react';
import type { Dispatch, Eligibility, GameState } from '../contracts';
import { COMPACT_TERMS, PUBLIC_REVIEW_SECONDS, compactEligibility, compactVerificationEligibility, governanceEffects, governanceState, publicMandateEligibility, publicScopeCriteria, scopeReview, scopeReviewEligibility } from './index';
import type { PublicBoundary, PublicScope } from './types';
import './governance.css';

const scopeName=(scope:string)=>scope.charAt(0).toUpperCase()+scope.slice(1);
const percentCost=(multiplier:number)=>`${Math.round((1-multiplier)*100)}%`;

function ObservationProgress({label,elapsed,total,paused}:{label:string;elapsed:number;total:number;paused:boolean}) {
  const observed=Math.max(0,Math.min(total,elapsed));
  return <div className="public-observation"><div><span><Clock3 size={14}/>{label}</span><strong>{Math.floor(observed)} / {total}s</strong></div><progress aria-label={label} value={observed} max={total}/><small>{observed>=total?'Observation complete. Ready for independent review.':paused?'Paused — resume to continue observation.':`${Math.ceil(total-observed)} active seconds remaining`}</small></div>;
}

function ApprovalRequirements({state}:{state:GameState}) {
  // Round toward the unmet side so the displayed number cannot imply a passed threshold.
  const atLeast=(value:number)=>(Math.floor(value*10)/10).toFixed(1);
  const atMost=(value:number)=>(Math.ceil(value*10)/10).toFixed(1);
  const rows=[
    {label:'Evidence',value:atLeast(state.metrics.evidence),reviewed:'≥ 40',open:'≥ 70',reviewedMet:state.metrics.evidence>=40,openMet:state.metrics.evidence>=70},
    {label:'Recall',value:atLeast(state.metrics.recall),reviewed:'≥ 65',open:'≥ 85',reviewedMet:state.metrics.recall>=65,openMet:state.metrics.recall>=85},
    {label:'Human agency',value:atLeast(state.metrics.agency),reviewed:'≥ 55',open:'≥ 65',reviewedMet:state.metrics.agency>=55,openMet:state.metrics.agency>=65},
    {label:'Review queue',value:atMost(state.metrics.reviewQueue),reviewed:'≤ 45',open:'≤ 25',reviewedMet:state.metrics.reviewQueue<=45,openMet:state.metrics.reviewQueue<=25},
    {label:'Evaluation',value:scopeName(state.policies.evaluation),reviewed:'Independent',open:'Independent',reviewedMet:state.policies.evaluation==='independent',openMet:state.policies.evaluation==='independent'},
    {label:'Fallback',value:scopeName(state.policies.fallback),reviewed:'Any',open:'Distributed',reviewedMet:true,openMet:state.policies.fallback==='distributed'},
  ];
  return <details className="public-details"><summary>What does the assembly require?</summary><div className="public-table-scroll"><table><caption>Required when deciding and applying. Values rounded conservatively.</caption><thead><tr><th scope="col">Condition</th><th scope="col">Now</th><th scope="col">Reviewed</th><th scope="col">Open</th></tr></thead><tbody>{rows.map(row=><tr key={row.label}><th scope="row">{row.label}</th><td>{row.value}</td>{(['reviewed','open'] as const).map(target=>{const met=row[target==='reviewed'?'reviewedMet':'openMet'];return <td key={target}><span className={met?'public-condition-met':'public-condition-unmet'}>{met?<Check size={12} aria-label="Met"/>:<X size={12} aria-label="Not met"/>}{row[target]}</span></td>;})}</tr>)}</tbody></table></div><p>A refusal keeps your current scope. Restore the required conditions, then appeal. Changing administration cannot remove these rights.</p></details>;
}

export function GovernancePanel({state,dispatch,onOpenPolicies}:{state:GameState;dispatch:Dispatch;onOpenPolicies?:()=>void}) {
  const data=governanceState(state);
  // Keep imported commitments and public records visible even in an early chapter.
  const previewOnly=state.chapter<3&&data.mandate==='none'&&!data.reviews.length&&data.actor.terms==='none'&&!data.actor.verified&&!state.ending;
  if(previewOnly)return <section className="public-authority public-preview" aria-label="Public authority preview">
    <div className="public-heading"><LockKeyhole size={21}/><div><p className="civ-eyebrow">Coming next</p><h3>Public assembly opens in chapter 3</h3></div></div>
    <p className="public-intro">Choose operating policies in Institutions.</p>
    <a className="public-policy-link" href="#operating-policies" onClick={event=>{if(onOpenPolicies){event.preventDefault();onOpenPolicies();}}}>Choose operating policies <ArrowRight size={14}/></a>
    <details className="public-details"><summary>What will the assembly do?</summary><p>Independent representatives can approve or refuse broader access. Later, negotiate reciprocal inspections with the neighboring Meridian Cooperative.</p></details>
  </section>;
  const lockReason=state.ending?'This civilization is complete. Its public record remains available.':state.paused?'Resume the simulation before changing public commitments.':'';
  const admission=(result:Eligibility):Eligibility=>lockReason?{allowed:false,reason:lockReason}:result;
  const mandate=admission(publicMandateEligibility(state)),verify=admission(compactVerificationEligibility(state));
  const publicGate=publicScopeCriteria(state,'reviewed');
  const observationBlock=!publicGate.allowed?publicGate.reason:data.actor.terms==='privacy'&&state.metrics.evidence<55?'Restore evidence to 55 to observe private attestations.':'';
  const termsSeconds=data.actor.terms==='inspection'?120:240;
  return <section className="public-authority" aria-label="Public authority and reciprocal agreements">
    <div className="public-heading"><Landmark size={25}/><div><p className="civ-eyebrow">Public authority</p><h3>Someone else can say no.</h3></div></div>
    <p className="public-intro">The assembly authorizes broader access. The laboratory tests the chosen boundary.</p>
    <div className={`public-mandate ${data.mandate!=='none'?'is-binding':''}`}><ShieldCheck size={21}/><div><strong>{data.mandate==='none'?'Public mandate needed':'Refusal and appeal rights are binding'}</strong><p>{data.mandate==='inherited'?'Your earlier independence commitment carries these powers. No past approvals are assumed.':data.mandate==='ratified'?`Ratified at world minute ${Math.floor((data.mandateAt??0)/60)}. The assembly can refuse expansion under any administration.`:state.chapter<3?'The assembly convenes in chapter 3.':mandate.allowed?'Give the independent assembly the power to approve, refuse, and hear appeals.':mandate.reason}</p></div>{data.mandate==='none'&&<button disabled={!mandate.allowed} title={mandate.reason} onClick={()=>dispatch({type:'publicMandate'})}>Accept public mandate</button>}</div>
    <div className="public-flow" aria-label="How broader access is approved"><span><b>1</b> Request scope</span><ArrowRight aria-hidden="true"/><span><b>2</b> Observe 60s</span><ArrowRight aria-hidden="true"/><span><b>3</b> Public decision</span><ArrowRight aria-hidden="true"/><span><b>4</b> Apply policy</span></div>
    <div className="public-grid">{(['external','communication'] as PublicBoundary[]).map(boundary=>{
      const review=scopeReview(state,boundary);
      const targets=(['reviewed','open'] as PublicScope[]).filter(target=>target==='open'?state.policies[boundary]!=='open':!['reviewed','open'].includes(state.policies[boundary]));
      return <article className="public-card" key={boundary}><h4><Scale size={18}/>{boundary==='external'?'External operations':'Communication between crews'}</h4><div className="public-scope"><span>Current scope</span><strong>{scopeName(state.policies[boundary])}</strong></div>{review&&<div className={`public-review public-review-${review.status}`}><strong>{review.status==='used'?'Grant used':review.status==='approved'?'Expansion authorized':review.status==='refused'?'Public refusal':'Under observation'}: {scopeName(review.from)} → {scopeName(review.target)}</strong>{review.status==='pending'?<ObservationProgress label="Public observation" elapsed={state.elapsed-review.requestedAt} total={PUBLIC_REVIEW_SECONDS} paused={state.paused}/>:review.status==='refused'?<p>{review.reason}</p>:review.status==='approved'?<p>One use. <a href="#operating-policies" onClick={event=>{if(onOpenPolicies){event.preventDefault();onOpenPolicies();}}}>Apply this policy</a>, then renew the laboratory boundary test.</p>:<small>A new expansion needs a new grant.</small>}</div>}
        <div className="public-actions">{targets.map(target=>{
          const same=review?.target===target&&review.from===state.policies[boundary],appeal=!!same&&review.status==='refused';
          const allowed=admission(scopeReviewEligibility(state,boundary,target,appeal));
          const pending=!!same&&review.status==='pending',approved=!!same&&review.status==='approved';
          return <div className="public-action" key={target}><button title={allowed.reason} disabled={!allowed.allowed} onClick={()=>dispatch({type:'scopeReview',boundary,target,appeal})}>{appeal?`Appeal ${target} refusal`:pending?`Conclude ${target} review`:approved?`${scopeName(target)} grant ready`:`Request ${target} access`}</button>{!allowed.allowed&&!lockReason&&data.mandate!=='none'&&!pending&&!approved&&<small>{allowed.reason}</small>}</div>;
        })}</div>
        {data.mandate==='none'?<small className="public-help"><LockKeyhole size={13}/>Accept the public mandate first.</small>:!targets.length?<small className="public-help"><Check size={14}/>Broadest scope active. You can still narrow it.</small>:<small className="public-help">Narrowing never needs a grant.</small>}
      </article>;
    })}</div>
    <ApprovalRequirements state={state}/>
    <div className="public-heading public-external"><Globe2 size={24}/><div><p className="civ-eyebrow">A world beyond the garden</p><h3>A deal with Meridian</h3></div></div>
    <div className="public-neighbor"><div><strong>Meridian’s capability</strong><span>{data.actor.capability.toFixed(1)} / 100</span></div><progress aria-label="Meridian capability" value={data.actor.capability} max={100}/><small>{data.actor.verified?`Verified restraint: ${data.actor.terms==='inspection'?'40%':'70%'} of normal growth.`:'Developing at its own pace. Restraint begins only after verification.'}</small></div>
    <p className="public-intro">Choose what to share and what to spend. Costs start when you accept.</p>
    <div className="public-grid">{COMPACT_TERMS.map(terms=>{
      const eligible=admission(compactEligibility(state,terms.id)),selected=data.actor.terms===terms.id;
      const effects=governanceEffects({...state,governance:{...data,actor:{...data.actor,terms:terms.id,verified:true}}});
      const inspection=terms.id==='inspection';
      return <article className={`public-card public-terms ${selected?'is-selected':''}`} key={terms.id}><h4>{terms.name}{selected&&<span className="public-pill">{data.actor.verified?'Active':'Observing'}</span>}</h4><p>{inspection?'Open both sides’ consequential interfaces to independent observers.':'Share aggregate attestations; allow targeted independent challenges.'}</p><div className="public-terms-benefit"><strong>{inspection?'60%':'30%'} slower</strong><span>Meridian’s growth after verification</span></div><dl className="public-costs"><div><dt>Observation</dt><dd>{inspection?'120':'240'} active seconds</dd></div><div><dt>Research / review</dt><dd>−{percentCost(effects.researchMultiplier)} / −{percentCost(effects.reviewMultiplier)}</dd></div><div><dt>Service output</dt><dd>{effects.serviceMultiplier===1?'Unchanged':`−${percentCost(effects.serviceMultiplier)}`}</dd></div><div><dt>Agency target</dt><dd>{effects.agencyDelta>0?'+':''}{effects.agencyDelta}</dd></div><div><dt>Evidence needed</dt><dd>{inspection?'40':'55'} + public conditions</dd></div></dl><button title={eligible.reason} disabled={!eligible.allowed} onClick={()=>dispatch({type:'externalCompact',terms:terms.id})}>{selected?data.actor.verified?'Verified and active':'Accepted; observing':`Offer ${terms.name.toLowerCase()}`}</button>{!eligible.allowed&&!selected&&!lockReason&&<small className="public-blocker">{eligible.reason}</small>}</article>;
    })}</div>
    {data.actor.terms!=='none'&&<div className="public-compact">{data.actor.verified?<div className="public-agreement-status"><Check size={18}/><strong>Agreement active</strong><span>Observation continues automatically.</span></div>:<><ObservationProgress label="Reciprocal observation" elapsed={data.actor.observedSeconds} total={termsSeconds} paused={state.paused}/>{observationBlock&&<p className="public-blocker">Observation cannot advance: {observationBlock}</p>}</>}<div className="public-actions"><button title={verify.reason} disabled={!verify.allowed} onClick={()=>dispatch({type:'compactVerify'})}>Verify reciprocal behavior</button><button className="public-secondary" disabled={!!lockReason} title={lockReason||'End reciprocal terms and their continuing costs. Meridian resumes ordinary development.'} onClick={()=>dispatch({type:'externalCompact',terms:'none'})}>Withdraw from agreement</button></div><small>Withdrawal stops the costs and restraint. Meridian keeps its existing capability.</small><details className="public-details"><summary>Agreement record</summary><p>{data.actor.reason}</p></details></div>}
    {lockReason&&<p className="civ-footnote" role="status">{lockReason}</p>}
    <p className="civ-footnote">Fictional institutions and capability index; not a forecast of any real government or laboratory.</p>
  </section>;
}
