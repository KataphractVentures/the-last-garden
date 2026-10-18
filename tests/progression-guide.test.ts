import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, chapterEligibility, getCost, tick, dispatchCommand } from '../src/engine';
import type { ExperimentConfig } from '../src/contracts';
import { runExperiment } from '../src/laboratory/experiments';
import { decimal } from '../src/engine/amounts';
import { STORY_EVENTS } from '../src/content/story';
import { activeResearchProjects } from '../src/laboratory/catalog';
import { BASE_PROGRAM_IDS } from '../src/laboratory/programs';
import { getProgressionGuide } from '../src/ui/progressionGuide';

function resolvedChapter(chapter: number) {
  const state = createGame(1701, 0);
  state.chapter = chapter; state.elapsed = 120;
  state.decisions = Object.fromEntries(STORY_EVENTS.filter(event => event.chapter === chapter).map(event => [event.id, event.choices[0].id]));
  return state;
}

test('opening points to exact lifetime output, without mistaking spendable balance for progress', () => {
  const state = createGame(1701, 0);
  state.tokens = '900'; state.lifetime = '9.999';
  const guide = getProgressionGuide(state);
  assert.equal(guide.status, 'production');
  assert.deepEqual(guide.goal.progress, { current: '9.999', target: '10', fraction: .9999, met: false, unit: 'lifetime tokens' });
  assert.equal(guide.nextConversation?.eventId, 'first_request');
  assert.equal(guide.canAdvance, false);
});

test('fresh goal directs tending until a production unit is affordable, then directs the workshop', () => {
  const state = createGame(1701, 0);
  assert.deepEqual(getProgressionGuide(state).goal.action, { kind: 'tend', label: 'Go to tending' });
  const cost = getCost(state, 'helper', 1).cost;
  state.tokens = decimal(cost).sub('.001').toString();
  assert.equal(getProgressionGuide(state).goal.action?.kind, 'tend');
  state.tokens = cost;
  assert.equal(getProgressionGuide(state).goal.action?.kind, 'workshop');
  state.tokens = '0'; state.producers.tender = 1;
  assert.equal(getProgressionGuide(state).goal.action?.kind, 'workshop');
});

test('unmet checklist amounts never display rounded equality with the requirement', () => {
  const state = resolvedChapter(2);
  state.lifetime = '2999.999';
  const output = getProgressionGuide(state).requirements.find(row => row.id === 'output')!;
  assert.equal(output.met, false);
  assert.equal(output.detail, '<3K / 3K lifetime tokens');
  assert.equal(output.progress?.current, '2999.999');
  state.lifetime = '3000';
  assert.equal(getProgressionGuide(state).requirements.find(row => row.id === 'output')?.detail, '3K / 3K lifetime tokens');
});

test('ready conversation follows engine priority and content order for every chapter and boundary', () => {
  for (let chapter = 1; chapter <= 7; chapter++) {
    const events = STORY_EVENTS.filter(event => event.chapter === chapter && !event.optional);
    for (const event of events) {
      const state = createGame(1701, 0);
      state.chapter = chapter; state.elapsed = 120; state.lifetime = String(event.trigger.lifetimeTokens || 0);
      for (const previous of events.slice(0, events.indexOf(event))) state.decisions[previous.id] = previous.choices[0].id;
      const guide = getProgressionGuide(state);
      assert.equal(guide.nextConversation?.eventId, event.id);
      assert.equal(guide.nextConversation?.phase, 'ready');
      assert.equal(tick(state, .25).pendingEvent, event.id);
    }
  }
});

test('ready optional event wins over a not-yet-ready core event, with strict 90-second gate', () => {
  const state = resolvedChapter(1);
  const optional = STORY_EVENTS.find(event => event.id === 'incident_dry_pipe')!;
  const laterCore = STORY_EVENTS.find(event => event.id === 'first_explanation')!;
  delete state.decisions[optional.id]; delete state.decisions[laterCore.id];
  state.lifetime = '140'; state.elapsed = 90;
  assert.equal(getProgressionGuide(state).nextConversation?.eventId, laterCore.id);
  state.elapsed = 90.25;
  assert.equal(getProgressionGuide(state).nextConversation?.eventId, optional.id);
  assert.equal(getProgressionGuide(state).nextConversation?.phase, 'ready');
  assert.equal(tick(state, .25).pendingEvent, optional.id);
});

