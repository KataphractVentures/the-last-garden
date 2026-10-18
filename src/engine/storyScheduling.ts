import type { GameState } from '../contracts';
import { STORY_EVENTS, type StoryEvent } from '../content/story';

export const CHARACTER_SCENE_INTERVAL = 90;

export function isCharacterScene(event: StoryEvent): boolean {
  return Boolean(event.optional && event.characterId);
}

// Carry-over character scenes are oldest first. Stable sorting retains authored
// order within a chapter; core/incident selection remains chapter-local.
export const STORY_EVENT_ORDER = [...STORY_EVENTS].sort((a, b) => a.chapter - b.chapter);
const earlierCharacterScenes = new Map(STORY_EVENTS.filter(isCharacterScene).map(event => [
  event.id, STORY_EVENTS.filter(prior => isCharacterScene(prior) && prior.characterId === event.characterId && prior.chapter < event.chapter),
]));

/** Availability only; economic triggers, cooldowns and study timing are separate. */
export function storyEventAvailable(state: Pick<GameState, 'chapter' | 'decisions'>, event: StoryEvent): boolean {
  if (state.decisions[event.id]) return false;
  if (!isCharacterScene(event)) return event.chapter === state.chapter;
  return event.chapter <= state.chapter &&
    (earlierCharacterScenes.get(event.id) || []).every(prior => Boolean(state.decisions[prior.id]));
}
