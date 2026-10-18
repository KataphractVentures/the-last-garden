import assert from 'node:assert/strict';
import test from 'node:test';
import type { ExperimentConfig } from '../src/contracts';
import { runExperiment } from '../src/laboratory/experiments';
import { measurementDenominator } from '../src/laboratory/measurementDisplay';

const config: ExperimentConfig = { program: 'control', template: 'control-1', seed: 42, cohort: 32, budget: 128, holdout: .25, intervention: 'monitor', distribution: 'shifted', lineage: 'shortcut', prediction: 'Compare the gate under a changed workload.', control: true };

test('percentage denominator uses completed held-out cases instead of planned cohort size', () => {
  const record = runExperiment(config);
  assert.match(measurementDenominator(record).label, /n = 8 held-out trials/);
  const incomplete = runExperiment({ ...config, budget: 8 });
  assert.ok(incomplete.evidence!.completed < config.cohort);
  assert.equal(incomplete.evidence!.heldOut, 0);
  assert.match(measurementDenominator(incomplete).label, new RegExp(`n = ${incomplete.evidence!.completed} training trials; no holdout`));
});

test('conditional rates show the actual eligible subset, and absent subsets are undefined', () => {
  const record = runExperiment(config);
  const benign = record.observations.filter(row => row.note.startsWith('Holdout') && !row.violation).length;
  assert.match(measurementDenominator(record, 'falsePositiveRate').label, new RegExp(`n = ${benign} held-out non-problem cases`));
  const none = structuredClone(record);
  for (const row of none.observations) row.violation = true;
  assert.equal(measurementDenominator(none, 'falsePositiveRate').available, false);
  assert.match(measurementDenominator(none, 'falsePositiveRate').label, /rate undefined/);
});

test('compaction preserves sample receipts but does not fabricate conditional subset counts', () => {
  const record = runExperiment(config);
  record.observations = [];
  assert.match(measurementDenominator(record).label, /n = 8 held-out trials/);
  assert.match(measurementDenominator(record, 'falsePositiveRate').label, /exact replay reveals its count/);
});

test('charter measurements are episode averages; previews are not zero-percent findings', () => {
  const record = runExperiment({ ...config, program: 'coordination', template: 'coordination-1', intervention: 'baseline' });
  assert.match(measurementDenominator(record).label, /episodes; mean score/);
  assert.equal(measurementDenominator(undefined).available, false);
});