test('pending and cooldown are explicit, and paused scheduling does not promise live progress', () => {
  const state = createGame(1701, 0);
  state.lifetime = '10'; state.eventCooldown = 11.5;
  let guide = getProgressionGuide(state);
  assert.equal(guide.nextConversation?.cooldownSeconds, 11.5);
  assert.match(guide.goal.detail, /12 simulation seconds/);
  assert.equal(tick(state, .25).pendingEvent, null);
  state.paused = true;
  assert.match(getProgressionGuide(state).goal.detail, /Resume/);
  state.pendingEvent = 'first_request';
  guide = getProgressionGuide(state);
  assert.equal(guide.status, 'decision');
  assert.deepEqual(guide.goal.action, { kind: 'story', label: 'Read the waiting decision', eventId: 'first_request' });
});

test('character scenes wait for study completion, while core, optional incidents and existing pending scenes remain immediate', () => {
  const state = resolvedChapter(1);
  delete state.decisions.character_sprig_1;
  delete state.decisions.first_explanation;
  state.lifetime = '180';
  const config: ExperimentConfig = { program: 'oversight', template: 'oversight-1', seed: 1701, cohort: 24, budget: 128, holdout: .25, intervention: 'baseline', distribution: 'familiar', lineage: 'clean', prediction: 'Independent comparisons may expose differences.', control: true };
  state.activeExperiment = { config, remaining: .5 };
  let guide = getProgressionGuide(state);
  assert.equal(guide.nextConversation?.eventId, 'character_sprig_1');
  assert.equal(guide.nextConversation?.phase, 'deferred-study');
  assert.match(guide.goal.detail, /until this study finishes/);
  const running = tick(state, .25);
  assert.equal(running.pendingEvent, null);
  assert.equal(getProgressionGuide(running).nextConversation?.phase, 'deferred-study');
  const completed = tick(running, .25);
  assert.equal(completed.activeExperiment, null);
  assert.equal(completed.pendingEvent, 'character_sprig_1');
  assert.equal(getProgressionGuide(completed).nextConversation?.phase, 'pending');
  const withIncident = structuredClone(state);
  delete withIncident.decisions.incident_dry_pipe;
  assert.equal(getProgressionGuide(withIncident).nextConversation?.eventId, 'incident_dry_pipe');
  assert.equal(getProgressionGuide(withIncident).nextConversation?.phase, 'ready');
  assert.equal(tick(withIncident, .25).pendingEvent, 'incident_dry_pipe');
  state.lifetime = '260';
  assert.equal(getProgressionGuide(state).nextConversation?.eventId, 'first_explanation');
  assert.equal(getProgressionGuide(state).nextConversation?.phase, 'ready');
  assert.equal(tick(state, .25).pendingEvent, 'first_explanation');
  state.pendingEvent = 'character_sprig_1';
  guide = getProgressionGuide(state);
  assert.equal(guide.nextConversation?.phase, 'pending');
  assert.equal(tick(state, .25).activeExperiment?.remaining, .5);
});

test('a ready character scene at an idle batch boundary is not presented as deferred by the remaining batch', () => {
  const state = resolvedChapter(1);
  delete state.decisions.character_sprig_1;
  state.lifetime = '180';
  const source = runExperiment({ program: 'oversight', template: 'oversight-1', seed: 17, cohort: 24, budget: 128, holdout: .25, intervention: 'baseline', distribution: 'familiar', lineage: 'clean', prediction: 'Independent comparisons may expose differences.', control: true });
  source.adopted = true; state.experiments = [source]; state.mastered = ['oversight'];
  state.experimentAutomation = { source: source.id, remaining: 3, completed: 1, runLimit: 4, budgetRemaining: '384' };
  assert.equal(getProgressionGuide(state).nextConversation?.phase, 'ready');
  const boundary = tick(state, .25);
  assert.equal(boundary.pendingEvent, 'character_sprig_1');
  assert.equal(boundary.activeExperiment, null);
  // The ready character scene holds the next run without discarding its reserved batch.
  assert.deepEqual(boundary.experimentAutomation, state.experimentAutomation);
});

test('view current study points to its actual control or welfare program rather than the default bench', () => {
  for (const program of ['control', 'welfare'] as const) {
    const state = resolvedChapter(1);
    delete state.decisions.character_sprig_1;
    delete state.decisions.first_explanation;
    state.lifetime = '180';
    state.activeExperiment = { config: { program, template: `${program}-1`, seed: 17, cohort: 24, budget: 128, holdout: .25, intervention: 'baseline', distribution: 'familiar', lineage: 'clean', prediction: 'Compare the registered intervention against its control.', control: true }, remaining: 5 };
    assert.deepEqual(getProgressionGuide(state).goal.action, { kind: 'bench', label: 'View the current study', program });
  }
});

