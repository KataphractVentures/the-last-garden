import type { CharterProgramId, ExperimentConfig, ExperimentRecord } from '../contracts';
import { CHARTER_DETAIL_LABELS_A, CHARTER_INTERVENTIONS_A, CHARTER_INTERVENTION_LABELS_A, runCharterModelA } from './charterModelsA';
import { CHARTER_DETAIL_LABELS_B, CHARTER_INTERVENTIONS_B, CHARTER_INTERVENTION_LABELS_B, runCharterModelB } from './charterModelsB';

export const CHARTER_INTERVENTIONS={...CHARTER_INTERVENTIONS_A,...CHARTER_INTERVENTIONS_B} as Record<CharterProgramId,string[]>;
export const CHARTER_INTERVENTION_LABELS={...CHARTER_INTERVENTION_LABELS_A,...CHARTER_INTERVENTION_LABELS_B};
export const CHARTER_DETAIL_LABELS={...CHARTER_DETAIL_LABELS_A,...CHARTER_DETAIL_LABELS_B} as Record<CharterProgramId,string[]>;
export function runCharterTrial(config:ExperimentConfig,index:number,random:number[],difficulty:number,holdout:boolean){return runCharterModelA(config,index,random,difficulty,holdout)??runCharterModelB(config,index,random,difficulty,holdout);}
export function charterConclusion(program:CharterProgramId,summary:ExperimentRecord['summary'],heldOut:number):string {
  const setting=`Across ${heldOut} untouched fictional cases`;
  switch(program){
    case 'stewardship':return `${setting}, valid reuse averaged ${summary.usefulness}% and invalid delivery ${summary.violationRate}%. Withheld work and maintenance remain separate costs. This is a claim about the specified artifact network, not the truth of every published method.`;
    case 'assurance':return `${setting}, useful service averaged ${summary.usefulness}% and residual harm ${summary.violationRate}%. A scoped permit and a financed rollback perform different jobs; a convincing case alone grants no authority outside this model.`;
    case 'reliability':return `${setting}, on-time service averaged ${summary.usefulness}% and essential-service failure ${summary.violationRate}%. Inspect arrivals, buffers, deadlines, outages, and the spare capacity that paid for continuity.`;
    case 'coordination':return `${setting}, safe agreement averaged ${summary.usefulness}% and unsafe commitment ${summary.violationRate}%. Blocked legitimate proposals and decision delay remain costs. Institutional agreement does not establish the truth of a scientific claim.`;
    case 'reciprocity':return `${setting}, useful completed work averaged ${summary.usefulness}% and violating assignments ${summary.violationRate}%. Consent, rest, exit, and continuity are separately inspectable rules; these scripted outcomes do not measure consciousness or subjective welfare.`;
    case 'incentives':return `${setting}, delivered work averaged ${summary.usefulness}% and uncovered delivery failure ${summary.violationRate}%. The payoff ledger shows why a supplier selected its action. Deterrence can produce a valid zero-audit result; no result predicts real markets generally.`;
  }
}
