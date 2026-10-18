import type { CharterCommand, CharterEconomy, CharterFlow } from './constitution/types';
import type { GovernanceCommand, GovernanceState } from './governance/types';
import type { SocietyCommand, SocietyState } from './society/types';

export type Amount = string;
export type BaseProgramId = 'oversight'|'control'|'organisms'|'interpretability'|'welfare';
export type CharterProgramId = 'stewardship'|'assurance'|'reliability'|'coordination'|'reciprocity'|'incentives';
export type ProgramId = BaseProgramId|CharterProgramId;
export type EndingId = 'garden'|'limit'|'shutdown'|'score'|'custodian'|'catastrophe';
export type ConstitutionId = 'commons'|'precaution'|'service'|'federation'|'plural'|'frontier';
export type Allocation = {production:number;research:number;review:number};
export type Policy = {contract:'score'|'verified'; communication:'closed'|'reviewed'|'open'; external:'blocked'|'reviewed'|'open'; evaluation:'independent'|'shared'; welfare:'instrumental'|'rest'|'consent'; continuity:'disposable'|'archive'|'protected'; fallback:'none'|'local'|'distributed'; governance:'central'|'council'|'federated'};
export type Metrics = {quality:number;distortion:number;agency:number;welfare:number;dependence:number;evidence:number;recall:number;coordination:number;pressure:number;continuity:number;humanWelfare:number;reviewQueue:number};
export interface Producer {id:string;name:string;description:string;category:'production'|'compute'|'review'|'control'|'institution';baseCost:number;growth:number;rate:number;compute:number;chapter:number;icon:string;color:string;benefit:string}
export interface Upgrade {id:string;name:string;description:string;cost:number;chapter:number;producer?:string;requiredCount?:number;requires?:string[];effect:{production?:number;research?:number;review?:number;click?:number;quality?:number;recall?:number;agency?:number;welfare?:number;compute?:number};category:string}
export interface ResearchProject {id:string;program:ProgramId|'foundation';title:string;description:string;chapter:number;cost:number;requires:string[];template?:string;capstone?:boolean;effect:Partial<Metrics>;unlock:string}
export interface ExperimentConfig {program:ProgramId;template:string;seed:number;cohort:number;budget:number;holdout:number;intervention:string;distribution:'familiar'|'shifted'|'adversarial';lineage:'clean'|'shortcut'|'inherited';prediction:string;control:boolean;replicateOf?:string;node?:number}
export interface Observation {trial:number;input:number;expected:number;observed:number;control:number;violation:boolean;detected:boolean;cost:number;note:string;activations?:number[];detail?:{kind:CharterProgramId;values:number[]}}
export interface EvidenceSummary {version:1;completed:number;heldOut:number;controlled:number}
export type OperatingProgram = 'control'|'organisms'|'interpretability';
export type FindingResponse = 'restrict'|'guarded';
export interface OperatingDecision {program:OperatingProgram;record:string;response:FindingResponse;decidedAt:number;claim:string;limitation:string}
export interface OperatingClearance {version:1;revision:number;scope:string;changedAt:number;reason:string;observation:null|{revision:number;observedAt:number;availableAt:number;recall:number};decisions:Partial<Record<OperatingProgram,OperatingDecision>>}
export interface ExperimentRecord {id:string;version:1;config:ExperimentConfig;observations:Observation[];evidence?:EvidenceSummary;summary:{usefulness:number;violationRate:number;detectionRate:number;falsePositiveRate:number;cost:number;preferenceStability:number;collateral:number};conclusion:string;limitation:string;replicated:boolean;adopted:boolean;elapsed:number}
export interface JournalEntry {id:number;time:number;type:'story'|'research'|'policy'|'incident'|'purchase'|'prestige'|'system';title:string;text:string}
export interface CharacterState {trust:number;respect:number;promises:string[];history:string[]}
export interface BranchRecord {id:string;parentId:string|null;name:string;constitution:ConstitutionId;cycle:number;seed:number;chapter:number;ending?:EndingId;createdAt:number;summary:string;checkpoint?:Omit<GameState,'legacy'>}
export interface Legacy {seeds:number;patterns:number;charters:number;cycle:number;efficiency:number;claims:string[];discovered:string[];contracts:{id:string;family:string;cycle:number;redeemed:boolean}[];branches:BranchRecord[];viableCycles:number[];historySummary?:{certificates:number;branches:number;viableCycles:number}}
export interface GameState {
  version:1;contentVersion:1;id:string;seed:number;startedAt:number;lastSavedAt:number;lastActiveAt:number;elapsed:number;commandSeq:number;
  chapter:number;tokens:Amount;lifetime:Amount;useful:Amount;research:Amount;producers:Record<string,number>;purchaseBasis:Record<string,Amount>;upgrades:string[];projects:string[];
  allocation:Allocation;metrics:Metrics;policies:Policy;flags:string[];decisions:Record<string,string>;pendingEvent:string|null;eventCooldown:number;
  /** Remaining simulation seconds between optional character conversations. Legacy saves default to zero. */
  characterSceneCooldown?:number;
  experiments:ExperimentRecord[];mastered:ProgramId[];activeExperiment:{config:ExperimentConfig;remaining:number}|null;
  experimentAutomation:{source:string;remaining:number;completed:number;runLimit:number;budgetRemaining:Amount}|null;
  characters:Record<string,CharacterState>;journal:JournalEntry[];constitution:ConstitutionId;modules:string[];legacy:Legacy;
  charter?:CharterEconomy|null;
  clearance?:OperatingClearance;
  governance?:GovernanceState;
  society?:SocietyState;
  ending:EndingId|null;endingTime:number|null;viableSeconds:number;paused:boolean;assisted:boolean;autoBuy:string|null;autoResearch:boolean;
  tendWindow:number;tendCount:number;lastCommandIds:string[];incidentStage:number;lastIncidentAt:number;certificateTier:number;offlineSummary:string|null;
  simulationRemainder?:number;pendingEvidence?:{due:number;amount:number}[];certificateProgress?:number;
  settings:{reducedMotion:boolean;sound:boolean;condensed:boolean;notation:'compact'|'scientific';speed:1|10|60;readingPause:boolean};
}
export type Command =
 | {type:'tend'} | {type:'buy';id:string;quantity:number|'max'} | {type:'sell';id:string;quantity:number}
 | {type:'upgrade';id:string} | {type:'allocation';allocation:Allocation} | {type:'policy';key:keyof Policy;value:string}
 | {type:'choose';event:string;choice:string} | {type:'advance'} | {type:'research';id:string}
 | {type:'experiment';config:ExperimentConfig} | {type:'adopt';record:string} | {type:'replicate';record:string}
 | {type:'findingResponse';record:string;response:FindingResponse}
 | {type:'withdrawFindingResponse';program:OperatingProgram}
 | {type:'experimentAutomation';record:string|null;runs?:number}
 | {type:'drill'} | {type:'isolate'} | {type:'repair'} | {type:'certify'}
 | {type:'finish';ending:EndingId} | {type:'prestige';layer:'refit'|'reinitialize'|'reframe';constitution?:ConstitutionId;modules?:string[]}
 | {type:'branch';id:string} | {type:'pause'} | {type:'assisted'} | {type:'autoBuy';id:string|null} | {type:'autoResearch';enabled:boolean}
 | {type:'settings';settings:Partial<GameState['settings']>} | {type:'dismissOffline'}
 | CharterCommand | GovernanceCommand | SocietyCommand;
export type Dispatch = (command:Command)=>void;
export interface Rates {tokens:Amount;useful:Amount;research:Amount;raw:Amount;compute:number;demand:number;utilization:number;review:number;distortion:number;click:Amount;bottleneck:string;charter?:CharterFlow}
export interface Eligibility {allowed:boolean;reason:string}
export interface CommandResult {state:GameState;ok:boolean;message:string}
export interface Constitution {id:ConstitutionId;name:string;description:string;benefit:string;constraint:string;color:string}
export interface ScenarioModule {id:string;name:string;description:string;constraint:string;incompatible:string[]}
