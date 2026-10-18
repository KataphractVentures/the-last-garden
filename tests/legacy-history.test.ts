import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, dispatchCommand, actionEligibility, tick } from '../src/engine';
import { branchOrdinal, compactCheckpointPayload, compactLegacyHistory, certificateFrontier } from '../src/engine/legacyHistory';
import { STORY_EVENTS } from '../src/content/story';
import { runExperiment } from '../src/laboratory/experiments';
import { reconstructEvidence } from '../src/laboratory/evidence';
import { getValidationCatalog, parseSave, serializeSave } from '../src/persistence';
import type { Command, ExperimentConfig, GameState } from '../src/contracts';
import { prepareOperatingFixture } from './operatingFixture';

/** Explicit funded boundary fixtures isolate bookkeeping; they are not campaign playthroughs. */
function ready(seed = 1701): GameState {
  const s = createGame(seed, 1000); s.chapter = 7; s.pendingEvent = null;
  s.tokens = '1e12'; s.research = '1e9'; s.lifetime = '1e9'; s.useful = '1e9';
  s.decisions = Object.fromEntries(STORY_EVENTS.map(event => [event.id, event.choices[0].id]));
  s.metrics = { quality: 95, distortion: 0, agency: 85, welfare: 85, dependence: 35, evidence: 90, recall: 95, coordination: 85, pressure: 15, continuity: 90, humanWelfare: 85, reviewQueue: 0 };
  s.policies = { contract: 'verified', communication: 'reviewed', external: 'blocked', evaluation: 'independent', welfare: 'consent', continuity: 'protected', fallback: 'distributed', governance: 'council' };
  s.viableSeconds = 180; s.certificateProgress = 60; s.flags.push('fresh-evidence:0');
  return prepareOperatingFixture(s);
}
function apply(s: GameState, command: Command): GameState { const r = dispatchCommand(s, command); assert.equal(r.ok, true, r.message); return r.state; }
function valid(s: GameState): void { const result = parseSave(serializeSave(s), getValidationCatalog()); assert.equal(result.ok, true, result.ok ? '' : result.message); }
function receipt(tier: number, family = 'commons') { return { id: `certificate:0:${family}:${tier}`, family, cycle: 0, redeemed: false }; }

test('small histories stay byte-identical and absent summaries remain absent', () => {
  const s = ready(); s.legacy.contracts = Array.from({ length: 369 }, (_, i) => receipt(i)); s.legacy.claims = s.legacy.contracts.map(c => c.id);
  const original = JSON.stringify(s); compactLegacyHistory(s); compactCheckpointPayload(s);
  assert.equal(JSON.stringify(s), original); assert.equal(s.legacy.historySummary, undefined);
});

test('repeated receipt retirement keeps the shared frontier and cannot repay a stale snapshot', () => {
  let s = ready(); let generated = 0;
  for (let round = 0; round < 3; round++) {
    while (s.legacy.contracts.length < 2000) { const entry = receipt(generated++); s.legacy.contracts.push(entry); s.legacy.claims.push(entry.id); }
    s.certificateTier = generated; s.certificateProgress = 60;
    s.flags = s.flags.filter(flag => !flag.startsWith('fresh-evidence:') && !flag.startsWith('certified-useful:')); s.flags.push('fresh-evidence:0');
    const seeds = s.legacy.seeds; s = apply(s, { type: 'certify' }); generated++;
    assert.equal(s.legacy.seeds, seeds + 10);
    assert.equal((s.legacy.historySummary?.certificates ?? 0) + s.legacy.contracts.length, generated);
    assert(s.legacy.contracts.length <= 512); assert(s.legacy.claims.length < 2000); assert.equal(certificateFrontier(s), generated); valid(s);
    const stale = ready(s.seed); stale.id = s.id; stale.legacy = structuredClone(s.legacy); stale.certificateTier = 0;
    assert.equal(actionEligibility(stale, 'certify').allowed, false); assert.equal(dispatchCommand(stale, { type: 'certify' }).ok, false);
    assert.equal(stale.legacy.seeds, s.legacy.seeds);
  }
});

