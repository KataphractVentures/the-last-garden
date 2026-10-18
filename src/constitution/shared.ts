import type { Amount, GameState, Rates } from '../contracts';
import { amount, decimal, scaleFor } from '../engine/amounts';
import { charterClearance } from '../laboratory/evidence';
import type { CharterActionQuote, CharterBase, CharterFlow } from './types';
export { amount, decimal, clamp, Decimal } from '../engine/amounts';
export { charterClearance } from '../laboratory/evidence';
export const charterScale = (s:GameState):Amount => scaleFor(Number(s.flags.find(f=>f.startsWith('replay-cycle:'))?.slice(13)??s.legacy.cycle)).toString();
export const scaled = (scale:Amount,n:number|string):Amount => amount(decimal(scale).mul(n));
export const base = ():CharterBase => ({version:1,rulesVersion:1,established:true,serial:0,completed:0,appliedTier:0,manualActions:[],receipts:[],automation:null});
export const source = (s:GameState,tier:1|2|3|4|5|6=1):string => {const ids=new Set(charterClearance(s,tier).sourceRecordIds);return s.experiments.find(record=>record.adopted&&ids.has(record.id))?.id??'';};
export function quote(s:GameState,scale:Amount,q:Omit<CharterActionQuote,'allowed'|'reason'|'cost'|'researchCost'|'refund'> & {cost?:number|string;researchCost?:number|string;refund?:Amount;reason?:string;requiresEvidence?:boolean}):CharterActionQuote {
 const {requiresEvidence=true,reason,...rest}=q;const evidence=charterClearance(s,q.tier);
 const failure=reason||(requiresEvidence&&!evidence.allowed?evidence.reason:'');
 return {...rest,cost:scaled(scale,q.cost??0),researchCost:scaled(scale,q.researchCost??0),refund:q.refund??'0',allowed:!failure,reason:failure||'Ready. Funding and work remain bounded by this quote.'};
}
/** Regime quotes omit wallet admission; the central dispatcher also checks escrow. */
export function refund(s:GameState,value:Amount):void {s.tokens=amount(decimal(s.tokens).add(value));}
export function flow(s:GameState,r:Rates,part:Partial<CharterFlow>={}):Rates {return {...r,charter:{kind:s.constitution,dedicatedUseful:'0',researchReserved:0,reviewReserved:0,note:'Bounded ordinary work remains available.',...part}};}
export function shares(value:number[]|undefined,length:number):boolean {return !!value&&value.length===length&&value.every(n=>Number.isFinite(n)&&n>=0&&n<=1)&&Math.abs(value.reduce((a,b)=>a+b,0)-1)<1e-8;}
export const success = (message:string) => ({ok:true,message});
export const failure = (message:string) => ({ok:false,message});
