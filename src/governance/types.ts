import type { GameState, Policy } from '../contracts';

export type PublicBoundary = 'external'|'communication';
export type PublicScope = 'reviewed'|'open';
export type CompactTerms = 'none'|'inspection'|'privacy';
export interface ScopeReview {
  boundary:PublicBoundary; from:string; target:PublicScope; requestedAt:number;
  status:'pending'|'refused'|'approved'|'used'; decidedAt:number|null;
  attempts:number; reason:string;
}
export interface GovernanceState {
  version:1;
  mandate:'none'|'ratified'|'inherited'; mandateAt:number|null;
  reviews:ScopeReview[];
  actor:{capability:number; terms:CompactTerms; acceptedAt:number|null; verifiedAt:number|null; verified:boolean; observedSeconds:number; reason:string};
}
export type GovernanceHost = Pick<GameState,'elapsed'|'chapter'|'flags'|'policies'|'metrics'|'paused'|'ending'> & {governance?:GovernanceState};
export type GovernanceCommand =
 | {type:'publicMandate'}
 | {type:'scopeReview';boundary:PublicBoundary;target:PublicScope;appeal?:boolean}
 | {type:'externalCompact';terms:CompactTerms}
 | {type:'compactVerify'};
export interface GovernanceResult {ok:boolean;message:string}
export interface GovernanceEffects {researchMultiplier:number;reviewMultiplier:number;pressureDelta:number;agencyDelta:number;serviceMultiplier:number}
export type GovernancePolicyKey = keyof Policy;