test('history retirement preserves a selected old target and the original branch ordinal and seed stream', () => {
  let s = ready();
  const old = ready(21); old.id = 'old-target'; const { legacy: _legacy, ...checkpoint } = old;
  s.legacy.branches = Array.from({ length: 255 }, (_, i) => ({ id: i ? `history-${i}` : old.id, parentId: null, name: `History ${i}`, constitution: 'commons', cycle: 0, seed: i, chapter: 7, createdAt: 1000, summary: 'Boundary fixture.', ...(i === 0 || i >= 253 ? { checkpoint: { ...structuredClone(checkpoint), id: i ? `history-${i}` : old.id } } : {}) }));
  s = apply(s, { type: 'branch', id: old.id });
  assert.equal(s.id, old.id); assert(s.legacy.branches.some(branch => branch.id === old.id)); assert.equal(branchOrdinal(s.legacy), 256);
  assert.equal(s.legacy.branches.filter(branch => branch.checkpoint).length, 3); valid(s);
  s = apply(s, { type: 'finish', ending: 'limit' });
  const expectedSeed = (s.seed + 2654435761 + 256) >>> 0;
  s = apply(s, { type: 'prestige', layer: 'reinitialize', constitution: 'commons', modules: [] });
  assert.equal(s.seed, expectedSeed); assert.equal(s.id, `garden-${expectedSeed}-0-256`); assert.equal(branchOrdinal(s.legacy), 256); valid(s);
});

function denseWorld(): GameState {
  const s = ready();
  // This archive-pressure fixture replaces every study below and makes no clearance claim.
  delete s.clearance;
  s.experiments = Array.from({ length: 180 }, (_, seed) => {
    const config: ExperimentConfig = { program: 'interpretability', template: 'interpretability-6', seed, cohort: 256, budget: 4096, holdout: .25, intervention: 'baseline', distribution: 'familiar', lineage: 'shortcut', prediction: 'A registered comparison tests whether the same circuit preserves the observed failure. '.repeat(7), control: true, node: 3 };
    const record = runExperiment(config); if (seed < 150) record.observations = []; return record;
  });
  const { legacy: _legacy, ...world } = s;
  for (let i = 0; i < 3; i++) {
    const checkpoint = structuredClone(world); checkpoint.id = `dense-${i}`;
    for (const record of checkpoint.experiments.slice(0, -10)) record.observations = [];
    s.legacy.branches.push({ id: checkpoint.id, parentId: null, name: `Dense world ${i}`, constitution: 'commons', cycle: 0, seed: i, chapter: 7, createdAt: 1000, summary: 'Authentic maximum-cohort observations.', checkpoint });
  }
  s.legacy.contracts = Array.from({ length: 1999 }, (_, i) => receipt(i)); s.legacy.claims = s.legacy.contracts.map(c => c.id); s.certificateTier = 1999;
  return s;
}

test('completed studies create envelope headroom by trimming only reproducible checkpoint rows', () => {
  let s = denseWorld(); valid(s);
  const original = serializeSave(s), originalRows = s.legacy.branches.map(branch => branch.checkpoint!.experiments.reduce((n, record) => n + record.observations.length, 0));
  const retainedProof = s.legacy.branches[0].checkpoint!.experiments.map(record => ({ id: record.id, config: record.config, evidence: record.evidence, summary: record.summary }));
  const config = { ...s.experiments.at(-1)!.config, seed: 9000 };
  s = apply(s, { type: 'experiment', config }); const input = s; s = tick(s, 30);
  assert.equal(input.legacy.branches[0].checkpoint!.experiments.reduce((n, record) => n + record.observations.length, 0), originalRows[0], 'Tick must not mutate shared prior legacy state.');
  assert(new TextEncoder().encode(serializeSave(s)).byteLength < 4.5 * 1024 * 1024);
  assert(s.legacy.branches.some((branch, i) => branch.checkpoint!.experiments.reduce((n, record) => n + record.observations.length, 0) < originalRows[i]));
  assert.deepEqual(s.legacy.branches[0].checkpoint!.experiments.map(record => ({ id: record.id, config: record.config, evidence: record.evidence, summary: record.summary })), retainedProof);
  const trimmed = s.legacy.branches[0].checkpoint!.experiments.at(-1)!;
  assert.deepEqual(reconstructEvidence(trimmed), trimmed.evidence);
  assert.equal(s.experiments.at(-1)!.observations.length, 256, 'Current result rows remain available.');
  assert.equal(s.legacy.branches.filter(branch => branch.checkpoint).length, 3); valid(s);
  s = apply(s, { type: 'branch', id: 'dense-0' }); valid(s); assert.equal(s.id, 'dense-0');
  assert(original.length > 0);
});
