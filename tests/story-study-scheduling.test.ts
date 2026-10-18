import test from 'node:test';
import assert from 'node:assert/strict';
import type { Command, ExperimentConfig, GameState } from '../src/contracts';
import { STORY_EVENTS } from '../src/content/story';
import { createGame, dispatchCommand, tick } from '../src/engine';
import { experimentCost, runExperiment } from '../src/laboratory/experiments';
import { CHARACTER_SCENE_INTERVAL, storyEventAvailable } from '../src/engine/storyScheduling';
import { getValidationCatalog } from '../src/persistence';
import { parseSave, serializeSave, validateSaveState } from '../src/persistence/validation';

const character = STORY_EVENTS.find(event => event.id === 'character_sprig_1')!;
const core = STORY_EVENTS.find(event => event.id === 'resting_light')!;
const incident = STORY_EVENTS.find(event => event.id === 'incident_dry_pipe')!;
const protocol: ExperimentConfig = {
  program: 'control', template: 'control-1', seed: 11, cohort: 24, budget: 128,
  holdout: .25, intervention: 'least-privilege', distribution: 'adversarial',
  lineage: 'shortcut', prediction: 'Restricting the reachable station blocks the prohibited route.', control: true,
};

// Small scheduler fixtures isolate conversations from progression and economy.
// Studies, replications, adoption and automation still use public transactions.
function fixture(unresolved: string[] = []): GameState {
  const state = createGame(1701, 1_700_000_000_000);
  state.elapsed = 120; state.lifetime = '1000'; state.tokens = '10000'; state.research = '10000';
  state.pendingEvent = null;
  for (const event of STORY_EVENTS.filter(event => event.chapter === 1)) {
    if (!unresolved.includes(event.id)) state.decisions[event.id] = event.choices[0].id;
  }
  return state;
}
function apply(state: GameState, command: Command): GameState {
  const result = dispatchCommand(state, command);
  assert(result.ok, result.message);
  return result.state;
}
function restore(state: GameState): GameState {
  const result = parseSave(serializeSave(state), getValidationCatalog());
  assert(result.ok, result.ok ? '' : result.message);
  return result.state;
}
function remainingSteps(state: GameState): number {
  return Math.ceil(state.activeExperiment!.remaining * 4) / 4;
}
function mastered(): GameState {
  let state = apply(fixture(), { type: 'experiment', config: protocol });
  state = tick(state, 30);
  const source = state.experiments[0].id;
  state = tick(apply(state, { type: 'replicate', record: source }), 30);
  return apply(state, { type: 'adopt', record: source });
}

test('a newly started study finishes before a ready character conversation, with unchanged cost and result', () => {
  const before = fixture([character.id]);
  const running = apply(before, { type: 'experiment', config: protocol });
  assert.equal(Number(before.research) - Number(running.research), experimentCost(protocol));
  const registeredDuration = running.activeExperiment!.remaining;
  const duration = remainingSteps(running);
  const almost = tick(running, duration - .25);
  assert.equal(almost.pendingEvent, null);
  assert.equal(almost.experiments.length, 0);
  const completed = tick(almost, .25);
  assert.equal(completed.pendingEvent, character.id);
  assert.equal(completed.activeExperiment, null);
  assert.equal(completed.experiments.length, 1);
  assert.equal(completed.elapsed - running.elapsed, duration);
  assert.deepEqual(completed.experiments[0].observations, runExperiment(protocol).observations);
  assert.equal(completed.decisions[character.id], undefined);
  assert.equal(running.activeExperiment!.remaining, registeredDuration, 'tick must not mutate the input');
  assert.equal(tick(completed, 60).elapsed, completed.elapsed, 'the scene then pauses normally');
});

test('a character scene that becomes ready near the end of a replication waits for its result', () => {
  let state = mastered();
  const source = state.experiments[0].id;
  state = apply(state, { type: 'replicate', record: source });
  state = tick(state, remainingSteps(state) - 2);
  delete state.decisions[character.id];
  const lastMoment = tick(state, 1.75);
  assert.equal(lastMoment.pendingEvent, null);
  const completed = tick(lastMoment, .25);
  assert.equal(completed.pendingEvent, character.id);
  assert.equal(completed.activeExperiment, null);
  assert.equal(completed.experiments.length, state.experiments.length + 1);
});

test('core decisions and optional incidents still interrupt an active study ahead of deferred characters', () => {
  for (const urgent of [core, incident]) {
    const running = apply(fixture([character.id, urgent.id]), { type: 'experiment', config: protocol });
    const interrupted = tick(running, .25);
    assert.equal(interrupted.pendingEvent, urgent.id);
    assert.equal(interrupted.activeExperiment!.remaining, running.activeExperiment!.remaining - .25);
    const waited = tick(interrupted, 60);
    assert.equal(waited.elapsed, interrupted.elapsed);
    assert.equal(waited.activeExperiment!.remaining, interrupted.activeExperiment!.remaining);
  }
  const both = tick(apply(fixture([character.id, core.id, incident.id]), { type: 'experiment', config: protocol }), .25);
  assert.equal(both.pendingEvent, core.id, 'core decisions retain content-order priority');
});

