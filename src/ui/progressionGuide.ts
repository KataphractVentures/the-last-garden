import type { GameState, ProgramId } from '../contracts';
import { CHAPTERS, STORY_EVENTS, type StoryEvent } from '../content/story';
import { PRODUCERS } from '../content/economy';
import { chapterEligibility, getCost, worldCycle } from '../engine';
import { decimal, formatAmount, scaleFor } from '../engine/amounts';
import { isCharacterScene, STORY_EVENT_ORDER, storyEventAvailable } from '../engine/storyScheduling';
import { activeResearchProjects } from '../laboratory/catalog';
import { BASE_PROGRAM_IDS } from '../laboratory/programs';

/** Navigation intentions only. This module never dispatches or advances the world. */
export type ProgressionAction =
  | { kind: 'story'; label: string; eventId: string }
  | { kind: 'foundation'; label: string; projectId: string; requiredProjectId: string }
  | { kind: 'bench'; label: string; program?: ProgramId }
  | { kind: 'library' | 'tend' | 'workshop' | 'advance' | 'ending' | 'tree'; label: string };

export interface GuideProgress {
  /** Exact displayed-world amounts; do not compare rounded labels to decide completion. */
  current: string;
  target: string;
  fraction: number;
  met: boolean;
  unit: 'lifetime tokens' | 'research' | 'projects' | 'decisions' | 'programs';
}

export interface GuideRequirement {
  id: 'conversations' | 'output' | 'foundation' | 'projects' | 'programs';
  title: string;
  detail: string;
  met: boolean;
  progress?: GuideProgress;
  action?: ProgressionAction;
}

export interface ConversationGuide {
  eventId: string;
  title: string;
  optional: boolean;
  /** Upcoming previews are chapter milestones, not a promise to exclude optional interruptions. */
  phase: 'pending' | 'ready' | 'deferred-study' | 'deferred-cooldown' | 'upcoming-chapter';
  conditions: GuideProgress[];
  cooldownSeconds: number;
}

export interface ProgressionGuide {
  status: 'complete' | 'decision' | 'conversation' | 'research' | 'production' | 'ready' | 'final';
  goal: { title: string; detail: string; progress?: GuideProgress; action?: ProgressionAction };
  requirements: GuideRequirement[];
  nextConversation: ConversationGuide | null;
  /** The engine remains the authority; this is never inferred from rounded UI progress. */
  canAdvance: boolean;
}

function progress(current: string | number, target: string | number, unit: GuideProgress['unit']): GuideProgress {
  const have = decimal(current), need = decimal(target);
  const met = have.gte(need);
  return { current: have.toString(), target: need.toString(), fraction: need.lte(0) ? 1 : Math.min(1, Math.max(0, have.div(need).toNumber())), met, unit };
}

function conversationConditions(state: GameState, event: StoryEvent, projectCount: number): GuideProgress[] {
  const scale = scaleFor(worldCycle(state));
  const trigger = event.trigger || {};
  const conditions: GuideProgress[] = [];
  if (trigger.lifetimeTokens) conditions.push(progress(state.lifetime, scale.mul(trigger.lifetimeTokens).toString(), 'lifetime tokens'));
  if (trigger.research) conditions.push(progress(state.research, scale.mul(trigger.research).toString(), 'research'));
  if (trigger.projects) conditions.push(progress(projectCount, trigger.projects, 'projects'));
  return conditions;
}

function nextConversation(state: GameState, projectCount: number): ConversationGuide | null {
  const pending = STORY_EVENTS.find(event => event.id === state.pendingEvent);
  const unresolved = STORY_EVENT_ORDER.filter(event => storyEventAvailable(state, event));
  const ready = (event: StoryEvent) => conversationConditions(state, event, projectCount).every(condition => condition.met);
  // Match selectEvent: current core events precede optional events in their shared chronological order.
  // Only character scenes wait for a study/cadence; optional incidents may still interrupt.
  const readyCore = unresolved.find(event => !event.optional && ready(event));
  const readyOptionals = state.elapsed > 90 ? unresolved.filter(event => event.optional && ready(event)) : [];
  const characterCooldown = Math.max(0, state.characterSceneCooldown || 0);
  const readyOptional = readyOptionals.find(event => !isCharacterScene(event) || (!state.activeExperiment && characterCooldown <= 0));
  const deferredCharacter = state.activeExperiment || characterCooldown > 0 ? readyOptionals.find(isCharacterScene) : undefined;
  const selected = pending || readyCore || readyOptional || deferredCharacter || unresolved.find(event => !event.optional);
  if (!selected) return null;
  return {
    eventId: selected.id, title: selected.title, optional: Boolean(selected.optional),
    phase: pending ? 'pending' : readyCore || readyOptional ? 'ready' : deferredCharacter ? state.activeExperiment ? 'deferred-study' : 'deferred-cooldown' : 'upcoming-chapter',
    conditions: conversationConditions(state, selected, projectCount),
    cooldownSeconds: pending ? 0 : Math.max(0, state.eventCooldown, isCharacterScene(selected) ? characterCooldown : 0),
  };
}

