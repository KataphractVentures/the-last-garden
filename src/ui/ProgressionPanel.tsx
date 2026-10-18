import {ArrowUpRight,Check,Flag,Pause,Play} from 'lucide-react';
import Decimal from 'decimal.js';
import {formatAmount} from '../engine';
import type {GameState} from '../contracts';
import {getProgressionGuide,type GuideProgress,type ProgressionAction} from './progressionGuide';
import {CHAPTERS} from '../content/story';

function Progress({value,notation}:{value:GuideProgress;notation:GameState['settings']['notation']}){
 const target=formatAmount(value.target,notation);
 const amount=new Decimal(value.current);
 const visibleCurrent=value.met?amount:amount.lt(1000)?amount.toDecimalPlaces(amount.lt(10)?1:0,Decimal.ROUND_DOWN):amount.toSignificantDigits(3,Decimal.ROUND_DOWN);
 const roundedCurrent=formatAmount(visibleCurrent.toString(),notation);
 // A rounded display must not claim that a still-unmet threshold has been reached.
 const current=!value.met&&roundedCurrent===target?`<${target}`:roundedCurrent;
 return <div className="goal-progress">
  <div className="goal-progress-label"><span>{value.unit}</span><strong>{current} / {target}</strong></div>
  <div className="goal-progress-track" role="progressbar" aria-label={value.unit} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value.fraction*100} aria-valuetext={`${value.current} of ${value.target} ${value.unit}; ${value.met?'complete':'in progress'}`}><span style={{width:`${value.fraction*100}%`}}/></div>
 </div>;
}

/** A map of existing requirements, not a second source of progression rules. */
export function ProgressionPanel({state,onAction,onResume}:{state:GameState;onAction:(action:ProgressionAction)=>void;onResume:()=>void}){
 const guide=getProgressionGuide(state);
 const action=guide.goal.action;
 const actionDisabled=action?.kind==='advance'&&(!guide.canAdvance||state.paused||Boolean(state.ending));
 return <section className={`progression-panel goal-${guide.status}`} aria-labelledby="next-step-title">
  <div className="next-step-row"><div className="next-step-copy">
   <span className="eyebrow"><Flag size={13}/>{guide.status==='complete'?'WORLD COMPLETE':'YOUR NEXT STEP'}{state.paused&&!state.ending&&<span className="goal-pause"><Pause size={10}/>Paused</span>}</span>
   <h2 id="next-step-title">{guide.goal.title}</h2>
  </div><div className="next-step-actions">
   {state.paused&&!state.ending&&<button className="primary" onClick={onResume}><Play size={15}/>Resume</button>}
   {action&&<button className={state.paused?'secondary':'primary'} disabled={actionDisabled} onClick={()=>onAction(action)}>{action.label}<ArrowUpRight size={16}/></button>}
  </div></div>
  {guide.goal.progress&&<Progress value={guide.goal.progress} notation={state.settings.notation}/>}
  <details className="chapter-checklist"><summary>Goal details <span>{guide.requirements.length>0?`${guide.requirements.filter(requirement=>requirement.met).length} / ${guide.requirements.length} complete`:'World complete'}</span></summary>
   <div className="goal-context"><p>{guide.goal.detail}</p><p className="chapter-context">{CHAPTERS.find(chapter=>chapter.id===state.chapter)?.summary}</p></div>
   {guide.requirements.length>0&&<ul>{guide.requirements.map(requirement=><li key={requirement.id} className={requirement.met?'complete':''}>
    <span className="requirement-check" aria-label={requirement.met?'Complete':'Still needed'}>{requirement.met?<Check size={13}/>:<span/>}</span>
    <div><strong>{requirement.title}</strong><small>{requirement.detail}</small>{requirement.progress&&!requirement.met&&<Progress value={requirement.progress} notation={state.settings.notation}/>}</div>
    {!requirement.met&&requirement.action&&<button className="text-button" onClick={()=>onAction(requirement.action!)}>{requirement.action.label}<ArrowUpRight size={13}/></button>}
   </li>)}</ul>}
  </details>
 </section>;
}
