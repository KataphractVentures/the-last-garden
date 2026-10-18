import type { BaseProgramId, CharterProgramId, ConstitutionId, ProgramId } from '../contracts';

export const BASE_PROGRAM_IDS:readonly BaseProgramId[]=['oversight','control','organisms','interpretability','welfare'];
export const CHARTER_PROGRAM_BY_CONSTITUTION:Record<ConstitutionId,CharterProgramId>={commons:'stewardship',precaution:'assurance',service:'reliability',federation:'coordination',plural:'reciprocity',frontier:'incentives'};
export const CHARTER_PROGRAM_IDS:readonly CharterProgramId[]=Object.values(CHARTER_PROGRAM_BY_CONSTITUTION);
export interface ResearchProgramDefinition {id:ProgramId;name:string;short:string;lead:string;color:string;description:string;kind:'base'|'charter';constitution?:ConstitutionId;instrument:string}
export const PROGRAMS:ResearchProgramDefinition[]=[
  {id:'oversight',name:'Scalable oversight',short:'Verification Commons',lead:'Lens',color:'#b9d994',description:'Who checks the work when no single reviewer can see the whole answer?',kind:'base',instrument:'review'},
  {id:'control',name:'Robustness & control',short:'Boundary Observatory',lead:'Latch',color:'#e6b87c',description:'Keep useful services running even when a toy actor cannot be trusted.',kind:'base',instrument:'boundary'},
  {id:'organisms',name:'Model organisms',short:'Failure Ecology',lead:'Moss',color:'#d8a1bd',description:'Construct a failure, trace its inheritance, and test an explanation.',kind:'base',instrument:'lineage'},
  {id:'interpretability',name:'Model internals',short:'Circuit Atlas',lead:'Prism',color:'#94c9da',description:'Change an actual small computation and discover what your explanation missed.',kind:'base',instrument:'circuit'},
  {id:'welfare',name:'AI welfare',short:'Moral Uncertainty Institute',lead:'Echo',color:'#c4b4e8',description:'Compare preferences and accommodations while keeping moral uncertainty visible.',kind:'base',instrument:'preference'},
  {id:'stewardship',name:'Knowledge Stewardship',short:'The Living Methods Library',lead:'Moss',color:'#a7cf9a',description:'Follow shared artifacts through reuse, maintenance, dependency failure, and public correction.',kind:'charter',constitution:'commons',instrument:'dependency'},
  {id:'assurance',name:'Assurance Engineering',short:'The Permission Workshop',lead:'Latch',color:'#a8bfdb',description:'Test what a safety case really warrants when premises expire, scope expands, and rollback costs resources.',kind:'charter',constitution:'precaution',instrument:'safety-case'},
  {id:'reliability',name:'Mission Reliability',short:'The Service Continuity Lab',lead:'Lens',color:'#dcc485',description:'Run queues, buffers, repairs, and fallbacks through demand peaks without hiding interrupted service.',kind:'charter',constitution:'service',instrument:'queue'},
  {id:'coordination',name:'Distributed Governance',short:'The Three Councils Observatory',lead:'Prism',color:'#bba8d9',description:'Observe what independent jurisdictions can agree on when information is delayed and authority is divided.',kind:'charter',constitution:'federation',instrument:'quorum'},
  {id:'reciprocity',name:'Reciprocal Work & Continuity',short:'The Negotiated Work Institute',lead:'Echo',color:'#ddaeb7',description:'Test executable rules for consent, rest, exit, and continuity while accounting for work left undone.',kind:'charter',constitution:'plural',instrument:'schedule'},
  {id:'incentives',name:'Incentive Design',short:'The Contested Contract Lab',lead:'Latch',color:'#d8a67d',description:'Change the payoff rules of a toy market and measure whether suppliers deliver, conceal, or exaggerate their work.',kind:'charter',constitution:'frontier',instrument:'market'},
];
export function isCharterProgram(program:ProgramId):program is CharterProgramId {return CHARTER_PROGRAM_IDS.includes(program as CharterProgramId);}
export function activeProgramIds(constitution:ConstitutionId):ProgramId[]{return [...BASE_PROGRAM_IDS,CHARTER_PROGRAM_BY_CONSTITUTION[constitution]];}
export function activePrograms(constitution:ConstitutionId):ResearchProgramDefinition[]{const ids=activeProgramIds(constitution);return ids.map(id=>PROGRAMS.find(program=>program.id===id)!);}
export function isProgramActive(program:ProgramId,constitution:ConstitutionId):boolean {return activeProgramIds(constitution).includes(program);}
export function activeCapstoneTemplateIds(constitution:ConstitutionId):string[]{return activeProgramIds(constitution).map(program=>`${program}-6`);}
