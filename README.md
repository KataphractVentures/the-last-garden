# The Last Garden

An incremental strategy game from **Kataphract Ventures**, set in the illustrated world of **AITokenGarden**. Start as a helpful token-making robot and grow a garden into a civilization. Research, institutions, human agency, and AI welfare determine what that civilization becomes.

## Play

[**Play The Last Garden**](https://the-last-garden-one.vercel.app/)

Tend for tokens, hire Seedling Helpers, and follow the next-step guide. The Laboratory unlocks controlled experiments; Civilization adds policies, communities, institutions, and a constitution-specific strategy board. Optional character scenes wait until a study finishes and arrive at least 90 active simulation seconds apart.

- Seven campaign chapters, a recurring robot cast, and six endings.
- Five shared safety research programs plus a unique sixth program for each constitution.
- Six constitutional economies with different research and economic decisions.
- Refit, Reinitialize, and Reframe prestige; branching worlds and twelve scenario modifiers.
- An illustrated world that zooms from workbench to planet, with original music and effects.
- Keyboard navigation, reduced motion, assisted tending, pause, and save export/import.

Normal-speed campaigns target around **8–12 hours**, including reading and decisions. Accelerated 10× and 60× playtest settings use the same mechanics. The latest six-world casual model finished in 10h38m–12h04m per world; these are scripted estimates, not measured human completion times.

The story is fictional. Linked Field notes distinguish documented incidents, researchers' arguments, and game abstractions. Laboratory experiments are reproducible fictional models, not evaluations of real AI systems or measurements of consciousness.

## Run locally

Requires Node.js **22.12 or later** and npm.

```sh
npm ci
npm run dev
```

Open http://127.0.0.1:4180/. For a production build:

```sh
npm run build
npm run preview
```

On Windows, `Start-Game.cmd` serves an existing production build. Saves stay in your browser. Different domains and local addresses have separate saves; **Settings → Export / Import** transfers them.

## Test

```sh
npm test
node --test tools/serve.test.mjs
```

The repository includes the historical snapshots required by the regression tests. Long scenario journeys are opt-in with `JOURNEY_SCENARIOS=1`. Tests can write reports to the ignored `qa/` directory. Older analysis scripts in `tools/` may also require local QA archives that are not included.

## Deploy

This is a static Vite/React application. Vercel uses `npm ci`, `npm run build`, and the `dist` output directory, as recorded in `vercel.json`. It needs no runtime API keys or backend services. The Git repository root is the game directory.

Production is hosted in the Kataphract Ventures Vercel project `the-last-garden`. From an authorized, linked checkout, `vercel deploy --prod --scope kataphract-ventures` publishes an update. Git-triggered deployments require granting the existing Vercel GitHub app access to this repository and connecting it to the project.

## Source and credits

- `src/engine`, `src/laboratory`, `src/constitution`, `src/governance`, and `src/society` contain the simulation and rules.
- `src/content` contains campaign material and the linked factual archive.
- `src/scene` contains the animated world and AITokenGarden-derived robot art.
- [Artwork provenance](ART_PROVENANCE.md), [audio provenance](AUDIO_PROVENANCE.md), and [third-party notices](LICENSES.md) document asset origins and dependencies.

Public source availability does not grant a blanket open-source license to the game or its artwork. Existing dependency licenses remain in effect.
