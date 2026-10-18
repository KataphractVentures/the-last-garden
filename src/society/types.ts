import type { Amount, GameState } from '../contracts';
import type { GovernanceState } from '../governance/types';

export type CommunityId = 'harbor'|'riverside'|'hill';
export type SocietyDecisionId = 'transition'|'distribution'|'life';
export type SocietyCaseId = 'requester'|'sponsor';
export type SocietyChoice = 'augmentation'|'replacement'|'bridge'|'shared'|'services'|'concentrated'|'consent'|'local'|'mandate';
export type SocietyResponse = 'refuse'|'alternative'|'appeal'|'comply';
export interface HumanCommunity {
  id:CommunityId;
  /** Indices relative to the community's starting livelihood; these are not spendable tokens. */
  income:number; access:number; ownership:number; transition:number;
  projectContinuity:number; meaning:number;
}
export interface HumanCase {
  id:SocietyCaseId; response:SocietyResponse|null; resolvedAt:number|null;
  harm:number; repairStartedAt:number|null; repaired:boolean;
}
export interface SocietyReceipt {time:number;kind:'decision'|'human-misuse'|'repair';id:string;choice:string;title:string;text:string}
export interface SocietyState {
  version:1; introducedAt:number; legacyBaseline:boolean;
  decisions:Record<SocietyDecisionId,SocietyChoice|null>;
  communities:[HumanCommunity,HumanCommunity,HumanCommunity];
  cases:[HumanCase,HumanCase];
  transitionRemaining:number; lastPaidRate:Amount;
  /** Actual tokens debited, including public provision levies and decisions. */
  spent:Amount; funding:number; receipts:SocietyReceipt[];
}
export type SocietyCommand =
 | {type:'society';action:'decision';id:SocietyDecisionId;choice:SocietyChoice}
 | {type:'society';action:'case';id:SocietyCaseId;choice:SocietyResponse}
 | {type:'society';action:'repair';id:SocietyCaseId};
export type SocietyHost = Pick<GameState,'chapter'|'elapsed'|'tokens'|'policies'|'metrics'|'flags'|'decisions'|'legacy'|'ending'> & {society?:SocietyState|null;governance?:GovernanceState};
export interface SocietyOption {id:SocietyChoice;name:string;description:string;levy:number}
export interface SocietyDecision {id:SocietyDecisionId;chapter:number;title:string;description:string;options:SocietyOption[]}
export interface SocietyCaseDefinition {id:SocietyCaseId;chapter:number;title:string;description:string;affected:CommunityId;harm:number;options:{id:SocietyResponse;name:string;description:string;costSeconds:number}[]}
export interface SocietyQuote {allowed:boolean;reason:string;cost:Amount}
