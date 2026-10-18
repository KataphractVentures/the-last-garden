import type { Amount, ConstitutionId, Eligibility, GameState, ProgramId, Rates } from '../contracts';

export type Triple<T> = [T,T,T];
export type Quad<T> = [T,T,T,T];
export interface CharterReceipt {id:number;time:number;title:string;text:string}
export interface CharterAutomation {remaining:number;budgetRemaining:Amount;reserveFloor:Amount;elapsed:number;actions:CharterActionId[];maxTier:number}
export interface CharterBase {version:1;rulesVersion:1;established:boolean;serial:number;completed:number;appliedTier:number;manualActions:CharterActionId[];receipts:CharterReceipt[];automation:CharterAutomation|null}
export interface MethodPackage {id:number;program:ProgramId;source:string;dependencies:number[];maintenance:number;uses:number;retired:boolean}
export interface CommonsState {methods:MethodPackage[];credits:number;focus:ProgramId;mode:'focused'|'open'|'maintained';reuse:number}
export interface DeploymentTranche {id:number;bond:Amount;capacity:number;coverage:number;wear:number;source:string;active:boolean}
export interface PrecautionState {tranches:DeploymentTranche[];scope:'local'|'staged'|'broad';reserveTarget:number;operated:Amount}
export interface ServiceLane {id:'water'|'learning'|'repair'|'logistics';backlog:number;buffer:number;delivered:number;required:number}
export interface ServiceState {lanes:Quad<ServiceLane>;allocation:Quad<number>;mode:'balanced'|'buffers'|'urgent';contract:number;active:boolean;funding:Amount;earned:Amount;progress:number;source:string}
export interface DistrictState {id:'garden'|'campus'|'harbor';treasury:Amount;returnable?:Amount;level:number;evidence:number;delivered:Amount}
export interface DistrictTransfer {id:number;from:number;to:number;amount:Amount;returnable?:Amount;remaining:number;fee:Amount}
export interface FederationState {districts:Triple<DistrictState>;allocation:Triple<number>;route:'ring'|'hub'|'redundant';transfers:DistrictTransfer[];agreements:number}
export interface CohortCommitment {id:'tenders'|'analysts'|'keepers';work:number;rest:number;continuity:number;accepted:boolean;fit:number;served:number}
export interface PluralState {cohorts:Triple<CohortCommitment>;agreement:'uniform'|'matched'|'rotation';careReserve:Amount;continuityDuty:number;preserved:number;unmet:number}
export interface Tender {id:number;kind:'verified'|'speed'|'public';collateral:Amount;reward:Amount;required:number;delivered:number;remaining:number;source:string}
export interface RivalState {id:'apex'|'relay'|'cobalt';pressure:number;offer:number}
export interface FrontierState {rivals:Triple<RivalState>;tenders:Tender[];offer:'verified'|'speed'|'public';round:number;reputation:number;disclosures:number}
export type CharterEconomy = CharterBase & (
 | {kind:'commons';data:CommonsState}
 | {kind:'precaution';data:PrecautionState}
 | {kind:'service';data:ServiceState}
 | {kind:'federation';data:FederationState}
 | {kind:'plural';data:PluralState}
 | {kind:'frontier';data:FrontierState}
);
export type CharterActionId = 'publish'|'maintain'|'retract'|'openTranche'|'renewTranche'|'retireTranche'|'acceptService'|'settleService'|'bufferService'|'fundDistrict'|'investDistrict'|'transferDistrict'|'negotiate'|'fundCare'|'preserve'|'bid'|'settleTender'|'disclose'|'withdraw';
export type CharterMode = 'focused'|'open'|'maintained'|'local'|'staged'|'broad'|'balanced'|'buffers'|'urgent'|'ring'|'hub'|'redundant'|'uniform'|'matched'|'rotation'|'verified'|'speed'|'public';
export type CharterCommand =
 | {type:'charterEstablish'}
 | {type:'charterConfigure';mode?:CharterMode;allocation?:number[];focus?:ProgramId}
 | {type:'charterAction';action:CharterActionId;target?:number;secondary?:number}
 | {type:'charterAutomation';enabled:boolean;budget?:Amount;runs?:number;reserveFloor?:Amount};
export interface CharterActionQuote extends Eligibility {action:CharterActionId;target?:number;secondary?:number;title:string;description:string;cost:Amount;researchCost:Amount;refund:Amount;tier:1|2|3|4|5|6;effect:string}
export interface CharterModeOption {id:CharterMode;name:string;description:string}
export interface CharterFlow {kind:ConstitutionId;dedicatedUseful:Amount;districtIncome?:Triple<Amount>;laneWork?:Quad<number>;tenderWork?:number;serviceCash?:Amount;tenderCash?:Amount;researchReserved:number;reviewReserved:number;note:string}
export interface CharterContext {scale:Amount;income:(tokens:Amount)=>void;log:(title:string,text:string)=>void}
export interface CharterActionResult {ok:boolean;message:string}
export interface RegimeModule {
 kind:ConstitutionId;
 modes:CharterModeOption[];
 create:()=>CharterEconomy;
 actions:(state:GameState,scale:Amount)=>CharterActionQuote[];
 configure:(state:GameState,command:Extract<CharterCommand,{type:'charterConfigure'}>)=>CharterActionResult;
 act:(state:GameState,quote:CharterActionQuote,context:CharterContext)=>CharterActionResult;
 rates:(state:GameState,rates:Rates,scale:Amount)=>Rates;
 tick:(state:GameState,seconds:number,rates:Rates,context:CharterContext)=>void;
 auto:(state:GameState,scale:Amount)=>CharterActionQuote|undefined;
}
