# The Last Garden audio

Original music and effects generated on 2026-10-15 through the user's connected ElevenLabs Creative Studio MCP workspace for this game. No narration or voice generation was requested or performed.

The live MCP model catalog identifies **Eleven v4 as a text-to-speech model**. Music and sound effects use separate model families. This build uses `eleven_music_v2` and `eleven_text_to_sound_v2`, the model identifiers accepted by the generation tools. The catalog also advertised Music v2.5, but the callable generation schema did not expose that identifier.

The production consists of three instrumental background cues (70, 60, and 60 seconds requested) and five short interaction effects, one take each. The music prompts ask for quiet sustained openings and endings. Runtime crossfading should smooth repeats; sample-perfect loop points are not claimed.

Generation records, exact prompts, hashes, and downloaded file metadata are in `public/audio/manifest.json`.

## Playback integration

- Begin audio only after a user gesture and offer independent music/effect volume controls.
- Music contexts: `garden`, `laboratory`, `civilization`.
- Effect contexts: `tend`, `buy`, `research`, `alert`, `chapter`.
- Frequent tending should throttle or vary the effect subtly to avoid fatigue.
- Narration remains deferred until the game has been built, as requested.

## Verification

All eight provider jobs completed successfully. All downloaded files contain valid MPEG Layer III frame streams, with no trailing bytes after the final complete frame. Music is 48 kHz; effects are 44.1 kHz. Frame-derived durations agree with the requested/provider durations, allowing for normal encoder padding. SHA-256 hashes are recorded in the manifest. This validates file structure and duration; browser playback is verified separately during game integration.

Generated music is not a representation of a named artist or an existing soundtrack. No third-party soundtrack was used as a reference. Exact prompts, model identifiers, and file hashes are retained in the public manifest. Account workspace links, job identifiers, billing metadata, and signed download URLs are omitted.
