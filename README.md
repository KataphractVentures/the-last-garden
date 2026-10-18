# The Last Garden

An incremental strategy game from **Ridge and Reason**, set in the illustrated world of **AITokenGarden**. Start as a helpful token-making robot and grow a garden into a civilization. Research, institutions, human agency, and AI welfare determine what that civilization becomes.

## Play

[**Play The Last Garden**](https://the-last-garden-one.vercel.app/) · [Source on GitHub](https://github.com/KataphractVentures/the-last-garden)

Tend for tokens, hire Seedling Helpers, and follow the next-step guide. As the garden grows, production shares the stage with research and the society that depends on it.

- **Garden:** the animated world comes first, beside a compact goal and progress panel. Expand goals or resources for details; narrow screens use bottom navigation.
- **Laboratory:** select stages in the experiment diagram to reach their controls. Set up a study, compare its result, and expand methods or raw observations when you need them. Replication and stronger evidence unlock advanced research.
- **Civilization:** inspect the permission network, society meters, and operating policies. **Public Authority** has its own tab with an attention badge for assemblies, approvals, and agreements. Communities and constitution-specific strategy have dedicated views.
- **Field notes:** explore the linked factual archive behind the fictional campaign.

## Campaign and prestige

- Seven campaign chapters, a recurring robot cast, and six endings.
- Five shared safety research programs plus a unique sixth program for each constitution.
- Six constitutional economies with different research and economic decisions.
- Refit, Reinitialize, and Reframe prestige; branching worlds and twelve scenario modifiers.
- An illustrated world that zooms from workbench to planet, with music and effects.

Normal-speed campaigns target around **8–12 hours**, including reading and decisions. Pacing estimates come from scripted simulations, not measured human completion times. Accelerated 10× and 60× playtest settings use the same mechanics. Optional character scenes wait until a study finishes and arrive at least 90 active simulation seconds apart.

The story is fictional. Linked Field notes distinguish documented incidents, researchers' arguments, and game abstractions. Laboratory experiments are reproducible fictional models, not evaluations of real AI systems or measurements of consciousness.

## Controls, sound, and saves

Use **G / L / C / F** to switch sections and **Space** or the Tend button to tend the garden. Shortcuts stay out of text fields and dialogs. Pause, assisted tending, reduced motion, and playtest speed are available in the interface and Settings.

Music and sound are **on by default**. If your browser blocks autoplay, playback starts after your next click or key press. Use the speaker button to mute or Settings to adjust volume. Explicit mute and volume choices are remembered in this browser, independently of imported saves.

Automatic saves and rotating backups stay in your browser. Different domains and local addresses have separate saves. Use **Settings → Export save / Import save** to transfer progress or keep a backup before clearing website data. Inactive civilization branches do not advance.

## Local development (optional)

Use these instructions to develop the game or run your own local copy. [Playing online](https://the-last-garden-one.vercel.app/) requires no installation.

Requires Git, Node.js **22.12 or later**, and npm.

```sh
git clone https://github.com/KataphractVentures/the-last-garden.git
cd the-last-garden
npm ci
npm run dev
```

Open http://127.0.0.1:4180/. For a production build:

```sh
npm run build
npm run preview
```

On Windows, `Start-Game.cmd` serves an existing production build.

## Test

```sh
npm test
node --test tools/serve.test.mjs
```

The repository includes the historical snapshots required by the regression tests. Long scenario journeys are opt-in with `JOURNEY_SCENARIOS=1`. Tests can write reports to the ignored `qa/` directory. Older analysis scripts in `tools/` may also require local QA archives that are not included.

## Deploy

This is a static Vite/React application. Vercel uses `npm ci`, `npm run build`, and the `dist` output directory, as recorded in `vercel.json`. It needs no runtime API keys or backend services. The Git repository root is the game directory.

Production is hosted in the Vercel project `the-last-garden`, connected to this GitHub repository. Pushes to `main` deploy to production; pull requests receive preview deployments.

## Source and credits

- `src/engine`, `src/laboratory`, `src/constitution`, `src/governance`, and `src/society` contain the simulation and rules.
- `src/content` contains campaign material and the linked factual archive.
- `src/scene` contains the animated world and AITokenGarden-derived robot art.
- [Artwork provenance](ART_PROVENANCE.md), [audio provenance](AUDIO_PROVENANCE.md), and [third-party notices](LICENSES.md) document asset origins and dependencies.

Public source availability does not grant a blanket open-source license to the game or its artwork. Existing dependency licenses remain in effect.
