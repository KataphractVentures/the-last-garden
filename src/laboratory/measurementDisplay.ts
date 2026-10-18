import type { ExperimentRecord } from '../contracts';
import { proofSummary } from './evidence';

export type DisplayMetric = Exclude<keyof ExperimentRecord['summary'], 'cost'>;

/** A percentage alone hides sample size. Charter metrics are means of episode
 * scores; they must not be converted to invented counts of successful trials. */
export function measurementDenominator(record: ExperimentRecord | undefined, metric: DisplayMetric = 'usefulness'): { label: string; available: boolean } {
  if (!record) return { label: 'Protocol preview; no observations', available: false };
  const proof = proofSummary(record);
  const held = proof.heldOut > 0;
  const n = held ? proof.heldOut : proof.completed;
  if (!n) return { label: 'No verified completed observations', available: false };
  if (metric === 'falsePositiveRate' || metric === 'detectionRate') {
    const observations = held ? record.observations.filter(row => row.note.startsWith('Holdout')) : record.observations;
    const label = metric === 'falsePositiveRate' ? 'non-problem' : 'problem';
    if (observations.length !== n) return { label: `${label} subset of ${n} ${held ? 'held-out' : 'training'} trials; exact replay reveals its count`, available: true };
    const count = observations.filter(row => metric === 'falsePositiveRate' ? !row.violation : row.violation).length;
    return { label: `n = ${count} ${held ? 'held-out' : 'training'} ${label} cases${count ? '' : '; rate undefined'}`, available: count > 0 };
  }
  const charter = !['oversight', 'control', 'organisms', 'interpretability', 'welfare'].includes(record.config.program);
  return { label: `n = ${n} ${held ? 'held-out' : 'training'} ${charter ? 'episodes; mean score' : 'trials'}${held ? '' : '; no holdout'}`, available: true };
}