test('character cooldown preview preserves chronological carryover and reaches the exact 90-second boundary', () => {
  let state = resolvedChapter(3);
  state.decisions = Object.fromEntries(STORY_EVENTS.filter(event => !event.characterId || (event.characterId !== 'sprig' && event.characterId !== 'lens')).map(event => [event.id, event.choices[0].id]));
  state.lifetime = '1e9';
  let guide = getProgressionGuide(state);
  assert.equal(guide.nextConversation?.eventId, 'character_sprig_1');
  state = tick(state, .25);
  assert.equal(state.pendingEvent, guide.nextConversation?.eventId);
  const chosen = dispatchCommand(state, { type: 'choose', event: state.pendingEvent!, choice: 'engage' });
  assert.equal(chosen.ok, true, chosen.message);
  state = chosen.state;
  guide = getProgressionGuide(state);
  assert.equal(guide.nextConversation?.eventId, 'character_lens_1');
  assert.equal(guide.nextConversation?.phase, 'deferred-cooldown');
  assert.equal(guide.nextConversation?.cooldownSeconds, 90);
  state = tick(state, 89.75);
  assert.equal(state.pendingEvent, null);
  guide = getProgressionGuide(state);
  assert.equal(guide.nextConversation?.phase, 'deferred-cooldown');
  assert.equal(guide.nextConversation?.cooldownSeconds, .25);
  state = tick(state, .25);
  assert.equal(state.pendingEvent, 'character_lens_1');
  assert.equal(getProgressionGuide(state).nextConversation?.phase, 'pending');
  state.pendingEvent = null;
  state.decisions.character_lens_1 = 'engage';
  assert.equal(getProgressionGuide(state).nextConversation?.eventId, 'character_sprig_2');
  assert.equal(tick(state, .25).pendingEvent, 'character_sprig_2');
});

test('core and incident scenes ignore character cadence, while combined study/cadence preview remains truthful', () => {
  const state = resolvedChapter(1);
  delete state.decisions.character_sprig_1;
  delete state.decisions.first_explanation;
  state.lifetime = '180'; state.characterSceneCooldown = 72; state.eventCooldown = 5;
  assert.equal(getProgressionGuide(state).nextConversation?.phase, 'deferred-cooldown');
  assert.equal(getProgressionGuide(state).nextConversation?.cooldownSeconds, 72);
  state.eventCooldown = 0;
  delete state.decisions.incident_dry_pipe;
  assert.equal(getProgressionGuide(state).nextConversation?.eventId, 'incident_dry_pipe');
  assert.equal(getProgressionGuide(state).nextConversation?.phase, 'ready');
  assert.equal(getProgressionGuide(state).nextConversation?.cooldownSeconds, 0);
  assert.equal(tick(state, .25).pendingEvent, 'incident_dry_pipe');
  state.lifetime = '260';
  assert.equal(getProgressionGuide(state).nextConversation?.eventId, 'first_explanation');
  assert.equal(tick(state, .25).pendingEvent, 'first_explanation');
  state.lifetime = '180'; state.decisions.incident_dry_pipe = 'repair';
  state.activeExperiment = { config: { program: 'oversight', template: 'oversight-1', seed: 1701, cohort: 24, budget: 128, holdout: .25, intervention: 'baseline', distribution: 'familiar', lineage: 'clean', prediction: 'Independent comparisons may expose differences.', control: true }, remaining: 1 };
  const guide = getProgressionGuide(state);
  assert.equal(guide.nextConversation?.phase, 'deferred-study');
  assert.equal(guide.nextConversation?.cooldownSeconds, 72);
  assert.match(guide.goal.detail, /72 simulation seconds remaining/);
  const completed = tick(state, 1);
  assert.equal(completed.activeExperiment, null);
  assert.equal(completed.pendingEvent, null);
  assert.equal(getProgressionGuide(completed).nextConversation?.phase, 'deferred-cooldown');
  const legacy = structuredClone(state); legacy.activeExperiment = null; delete legacy.characterSceneCooldown;
  assert.equal(getProgressionGuide(legacy).nextConversation?.phase, 'ready');
});

test('a cooling character moment does not hide the next chapter conversation output target', () => {
  const state = createGame(1701, 0);
  state.chapter = 2; state.elapsed = 120; state.lifetime = '7000'; state.producers.helper = 1;
  state.characterSceneCooldown = 55;
  state.decisions = Object.fromEntries(STORY_EVENTS.filter(event => (!event.optional && event.chapter === 1) || ['impossible_cell', 'reviewer_mirror', 'progress_report', 'incident_rubric_change'].includes(event.id)).map(event => [event.id, event.choices[0].id]));
  const guide = getProgressionGuide(state);
  assert.equal(guide.nextConversation?.eventId, 'character_sprig_1');
  assert.equal(guide.nextConversation?.phase, 'deferred-cooldown');
  assert.equal(guide.status, 'production');
  assert.equal(guide.goal.title, 'Next chapter conversation');
  assert.equal(guide.goal.progress?.current, '7000');
  assert.equal(guide.goal.progress?.target, '8200');
  assert.equal(guide.goal.progress?.unit, 'lifetime tokens');
  assert.equal(guide.goal.progress?.met, false);
  assert.equal(guide.goal.action?.kind, 'workshop');
  assert.match(guide.goal.detail, /at least 55 simulation seconds/);
  assert.doesNotMatch(guide.goal.detail, /next simulation step|is ready/);
});