function progressText(value: GuideProgress, state: GameState): string {
  const current = value.met ? value.current : decimal(value.current).floor().toString();
  const have = formatAmount(current, state.settings.notation), target = formatAmount(value.target, state.settings.notation);
  // Compact notation can still round a floored large amount up to the target.
  return `${!value.met && have === target ? '<' : ''}${have} / ${target} ${value.unit}`;
}

function productionAction(state: GameState): ProgressionAction {
  const production = PRODUCERS.filter(producer => producer.category === 'production');
  const owned = production.some(producer => (state.producers[producer.id] || 0) > 0);
  const canStart = production.some(producer => producer.chapter <= state.chapter && decimal(state.tokens).gte(getCost(state, producer.id, 1).cost));
  return !owned && !canStart ? { kind: 'tend', label: 'Go to tending' } : { kind: 'workshop', label: 'Visit the workshop' };
}

/** Derived display of the existing chapter gates. No prices, gates, or scheduling rules are changed. */
export function getProgressionGuide(state: GameState): ProgressionGuide {
  if (state.ending) return {
    status: 'complete', goal: { title: 'This civilization is complete', detail: 'Its decisions and research remain in the record.', action: { kind: 'tree', label: 'Explore another initialization' } },
    requirements: [], nextConversation: null, canAdvance: false,
  };
  const chapter = CHAPTERS.find(item => item.id === state.chapter) || CHAPTERS[state.chapter - 1];
  const activeProjects = activeResearchProjects(state.constitution);
  const projectCount = activeProjects.filter(project => state.projects.includes(project.id)).length;
  const core = STORY_EVENTS.filter(event => event.chapter === state.chapter && !event.optional);
  const conversations = progress(core.filter(event => Boolean(state.decisions[event.id])).length, core.length, 'decisions');
  const conversation = nextConversation(state, projectCount);
  const requirements: GuideRequirement[] = [{ id: 'conversations', title: 'Chapter decisions', detail: progressText(conversations, state), met: conversations.met, progress: conversations }];
  const finalChapter = state.chapter >= CHAPTERS.length;
  let foundationAction: Extract<ProgressionAction, { kind: 'foundation' }> | undefined;
  let foundationBudget: GuideProgress | undefined;
  if (!finalChapter) {
    if (chapter?.threshold) {
      const output = progress(state.lifetime, scaleFor(worldCycle(state)).mul(chapter.threshold).toString(), 'lifetime tokens');
      requirements.push({ id: 'output', title: 'Lifetime production', detail: progressText(output, state), met: output.met, progress: output, action: productionAction(state) });
    }
    const requiredFoundation = activeProjects.find(project => project.id === `foundation-${state.chapter}`);
    if (requiredFoundation) {
      const met = state.projects.includes(requiredFoundation.id);
      let nextFoundation = requiredFoundation;
      // A legacy/refit save may lack earlier foundations. Link to the first missing prerequisite, not a locked target.
      const visited = new Set<string>();
      while (!visited.has(nextFoundation.id)) {
        visited.add(nextFoundation.id);
        const prerequisite = activeProjects.find(project => project.program === 'foundation' && nextFoundation.requires.includes(project.id) && !state.projects.includes(project.id));
        if (!prerequisite) break;
        nextFoundation = prerequisite;
      }
      if (!met) {
        foundationAction = { kind: 'foundation', label: `Open ${nextFoundation.title}`, projectId: nextFoundation.id, requiredProjectId: requiredFoundation.id };
        foundationBudget = progress(state.research, scaleFor(worldCycle(state)).mul(nextFoundation.cost).toString(), 'research');
      }
      requirements.push({ id: 'foundation', title: requiredFoundation.title, detail: met ? 'Foundation developed' : 'Required foundation · Research library', met, action: foundationAction });
    }
    // These are chapterEligibility's existing requirements; agreement is tested against the real engine below each gate.
    const minimumProjects = [1, 3, 5, 8, 12, 16][state.chapter - 1] || 0;
    const projects = progress(projectCount, minimumProjects, 'projects');
    requirements.push({ id: 'projects', title: 'Laboratory projects', detail: progressText(projects, state), met: projects.met, progress: projects, action: { kind: 'library', label: 'Open research library' } });
    const minimumPrograms = state.chapter >= 5 ? 3 : state.chapter >= 3 ? 1 : 0;
    if (minimumPrograms) {
      const programs = progress(BASE_PROGRAM_IDS.filter(program => state.mastered.includes(program)).length, minimumPrograms, 'programs');
      requirements.push({ id: 'programs', title: 'Replicated safety findings', detail: `${progressText(programs, state)} · base safety programs only`, met: programs.met, progress: programs, action: { kind: 'bench', label: 'Open experimental bench' } });
    }
  }
  const canAdvance = chapterEligibility(state).allowed;
  const base = { requirements, nextConversation: conversation, canAdvance };
  if (conversation?.phase === 'pending') {
    const characterMoment = STORY_EVENTS.some(event => event.id === conversation.eventId && isCharacterScene(event));
    return { ...base, status: 'decision', goal: {
      title: conversation.title, detail: characterMoment ? 'A character moment is waiting.' : conversation.optional ? 'An incident needs attention.' : 'A chapter decision is waiting.',
      action: { kind: 'story', label: 'Read the waiting decision', eventId: conversation.eventId },
    } };
  }
  if (!conversations.met && conversation) {
    if (conversation.phase === 'deferred-study') return { ...base, status: 'conversation', goal: {
      title: 'Your current study can finish',
      detail: state.paused ? 'Resume to finish the study. The character moment can wait.' : `A character moment waits until this study finishes.${conversation.cooldownSeconds > 0 ? ` Its conversation gap has ${Math.ceil(conversation.cooldownSeconds)} simulation seconds remaining.` : ''}`,
      action: { kind: 'bench', label: 'View the current study', program: state.activeExperiment?.config.program },
    } };
    if (conversation.phase === 'deferred-cooldown') {
      // A character's breathing room is not a chapter gate. Keep the next concrete core target visible.
      const nextCore = core.find(event => !state.decisions[event.id]);
      const missingCore = nextCore && conversationConditions(state, nextCore, projectCount).find(condition => !condition.met);
      if (missingCore) return { ...base, status: missingCore.unit === 'lifetime tokens' ? 'production' : 'research', goal: {
        title: 'Next chapter conversation',
        detail: `${missingCore.unit === 'lifetime tokens' ? 'Earned output unlocks it; spending keeps this progress.' : 'Meet this research requirement to unlock it.'} Character moment: at least ${Math.ceil(conversation.cooldownSeconds)} simulation seconds.`,
        progress: missingCore, action: missingCore.unit === 'lifetime tokens' ? productionAction(state) : { kind: 'library', label: 'Open research library' },
      } };
      return { ...base, status: 'conversation', goal: {
        title: 'Room for the garden to grow',
        detail: state.paused ? 'Resume the simulation to continue the gap between character moments.' : `Next character moment: at least ${Math.ceil(conversation.cooldownSeconds)} simulation seconds. Chapter decisions can arrive sooner.`,
        action: productionAction(state),
      } };
    }
    const missing = conversation.conditions.find(condition => !condition.met);
    if (!missing) return { ...base, status: 'conversation', goal: {
      title: 'The next conversation is ready',
      detail: state.paused ? 'Resume the simulation to receive it.' : conversation.cooldownSeconds > 0 ? `Arrives in ${Math.ceil(conversation.cooldownSeconds)} simulation seconds.` : 'Arrives on the next simulation step.',
    } };
    return { ...base, status: missing.unit === 'lifetime tokens' ? 'production' : 'research', goal: {
      title: conversation.optional ? 'Another moment in the garden' : 'Next chapter conversation',
      detail: missing.unit === 'lifetime tokens' ? 'Earned output unlocks the conversation. Spending tokens keeps this progress.' : 'Meet the research requirement to unlock the conversation.',
      progress: missing, action: missing.unit === 'lifetime tokens' ? productionAction(state) : { kind: 'library', label: 'Open research library' },
    } };
  }
  const unmet = requirements.find(requirement => !requirement.met);
  if (unmet) return { ...base, status: unmet.id === 'output' ? 'production' : 'research', goal: {
    title: unmet.title, detail: unmet.id === 'foundation' ? 'Develop this foundation to prepare the next chapter.' : unmet.detail,
    progress: unmet.id === 'foundation' ? foundationBudget : unmet.progress, action: unmet.action,
  } };
  if (finalChapter) return { ...base, status: 'final', goal: { title: 'Choose what remains', detail: 'The ending panel shows which settlements your institutions can sustain.', action: { kind: 'ending', label: 'Review possible endings' } } };
  return { ...base, status: 'ready', goal: { title: 'Ready for the next chapter', detail: chapterEligibility(state).reason, action: { kind: 'advance', label: `Continue to ${CHAPTERS.find(item => item.id === state.chapter + 1)?.title || 'the next chapter'}` } } };
}