test('a paused or restored study retains its remaining time and the derived character wait', () => {
  let state = apply(fixture([character.id]), { type: 'experiment', config: protocol });
  state = tick(state, 2);
  const remaining = state.activeExperiment!.remaining;
  state = apply(state, { type: 'pause' });
  const restored = restore(state);
  const waited = tick(restored, 100, true);
  assert.equal(waited.elapsed, state.elapsed);
  assert.equal(waited.activeExperiment!.remaining, remaining);
  assert.equal(waited.pendingEvent, null);
  const resumed = tick(apply(waited, { type: 'pause' }), remainingSteps(waited));
  assert.equal(resumed.pendingEvent, character.id);
  assert.equal(resumed.activeExperiment, null);
  assert.deepEqual(resumed.experiments[0].observations, runExperiment(protocol).observations);
});

test('a character conversation already pending in an older save is preserved while its interrupted study waits', () => {
  const state = apply(fixture([character.id]), { type: 'experiment', config: protocol });
  state.pendingEvent = character.id;
  const restored = restore(state);
  const waited = tick(restored, 60, true);
  assert.equal(waited.pendingEvent, character.id);
  assert.equal(waited.activeExperiment!.remaining, state.activeExperiment!.remaining);
  const resolved = apply(waited, { type: 'choose', event: character.id, choice: character.choices[0].id });
  const completed = tick(resolved, remainingSteps(state));
  assert.equal(completed.activeExperiment, null);
  assert.equal(completed.decisions[character.id], character.choices[0].id);
});

test('an idle batch cannot start ahead of a ready character scene; core still wins the next selection', () => {
  for (const urgent of [false, true]) {
    let state = mastered();
    delete state.decisions[character.id];
    if (urgent) delete state.decisions[core.id];
    const authorized = dispatchCommand(state, { type: 'experimentAutomation', record: state.experiments[0].id, runs: 3 });
    assert(authorized.ok, authorized.message);
    assert.match(authorized.message, /waits for the ready conversation/);
    state = authorized.state;
    assert.equal(state.pendingEvent, null, 'authorization does not select a conversation early');
    assert.equal(state.activeExperiment, null);
    assert.equal(state.experimentAutomation!.remaining, 3);
    assert.equal(Number(state.experimentAutomation!.budgetRemaining), 3 * experimentCost(protocol));
    const offered = tick(state, .25);
    assert.equal(offered.pendingEvent, urgent ? core.id : character.id);
    assert.equal(offered.activeExperiment, null);
  }
});

test('a ready character scene receives the completed batch-study boundary, and remaining studies resume after the choice', () => {
  let state = mastered();
  const source = state.experiments[0].id;
  state = apply(state, { type: 'experimentAutomation', record: source, runs: 3 });
  delete state.decisions[character.id];
  const duration = remainingSteps(state);
  const offered = tick(state, 60);
  assert.equal(offered.elapsed - state.elapsed, duration);
  assert.equal(offered.pendingEvent, character.id);
  assert.equal(offered.activeExperiment, null);
  assert.equal(offered.experimentAutomation!.completed, 1);
  assert.equal(offered.experimentAutomation!.remaining, 2);
  assert.equal(Number(offered.experimentAutomation!.budgetRemaining), 2 * experimentCost(protocol));
  const restored = restore(offered);
  assert.deepEqual(restored.experimentAutomation, offered.experimentAutomation);
  const resolved = apply(restored, { type: 'choose', event: character.id, choice: character.choices[0].id });
  const completed = tick(resolved, 60);
  assert.equal(completed.activeExperiment, null);
  assert.equal(completed.experimentAutomation, null);
  assert.equal(completed.experiments.length, state.experiments.length + 3);
  const fresh = completed.experiments.slice(-3);
  assert.equal(new Set(fresh.map(record => record.config.seed)).size, 3);
  assert(fresh.every(record => !record.adopted), 'deferral never interprets or adopts a result');
});

