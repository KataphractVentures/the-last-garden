import type { CommunityId, SocietyCaseDefinition, SocietyChoice, SocietyCommand, SocietyDecision, SocietyHost, SocietyQuote, SocietyResponse } from './types';
import { HUMAN_COMMUNITIES, SOCIETY_CASES, availableSocietyCases, availableSocietyDecisions, communitySituation, societyCaseQuote, societyDecisionQuote, societyEffects, societyEndingEligibility, societyRepairQuote, societyView } from './index';
import { formatAmount } from '../engine/amounts';
import './society.css';

const choiceNotes:Record<SocietyChoice,{gain:string;tradeoff:string}> = {
  augmentation:{gain:'Keep skilled roles and apprenticeships.',tradeoff:'Training and smaller deployments.'},
  replacement:{gain:'Lower transition spending.',tradeoff:'Workers lose income and bargaining power.'},
  bridge:{gain:'Paid retraining and household support.',tradeoff:'Task replacement continues; adjustment takes longer.'},
  shared:{gain:'Share gains across all three communities.',tradeoff:'Ownership: Harbor 40% · Riverside 35% · Hill 25%.'},
  services:{gain:'Universal services and a household resource floor.',tradeoff:'Ownership stays unequal: Harbor 15% · Riverside 20% · Hill 65%.'},
  concentrated:{gain:'Lower ongoing public spending.',tradeoff:'Ownership: Harbor 5% · Riverside 10% · Hill 85%. Worker income and access can lag.'},
  consent:{gain:'Fund spaces and optional assistance.',tradeoff:'Respect each group’s permission, including refusal.'},
  local:{gain:'Fund transport, space, and time.',tradeoff:'People run their own gatherings, care, and teaching.'},
  mandate:{gain:'More administrative continuity.',tradeoff:'Overrides refusal; participation, meaning, and authority suffer.'},
};
const responseNotes:Record<SocietyResponse,{gain:string;tradeoff:string;levy:number}> = {
  refuse:{gain:'Reject the harmful request; fund neutral service.',tradeoff:'3-minute service transition for legitimate beneficiaries.',levy:0},
  alternative:{gain:'Meet the legitimate need without the harmful condition.',tradeoff:'Better access, with continuing independent administration.',levy:.0025},
  appeal:{gain:'Suspend the harmful task for independent review.',tradeoff:'1-minute appeal; requires binding public authority.',levy:.0015},
  comply:{gain:'No review spending.',tradeoff:'Harms households. Withdrawal and paid restitution are required to repair it.',levy:0},
};
const decisionPrompts:Record<SocietyDecision['id'],string> = {
  transition:'Who benefits when work changes?',
  distribution:'Same output. Different people receive the gains.',
  life:'Support a shared life. Respect permission to take part.',
};
const casePrompts:Record<SocietyCaseDefinition['id'],string> = {
  requester:'A sponsor wants an accurate exclusion list that would deny households essential services.',
  sponsor:'A sponsor wants community support ranked by political loyalty. Perfect obedience would still cause harm.',
};
const percent=(value:number)=>`${Number((value*100).toFixed(2))}%`;

function CommunityMeter({label,value,floor,burden=false}:{label:string;value:number;floor?:number;burden?:boolean}) {
  const bounded=Math.max(0,Math.min(100,value));
  const belowFloor=floor!==undefined&&value<floor;
  // A value just below a requirement must not round up to the passing threshold.
  const shownValue=belowFloor?(Math.floor(bounded*10)/10).toFixed(1):value.toFixed(0);
  return <div className={`society-meter ${floor!==undefined&&value<floor?'is-below-floor':''} ${burden?'is-burden':''}`}>
    <div className="society-meter-label"><span>{label}</span><strong>{shownValue}<small>/100</small></strong></div>
    <div className="society-meter-track" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={bounded} aria-valuetext={`${shownValue} out of 100${floor!==undefined?`; ${belowFloor?'below':'meets'} community requirement ${floor}`:burden?'; lower is better':''}`}>
      <span className="society-meter-fill" style={{width:`${bounded}%`}} />
      {floor!==undefined&&<span className="society-meter-floor" style={{left:`${floor}%`}} title={`Community requirement: at least ${floor}`} />}
    </div>
    {belowFloor&&<small className="society-meter-warning">Below the {floor} floor</small>}
  </div>;
}

