import type { GameState } from '../contracts';
import { formatAmount, tick } from '../engine';
import Decimal from 'decimal.js';

export const MAX_OFFLINE_SECONDS=12*60*60;
export interface CatchupResult {state:GameState;cancelled:boolean;requestedSeconds:number;processedSeconds:number}
export interface CatchupOptions {
  authorize:()=>boolean;
  progress?:(processed:number,total:number)=>void;
  yieldControl?:()=>Promise<void>;
  chunkSeconds?:number;
  simulate?:typeof tick;
}
/** Pure candidate simulation: callers commit only after final ownership validation. */
export async function catchUpOffline(initial:GameState,seconds:number,options:CatchupOptions):Promise<CatchupResult> {
  const requestedSeconds=Math.max(0,Number.isFinite(seconds)?seconds:0);
  const total=Math.min(requestedSeconds,MAX_OFFLINE_SECONDS);
  const chunkSize=Math.max(.25,Math.min(60,options.chunkSeconds??30));
  const yieldControl=options.yieldControl??(()=>new Promise<void>(resolve=>setTimeout(resolve,0)));
  const simulate=options.simulate??tick;
  let candidate=initial,processedSeconds=0;
  const cancelled=():CatchupResult=>({state:initial,cancelled:true,requestedSeconds,processedSeconds});
  if(!options.authorize())return cancelled();
  if(total<=2||initial.paused||initial.ending)return {state:initial,cancelled:false,requestedSeconds,processedSeconds};
  options.progress?.(0,total);
  // Allow the progress notice to paint before any simulation work begins.
  await yieldControl();
  while(processedSeconds<total){
    if(!options.authorize())return cancelled();
    const portion=Math.min(chunkSize,total-processedSeconds);
    candidate=simulate(candidate,portion,true);
    processedSeconds+=portion;
    if(!options.authorize())return cancelled();
    options.progress?.(processedSeconds,total);
    if(candidate.pendingEvent||candidate.paused||candidate.ending)break;
    if(processedSeconds<total)await yieldControl();
  }
  if(!options.authorize())return cancelled();
  if(!candidate.pendingEvent&&!candidate.paused&&!candidate.ending&&processedSeconds===total){
    // Match one uninterrupted engine call's carry instead of accumulating a
    // different floating-point addition order at every asynchronous boundary.
    candidate={...candidate,simulationRemainder:Math.max(0,(initial.simulationRemainder??0)+total-(candidate.elapsed-initial.elapsed))};
  }else if(candidate.pendingEvent&&!initial.pendingEvent&&processedSeconds<total){
    candidate={...candidate,simulationRemainder:0};
  }
  const simulated=Math.floor(candidate.elapsed-initial.elapsed);
  const earned=formatAmount(new Decimal(candidate.tokens).sub(initial.tokens).toString(),initial.settings.notation);
  const boundary=candidate.pendingEvent?'Progress stopped at a conversation awaiting your decision.':candidate.ending?'This civilization reached its conclusion.':requestedSeconds>MAX_OFFLINE_SECONDS?'Offline progress is capped at twelve hours.':'The same production, review, and risk rules applied.';
  candidate={...candidate,offlineSummary:`${simulated} seconds simulated; ${earned} net tokens. ${boundary}`};
  return {state:candidate,cancelled:false,requestedSeconds,processedSeconds};
}