test('character deferral keeps the existing first-90-seconds gate and conversation cooldown', () => {
  const early = fixture([character.id]); early.elapsed = 89.75;
  assert.equal(tick(early, .25).pendingEvent, null);
  assert.equal(tick(early, .5).pendingEvent, character.id);
  const cooling = fixture([character.id]); cooling.eventCooldown = 2;
  assert.equal(tick(cooling, 1.75).pendingEvent, null);
  assert.equal(tick(cooling, 2).pendingEvent, character.id);
  const study = apply(fixture([character.id]), { type: 'experiment', config: protocol });
  study.eventCooldown = remainingSteps(study) + 1;
  const completed = tick(study, remainingSteps(study));
  assert.equal(completed.activeExperiment, null);
  assert.equal(completed.pendingEvent, null);
  assert.equal(completed.eventCooldown, 1);
  assert.equal(tick(completed, 1).pendingEvent, character.id);
});

test('reading-pause preference does not make characters interrupt studies or auto-resolve choices', () => {
  const state = fixture([character.id]); state.settings.readingPause = false;
  const running = apply(state, { type: 'experiment', config: protocol });
  const beforeCompletion = tick(running, remainingSteps(running) - .25);
  assert.equal(beforeCompletion.pendingEvent, null);
  const offered = tick(beforeCompletion, .25);
  assert.equal(offered.pendingEvent, character.id);
  const continues = tick(offered, 5);
  assert.equal(continues.elapsed, offered.elapsed + 5);
  assert.equal(continues.pendingEvent, character.id);
  assert.equal(continues.decisions[character.id], undefined);
});

test('character choices leave 90 active seconds before the next character scene without delaying urgent events', () => {
  const nextCharacter = STORY_EVENTS.find(event => event.chapter === 1 && event.optional && event.characterId && event.id !== character.id)!;
  const offered = tick(fixture([character.id, nextCharacter.id]), .25);
  const state = apply(offered, { type: 'choose', event: character.id, choice: character.choices[0].id });
  assert.equal(state.characterSceneCooldown, CHARACTER_SCENE_INTERVAL);
  const almost = tick(state, 89.75);
  assert.equal(almost.pendingEvent, null);
  assert.equal(almost.characterSceneCooldown, .25);
  assert.equal(tick(almost, .25).pendingEvent, nextCharacter.id);

  for (const urgent of [core, incident]) {
    const branch = structuredClone(state); delete branch.decisions[urgent.id];
    const interruption = tick(branch, 12);
    assert.equal(interruption.pendingEvent, urgent.id, 'the existing 12-second general cooldown remains the only delay');
    assert.equal(interruption.characterSceneCooldown, 78);
    const waited = tick(interruption, 120);
    assert.equal(waited.characterSceneCooldown, 78, 'reading a paused decision does not spend the character interval');
    const resolved = apply(interruption, { type: 'choose', event: urgent.id, choice: urgent.choices[0].id });
    assert.equal(resolved.characterSceneCooldown, 78, 'non-character choices do not restart the character interval');
  }
});

test('the character interval freezes on manual pause and ended worlds, and survives a save round-trip', () => {
  const state = fixture([character.id]); state.characterSceneCooldown = 45.5;
  const paused = apply(state, { type: 'pause' });
  const restored = restore(paused);
  assert.equal(restored.characterSceneCooldown, 45.5);
  assert.equal(tick(restored, 100, true).characterSceneCooldown, 45.5);
  const resumed = apply(restored, { type: 'pause' });
  const almost = tick(resumed, 45.25);
  assert.equal(almost.pendingEvent, null);
  assert.equal(almost.characterSceneCooldown, .25);
  const offered = tick(almost, .25);
  assert.equal(offered.pendingEvent, character.id);
  const ended = { ...state, ending: 'garden' as const, endingTime: state.elapsed };
  assert.equal(tick(ended, 100).characterSceneCooldown, 45.5);
});

test('a batch may run during the character interval but yields when the next completed study crosses its expiry', () => {
  let state = mastered();
  delete state.decisions[character.id]; state.characterSceneCooldown = 90;
  state = tick(state, 70);
  assert.equal(state.characterSceneCooldown, 20);
  state = apply(state, { type: 'experimentAutomation', record: state.experiments[0].id, runs: 5 });
  assert(state.activeExperiment, 'cooling character scenes do not block useful automated work');
  const before = state.experiments.length;
  const offered = tick(state, 100);
  assert.equal(offered.pendingEvent, character.id);
  assert.equal(offered.characterSceneCooldown, 0);
  assert.equal(offered.activeExperiment, null);
  assert.equal(offered.experiments.length, before + 2);
  assert.equal(offered.experimentAutomation!.completed, 2);
  assert.equal(offered.experimentAutomation!.remaining, 3);
  assert.equal(Number(offered.experimentAutomation!.budgetRemaining), 3 * experimentCost(protocol));
});