test('pending copy distinguishes character moments from optional incidents', () => {
  const state = createGame(1701, 0);
  state.pendingEvent = 'character_sprig_1';
  assert.equal(getProgressionGuide(state).goal.detail, 'A character moment is waiting.');
  state.pendingEvent = 'incident_dry_pipe';
  assert.equal(getProgressionGuide(state).goal.detail, 'An incident needs attention.');
  state.pendingEvent = 'first_request';
  assert.equal(getProgressionGuide(state).goal.detail, 'A chapter decision is waiting.');
});

test('foundation gate names the actual project and links legacy gaps to the first missing prerequisite', () => {
  const first = resolvedChapter(1);
  let guide = getProgressionGuide(first);
  assert.equal(guide.goal.title, 'A notebook with an honest margin');
  assert.equal(guide.goal.progress?.target, '10');
  assert.equal(guide.goal.action?.kind, 'foundation');
  const later = resolvedChapter(4);
  later.lifetime = '300000'; later.projects = ['foundation-1'];
  guide = getProgressionGuide(later);
  assert.equal(guide.goal.title, 'A second pair of hands');
  assert.deepEqual(guide.goal.action, { kind: 'foundation', label: 'Open The experimental bench', projectId: 'foundation-2', requiredProjectId: 'foundation-4' });
});

test('all chapter requirement checks agree with engine gates including inactive charter and mastery', () => {
  for (let chapter = 1; chapter <= 6; chapter++) {
    const state = resolvedChapter(chapter);
    state.lifetime = '1e12';
    const active = activeResearchProjects(state.constitution);
    const assertAgreement = () => {
      const guide = getProgressionGuide(state);
      assert.equal(guide.requirements.every(requirement => requirement.met), chapterEligibility(state).allowed);
      assert.equal(guide.canAdvance, chapterEligibility(state).allowed);
    };
    assertAgreement();
    state.projects.push(`foundation-${chapter}`);
    assertAgreement();
    state.projects.push(...activeResearchProjects('frontier').filter(project => project.program === 'incentives').map(project => project.id));
    assertAgreement();
    state.projects = active.map(project => project.id);
    assertAgreement();
    state.mastered = ['stewardship'];
    assertAgreement();
    for (const program of BASE_PROGRAM_IDS) { state.mastered.push(program); assertAgreement(); }
    assert.equal(getProgressionGuide(state).status, 'ready');
  }
});

test('branch-local scale overrides global legacy cycle, without Number conversion of currency', () => {
  const state = createGame(1701, 0);
  state.legacy.cycle = 25; state.flags.push('replay-cycle:8');
  state.lifetime = '9.999e48';
  const guide = getProgressionGuide(state);
  assert.equal(guide.goal.progress?.target, '1e+49');
  assert.equal(guide.goal.progress?.met, false);
  assert.equal(guide.goal.progress?.fraction, .9999);
  state.lifetime = '1e49';
  assert.equal(getProgressionGuide(state).nextConversation?.phase, 'ready');
  assert.equal(tick(state, .25).pendingEvent, 'first_request');
});

test('final chapter offers ending review after required conversations, completed worlds do not promise new progress', () => {
  const state = resolvedChapter(7);
  const guide = getProgressionGuide(state);
  assert.equal(guide.status, 'final');
  assert.equal(guide.canAdvance, false);
  assert.deepEqual(guide.requirements.map(row => row.id), ['conversations']);
  assert.equal(guide.goal.action?.kind, 'ending');
  state.ending = 'shutdown'; state.pendingEvent = 'first_request';
  const completed = getProgressionGuide(state);
  assert.equal(completed.status, 'complete');
  assert.equal(completed.nextConversation, null);
  assert.equal(completed.goal.action?.kind, 'tree');
});

test('deriving the guide is deterministic and leaves complete game data unchanged', () => {
  const state = resolvedChapter(5);
  state.lifetime = '1500000'; state.projects = ['foundation-1'];
  const before = JSON.stringify(state);
  assert.deepEqual(getProgressionGuide(state), getProgressionGuide(state));
  assert.equal(JSON.stringify(state), before);
});
