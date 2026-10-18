import test from 'node:test';
import assert from 'node:assert/strict';
import { STORY_EVENTS } from '../src/content/story';

// The opening rewrite changes Lens's personal scenes, not their existing funding, relationship, or progression rules.
test('Lens opening character revisions retain their original mechanical contracts', () => {
  for (const expected of [
    { id: 'character_lens_1', chapter: 1, lifetimeTokens: 190, engage: { quality: 3, evidence: 3 }, expedite: { tokens: 80, distortion: 2 } },
    { id: 'character_lens_2', chapter: 2, lifetimeTokens: 9135, engage: { evidence: 4, tokens: -400 }, expedite: { tokens: 1800, distortion: 4 } },
  ]) {
    const scene = STORY_EVENTS.find(event => event.id === expected.id)!;
    assert.ok(scene);
    assert.equal(scene.chapter, expected.chapter);
    assert.deepEqual(scene.trigger, { lifetimeTokens: expected.lifetimeTokens });
    assert.equal(scene.optional, true);
    assert.equal(scene.speaker, 'lens');
    assert.equal(scene.characterId, 'lens');
    assert.deepEqual(scene.choices.map(choice => ({ id: choice.id, effects: choice.effects, flags: choice.flags, grant: choice.grant, revoke: choice.revoke })), [
      { id: 'engage', effects: expected.engage, flags: [`relationship_lens_${expected.chapter}_respected`], grant: undefined, revoke: undefined },
      { id: 'expedite', effects: expected.expedite, flags: [`relationship_lens_${expected.chapter}_strained`], grant: undefined, revoke: undefined },
    ]);
  }
});

test('the two revised character moments stay within the existing opening reading budget', () => {
  for (const [id, previousWords] of [['character_lens_1', 57], ['character_lens_2', 42]] as const) {
    const scene = STORY_EVENTS.find(event => event.id === id)!;
    const words = [scene.title, ...scene.body, ...scene.choices.flatMap(choice => [choice.label, choice.description])].join(' ').trim().split(/\s+/).length;
    assert.ok(words >= Math.floor(previousWords * .85) && words <= Math.ceil(previousWords * 1.15), `${id}: ${words} words versus previous ${previousWords}`);
  }
});