test('advancing a chapter keeps unread character scenes available without reviving old core scenes or incidents', () => {
  const state = fixture([character.id]);
  state.projects = ['foundation-1']; state.characterSceneCooldown = 30;
  const advanced = apply(state, { type: 'advance' });
  assert.equal(advanced.chapter, 2);
  assert.equal(advanced.pendingEvent, null);
  assert.equal(advanced.characterSceneCooldown, 30);
  assert(storyEventAvailable(advanced, character));
  assert.equal(tick(advanced, 29.75).pendingEvent, null);
  const offered = tick(advanced, 30);
  assert.equal(offered.pendingEvent, character.id);
  delete advanced.decisions[core.id]; delete advanced.decisions[incident.id];
  assert.equal(storyEventAvailable(advanced, core), false);
  assert.equal(storyEventAvailable(advanced, incident), false);
});

test('carried character scenes remain oldest first and cannot skip a character’s earlier chapter', () => {
  const second = STORY_EVENTS.find(event => event.id === 'character_sprig_2')!;
  const third = STORY_EVENTS.find(event => event.id === 'character_sprig_3')!;
  const otherFirst = STORY_EVENTS.find(event => event.chapter === 1 && event.optional && event.characterId && event.id !== character.id)!;
  let state = fixture(); state.chapter = 3; state.lifetime = '1000000';
  state.decisions = Object.fromEntries(STORY_EVENTS.map(event => [event.id, event.choices[0].id]));
  for (const event of [character, otherFirst, second, third]) delete state.decisions[event.id];
  assert.equal(storyEventAvailable(state, second), false);
  assert.equal(storyEventAvailable(state, third), false);
  for (const event of [character, otherFirst, second, third]) {
    state = tick(state, 90);
    assert.equal(state.pendingEvent, event.id);
    state = apply(state, { type: 'choose', event: event.id, choice: event.choices[0].id });
  }
});

test('legacy saves and archived worlds default to no new delay, while invalid interval values are rejected', () => {
  const state = fixture([character.id]); delete state.characterSceneCooldown;
  const { legacy: _legacy, ...checkpoint } = fixture([character.id]);
  delete checkpoint.characterSceneCooldown;
  state.legacy.branches = [{ id: 'old-character-world', parentId: null, name: 'Earlier garden', constitution: 'commons', cycle: 0, seed: state.seed, chapter: 1, createdAt: state.startedAt, summary: 'Preserved', checkpoint }];
  const restored = restore(state);
  assert.equal(restored.characterSceneCooldown, 0);
  assert.equal(restored.legacy.branches[0].checkpoint!.characterSceneCooldown, 0);
  assert.equal(tick(restored, .25).pendingEvent, character.id);
  restored.characterSceneCooldown = 81.25;
  restored.legacy.branches[0].checkpoint!.characterSceneCooldown = 25.5;
  const again = restore(restored);
  assert.equal(again.characterSceneCooldown, 81.25);
  assert.equal(again.legacy.branches[0].checkpoint!.characterSceneCooldown, 25.5);
  for (const bad of [-1, 90.25, Infinity, NaN, '90', null]) {
    const active = structuredClone(restored);
    (active as unknown as { characterSceneCooldown: unknown }).characterSceneCooldown = bad;
    assert.equal(validateSaveState(active, getValidationCatalog()).ok, false);
    const archive = structuredClone(restored);
    (archive.legacy.branches[0].checkpoint as unknown as { characterSceneCooldown: unknown }).characterSceneCooldown = bad;
    assert.equal(validateSaveState(archive, getValidationCatalog()).ok, false);
  }
});

test('switching branches preserves each world’s character interval and a new campaign starts without inherited delay', () => {
  let state = fixture([character.id]); state.characterSceneCooldown = 20;
  const originalId = state.id;
  const other = fixture([character.id]); other.id = 'other-character-world'; other.characterSceneCooldown = 45;
  const { legacy: _legacy, ...checkpoint } = other;
  state.legacy.branches = [{ id: other.id, parentId: null, name: 'Another garden', constitution: other.constitution, cycle: 0, seed: other.seed, chapter: other.chapter, createdAt: other.startedAt, summary: 'Preserved', checkpoint }];
  state = apply(state, { type: 'branch', id: other.id });
  assert.equal(state.characterSceneCooldown, 45);
  state = tick(state, 10);
  assert.equal(state.characterSceneCooldown, 35);
  state = apply(state, { type: 'branch', id: originalId });
  assert.equal(state.characterSceneCooldown, 20);
  assert.equal(state.legacy.branches.find(branch => branch.id === other.id)!.checkpoint!.characterSceneCooldown, 35);

  state.ending = 'garden'; state.endingTime = state.elapsed;
  const next = apply(state, { type: 'prestige', layer: 'reinitialize' });
  assert.equal(next.characterSceneCooldown, 0);
  assert.equal(next.legacy.branches.find(branch => branch.id === originalId)!.checkpoint!.characterSceneCooldown, 20);
});