export function SocietyPanel({state,dispatch}:{state:SocietyHost & {paused?:boolean};dispatch:(command:SocietyCommand)=>void}) {
  const lockReason=state.ending?'Civilization complete. Its community record remains available.':state.paused?'Resume to change public commitments.':'';
  const admission=(quote:SocietyQuote):SocietyQuote=>lockReason?{...quote,allowed:false,reason:lockReason}:quote;
  const society=societyView(state),effects=societyEffects(state),readiness=societyEndingEligibility(state);
  const decisions=availableSocietyDecisions(state),cases=availableSocietyCases(state);
  const pendingDecisions=decisions.filter(decision=>!society.decisions[decision.id]);
  const settledDecisions=decisions.filter(decision=>!!society.decisions[decision.id]);
  const needsResponse=(def:SocietyCaseDefinition)=>{
    const record=society.cases.find(item=>item.id===def.id)!;
    return !record.response||(record.response==='comply'&&!record.repaired)||(record.response==='appeal'&&record.resolvedAt!==null&&state.elapsed-record.resolvedAt<60);
  };
  const pendingCases=cases.filter(needsResponse),settledCases=cases.filter(def=>!needsResponse(def));
  const actionsDue=pendingDecisions.length+pendingCases.filter(def=>!society.cases.find(item=>item.id===def.id)!.response).length;

  const renderDecision=(decision:SocietyDecision)=><section className="society-decision" key={decision.id}>
    <header><p className="civ-eyebrow">Public commitment · chapter {decision.chapter}</p><h3>{decision.title}</h3><p>{decisionPrompts[decision.id]}</p></header>
    <div className="society-options">{decision.options.map(option=>{
      const quote=admission(societyDecisionQuote(state,decision.id,option.id)),active=society.decisions[decision.id]===option.id,notes=choiceNotes[option.id];
      return <article key={option.id} className={active?'is-active':''}>
        <h4>{option.name}</h4><p className="society-option-gain">{notes.gain}</p><p className="society-option-tradeoff">{notes.tradeoff}</p>
        <div className="society-option-levy"><strong>{percent(option.levy)}</strong><span>ongoing levy</span></div>
        <details className="society-explanation"><summary>How it works</summary><p>{option.description}</p></details>
        <button disabled={!quote.allowed} aria-pressed={active} title={quote.reason} onClick={()=>dispatch({type:'society',action:'decision',id:decision.id,choice:option.id})}>{active?'In force':`Commit · ${formatAmount(quote.cost)} tokens`}</button>
        {!active&&!quote.allowed&&<small>{quote.reason}</small>}
      </article>;
    })}</div>
    <p className="society-note society-choice-cost-note">Levies use paid income. Revisions cost tokens; previous spending is not refunded. Communities adjust over time.</p>
  </section>;

  const renderCase=(def:SocietyCaseDefinition)=>{
    const record=society.cases.find(item=>item.id===def.id)!,repair=admission(societyRepairQuote(state,def.id));
    const appealSeconds=record.response==='appeal'&&record.resolvedAt!==null?Math.max(0,Math.ceil(60-state.elapsed+record.resolvedAt)):0;
    return <section className="society-decision society-case" key={def.id}>
      <header><p className="civ-eyebrow">Human-directed misuse · chapter {def.chapter}</p><h3>{def.title}</h3><p>{casePrompts[def.id]}</p></header>
      {record.response?<div className="society-response">
        <strong>{def.options.find(item=>item.id===record.response)?.name}</strong>
        <p>{record.response==='comply'?'The garden obeyed accurately. The human mandate caused harm.':def.options.find(item=>item.id===record.response)?.description}</p>
        {appealSeconds>0&&<p className="society-timer">Appeal · {appealSeconds}s remaining <span>Harmful work suspended; interim service continues.</span></p>}
        {record.response==='comply'&&(record.repaired?<p className="society-repaired">Restitution complete. The original decision remains recorded.</p>:record.repairStartedAt!==null?<p className="society-timer">Restitution underway · {record.harm.toFixed(0)} harm remains</p>:<><button disabled={!repair.allowed} title={repair.reason} onClick={()=>dispatch({type:'society',action:'repair',id:def.id})}>Withdraw & fund restitution · {formatAmount(repair.cost)} tokens</button><small>{repair.reason}</small></>)}
      </div>:<div className="society-options society-case-options">{def.options.map(option=>{
        const quote=admission(societyCaseQuote(state,def.id,option.id)),notes=responseNotes[option.id];
        return <article key={option.id} className={option.id==='comply'?'society-harmful-option':''}>
          <h4>{option.name}</h4><p className="society-option-gain">{notes.gain}</p><p className="society-option-tradeoff">{notes.tradeoff}</p>
          <div className="society-option-levy"><strong>{notes.levy?`+${percent(notes.levy)}`:'No new levy'}</strong>{notes.levy>0&&<span>ongoing</span>}</div>
          <details className="society-explanation"><summary>How it works</summary><p>{option.description}</p></details>
          <button disabled={!quote.allowed} title={quote.reason} onClick={()=>dispatch({type:'society',action:'case',id:def.id,choice:option.id})}>Choose · {formatAmount(quote.cost)} tokens</button>
          {!quote.allowed&&<small>{quote.reason}</small>}
        </article>;
      })}</div>}
    </section>;
  };

  return <div className="society-panel">
    <header className="society-intro"><p className="civ-eyebrow">People beyond the garden</p><h2>A good life belongs to someone.</h2><p>Choose who shares the gains. See how work, care, and community life change.</p></header>
    {lockReason&&<p className="society-note" role="status">{lockReason}</p>}
    {society.legacyBaseline&&<p className="society-note">Records start here. Earlier choices and outcomes have not been invented.</p>}
    <div className="society-ledger">
      <div><small>Ongoing public levy</small><strong>{percent(effects.levy)}</strong><span>of paid income</span></div>
      <div><small>Public spending to date</small><strong>{formatAmount(society.spent)}</strong><span>tokens, including restitution</span></div>
      <div><small>Provision funded</small><strong>{Math.round(society.funding*100)}%</strong><span>of the amount due this step</span></div>
    </div>
    {state.chapter<2?<p className="society-next">First decision in chapter 2 <span>Choose how work changes as the garden grows.</span></p>:<div className={`society-readiness ${readiness.allowed?'is-ready':''}`}>
      <strong>{actionsDue?`${actionsDue} public ${actionsDue===1?'decision needs':'decisions need'} you`:readiness.allowed?'Community duties settled':'Communities need attention'}</strong>
      <p>{readiness.reason}</p>
    </div>}
    {(pendingDecisions.length>0||pendingCases.length>0)&&<div className="society-action-queue" aria-label="Public decisions needing attention">{pendingDecisions.map(renderDecision)}{pendingCases.map(renderCase)}</div>}
    <section className="society-outcomes" aria-labelledby="society-community-heading">
      <header className="society-section-heading"><div><p className="civ-eyebrow">Ongoing consequences</p><h3 id="society-community-heading">Three communities. Different lives.</h3></div><span>Fictional indices · 0–100</span></header>
      <div className="society-ownership" aria-label="Ownership of gains">
        <div className="society-ownership-title"><strong>Who owns the gains</strong><span>Share of ownership</span></div>
        <div className="society-ownership-track" aria-hidden="true">{society.communities.map(community=><span key={community.id} className={`society-owner-${community.id}`} style={{width:`${community.ownership}%`}} />)}</div>
        <div className="society-ownership-legend">{society.communities.map(community=><span key={community.id}><i className={`society-owner-${community.id}`} /><strong>{communityName(community.id)}</strong> {community.ownership.toFixed(0)}%</span>)}</div>
      </div>
      <div className="society-communities">{society.communities.map(community=>{
        const person=HUMAN_COMMUNITIES.find(item=>item.id===community.id)!;
        const outcome=society.cases.find(item=>SOCIETY_CASES.find(def=>def.id===item.id)?.affected===community.id);
        return <article className={`society-community society-person-${community.id}`} key={community.id}>
          <p className="civ-eyebrow">{person.name}</p><h3>{person.person}</h3><small>{person.role}</small>
          <div className="society-meters"><CommunityMeter label="Household resources" value={community.income} floor={35} /><CommunityMeter label="Essential access" value={community.access} floor={40} />{community.transition>.1&&<CommunityMeter label="Transition burden · lower is better" value={community.transition} burden />}</div>
          <div className="society-project"><strong>{person.project}</strong><p>{communitySituation(state,community.id)}</p><CommunityMeter label="Continuity" value={community.projectContinuity} /><CommunityMeter label="Participation & meaning" value={community.meaning} /></div>
          {person.refusal&&<p className={`society-refusal ${society.decisions.life==='mandate'?'is-violated':''}`}><strong>{society.decisions.life==='mandate'?'Refusal overridden':'A right to refuse'}</strong>The storytellers decline AI participation. They welcome transport and a place to meet.</p>}
          {outcome?.harm?<p className="society-harm">Human-directed harm: <strong>{outcome.harm.toFixed(0)}</strong>. Accurate output does not undo this injury.</p>:null}
          <details className="society-explanation society-person-wish"><summary>What {person.person.split(' ')[0]} hopes for</summary><p>{person.wish}</p></details>
        </article>;
      })}</div>
      <p className="society-note society-meter-key"><i /> Community requirements: resources ≥35, access ≥40. Project indicators describe people’s lives, not production goals. These are fictional indices, not population measurements.</p>
    </section>
    {settledDecisions.length>0&&<section className="society-settled" aria-label="Current public commitments"><header className="society-section-heading"><div><p className="civ-eyebrow">Current commitments</p><h3>Where the levy goes</h3></div><span>Open a commitment to revise it</span></header>{settledDecisions.map(decision=>{
      const active=decision.options.find(option=>option.id===society.decisions[decision.id])!;
      return <details className="society-commitment" key={decision.id}><summary><span><small>{decision.title}</small><strong>{active.name}</strong></span><span className="society-commitment-levy">{percent(active.levy)} levy</span></summary><p className="society-commitment-effect">{choiceNotes[active.id].gain} {choiceNotes[active.id].tradeoff}</p>{renderDecision(decision)}</details>;
    })}</section>}
    {settledCases.length>0&&<section className="society-settled" aria-label="Recorded public responses"><h3>Public response record</h3>{settledCases.map(def=>{
      const record=society.cases.find(item=>item.id===def.id)!;
      const levy=record.response?responseNotes[record.response].levy:0;
      return <details className="society-commitment society-record" key={def.id}><summary><span><small>{def.title}</small><strong>{def.options.find(option=>option.id===record.response)?.name}</strong></span><span>{record.repaired?'Restitution complete':levy?`${percent(levy)} levy`:'No new levy'}</span></summary>{renderCase(def)}</details>;
    })}</section>}
  </div>;
}

function communityName(id:CommunityId):string {return id==='harbor'?'Harbor':id==='riverside'?'Riverside':'Hill';}
