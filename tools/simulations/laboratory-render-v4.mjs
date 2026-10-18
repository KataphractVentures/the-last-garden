import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

// Read earned saves and render the real component without mounting a browser,
// writing saves, or changing production source. Run from any working directory.
const runnerPath = fileURLToPath(import.meta.url);
const gameRoot = path.resolve(path.dirname(runnerPath), '../..');
process.chdir(gameRoot);
const options = {};
for (let index = 2; index < process.argv.length; index += 2) {
  const flag = process.argv[index];
  assert(['--manifest', '--output'].includes(flag), `Unknown argument ${flag}; use --manifest <path> and --output <path>`);
  assert(process.argv[index + 1] && !process.argv[index + 1].startsWith('--'), `Missing value for ${flag}`);
  assert(!options[flag], `Duplicate argument ${flag}`);
  options[flag] = process.argv[index + 1];
}
const originalManifest = path.join(gameRoot, 'qa/simulations-v4/source-freeze.json');
const originalOutput = path.join(gameRoot, 'qa/simulations-v4/ui');
const freezePath = path.resolve(gameRoot, options['--manifest'] ?? originalManifest);
const output = path.resolve(gameRoot, options['--output'] ?? originalOutput);
assert(freezePath === originalManifest || options['--output'], 'A different source manifest requires an explicit --output directory to preserve the original audit');
assert(freezePath === originalManifest || output !== originalOutput, 'A release audit must not overwrite the original frozen output directory');
fs.mkdirSync(output, { recursive: true });
const relative = filename => path.relative(gameRoot, filename).replaceAll('\\', '/');
const digest = data => createHash('sha256').update(data).digest('hex');
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#x27;');
const plain = value => value.replace(/<[^>]*>/g, '').replaceAll('&amp;', '&').replaceAll('&#x27;', "'").replaceAll('&quot;', '"');
const freezeBytes = fs.readFileSync(freezePath);
const freeze = JSON.parse(freezeBytes);
const report = {
  createdAt: new Date().toISOString(),
  command: ['node tools/simulations/laboratory-render-v4.mjs', ...process.argv.slice(2)].join(' '),
  method: 'ReactDOM server rendering through Vite, using six earned optimized final pre-ending saves. No game-source changes, DOM emulation, or live browser interaction.',
  sourceFreeze: { path: relative(freezePath), sha256: freeze.sha256, manifestSha256: digest(freezeBytes), files: freeze.files.length, validationBaseSha256: freeze.validationBaseSha256 },
  runner: { path: relative(runnerPath), sha256: digest(fs.readFileSync(runnerPath)) },
  inputs: [],
  checks: [],
  renders: [],
  warnings: [],
  limitations: [
    'SSR does not run effects or click handlers. No hydration, keyboard focus, screen-reader, contrast, responsive layout, or pixel comparison is claimed.',
    'The thirty base views mean five base-program views in each of six earned civilizations. Each shows its actual latest earned record and six-study catalogue; this is not thirty different template-editor interactions.',
    'Story-held batch cases are explicitly presentation-only clones with a pending-event flag. They do not claim an earned later story event, create evidence, or alter the stored saves.',
    'The research-library and historical-archive tabs require client interaction and are outside this SSR entry-state audit. Active-program fallback and preserved checkpoint data are checked without pretending to navigate those tabs.'
  ]
};
function check(name, fn, details = {}) {
  fn();
  report.checks.push({ name, pass: true, ...details });
}
function verifyFreeze(stage) {
  assert.equal(digest(fs.readFileSync(freezePath)), report.sourceFreeze.manifestSha256, 'Freeze manifest changed during audit');
  for (const file of freeze.files) assert.equal(digest(fs.readFileSync(path.resolve(gameRoot, file.path))), file.sha256, `${stage}: frozen file changed: ${file.path}`);
  report.sourceFreeze[stage] = 'All manifest file hashes match';
}
function buttons(html) {
  return [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map(match => ({ attributes: match[1], text: plain(match[2]) }));
}
function button(html, phrase) {
  const match = buttons(html).find(item => item.text.includes(phrase));
  assert(match, `Missing button: ${phrase}`);
  return match;
}
function disabled(html, phrase, expected) {
  assert.equal(/\bdisabled(?:=|\s|$)/.test(button(html, phrase).attributes), expected, `Disabled state: ${phrase}`);
}
const css = ['src/laboratory/laboratory.css', 'src/laboratory/automation.css', 'src/laboratory/charter.css'].map(file => fs.readFileSync(file, 'utf8')).join('\n');
function savePreview(name, html, note) {
  const filename = path.join(output, name + '.html');
  const document = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(name)} | Laboratory SSR audit</title><style>body{margin:0;background:#101c16;color:#f1ebda;font-family:system-ui,sans-serif}main{max-width:1500px;margin:auto;padding:24px}.audit-banner{padding:16px;border:1px solid #54735d;margin-bottom:24px;color:#d6dfcd}.audit-banner a{color:#c0e5a6}button,input,select,textarea{font:inherit}*{box-sizing:border-box}${css}</style></head><body><main><aside class="audit-banner"><strong>Static rendered audit artifact. Controls are not interactive.</strong><p>${escape(note)}</p><small>Validated source ${freeze.sha256}</small></aside>${html}</main></body></html>`;
  fs.writeFileSync(filename, document);
  return { path: relative(filename), sha256: digest(document) };
}
let server;
const originalConsoleError = console.error;
try {
  verifyFreeze('before');
  server = await createServer({ root: gameRoot, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
  const { LaboratoryPanel } = await server.ssrLoadModule('/src/laboratory/LaboratoryPanel.tsx');
  const { activePrograms, CHARTER_PROGRAM_IDS } = await server.ssrLoadModule('/src/laboratory/programs.ts');
  const { activeResearchProjects, activeExperimentTemplates } = await server.ssrLoadModule('/src/laboratory/catalog.ts');
  const { CHARTER_DETAIL_LABELS } = await server.ssrLoadModule('/src/laboratory/charterModels.ts');
  const { dispatchCommand, tick } = await server.ssrLoadModule('/src/engine/index.ts');
  const { decimal } = await server.ssrLoadModule('/src/engine/amounts.ts');
  const baseMarkers = { oversight: 'class="lab-review-map"', control: 'class="lab-boundary-map"', organisms: 'class="lab-lineage"', interpretability: 'class="lab-circuit"', welfare: 'class="lab-welfare-instruments"' };
  const instrumentTitles = { stewardship: 'The provenance desk', assurance: 'The safety-case examiner', reliability: 'The service observatory', coordination: 'The council message room', reciprocity: 'The reciprocal work ledger', incentives: 'The tender laboratory' };
  console.error = (...args) => { report.warnings.push(args.map(String).join(' ')); };
  function render(state, program, kind) {
    const before = digest(JSON.stringify(state));
    let dispatched = false;
    const html = renderToStaticMarkup(React.createElement(LaboratoryPanel, { state, initialProgram: program, dispatch: () => { dispatched = true; } }));
    assert.equal(digest(JSON.stringify(state)), before, 'Rendering mutated the input state');
    assert.equal(dispatched, false, 'Rendering dispatched a game command');
    assert(!html.includes('undefined'), 'Undefined value leaked into markup');
    assert(!html.includes('>NaN<'), 'NaN leaked into markup');
    for (const control of buttons(html)) assert(control.text.trim() || /aria-label="[^"]+"/.test(control.attributes), 'A rendered button has no visible or aria-label text');
    report.renders.push({ constitution: state.constitution, requestedProgram: program, kind, stateSha256: before, markupSha256: digest(html), bytes: Buffer.byteLength(html) });
    return html;
  }
  function programNavigation(html, definitions, selected) {
    const nav = html.match(/<nav\b[^>]*aria-label="Research programs"[^>]*>([\s\S]*?)<\/nav>/)?.[1];
    assert(nav, 'Research program navigation missing');
    const items = buttons(nav);
    assert.equal(items.length, 6);
    assert.equal(items.filter(item => /aria-pressed="true"/.test(item.attributes)).length, 1);
    for (const definition of definitions) {
      const item = items.find(item => item.text.includes(definition.name));
      assert(item, `Active navigation omitted ${definition.id}`);
      assert.equal(/aria-pressed="true"/.test(item.attributes), definition.id === selected);
    }
  }
  for (let world = 1; world <= 6; world++) {
    const inputPath = path.join(gameRoot, `qa/simulations-v4/optimized/final/world-${world}-before-ending.json`);
    const bytes = fs.readFileSync(inputPath);
    const state = JSON.parse(bytes).state;
    const stateBefore = digest(JSON.stringify(state));
    const definitions = activePrograms(state.constitution);
    const charter = definitions.find(item => CHARTER_PROGRAM_IDS.includes(item.id));
    assert(charter);
    report.inputs.push({ path: relative(inputPath), sha256: digest(bytes), constitution: state.constitution, stateId: state.id, elapsed: state.elapsed, recordCount: state.experiments.length });
    check(`${state.constitution}: earned pre-ending input and active catalogues`, () => {
      assert.equal(state.chapter, 7); assert.equal(state.ending, null); assert.equal(state.pendingEvent, null); assert.equal(state.paused, false);
      assert.equal(activeResearchProjects(state.constitution).length, 70);
      assert.equal(activeExperimentTemplates(state.constitution).length, 36);
      assert.equal(definitions.length, 6);
      assert(state.mastered.includes(charter.id));
    });
    const current = state.experiments.filter(record => record.config.program === charter.id).at(-1);
    assert(current?.observations.length, `${charter.id}: actual current record has no raw observations`);
    const detail = current.observations[0].detail;
    assert.equal(detail?.kind, charter.id);
    const html = render(state, charter.id, 'earned charter instrument');
    check(`${state.constitution}: actual ${charter.id} instrument and counters`, () => {
      programNavigation(html, definitions, charter.id);
      assert(html.includes(' / 70'));
      assert(html.includes(`lab-instrument-${charter.id}`));
      assert(html.includes(`aria-label="${instrumentTitles[charter.id]}"`));
      assert(html.includes(`All ${detail.values.length} episode counters`));
      const counterList = html.match(/<details\b[^>]*lab-detail-counters[^>]*>([\s\S]*?)<\/details>/)?.[1];
      assert(counterList, 'Actual episode counter list is absent');
      assert.equal(CHARTER_DETAIL_LABELS[charter.id].length, detail.values.length);
      for (let index = 0; index < detail.values.length; index++) {
        const value = detail.values[index];
        const displayed = Number.isInteger(value) ? value.toFixed(0) : value.toFixed(3);
        assert(counterList.includes(`<dt>${escape(CHARTER_DETAIL_LABELS[charter.id][index])}</dt><dd>${displayed}</dd>`), `Counter ${index} does not match its earned observation`);
      }
      assert(html.includes(`<caption>Select a trial to inspect its actual instrument values.</caption>`));
      assert(html.includes(`Raw observations · ${current.observations.length} trials`));
      assert(html.includes(`Seed <b>${current.config.seed}</b>`));
      assert(!html.includes('class="lab-welfare-instruments"'), 'A charter instrument fell through to welfare');
      for (const template of activeExperimentTemplates(state.constitution).filter(item => item.program === charter.id)) assert(html.includes(escape(template.title)));
    }, { recordId: current.id, template: current.config.template, detailCount: detail.values.length, trials: current.observations.length });
    report.renders.at(-1).artifact = savePreview(`${world}-${state.constitution}-${charter.id}`, html, `Unmodified earned world ${world}; actual ${current.config.template} record ${current.id}, seed ${current.config.seed}.`);
    for (const base of definitions.filter(item => !CHARTER_PROGRAM_IDS.includes(item.id))) {
      const baseHTML = render(state, base.id, 'earned base program');
      const baseRecord = state.experiments.filter(record => record.config.program === base.id).at(-1);
      check(`${state.constitution}: ${base.id} view, actual record, six-study catalogue`, () => {
        programNavigation(baseHTML, definitions, base.id);
        assert(baseHTML.includes(baseMarkers[base.id]));
        assert(baseRecord?.observations.length);
        assert(baseHTML.includes(`Seed <b>${baseRecord.config.seed}</b>`));
        assert(baseHTML.includes(`Raw observations · ${baseRecord.observations.length} trials`));
        for (const template of activeExperimentTemplates(state.constitution).filter(item => item.program === base.id)) assert(baseHTML.includes(escape(template.title)));
      }, { recordId: baseRecord.id, trials: baseRecord.observations.length });
    }
    for (const foreign of CHARTER_PROGRAM_IDS.filter(id => id !== charter.id)) {
      const fallback = render(state, foreign, 'inactive initial selection fallback');
      check(`${state.constitution}: inactive ${foreign} falls back to active oversight`, () => {
        programNavigation(fallback, definitions, 'oversight');
        assert(fallback.includes(baseMarkers.oversight));
        assert(!fallback.includes(`lab-instrument-${foreign}`));
      });
    }
    const source = state.experiments.filter(record => record.config.program === charter.id && record.adopted && record.config.control && record.config.holdout >= .2).sort((a, b) => a.config.budget - b.config.budget)[0];
    assert(source, 'Earned adopted batch source absent');
    const queued = dispatchCommand(structuredClone(state), { type: 'experimentAutomation', record: source.id, runs: 2 });
    assert(queued.ok, queued.message);
    assert(queued.state.activeExperiment && queued.state.experimentAutomation);
    const pausedResult = dispatchCommand(queued.state, { type: 'pause' });
    assert(pausedResult.ok, pausedResult.message);
    const paused = pausedResult.state;
    assert.equal(paused.paused, true);
    const pausedHTML = render(paused, charter.id, 'public-command paused batch');
    check(`${state.constitution}: paused batch locks mutations while retaining replay and stop`, () => {
      assert(pausedHTML.includes('The world is paused.'));
      assert(pausedHTML.includes('Waiting while the world is paused.'));
      disabled(pausedHTML, 'Study running', true);
      disabled(pausedHTML, 'Replicate with a new seed', true);
      disabled(pausedHTML, 'Adopt bounded finding', true);
      disabled(pausedHTML, 'Replay this exact seed', false);
      disabled(pausedHTML, 'Stop future studies & return reserve', false);
      assert(pausedHTML.includes('aria-label="Study progress"'));
      const later = tick(paused, 30);
      assert.equal(later.elapsed, paused.elapsed);
      assert.equal(later.activeExperiment.remaining, paused.activeExperiment.remaining);
      assert.equal(later.experiments.length, paused.experiments.length);
      const stopped = dispatchCommand(paused, { type: 'experimentAutomation', record: null });
      assert(stopped.ok, stopped.message);
      assert.equal(stopped.state.experimentAutomation, null);
      assert(stopped.state.activeExperiment, 'Stopping a batch cancelled an already-running study');
      assert(decimal(stopped.state.research).eq(decimal(paused.research).add(paused.experimentAutomation.budgetRemaining)));
    }, { adoptedSourceId: source.id, publicCommands: ['experimentAutomation(runs:2)', 'pause', 'experimentAutomation(record:null)'], reservedForFuture: paused.experimentAutomation.budgetRemaining });
    report.renders.at(-1).artifact = savePreview(`${world}-${state.constitution}-paused-batch`, pausedHTML, 'Earned save cloned in memory; a two-study batch was authorized through the public command, then paused through the public command. Stopping future work remains available.');
    const storyHeld = { ...queued.state, pendingEvent: 'render-only-story-hold' };
    const heldHTML = render(storyHeld, charter.id, 'presentation-only pending-decision variant');
    check(`${state.constitution}: story-held presentation explains lock and retains stop`, () => {
      assert(heldHTML.includes('A story decision is waiting.'));
      assert(heldHTML.includes('Waiting for the open story decision.'));
      disabled(heldHTML, 'Study running', true);
      disabled(heldHTML, 'Replicate with a new seed', true);
      disabled(heldHTML, 'Adopt bounded finding', true);
      disabled(heldHTML, 'Replay this exact seed', false);
      disabled(heldHTML, 'Stop future studies & return reserve', false);
    }, { fixture: 'Only pendingEvent was set on an in-memory earned/public-command clone; presentation-only, not an earned story transition.' });
    assert.equal(digest(JSON.stringify(state)), stateBefore, 'Audit changed the earned input object');
    assert.equal(digest(fs.readFileSync(inputPath)), digest(bytes), 'Earned save file changed during audit');
  }
  check('All renders have no React console errors or warnings', () => assert.deepEqual(report.warnings, []));
  verifyFreeze('after');
  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  report.failure = { message: error.message, stack: error.stack };
  process.exitCode = 1;
} finally {
  console.error = originalConsoleError;
  if (server) await server.close();
  report.totals = { checks: report.checks.length, renders: report.renders.length, earnedCharter: report.renders.filter(item => item.kind === 'earned charter instrument').length, earnedBase: report.renders.filter(item => item.kind === 'earned base program').length, inactiveFallbacks: report.renders.filter(item => item.kind === 'inactive initial selection fallback').length, pausedBatches: report.renders.filter(item => item.kind === 'public-command paused batch').length, storyPresentationVariants: report.renders.filter(item => item.kind === 'presentation-only pending-decision variant').length };
  // Preserve successful provenance if a later run refuses a changed manifest.
  fs.writeFileSync(path.join(output, report.status === 'passed' ? 'laboratory-render-report.json' : 'laboratory-render-failure.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ status: report.status, source: report.sourceFreeze.sha256, totals: report.totals, failure: report.failure?.message, output: relative(output) }, null, 2));
}
