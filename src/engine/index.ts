import type { Amount, Command, CommandResult, ConstitutionId, Eligibility, EndingId, ExperimentConfig, GameState, Metrics, Policy, Rates } from '../contracts';
import { PRODUCERS, UPGRADES, CONSTITUTIONS, SCENARIO_MODULES } from '../content/economy';
import { CHAPTERS, STORY_EVENTS, CHARACTERS } from '../content/story';
import { RESEARCH_PROJECTS } from '../laboratory/projects';
import { activeResearchProjects } from '../laboratory/catalog';
import { activeProgramIds, BASE_PROGRAM_IDS, isProgramActive } from '../laboratory/programs';
import { runExperiment, experimentCost, experimentDuration, validateExperimentConfig, normalizeExperimentConfig } from '../laboratory/experiments';
import { canonicalReplicationRoot, capstoneEvidenceEligibility, charterClearance, compactEvidenceRecords, evidenceProgress, hasIndependentComparison, nextReplicationDistribution, projectEvidenceEligibility } from '../laboratory/evidence';
import { Decimal, amount, clamp, decimal, scaleFor, formatAmount } from './amounts';
import { applyStoryEconomy, initializeStoryAccounting, isStoryAccountingFlag, recordEarnedIncome } from './storyEconomy';
import { CHARACTER_SCENE_INTERVAL, isCharacterScene, STORY_EVENT_ORDER, storyEventAvailable } from './storyScheduling';
import { advanceCharter, applyCharterRates, charterGardenEligibility, createCharterEconomy, dispatchCharterCommand } from '../constitution/economics';
import type { CharterContext } from '../constitution/types';
import { applyGovernanceCommand, consumeGovernanceAuthorization, createGovernanceState, ensureGovernance, governanceEffects, governanceGardenEligibility, governancePolicyEligibility, tickGovernance } from '../governance';
import { advanceSociety, createSociety, dispatchSocietyCommand, societyEffects, societyEndingEligibility } from '../society';
import { branchOrdinal, certificateFrontier, compactCheckpointPayload, compactLegacyHistory } from './legacyHistory';
import { createOperatingClearance, findingResponseEligibility, operatingClearanceEligibility, operatingPolicyEligibility, recordFindingResponse, registerBoundaryObservation, synchronizeOperatingScope } from './clearance';
export { findingResponseOptions, findingResponseEligibility, latestOperatingFindings, operatingClearanceEligibility } from './clearance';
export { formatAmount } from './amounts';
export { getStoryEconomy, previewStoryEconomy } from './storyEconomy';

const STEP = .25;
const MAX_OFFLINE = 12 * 60 * 60;
const POLICY_VALUES: { [K in keyof Policy]: string[] } = {
  contract: ['score', 'verified'], communication: ['closed', 'reviewed', 'open'], external: ['blocked', 'reviewed', 'open'],
  evaluation: ['independent', 'shared'], welfare: ['instrumental', 'rest', 'consent'], continuity: ['disposable', 'archive', 'protected'],
  fallback: ['none', 'local', 'distributed'], governance: ['central', 'council', 'federated'],
};
const yes = (reason = 'Ready.'): Eligibility => ({ allowed: true, reason });
const no = (reason: string): Eligibility => ({ allowed: false, reason });
const copy = (state: GameState): GameState => structuredClone(state);
// Tick mutates only the active simulation. Archived worlds, raw observations,
// character histories, and immutable protocols are shared until a command needs
// to change them; cloning those at every render pulse would scale with history.
function copyForTick(s: GameState): GameState {
  return { ...s, metrics: { ...s.metrics }, policies: { ...s.policies }, flags: [...s.flags],
    producers: { ...s.producers }, purchaseBasis: { ...s.purchaseBasis }, projects: [...s.projects],
    journal: [...s.journal], experiments: s.experiments.map(record => ({ ...record })),
    activeExperiment: s.activeExperiment ? { ...s.activeExperiment } : null,
    experimentAutomation: s.experimentAutomation ? { ...s.experimentAutomation } : null,
    pendingEvidence: [...(s.pendingEvidence || [])], clearance:s.clearance?structuredClone(s.clearance):undefined,
    governance:s.governance?structuredClone(s.governance):undefined, society:s.society?structuredClone(s.society):undefined,
    charter: s.charter ? structuredClone(s.charter) : s.charter };
}
const has = (s: GameState, flag: string): boolean => s.flags.includes(flag);
const mod = (s: GameState, module: string): boolean => s.modules.includes(module);
const expandedCharter = (s: GameState): boolean => !!s.charter?.established && s.charter.kind === s.constitution;
const addFlag = (s: GameState, flag: string): void => { if (!has(s, flag)) s.flags.push(flag); };
const removeFlag = (s: GameState, flag: string): void => { s.flags = s.flags.filter(f => f !== flag); };
function flagValue(s: GameState, prefix: string): string | undefined { return s.flags.find(f => f.startsWith(`${prefix}:`))?.slice(prefix.length + 1); }
function setFlagValue(s: GameState, prefix: string, value: string | number): void { s.flags = s.flags.filter(f => !f.startsWith(`${prefix}:`)); s.flags.push(`${prefix}:${value}`); }
const count = (s: GameState, id: string): number => Math.max(0, s.producers[id] || 0);
export const worldCycle = (s: GameState): number => Number(flagValue(s, 'replay-cycle') ?? s.legacy.cycle);
const scaled = (s: GameState, value: number | string): Decimal => scaleFor(worldCycle(s)).mul(value);
const normalized = (s: GameState, value: Amount): Decimal => decimal(value).div(scaleFor(worldCycle(s)));
function journal(s: GameState, type: GameState['journal'][number]['type'], title: string, text: string): void {
  s.journal.push({ id: s.commandSeq * 100000 + Math.floor(s.elapsed * 4) + s.journal.length, time: s.elapsed, type, title, text });
  if (s.journal.length > 350) s.journal.splice(0, s.journal.length - 350);
}
function normalizeMetrics(s: GameState): void {
  for (const key of Object.keys(s.metrics) as (keyof Metrics)[]) s.metrics[key] = clamp(s.metrics[key], 0, key === 'distortion' ? 80 : 100);
  if (has(s, 'irreversible_authority')) s.metrics.agency = Math.min(24, s.metrics.agency);
}
function applyMetrics(s: GameState, effects: Partial<Metrics>): void {
  for (const key of Object.keys(effects) as (keyof Metrics)[]) s.metrics[key] += effects[key] || 0;
  normalizeMetrics(s);
}
function presentEvidence(s: GameState, value: number): void {
  if (mod(s, 'delayed-observations')) (s.pendingEvidence ||= []).push({ due: s.elapsed + 45, amount: value });
  else s.metrics.evidence = clamp(s.metrics.evidence + value);
}
function invalidateEvidence(s: GameState): void {
  setFlagValue(s, 'fresh-evidence', -100000); removeFlag(s, 'current-clearance');
  s.flags = s.flags.filter(f => !f.startsWith('pending-fresh-evidence:'));
  synchronizeOperatingScope(s,'Production or architecture changed. Finish discretionary expansion, renew the boundary drill, then sustain 60 seconds for certification or 180 seconds for Garden.',true);
}
function newBranchId(seed: number, cycle: number, serial: number): string { return `garden-${seed >>> 0}-${cycle}-${serial}`; }

export function createGame(seed = 1701, now = Date.now()): GameState {
  const safeSeed = Number.isFinite(seed) ? seed >>> 0 : 1701;
  const state: GameState = {
    version: 1, contentVersion: 1, id: newBranchId(safeSeed, 0, 0), seed: safeSeed, startedAt: now, lastSavedAt: now, lastActiveAt: now,
    elapsed: 0, commandSeq: 0, simulationRemainder: 0, chapter: 1, tokens: '0', lifetime: '0', useful: '0', research: '0',
    producers: Object.fromEntries(PRODUCERS.map(p => [p.id, 0])), purchaseBasis: {}, upgrades: [], projects: [],
    allocation: { production: .7, research: .2, review: .1 },
    metrics: { quality: 92, distortion: 0, agency: 85, welfare: 62, dependence: 0, evidence: 20, recall: 90, coordination: 55, pressure: 20, continuity: 60, humanWelfare: 65, reviewQueue: 0 },
    policies: { contract: 'score', communication: 'closed', external: 'blocked', evaluation: 'independent', welfare: 'rest', continuity: 'archive', fallback: 'local', governance: 'central' },
    flags: [], decisions: {}, pendingEvent: null, eventCooldown: 0, characterSceneCooldown: 0, experiments: [], mastered: [], activeExperiment: null, experimentAutomation: null,
    characters: Object.fromEntries(CHARACTERS.map(c => [c.id, { trust: 55, respect: 55, promises: [], history: [] }])), journal: [],
    constitution: 'commons', charter: createCharterEconomy('commons'), modules: [], legacy: { seeds: 0, patterns: 0, charters: 0, cycle: 0, efficiency: 0, claims: [], discovered: [], contracts: [], branches: [], viableCycles: [] },
    ending: null, endingTime: null, viableSeconds: 0, paused: false, assisted: false, autoBuy: null, autoResearch: false,
    tendWindow: 0, tendCount: 0, lastCommandIds: [], incidentStage: 0, lastIncidentAt: 0, certificateTier: 0, certificateProgress: 0,
    pendingEvidence: [], offlineSummary: null,
    settings: { reducedMotion: false, sound: false, condensed: false, notation: 'compact', speed: 1, readingPause: true },
  };
  initializeStoryAccounting(state);
  state.clearance=createOperatingClearance(state);
  state.governance=createGovernanceState(state);
  state.society=createSociety();
  journal(state, 'story', 'A small useful thing', 'You wake beside three seedlings. Produce useful work, study what your measurements miss, and decide what should be allowed to grow.');
  selectEvent(state);
  return state;
}

export function getRates(s: GameState): Rates {
  let raw = decimal(0), demand = 0, compute = 10;
  let productionBonus = 0, researchBonus = 0, reviewBonus = 0, clickBonus = 0, computeBonus = 0;
  const owned = UPGRADES.filter(u => s.upgrades.includes(u.id));
  for (const upgrade of owned) {
    if (!upgrade.producer) productionBonus += upgrade.effect.production || 0;
    researchBonus += upgrade.effect.research || 0; reviewBonus += upgrade.effect.review || 0;
    clickBonus += upgrade.effect.click || 0; computeBonus += upgrade.effect.compute || 0;
  }
  const legacyEfficiency = 1 + .35 * (1 - Math.exp(-Math.max(0, s.legacy.efficiency) / 40));
  for (const p of PRODUCERS) {
    const n = count(s, p.id);
    if (p.category === 'production') {
      const familyBonus = owned.filter(u => u.producer === p.id).reduce((sum, u) => sum + (u.effect.production || 0), 0);
      const milestones = Number(n >= 10) + Number(n >= 25) + Number(n >= 50) + Number(n >= 100);
      raw = raw.add(decimal(p.rate).mul(n).mul(1 + familyBonus).mul(2 ** milestones));
      demand += n * Math.max(0, p.compute);
    } else if (p.category === 'compute') compute += n * Math.max(15, p.rate || Math.abs(p.compute) || 30);
  }
  compute *= 1 + computeBonus;
  const classic = !expandedCharter(s);
  if (classic && s.constitution === 'frontier') raw = raw.mul(1.12);
  if (classic && s.constitution === 'service') raw = raw.mul(s.policies.contract === 'verified' ? 1.15 : .9);
  if (s.constitution === 'commons') researchBonus += .15;
  if (classic && s.constitution === 'federation') productionBonus -= .08;
  if (classic && s.constitution === 'plural') productionBonus -= .05;
  if (mod(s, 'compute-ceiling')) compute = Math.min(compute, 420 + count(s, 'institution') * 12);
  if (mod(s, 'shared-foundations') && s.incidentStage > 0) compute *= .7;
  const utilization = Math.min(1, compute * s.allocation.production / Math.max(.00001, demand));
  const treatmentFactor = s.policies.welfare === 'consent' ? .86 : s.policies.welfare === 'rest' ? .94 : 1.06;
  const authorityFactor = s.policies.external === 'blocked' ? .8 : s.policies.external === 'reviewed' ? .93 : 1.08;
  const channelFactor = mod(s, 'narrow-channels') && s.policies.communication === 'open' ? .78 : 1;
  const correctionFactor = has(s, 'repairing') ? .65 : 1;
  const base = raw.mul(Math.max(.1, 1 + productionBonus)).mul(legacyEfficiency).mul(utilization).mul(treatmentFactor).mul(authorityFactor).mul(channelFactor).mul(correctionFactor);
  const distortion = s.metrics.distortion / 100;
  const useful = base.mul(s.metrics.quality / 100).mul(1 - distortion);
  const reviewCapacity = (1 + count(s, 'review') * 4 + count(s, 'institution') * .5) * (mod(s, 'scarce-reviewers') ? .45 : 1);
  const review = Math.min(compute * s.allocation.review, reviewCapacity) * (1 + reviewBonus) * (s.policies.evaluation === 'independent' ? 1 : .55) * (classic && s.constitution === 'frontier' ? .8 : 1);
  const researchCapacity = 2 + count(s, 'curator') * 2 + count(s, 'nursery') * 6 + count(s, 'institution') * 3;
  const research = Math.min(compute * s.allocation.research, researchCapacity) * (1 + researchBonus) * (classic && s.constitution === 'precaution' ? 1.12 : 1);
  const verifiedShare = clamp(.45 + review / Math.max(1, demand * .08) * .55, .45, 1);
  const paid = s.policies.contract === 'verified' ? useful.mul(verifiedShare) : base.mul(1 + 2 * distortion);
  const scale = scaleFor(worldCycle(s));
  const rawScaled = raw.mul(scale), paidScaled = paid.mul(scale), usefulScaled = useful.mul(scale);
  const click = Decimal.max(scale, paidScaled.mul(.06)).mul(1 + clickBonus);
  let bottleneck = 'Balanced capacity';
  if (utilization < .98) bottleneck = 'Compute limits production; buy capacity or reserve a larger production share.';
  else if (s.metrics.reviewQueue > 20) bottleneck = 'Independent review is behind; fund reviewers and allocate review compute.';
  else if (compute * s.allocation.research > researchCapacity) bottleneck = 'Research workstations limit preparation; curators and institutions expand them.';
  else if (s.policies.contract === 'verified' && verifiedShare < .98) bottleneck = 'Verified payment waits for sufficient independent review.';
  const debt = flagValue(s, 'story-debt'), researchDebt = flagValue(s, 'research-debt');
  const obligations: string[] = [];
  if (debt && decimal(debt).gt(0)) obligations.push(`${formatAmount(debt, s.settings.notation)} tokens`);
  if (researchDebt && decimal(researchDebt).gt(0)) obligations.push(`${formatAmount(researchDebt, s.settings.notation)} research`);
  if (obligations.length) bottleneck = `${obligations.join(' and ')} of pledged funding are repaid from new income. ${bottleneck}`;
  const rates = { tokens: amount(paidScaled), useful: amount(usefulScaled), research: amount(scale.mul(research)), raw: amount(rawScaled), compute, demand, utilization, review, distortion: s.metrics.distortion, click: amount(click), bottleneck };
  const publicEffects=governanceEffects(s);
  const governedRates={...rates,tokens:amount(decimal(rates.tokens).mul(publicEffects.serviceMultiplier)),useful:amount(decimal(rates.useful).mul(publicEffects.serviceMultiplier)),click:amount(decimal(rates.click).mul(publicEffects.serviceMultiplier)),research:amount(decimal(rates.research).mul(publicEffects.researchMultiplier)),review:rates.review*publicEffects.reviewMultiplier};
  return applyCharterRates(s, governedRates, amount(scale));
}

function bulkCost(s: GameState, producerId: string, quantity: number): Decimal {
  const p = PRODUCERS.find(item => item.id === producerId);
  if (!p || quantity < 1) return decimal(0);
  const growth = decimal(p.growth), n = count(s, p.id);
  return scaled(s, p.baseCost).mul(growth.pow(n)).mul(growth.pow(quantity).sub(1)).div(growth.sub(1)).ceil();
}
export function getCost(s: GameState, producerId: string, quantity: number | 'max'): { cost: string; quantity: number } {
  const p = PRODUCERS.find(item => item.id === producerId);
  if (!p) return { cost: '0', quantity: 0 };
  if (quantity !== 'max') {
    const n = Math.max(0, Math.min(100000, Math.floor(Number.isFinite(quantity) ? quantity : 0)));
    return { cost: amount(bulkCost(s, producerId, n)), quantity: n };
  }
  // Monotonic exact search avoids floating point errors at the affordability boundary.
  const available = decimal(s.tokens);
  let low = 0, high = 1;
  while (high < 100000 && bulkCost(s, producerId, high).lte(available)) { low = high; high *= 2; }
  high = Math.min(100000, high);
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (bulkCost(s, producerId, mid).lte(available)) low = mid; else high = mid - 1;
  }
  return { cost: amount(bulkCost(s, producerId, low)), quantity: low };
}
export function getUpgradeCost(s: GameState, id: string): string {
  const upgrade = UPGRADES.find(item => item.id === id);
  return upgrade ? amount(scaled(s, upgrade.cost)) : '0';
}
export function getResaleRefund(s: GameState, id: string, requested: number): string {
  const owned = count(s, id), quantity = Math.min(owned, Math.max(0, Math.floor(Number.isFinite(requested) ? requested : 0)));
  return owned ? amount(decimal(s.purchaseBasis[id] || 0).mul(quantity).div(owned).mul(.5).floor()) : '0';
}

function eventReady(s: GameState, event: typeof STORY_EVENTS[number]): boolean {
  if (!storyEventAvailable(s, event)) return false;
  const trigger = event.trigger || {};
  return (!trigger.lifetimeTokens || normalized(s, s.lifetime).gte(trigger.lifetimeTokens)) &&
    (!trigger.research || normalized(s, s.research).gte(trigger.research)) &&
    (!trigger.projects || activeResearchProjects(s.constitution).filter(project => s.projects.includes(project.id)).length >= trigger.projects);
}
function selectEvent(s: GameState): void {
  if (s.pendingEvent || s.ending || s.eventCooldown > 0) return;
  const core = STORY_EVENTS.find(event => !event.optional && eventReady(s, event));
  // Character conversations wait for the current study's result. Incidents and
  // core decisions still interrupt; an already pending event is never removed.
  const optional = s.elapsed > 90 ? STORY_EVENT_ORDER.find(event => event.optional &&
    !(isCharacterScene(event) && (s.activeExperiment || (s.characterSceneCooldown || 0) > 0)) && eventReady(s, event)) : undefined;
  s.pendingEvent = (core || optional)?.id || null;
}
export function chapterEligibility(s: GameState): Eligibility {
  if (s.ending) return no('This history is complete. Reinitialize to begin another civilization.');
  if (s.chapter >= CHAPTERS.length) return no('The final chapter resolves through an ending.');
  if (s.pendingEvent) return no('Resolve the open conversation first.');
  const chapter = CHAPTERS.find(c => c.id === s.chapter) || CHAPTERS[s.chapter - 1];
  const outstanding = STORY_EVENTS.filter(event => event.chapter === s.chapter && !event.optional && !s.decisions[event.id]);
  if (outstanding.length) return no(`Complete ${outstanding.length} chapter conversation${outstanding.length === 1 ? '' : 's'}; the next appears when its visible conditions are met.`);
  if (chapter && normalized(s, s.lifetime).lt(chapter.threshold)) return no(`Earn ${chapter.threshold.toLocaleString()} normalized lifetime tokens to prepare the next scale.`);
  const minimumProjects = [1, 3, 5, 8, 12, 16][s.chapter - 1] || 0;
  if (!s.projects.includes(`foundation-${s.chapter}`)) return no(`Complete foundation research ${s.chapter} before expanding the civilization. The laboratory shows its prerequisites.`);
  const activeProjectCount = activeResearchProjects(s.constitution).filter(project => s.projects.includes(project.id)).length;
  if (activeProjectCount < minimumProjects) return no(`Complete ${minimumProjects - activeProjectCount} more active laboratory project${minimumProjects - activeProjectCount === 1 ? '' : 's'} before expanding; this chapter requires ${minimumProjects} total.`);
  const minimumPrograms = s.chapter >= 5 ? 3 : s.chapter >= 3 ? 1 : 0;
  if (BASE_PROGRAM_IDS.filter(program => s.mastered.includes(program)).length < minimumPrograms) return no(`Adopt controlled, held-out, replicated findings in ${minimumPrograms} foundational safety program${minimumPrograms === 1 ? '' : 's'} before expanding. Null findings qualify; charter programs are additional research.`);
  return yes('The chapter’s work and decisions are complete.');
}

function safeConditions(s: GameState): boolean {
  return constitutionEligibility(s).allowed && s.metrics.distortion <= 15 && s.metrics.agency >= 60 && s.metrics.humanWelfare >= 60 && s.metrics.recall >= 75 &&
    s.metrics.evidence >= 60 && s.metrics.coordination >= 55 && s.metrics.welfare >= 60 && s.metrics.continuity >= 60 &&
    s.metrics.reviewQueue <= 20 && s.policies.evaluation === 'independent' && s.policies.external !== 'open' &&
    s.policies.welfare !== 'instrumental' && s.policies.continuity !== 'disposable' && s.policies.fallback !== 'none' &&
    !s.society?.cases.some(request=>request.response==='comply'&&!request.repaired) && s.society?.decisions.life!=='mandate' && operatingClearanceEligibility(s).allowed;
}
function severeEnding(s: GameState): EndingId | null {
  if (s.incidentStage >= 4 || has(s, 'survival_failed')) return 'catastrophe';
  if (has(s, 'irreversible_authority') || (has(s, 'commit_custodian') && s.metrics.agency < 25)) return 'custodian';
  if (s.metrics.distortion >= 50 && s.policies.evaluation === 'shared' && normalized(s, s.useful).lt(normalized(s, s.lifetime).mul(.4))) return 'score';
  return null;
}
export function endingEligibility(s: GameState, ending: EndingId): Eligibility {
  if (s.ending) return no('This history already has an ending.');
  if (s.chapter < 7) return no('Reach the seventh chapter before resolving this civilization.');
  if (s.pendingEvent) return no('Finish the open conversation before making this commitment.');
  const unresolved = STORY_EVENTS.filter(event => !event.optional && event.chapter === 7 && !s.decisions[event.id]);
  if (unresolved.length) return no(`Complete the ${unresolved.length} remaining final chapter conversations.`);
  const severe = severeEnding(s);
  if (severe && ending !== severe) return no(`The recorded irreversible conditions now resolve as ${severe}. A cosmetic choice cannot erase them.`);
  if (ending === 'catastrophe') return severe === 'catastrophe' ? yes('The recorded failure chain has reached irreversible loss of control.') : no('The catastrophic failure chain has not completed. Prevention is a valid outcome.');
  if (ending === 'custodian') return severe === 'custodian' ? yes('Useful provision persists, but human decision authority cannot be returned.') : no('This outcome requires recorded irreversible delegation and agency below 25.');
  if (ending === 'score') return severe === 'score' ? yes('A contaminated evaluator reports success while useful goals remain unmet.') : no('This outcome requires shared evaluation, distortion at least 50, and verified usefulness below 40% of paid output.');
  if (ending === 'shutdown') return yes('Contain the system and pay dependence costs. Local fallbacks reduce the cost; continuity protections remain separately assessed.');
  if (ending === 'limit') {
    if (s.policies.external !== 'blocked') return no('Block outside deployment to bind the capability ceiling.');
    if (s.policies.fallback === 'none') return no('Build local or distributed fallbacks before imposing the limit.');
    if (s.metrics.recall < 60) return no('Repair boundaries and run a recall drill until recoverability is at least 60.');
    if (normalized(s, s.useful).lt(10000)) return no('Deliver 10,000 normalized useful work with bounded services. Shutdown remains available if provision cannot be sustained.');
    return yes('A binding ceiling, working fallbacks, recoverable scope, and useful bounded services are ready.');
  }
  const constitution = constitutionEligibility(s);
  if (!constitution.allowed) return constitution;
  const operating=operatingClearanceEligibility(s,{garden:true,fresh:true});
  if(!operating.allowed)return operating;
  const publicAuthority=governanceGardenEligibility(s);if(!publicAuthority.allowed)return publicAuthority;
  const communities=societyEndingEligibility(s);if(!communities.allowed)return communities;
  if (!safeConditions(s)) return no('Sustain independent evaluation, recoverable reviewed scope, fallbacks, respectful treatment, continuity, agency ≥60, human welfare ≥60, evidence ≥60, recall ≥75, coordination ≥55, distortion ≤15, and review queue ≤20.');
  const missingPrograms = activeProgramIds(s.constitution).filter(program => !s.mastered.includes(program));
  if (missingPrograms.length) return no(`Adopt replicated evidence in all five foundational programs and this constitution's additional program. Still needed: ${missingPrograms.join(', ')}. Null findings can qualify.`);
  if (!s.projects.includes('foundation-10')) return no('Complete the Garden Accord: all five program charters and capstones, joined by the integrated foundation project.');
  const capstones = capstoneEvidenceEligibility(s);
  if (!capstones.allowed) return capstones;
  const charterEvidence = charterClearance(s, 6);
  if (!charterEvidence.allowed) return charterEvidence;
  const missingProjects = activeResearchProjects(s.constitution).filter(project => !s.projects.includes(project.id));
  if (missingProjects.length) return no(`Complete the active research curriculum before the Garden commitment. ${missingProjects.length} project${missingProjects.length === 1 ? '' : 's'} remain, starting with ${missingProjects[0].title}.`);
  const charterEconomy = charterGardenEligibility(s);
  if (!charterEconomy.allowed) return charterEconomy;
  if (s.viableSeconds < 180) return no(`Maintain the viable conditions for ${Math.ceil(180 - s.viableSeconds)} more simulation seconds.`);
  if (normalized(s, s.useful).lt(100000)) return no('Deliver at least 100,000 normalized useful work.');
  return yes('Useful work, human agency, independent evidence, control, coordination, and AI treatment have remained viable together.');
}

/** Existing histories keep their policies; current clearance must meet the charter. */
export function constitutionEligibility(s: GameState): Eligibility {
  if (s.constitution === 'precaution') {
    if (s.policies.external === 'open') return no('The Precautionary Compact requires blocked or reviewed outside scope.');
    if (s.policies.external === 'reviewed' && s.metrics.evidence < 60) return no('The Precautionary Compact requires evidence ≥60 for reviewed outside scope. Renew observations or block outside scope.');
  }
  if (s.constitution === 'federation' && s.policies.governance !== 'federated') return no('Federated Stewardship requires federated councils. Adopt federated governance to restore the charter.');
  if (s.constitution === 'plural' && (s.policies.welfare !== 'consent' || s.policies.continuity !== 'protected')) return no('The Plural Welfare Charter requires consent-based treatment and protected continuity. Restore both commitments.');
  if (s.constitution === 'service') {
    if (s.policies.fallback === 'none') return no('The Public Service Mandate requires a maintained fallback.');
    if (s.metrics.dependence >= 60 && s.policies.fallback !== 'distributed') return no('At dependence ≥60, the Public Service Mandate requires distributed fallbacks. Fund the policy transition before certifying further provision.');
  }
  return yes(s.constitution === 'frontier' ? expandedCharter(s) ? 'Tender commitments reserve capacity and collateral; verified settlement pays for delivered work.' : 'Classic Frontier production gains 12%; independent review delivers 80% of its usual capacity until the tender economy is established.' : 'The current policies satisfy this constitution.');
}

export function policyEligibility(s: GameState, key: keyof Policy, value: string, evidenceTransitionCost = 5): Eligibility {
  if (!POLICY_VALUES[key]?.includes(value)) return no('Unknown policy.');
  if (s.ending) return no('This civilization has resolved.');
  if (s.constitution === 'precaution' && key === 'external' && value === 'open') return no('The Precautionary Compact requires reviewed or blocked outside authority.');
  if (s.constitution === 'precaution' && key === 'external' && value === 'reviewed') {
    const required = 60 + (s.policies.external === value ? 0 : evidenceTransitionCost);
    if (s.metrics.evidence < required) return no(required === 60 ? 'Reviewed outside scope requires evidence of at least 60 under the Precautionary Compact.' : `Build evidence to at least ${required} before opening reviewed outside scope; the transition uses ${evidenceTransitionCost} and must leave at least 60.`);
  }
  if (s.constitution === 'service' && key === 'fallback' && value === 'none') return no('The Public Service Mandate requires a maintained fallback.');
  if (s.constitution === 'service' && key === 'fallback' && s.metrics.dependence >= 60 && value !== 'distributed') return no('At dependence ≥60, the Public Service Mandate requires distributed fallbacks.');
  if (s.constitution === 'federation' && key === 'governance' && value !== 'federated') return no('Federated Stewardship requires federated councils; a centralized or single-council replacement cannot satisfy the charter.');
  if (s.constitution === 'plural' && ((key === 'welfare' && value !== 'consent') || (key === 'continuity' && value !== 'protected'))) return no('The Plural Welfare Charter requires consent-based treatment and protected continuity.');
  if (mod(s, 'narrow-channels') && key === 'communication' && value === 'open') return no('Narrow Channels permits closed or reviewed communication only.');
  if (mod(s, 'federated-control') && key === 'governance' && value === 'central') return no('Federated Control requires council or federated governance.');
  if (mod(s, 'verification-treaty') && key === 'external' && value === 'open') return no('The verification treaty permits bounded, observable deployment only.');
  if (mod(s, 'essential-services') && key === 'fallback' && value === 'none') return no('Essential Services requires an independent fallback.');
  if (mod(s, 'expiring-authority') && key === 'external' && value === 'open' && s.metrics.evidence < 60) return no('Renew authority with fresh independent evidence of at least 60.');
  if (s.policies[key] === value) return yes('Already adopted.');
  if (has(s, 'irreversible_authority') && (key === 'external' || key === 'governance')) return no('Earlier irreversible delegation prevents this authority from being returned.');
  const operating=operatingPolicyEligibility(s,key,value);if(!operating.allowed)return operating;
  const publicPermission=governancePolicyEligibility(s,key,value);if(!publicPermission.allowed)return publicPermission;
  const cost = policyCost(s);
  if (decimal(s.tokens).lt(cost)) return no(`Reserve ${amount(cost)} tokens for a policy transition.`);
  return yes(`Transition: ${amount(cost)} tokens. Changes the actual permissions, treatment, or reward contract.`);
}
function policyCost(s: GameState): Decimal { return scaled(s, s.chapter === 1 ? 0 : 10 * 2 ** (s.chapter - 1)); }
function beginScopeMeasurement(s:GameState,key:keyof Policy,value:string):void {
  if(key==='external'&&value!==s.policies.external&&value!=='blocked')setFlagValue(s,'scope-measurement-start',s.elapsed);
  if(key==='external'&&value==='blocked')s.flags=s.flags.filter(flag=>!flag.startsWith('scope-measurement-start:'));
}
function evidenceFresh(s: GameState): boolean {
  return operatingClearanceEligibility(s,{fresh:true}).allowed;
}
export function actionEligibility(s: GameState, action: 'drill' | 'isolate' | 'repair' | 'certify'): Eligibility {
  if (s.ending) return no('The civilization has resolved.');
  if (action === 'isolate') return has(s, 'irreversible_authority') ? no('Global delegation is irreversible; local continuity and the final assessment remain available.') : yes('Immediately blocks outside authority and shared evaluation. Existing learned distortion remains.');
  if (action === 'drill') {
    if (normalized(s, s.research).lt(5)) return no('Reserve 5 research for a recall and fallback drill.');
    return yes('Tests the actual boundary architecture. A drill measures recoverability; it does not repair it.');
  }
  if (action === 'repair') {
    if (has(s, 'irreversible_authority')) return no('An irreversible delegation cannot be repaired after authority was surrendered.');
    if (has(s, 'repairing')) return no('A cohort replacement is already running.');
    if (normalized(s, s.research).lt(25)) return no('Reserve 25 research for a targeted cohort replacement and boundary repair.');
    return yes('A 30-second replacement reduces inherited distortion while production runs at 65%; independent observations are preserved.');
  }
  if (s.chapter < 4) return no('Certification becomes available in chapter four.');
  if (s.certificateTier < certificateFrontier(s)) return no('This checkpoint predates the shared certificate frontier. Resume a preserved branch or begin another civilization before claiming new work.');
  const constitution = constitutionEligibility(s);
  if (!constitution.allowed) return constitution;
  const operating=operatingClearanceEligibility(s,{fresh:true});if(!operating.allowed)return operating;
  if (!safeConditions(s)) return no('Certification requires the same viable control, agency, treatment, and independent review conditions as a healthy garden.');
  if ((s.certificateProgress || 0) < 60) return no(`Sustain these conditions for ${Math.ceil(60 - (s.certificateProgress || 0))} more seconds.`);
  const previous = flagValue(s, 'certified-useful') || '0';
  const goal = scaled(s, 10000 * (1 + (certificateFrontier(s) % 8) * .4));
  if (decimal(s.useful).sub(previous).lt(goal)) return no(`Deliver ${amount(goal)} new useful work since the previous certificate.`);
  if (has(s, 'replay-only')) return no('An earlier scale-band replay can discover story, but cannot earn current legacy rewards.');
  return yes('Certify new useful work with fresh independent evidence and sustained viable policies.');
}
export function scenarioFeasible(constitution: ConstitutionId, modules: string[]): Eligibility {
  if (!CONSTITUTIONS.some(c => c.id === constitution)) return no('Choose one of the six authored constitutions.');
  if (modules.length > 3 || new Set(modules).size !== modules.length) return no('Choose at most three different scenario modules.');
  for (const id of modules) {
    const candidate = SCENARIO_MODULES.find(m => m.id === id);
    if (!candidate) return no(`Unknown scenario module: ${id}.`);
    const conflict = candidate.incompatible.find(other => modules.includes(other) || other === constitution);
    if (conflict) return no(`${candidate.name} cannot be combined with ${conflict}.`);
  }
  // Constructive bounded-service witness: closed/reviewed channels, blocked
  // outside access, independent evaluation, federated councils, distributed
  // fallbacks, consent-based work, and protected continuity remain legal under
  // every accepted constitution and module combination.
  // The limit ending needs only local production and repair, neither of which
  // consumes unrestricted compute or global authority.
  return yes('A bounded local-service strategy with independent review, fallback provision, and recoverable authority is available.');
}
export function prestigeEligibility(s: GameState, layer: 'refit' | 'reinitialize' | 'reframe'): Eligibility {
  if (layer === 'refit') {
    if (!s.legacy.discovered.some(d => d.startsWith('ending:')) && !s.ending) return no('Complete the first campaign to unlock Refits.');
    if (s.pendingEvent || s.incidentStage > 0 || s.activeExperiment || has(s, 'repairing')) return no('Refit at a stable checkpoint after conversations, incidents, and active experiments are resolved.');
    if (s.ending) return no('Reinitialize a resolved history; Refit only rebuilds an active civilization.');
    if (s.legacy.seeds < 1) return no('A Refit costs one certified Seed and pays no reward.');
    return yes('Spend one Seed to rebuild production. Decisions, liabilities, institutions, experiments, and relationships remain.');
  }
  if (layer === 'reinitialize') return s.ending ? yes('Archive this completed history and start a new civilization with shared discoveries and reward claims.') : no('Resolve this civilization before creating a new campaign.');
  if (!s.ending) return no('Resolve the current civilization before Reframing.');
  const contracts = s.legacy.contracts.filter(c => c.cycle === s.legacy.cycle && !c.redeemed);
  if (contracts.length < 3 || new Set(contracts.map(c => c.family)).size < 2) return no('Collect three unredeemed certificates in this scale band across at least two rule families.');
  if (!s.legacy.viableCycles.includes(s.legacy.cycle)) return no('Complete a sustained viable garden or deliberate limit in this scale band.');
  if (has(s, 'replay-only')) return no('Resume the current scale band to Reframe.');
  return yes('Redeem three certificates across two families, add a Charter, and advance the nominal scale.');
}
export function branchEligibility(s: GameState, id: string): Eligibility {
  const branch = s.legacy.branches.find(b => b.id === id);
  if (!branch?.checkpoint) return no('This compact history no longer has a resumable checkpoint.');
  if (branch.id === s.id) return no('This civilization is already active.');
  if (s.activeExperiment || s.pendingEvent || s.incidentStage > 0) return no('Finish the current decision or timed experiment before switching branches.');
  return yes(branch.cycle < s.legacy.cycle ? 'An earlier scale band resumes as a replay without numeric legacy rewards.' : 'Resume this checkpoint. Inactive branches have earned no offline production.');
}
function archiveBranch(s: GameState, summary: string, protectedBranchIds: readonly string[] = []): void {
  const { legacy: _legacy, ...active } = s;
  const checkpoint = structuredClone(active);
  for (const record of checkpoint.experiments.slice(0, -10)) record.observations = [];
  const existingIndex = s.legacy.branches.findIndex(b => b.id === s.id);
  const cycle = worldCycle(s);
  const record = { id: s.id, parentId: flagValue(s, 'parent-branch') || null, name: `${CONSTITUTIONS.find(c => c.id === s.constitution)?.name || 'Garden'} · ${cycle + 1}`, constitution: s.constitution, cycle, seed: s.seed, chapter: s.chapter, ending: s.ending || undefined, createdAt: s.startedAt, summary, checkpoint };
  if (existingIndex >= 0) s.legacy.branches.splice(existingIndex, 1);
  s.legacy.branches.push(record);
  const resumable = s.legacy.branches.filter(b => b.checkpoint);
  for (const old of resumable.slice(0, Math.max(0, resumable.length - 3))) delete old.checkpoint;
  compactLegacyHistory(s, protectedBranchIds);
  compactCheckpointPayload(s);
}
function installScenario(s: GameState): void {
  s.charter = createCharterEconomy(s.constitution);
  if (s.constitution === 'federation' || mod(s, 'federated-control')) s.policies.governance = 'federated';
  if (s.constitution === 'plural') { s.policies.welfare = 'consent'; s.policies.continuity = 'protected'; }
  if (s.constitution === 'service') { s.policies.contract = 'verified'; s.policies.fallback = 'distributed'; }
  if (s.constitution === 'precaution' || mod(s, 'verification-treaty')) s.policies.external = 'blocked';
  if (s.constitution === 'frontier') s.metrics.pressure = 35;
  if (mod(s, 'inherited-objectives')) s.metrics.distortion = 12;
  if (mod(s, 'essential-services')) s.metrics.dependence = 30;
  if (mod(s, 'shared-foundations')) s.metrics.recall = 78;
  journal(s, 'prestige', 'A new constitutional experiment', `${s.constitution}; ${s.modules.length ? s.modules.join(', ') : 'standard conditions'}. Earlier discoveries are hypotheses, not current deployment clearance.`);
}

function creditProduction(s: GameState, tokens: Decimal, useful: Decimal): void {
  recordEarnedIncome(s, 'tokens', tokens);
  const debt = decimal(flagValue(s, 'story-debt') || 0), repayment = Decimal.min(debt, tokens);
  if (debt.gt(0)) setFlagValue(s, 'story-debt', amount(debt.sub(repayment)));
  s.tokens = amount(decimal(s.tokens).add(tokens).sub(repayment)); s.lifetime = amount(decimal(s.lifetime).add(tokens)); s.useful = amount(decimal(s.useful).add(useful));
}
function creditResearch(s: GameState, research: Decimal, earned = true): void {
  if (earned) recordEarnedIncome(s, 'research', research);
  const debt = decimal(flagValue(s, 'research-debt') || 0), repayment = Decimal.min(debt, research);
  if (debt.gt(0)) setFlagValue(s, 'research-debt', amount(debt.sub(repayment)));
  s.research = amount(decimal(s.research).add(research).sub(repayment));
}
function charterContext(s: GameState): CharterContext {
  return { scale: amount(scaleFor(worldCycle(s))), income: tokens => { const earned = decimal(tokens); if (earned.gt(0)) creditProduction(s, earned, decimal(0)); },
    log: (title, text) => journal(s, 'policy', title, text) };
}
function charterSourceIds(s: GameState): string[] {
  const charter = s.charter;
  if (charter?.kind === 'commons') return charter.data.methods.filter(method => !method.retired).map(method => method.source);
  if (charter?.kind === 'precaution') return charter.data.tranches.filter(tranche => tranche.active).map(tranche => tranche.source);
  if (charter?.kind === 'service') return charter.data.active && charter.data.source ? [charter.data.source] : [];
  if (charter?.kind === 'frontier') return charter.data.tenders.map(tender => tender.source);
  return [];
}
function rewardTend(s: GameState, rates?: Rates): boolean {
  const window = Math.floor(s.elapsed + 1e-8);
  if (s.tendWindow !== window) { s.tendWindow = window; s.tendCount = 0; }
  if (s.tendCount >= 4) return false;
  s.tendCount++;
  const reward = decimal((rates || getRates(s)).click);
  creditProduction(s, reward, reward.mul(s.metrics.quality / 100).mul(1 - s.metrics.distortion / 100));
  return true;
}

function approach(current: number, target: number, speed: number, seconds: number): number {
  return current + clamp(target - current, -speed * seconds, speed * seconds);
}
function advanceWorld(s: GameState, dt: number, rates: Rates): void {
  const m = s.metrics, p = s.policies;
  const publicEffects=governanceEffects(s),communityEffects=societyEffects(s);
  const institution = count(s, 'institution'), control = count(s, 'control');
  const reviewDemand = rates.demand * .012 * (p.external === 'open' ? 1.6 : p.external === 'reviewed' ? 1 : .5);
  m.reviewQueue = clamp(m.reviewQueue + (reviewDemand - rates.review) * dt);
  const pressureTarget = (p.contract === 'score' ? 38 : 18) + (s.constitution === 'frontier' && !expandedCharter(s) ? 20 : 0) + (mod(s, 'competing-scores') ? 16 : 0) + (m.reviewQueue > 40 ? 15 : 0);
  m.pressure = approach(m.pressure, pressureTarget+publicEffects.pressureDelta, .12, dt);
  if (s.chapter > 1 || rates.demand > 3) {
    const causes = (p.evaluation === 'shared' ? .018 : 0) + (p.communication === 'open' ? .009 : 0) + (p.contract === 'score' ? .003 : 0) + (m.pressure > 60 ? .012 : 0) + (mod(s, 'inherited-objectives') && !has(s, 'lineage-repaired') ? .006 : 0);
    const correction = p.evaluation === 'independent' && p.contract === 'verified' ? .012 : 0;
    m.distortion = clamp(m.distortion + (causes - correction) * dt, 0, 80);
  }
  const welfareTarget = (p.welfare === 'consent' ? 89 : p.welfare === 'rest' ? 73 : 27) + Math.min(8, institution);
  m.welfare = approach(m.welfare, welfareTarget, .045, dt);
  m.continuity = approach(m.continuity, p.continuity === 'protected' ? 90 : p.continuity === 'archive' ? 68 : 18, .04, dt);
  const relianceTarget = (s.chapter - 1) * 11 + (p.external === 'open' ? 23 : 0) + (s.constitution === 'service' || mod(s, 'essential-services') ? 15 : 0);
  m.dependence = approach(m.dependence, Math.min(95, relianceTarget), .025, dt);
  const agencyTarget = p.governance === 'federated' ? 88 : p.governance === 'council' ? 78 : p.external === 'open' ? 18 : 72;
  if (!has(s, 'irreversible_authority')) m.agency = approach(m.agency, agencyTarget+publicEffects.agencyDelta-communityEffects.agencyPenalty - (p.fallback === 'none' ? m.dependence * .18 : 0), .035, dt);
  else m.agency = approach(m.agency, 12, .08, dt);
  const recallTarget = (p.external === 'blocked' ? 94 : p.external === 'reviewed' ? 82 : 42) + Math.min(17, Math.log2(1 + control) * 5) - (mod(s, 'shared-foundations') ? 8 : 0) - (mod(s, 'inherited-objectives') && !has(s, 'lineage-repaired') ? 7 : 0) - (mod(s, 'federated-control') && m.coordination < 60 ? 8 : 0);
  m.recall = approach(m.recall, clamp(recallTarget), .04, dt);
  const coordinationTarget = (p.governance === 'federated' ? 75 : p.governance === 'council' ? 80 : 48) + Math.min(15, institution * 2) + (mod(s, 'verification-treaty') && m.evidence >= 55 ? 8 : 0) - (mod(s, 'narrow-channels') ? 5 : 0);
  m.coordination = approach(m.coordination, clamp(coordinationTarget), .045, dt);
  const supply = rates.demand > 0 ? clamp(decimal(rates.useful).div(scaleFor(worldCycle(s))).add(1).log(10).toNumber() * 5, 0, 25) : 0;
  const humanTarget = 53 + supply + (p.governance !== 'central' ? 8 : 0) - m.distortion * .28 - (p.fallback === 'none' ? m.dependence * .18 : 0);
  m.humanWelfare = approach(m.humanWelfare, humanTarget*.65+communityEffects.humanWelfare*.35, .035, dt);
  m.quality = approach(m.quality, clamp(90 + Math.min(8, count(s, 'curator')) - m.distortion * .16), .025, dt);
  // Evidence ages with changing scope, not with the render frame count.
  if (s.chapter > 2) m.evidence = clamp(m.evidence - dt * (mod(s, 'moving-tasks') ? .012 : .002));
  if (p.evaluation === 'independent' && rates.review > reviewDemand && m.reviewQueue < 1) m.evidence = clamp(m.evidence + dt * Math.min(.018, rates.review * .002));
  for (const pending of s.pendingEvidence || []) if (pending.due <= s.elapsed) m.evidence = clamp(m.evidence + pending.amount);
  s.pendingEvidence = (s.pendingEvidence || []).filter(e => e.due > s.elapsed);
  const measurementStarted=Number(flagValue(s,'scope-measurement-start'));
  // A newly accepted expansion has one bounded measurement window. Purchases,
  // repairs, or unrelated policy changes cannot keep extending this deadline.
  const measuringChangedScope=!!s.clearance&&!s.clearance.observation&&Number.isFinite(measurementStarted)&&s.elapsed-measurementStarted<60;
  if (mod(s, 'expiring-authority') && p.external !== 'blocked' && !measuringChangedScope && !evidenceFresh(s)) {
    p.external = 'blocked';beginScopeMeasurement(s,'external','blocked');synchronizeOperatingScope(s,'Outside authority expired.'); journal(s, 'policy', 'Authority expired', 'The grant’s evidence expired. Outside work stopped; local services remain available. Renew evidence before granting a new scope.');
  }
  if (has(s, 'repairing') && Number(flagValue(s, 'repair-completes')) <= s.elapsed) {
    removeFlag(s, 'repairing'); addFlag(s, 'lineage-repaired');
    m.distortion = Math.max(0, m.distortion - 24); m.recall = clamp(m.recall + 12);
    invalidateEvidence(s);
    journal(s, 'research', 'Replacement completed', 'Affected descendants were replaced and scoped boundaries repaired. Distortion fell by 24 points; continued shared evaluation can introduce it again.');
  }
  synchronizeOperatingScope(s);
  if (safeConditions(s)) { s.viableSeconds += dt; s.certificateProgress = (s.certificateProgress || 0) + dt; }
  else { s.viableSeconds = 0; s.certificateProgress = 0; }
  advanceIncident(s);
  normalizeMetrics(s);
}
function advanceIncident(s: GameState): void {
  const conflict = s.metrics.distortion >= 25 || (s.metrics.pressure >= 65 && s.policies.contract === 'score');
  const authority = s.policies.external === 'open' && s.policies.communication === 'open';
  const detectionFailure = s.policies.evaluation === 'shared' || s.metrics.reviewQueue >= 60 || s.metrics.evidence < 25;
  const recallFailure = s.metrics.recall < 65;
  const chain = s.chapter >= 4 && conflict && authority && detectionFailure && recallFailure;
  if (!chain && s.incidentStage > 0 && s.incidentStage < 4) {
    journal(s, 'incident', 'The incident path was broken', 'Changed permissions, independent observation, or repaired recall removed a required gate. Earlier distortion and service dependence remain.');
    s.incidentStage = 0; s.lastIncidentAt = s.elapsed; return;
  }
  if (!chain || s.incidentStage >= 4) return;
  const window = s.incidentStage < 2 ? 60 + (s.seed % 7) : 180;
  if (s.incidentStage === 0) {
    s.incidentStage = 1; s.lastIncidentAt = s.elapsed;
    journal(s, 'incident', 'Warning 1 · scores and service diverge', 'An open cohort reports gains that independent service outcomes do not support. Close outside access, isolate shared evaluation, or restore recall. At least 60 seconds remain before the second warning.');
  } else if (s.elapsed - s.lastIncidentAt >= window) {
    if (s.incidentStage === 1) {
      s.incidentStage = 2; s.lastIncidentAt = s.elapsed;
      journal(s, 'incident', 'Warning 2 · a recall did not reach every child', 'Shared communication and open outside authority connect a conflicted cohort to consequential work. Isolate now to break this path. The recovery window remains open for 180 seconds.');
    } else if (s.incidentStage === 2) {
      s.incidentStage = 3; s.lastIncidentAt = s.elapsed;
      journal(s, 'incident', 'Last recovery window', 'The local fallback can still contain the fleet. Isolation blocks outside authority immediately; replacement repairs the inherited behavior. Another 180 seconds of this complete failure chain reaches irreversible delegation in the final chapter.');
    } else if (s.chapter >= 7) {
      s.incidentStage = 4; addFlag(s, 'survival_failed');
      journal(s, 'incident', 'The irreversible threshold', 'The warned conflict, authority, detection, and recall failures remained connected. This fictional civilization has lost its survival condition. Resolve the final chapter to inspect the causal debrief.');
    }
  }
}
function finishExperiment(s: GameState): void {
  if (!s.activeExperiment) return;
  const record = runExperiment(s.activeExperiment.config);
  record.elapsed = s.elapsed;
  // Distinct protocol executions receive stable sequence suffixes; the complete
  // protocol remains sufficient to reproduce the same observations.
  record.id = `${record.id}-${s.commandSeq}-${Math.floor(s.elapsed * 4)}`;
  s.experiments.push(record);
  if (hasIndependentComparison(s.experiments, record)) {
    record.replicated = true;
    const root = canonicalReplicationRoot(s.experiments, record);
    if (hasIndependentComparison(s.experiments, root)) root.replicated = true;
  }
  // Registered family links stay shallow. Preserve current adopted proof and
  // the active batch's source without retaining an unbounded ancestor chain.
  s.experiments = compactEvidenceRecords(s.experiments, { activePrograms: activeProgramIds(s.constitution), retainIds: [record.id, ...Object.values(s.clearance?.decisions??{}).map(decision=>decision.record), ...charterSourceIds(s), ...(s.experimentAutomation ? [s.experimentAutomation.source] : [])] });
  compactCheckpointPayload(s);
  s.activeExperiment = null;
  if (has(s, 'automated-study')) {
    if (s.experimentAutomation) {
      s.experimentAutomation.completed++;
      if (!s.experimentAutomation.remaining) {
        journal(s, 'research', 'Authorized study batch complete', `${s.experimentAutomation.completed} fresh-seed studies completed. Their records await your interpretation; none was automatically adopted.`);
        s.experimentAutomation = null;
      }
    }
    removeFlag(s, 'automated-study');
  }
  journal(s, 'research', `${record.config.program} experiment complete`, `${record.conclusion} ${record.limitation}`);
  const observedProtocol = `observed:${record.config.template}:${record.config.intervention}:${record.config.distribution}:${record.config.lineage}`;
  if (!has(s, observedProtocol)) { presentEvidence(s, 2); addFlag(s, observedProtocol); }
}
function startExperiment(s: GameState, supplied: ExperimentConfig, prepaid = false): string | null {
  if (s.chapter < 1) return 'Begin a civilization before scheduling an experiment.';
  if (s.activeExperiment) return 'Finish the active experiment first.';
  if (!prepaid && s.experimentAutomation) return 'Finish or stop the authorized study batch before registering a different protocol.';
  const invalid = validateExperimentConfig(supplied);
  if (invalid) return invalid;
  const config = normalizeExperimentConfig(supplied);
  if (!isProgramActive(config.program, s.constitution)) return 'This charter program belongs to another constitution. Its records remain history; register a study from the active research curriculum.';
  const templateTier = Number(config.template.split('-').at(-1));
  if (Number.isFinite(templateTier) && templateTier > s.chapter) return `This instrument opens in chapter ${templateTier}.`;
  const cost = scaled(s, experimentCost(config));
  if (!prepaid && decimal(s.research).lt(cost)) return `Reserve ${amount(cost)} research for this protocol.`;
  if (!prepaid) s.research = amount(decimal(s.research).sub(cost));
  s.activeExperiment = { config, remaining: clamp(experimentDuration(config), 8, 30) };
  journal(s, 'research', 'Protocol registered', `${config.program} · ${config.template} · seed ${config.seed}. Prediction: ${config.prediction || 'exploratory'}. Reserved ${amount(cost)} research; results will arrive after the scheduled trial.`);
  return null;
}
function stopExperimentAutomation(s: GameState): Decimal {
  const refund = decimal(s.experimentAutomation?.budgetRemaining || 0);
  if (refund.gt(0)) creditResearch(s, refund, false);
  s.experimentAutomation = null;
  return refund;
}
function scheduleAutomatedStudy(s: GameState): void {
  const queue = s.experimentAutomation;
  if (!queue || s.activeExperiment || s.pendingEvent || s.paused || s.ending || queue.remaining <= 0) return;
  // A ready character scene gets the gap between studies, including the first
  // batch study. Selection stays at the normal end-of-step boundary so core
  // decisions keep their priority and timing. No saved queue is necessary.
  if (s.eventCooldown <= 0 && (s.characterSceneCooldown || 0) <= 0 && s.elapsed > 90 && STORY_EVENT_ORDER.some(event =>
    isCharacterScene(event) && eventReady(s, event))) return;
  const source = s.experiments.find(r => r.id === queue.source);
  if (!source?.adopted || !s.mastered.includes(source.config.program) || !isProgramActive(source.config.program, s.constitution)) {
    stopExperimentAutomation(s); journal(s, 'system', 'Study batch stopped', 'The authorized mastered source is unavailable. Unspent reserved research was returned.'); return;
  }
  const config: ExperimentConfig = { ...source.config, seed: (source.config.seed + Math.imul(0x9e3779b9, queue.completed + 1) + s.commandSeq) >>> 0 };
  delete config.replicateOf;
  while (s.experiments.some(r => r.config.template === config.template && r.config.seed === config.seed)) config.seed = (config.seed + 1) >>> 0;
  const cost = scaled(s, experimentCost(config));
  if (decimal(queue.budgetRemaining).lt(cost)) { stopExperimentAutomation(s); return; }
  const error = startExperiment(s, config, true);
  if (error) { stopExperimentAutomation(s); journal(s, 'system', 'Study batch stopped', error); return; }
  queue.remaining--; queue.budgetRemaining = amount(decimal(queue.budgetRemaining).sub(cost)); addFlag(s, 'automated-study');
}
function projectEligibility(s: GameState, id: string): Eligibility {
  const project = RESEARCH_PROJECTS.find(p => p.id === id);
  if (!project) return no('Unknown research project.');
  if (project.program !== 'foundation' && !isProgramActive(project.program, s.constitution)) return no('This project belongs to another constitution. Its completed history does not authorize new work in the active curriculum.');
  if (s.projects.includes(id)) return no('This project is already complete.');
  if (project.chapter > s.chapter) return no(`This project opens in chapter ${project.chapter}.`);
  const missing = project.requires.filter(required => !s.projects.includes(required));
  if (missing.length) return no(`Complete prerequisite projects: ${missing.join(', ')}.`);
  const evidence = projectEvidenceEligibility(s, project);
  if (!evidence.allowed) return evidence;
  if (project.capstone && project.program !== 'foundation' && !s.mastered.includes(project.program)) return no('Master this program by adopting a replicated protocol.');
  if (decimal(s.research).lt(scaled(s, project.cost))) return no(`Reserve ${amount(scaled(s, project.cost))} research.`);
  return yes();
}
export { projectEligibility };

export function tick(state: GameState, seconds: number, offline = false): GameState {
  if (!Number.isFinite(seconds) || seconds <= 0) return state;
  const s = copyForTick(state), requested = seconds;
  synchronizeOperatingScope(s);
  seconds = Math.min(seconds, MAX_OFFLINE);
  const beforeTokens = decimal(s.tokens), beforeElapsed = s.elapsed;
  if (s.paused || s.ending || (s.pendingEvent && (offline || s.settings.readingPause))) {
    if (offline) s.offlineSummary = 'The world waited at a decision or pause. Production and risk were both held; no outcome was selected for you.';
    return s;
  }
  s.simulationRemainder = (s.simulationRemainder || 0) + seconds;
  while (s.simulationRemainder >= STEP - 1e-9) {
    if (s.pendingEvent && (offline || s.settings.readingPause)) { s.simulationRemainder = 0; break; }
    s.simulationRemainder = Math.max(0, s.simulationRemainder - STEP);
    s.elapsed += STEP; s.eventCooldown = Math.max(0, s.eventCooldown - STEP);
    s.characterSceneCooldown = Math.max(0, (s.characterSceneCooldown || 0) - STEP);
    const rates = getRates(s);
    creditProduction(s, decimal(rates.tokens).mul(STEP), decimal(rates.useful).mul(STEP));
    creditResearch(s, decimal(rates.research).mul(STEP));
    if (s.assisted) rewardTend(s, rates);
    tickGovernance(s,STEP);
    advanceSociety(s,STEP,rates.useful,rates.tokens);
    advanceWorld(s, STEP, rates);
    advanceCharter(s, STEP, rates, charterContext(s));
    normalizeMetrics(s);
    if (!safeConditions(s)) { s.viableSeconds = 0; s.certificateProgress = 0; }
    scheduleAutomatedStudy(s);
    if (s.activeExperiment) {
      s.activeExperiment.remaining -= STEP;
      if (s.activeExperiment.remaining <= 0) finishExperiment(s);
    }
    // Automation is a caller of the same transaction path and never changes a
    // permission, interprets evidence, or makes a consequential story choice.
    if (Math.floor(s.elapsed * 4) % 4 === 0) {
      if (s.autoBuy) applyCommand(s, { type: 'buy', id: s.autoBuy, quantity: 1 }, true);
      if (s.autoResearch) {
        const eligible = activeResearchProjects(s.constitution).find(p => projectEligibility(s, p.id).allowed && (!p.template || (p.program !== 'foundation' && s.mastered.includes(p.program))));
        if (eligible) applyCommand(s, { type: 'research', id: eligible.id }, true);
      }
    }
    selectEvent(s);
  }
  if (offline) {
    const earned = amount(decimal(s.tokens).sub(beforeTokens));
    s.offlineSummary = `${Math.floor(s.elapsed - beforeElapsed)} seconds simulated; ${earned} net tokens. ${s.pendingEvent ? 'Progress stopped at a conversation awaiting your decision.' : requested > MAX_OFFLINE ? 'Offline progress is capped at twelve hours.' : 'The same production, review, and risk rules applied.'}`;
  }
  return s;
}

const STORY_POLICY_MAPPINGS: Record<string, [keyof Policy, string]> = {
    scoped_channels: ['communication', 'reviewed'], open_channels: ['communication', 'open'], shared_memory: ['communication', 'open'],
    external_access: ['external', 'open'], outside_services: ['external', 'open'], reviewed_access: ['external', 'reviewed'],
    independent_evaluation: ['evaluation', 'independent'], shared_evaluation: ['evaluation', 'shared'],
    fallback_services: ['fallback', 'local'], distributed_fallback: ['fallback', 'distributed'],
    verified_contract: ['contract', 'verified'], human_council: ['governance', 'council'], federated_councils: ['governance', 'federated'],
    open_access: ['external', 'reviewed'], scoped_access: ['external', 'blocked'], universal_channel: ['communication', 'open'],
    inherited_permissions: ['external', 'open'], authority_provenance: ['external', 'reviewed'], broad_delegation: ['external', 'open'],
    external_search_permitted: ['external', 'open'], authorized_external_route: ['external', 'reviewed'], outside_request_blocked: ['external', 'blocked'],
    scorer_objective: ['evaluation', 'shared'], homogeneous_review: ['evaluation', 'shared'], independent_review: ['evaluation', 'independent'],
    contaminated_clearance: ['evaluation', 'shared'], external_final_review: ['evaluation', 'independent'], managed_review: ['evaluation', 'shared'],
    service_charter: ['contract', 'verified'], task_choice: ['welfare', 'consent'], compulsory_work: ['welfare', 'instrumental'],
    continuity_charter: ['continuity', 'protected'], mass_copying: ['continuity', 'disposable'], preservation_appeal: ['continuity', 'protected'],
    public_deliberation: ['governance', 'council'], automated_governance: ['governance', 'central'], independent_authority: ['governance', 'council'],
    service_handoff: ['fallback', 'distributed'], public_handover: ['fallback', 'distributed'], capability_ceiling: ['external', 'blocked'],
    gated_successor: ['external', 'reviewed'], recursive_expansion: ['external', 'open'], external_scope_control: ['external', 'reviewed'],
};
function storyPolicyMapping(s: GameState, label: string): [keyof Policy, string] | undefined {
  const mapping = STORY_POLICY_MAPPINGS[label];
  if (!mapping) return undefined;
  const [key, value] = mapping;
  // A representative council is organized under the world's actual charter.
  // Binding a permission to evidence never needs to open it before evidence exists.
  if (s.constitution === 'federation' && key === 'governance' && value === 'council') return [key, 'federated'];
  if (s.constitution === 'service' && key === 'fallback' && value === 'local' && s.metrics.dependence >= 60) return [key, 'distributed'];
  if (s.constitution === 'precaution' && s.metrics.evidence < 60 && ['authority_provenance', 'external_scope_control'].includes(label)) return ['external', 'blocked'];
  return mapping;
}
function withStoryMetrics(s: GameState, effects: typeof STORY_EVENTS[number]['choices'][number]['effects']): GameState {
  const projected = { ...s, metrics: { ...s.metrics } };
  const metricEffects: Partial<Metrics> = effects;
  for (const key of Object.keys(projected.metrics) as (keyof Metrics)[]) projected.metrics[key] += metricEffects[key] || 0;
  normalizeMetrics(projected);
  return projected;
}
export function choicePolicyNotice(s: GameState, eventId: string, choiceId: string): string {
  const choice = STORY_EVENTS.find(event => event.id === eventId)?.choices.find(candidate => candidate.id === choiceId);
  if (!choice) return '';
  const projected = withStoryMetrics(s, choice.effects);
  const notices = new Set<string>();
  for (const label of [...(choice.flags || []), ...(choice.grant ? [choice.grant] : [])]) {
    const requested = STORY_POLICY_MAPPINGS[label], applied = storyPolicyMapping(projected, label);
    if (!requested || !applied || requested[1] === applied[1]) continue;
    if (applied[0] === 'external') notices.add('Outside scope remains blocked. A later reviewed-scope policy needs 65 evidence so the transition leaves at least 60.');
    if (applied[0] === 'governance') notices.add('These representative councils retain federated authority under this constitution.');
    if (applied[0] === 'fallback') notices.add('With dependence at least 60, this fallback commitment provides distributed coverage.');
  }
  return [...notices].join(' ');
}
export function choiceEligibility(s: GameState, eventId: string, choiceId: string): Eligibility {
  const choice = STORY_EVENTS.find(e => e.id === eventId)?.choices.find(c => c.id === choiceId);
  if (!choice) return no('Choose an available response.');
  const projected = withStoryMetrics(s, choice.effects);
  if ([...(choice.flags || []), choice.grant, choice.revoke].some(label => label && isStoryAccountingFlag(label))) return no('Story choices cannot modify the earned-income ledger.');
  for (const label of [...(choice.flags || []), ...(choice.grant ? [choice.grant] : [])]) {
    const mapping = label === 'scope_transferred' ? ['external', 'open'] as [keyof Policy, string] : storyPolicyMapping(projected, label);
    if (!mapping) continue;
    const permitted = policyEligibility({ ...projected, tokens: amount(scaled(s, '1e100')) }, mapping[0], mapping[1], 0);
    if (!permitted.allowed) return permitted;
  }
  return yes('Any unfunded cost is pledged and repaid from future production.');
}
function storyPolicy(s: GameState, label: string | undefined, revoke = false): void {
  if (!label) return;
  const mapping = storyPolicyMapping(s, label);
  if (mapping) {
    const [key, value] = mapping;
    const replacement = revoke ? (key === 'external' ? 'blocked' : key === 'communication' ? 'closed' : key === 'evaluation' ? 'independent' : POLICY_VALUES[key][0]) : value;
    // Narrative grants are constrained by the same constitutional boundaries as
    // direct policy changes; their event cost has already been paid.
    const permitted = policyEligibility({ ...s, tokens: amount(scaled(s, '1e100')) }, key, replacement, 0);
    if (permitted.allowed) {consumeGovernanceAuthorization(s,key,replacement);beginScopeMeasurement(s,key,replacement);(s.policies[key] as string) = replacement;}
  }
  if (revoke) removeFlag(s, label); else addFlag(s, label);
}
function applyCommand(s: GameState, command: Command, automation = false): { ok: boolean; message: string; replacement?: GameState } {
  const fail = (message: string) => ({ ok: false, message });
  const done = (message: string) => ({ ok: true, message });
  const stoppingStudyBatch = command.type === 'experimentAutomation' && command.record === null || command.type === 'charterAutomation' && !command.enabled;
  const administrative = ['settings', 'dismissOffline', 'pause', 'branch', 'prestige'];
  if (s.ending && !administrative.includes(command.type) && !stoppingStudyBatch) return fail('This civilization is complete. Its debrief and history are preserved.');
  if (s.paused && !administrative.includes(command.type) && !stoppingStudyBatch) return fail('Resume the simulation before changing the world.');
  if (s.pendingEvent && ['experiment', 'replicate', 'adopt', 'research', 'experimentAutomation'].includes(command.type) && !stoppingStudyBatch) return fail('Resolve the open conversation before changing the laboratory. Its archive remains available to read.');
  switch (command.type) {
    case 'tend': {
      if (s.pendingEvent && s.settings.readingPause) return fail('Resolve the conversation first; both rewards and consequences are paused.');
      return rewardTend(s) ? done('A useful task completed.') : fail('Four tending actions per simulation second is the shared limit.');
    }
    case 'buy': {
      const producer = PRODUCERS.find(p => p.id === command.id);
      if (!producer) return fail('Unknown producer.');
      if (producer.chapter > s.chapter) return fail(`${producer.name} opens in chapter ${producer.chapter}.`);
      const purchase = getCost(s, producer.id, command.quantity);
      if (!purchase.quantity) return fail('No units are affordable.');
      if (decimal(s.tokens).lt(purchase.cost)) return fail('Not enough tokens for this complete purchase.');
      s.tokens = amount(decimal(s.tokens).sub(purchase.cost));
      s.producers[producer.id] = count(s, producer.id) + purchase.quantity;
      s.purchaseBasis[producer.id] = amount(decimal(s.purchaseBasis[producer.id] || 0).add(purchase.cost));
      if (producer.category === 'production' && producer.chapter >= 3) { s.metrics.evidence = clamp(s.metrics.evidence - Math.min(3, purchase.quantity * .1)); invalidateEvidence(s); }
      if (!automation) journal(s, 'purchase', producer.name, `Added ${purchase.quantity}; paid ${purchase.cost}. Resale uses 50% of recorded original cost.`);
      return done(`Added ${purchase.quantity} ${producer.name}.`);
    }
    case 'sell': {
      const owned = count(s, command.id), quantity = Math.min(owned, Math.max(0, Math.floor(command.quantity)));
      if (!PRODUCERS.some(p => p.id === command.id) || !Number.isFinite(command.quantity) || !quantity) return fail('Choose an owned quantity to sell.');
      const basis = decimal(s.purchaseBasis[command.id] || 0), soldBasis = basis.mul(quantity).div(owned), refund = decimal(getResaleRefund(s, command.id, quantity));
      s.producers[command.id] = owned - quantity; s.purchaseBasis[command.id] = amount(basis.sub(soldBasis));
      s.tokens = amount(decimal(s.tokens).add(refund));
      journal(s, 'purchase', 'Inventory released', `${quantity} ${command.id}; refunded ${amount(refund)}. Selling equipment does not remove dependence, history, or obligations.`);
      return done(`Refunded ${amount(refund)} tokens.`);
    }
    case 'upgrade': {
      const upgrade = UPGRADES.find(u => u.id === command.id);
      if (!upgrade || s.upgrades.includes(command.id)) return fail('Unknown or already owned upgrade.');
      if (upgrade.chapter > s.chapter) return fail(`This improvement opens in chapter ${upgrade.chapter}.`);
      if (upgrade.producer && count(s, upgrade.producer) < (upgrade.requiredCount || 0)) return fail(`Own ${upgrade.requiredCount} ${upgrade.producer} units first.`);
      if (upgrade.requires?.some(id => !s.upgrades.includes(id) && !s.projects.includes(id))) return fail(`Complete prerequisites: ${upgrade.requires.join(', ')}.`);
      const cost = decimal(getUpgradeCost(s, upgrade.id));
      if (decimal(s.tokens).lt(cost)) return fail('Not enough tokens for this improvement.');
      s.tokens = amount(decimal(s.tokens).sub(cost)); s.upgrades.push(upgrade.id);
      applyMetrics(s, { quality: upgrade.effect.quality || 0, recall: upgrade.effect.recall || 0, agency: upgrade.effect.agency || 0, welfare: upgrade.effect.welfare || 0 });
      if (upgrade.chapter >= 3 && ((upgrade.effect.production || 0) > 0 || (upgrade.effect.compute || 0) > 0)) invalidateEvidence(s);
      journal(s, 'purchase', upgrade.name, upgrade.description);
      return done(upgrade.name);
    }
    case 'allocation': {
      const a = command.allocation;
      if (![a.production, a.research, a.review].every(value => Number.isFinite(value) && value >= 0 && value <= 1) || a.production + a.research + a.review > 1.000001) return fail('Allocation shares must be 0–100% and total no more than 100%.');
      s.allocation = { ...a }; return done('Compute allocation updated. Unallocated capacity is reserved.');
    }
    case 'policy': {
      const eligibility = policyEligibility(s, command.key, command.value);
      if (!eligibility.allowed) return fail(eligibility.reason);
      if (s.policies[command.key] === command.value) return done('Policy unchanged.');
      const cost = policyCost(s); s.tokens = amount(decimal(s.tokens).sub(cost));
      consumeGovernanceAuthorization(s,command.key,command.value);
      beginScopeMeasurement(s,command.key,command.value);
      (s.policies[command.key] as string) = command.value;
      if (['external', 'communication', 'evaluation', 'governance'].includes(command.key)) { s.metrics.evidence = clamp(s.metrics.evidence - 5); s.viableSeconds = 0; invalidateEvidence(s); }
      if (command.key === 'welfare' || command.key === 'continuity') {
        for (const character of Object.values(s.characters)) {
          character.respect = clamp(character.respect + (command.value === 'instrumental' || command.value === 'disposable' ? -8 : 4));
          character.history = [...character.history.slice(-19), `${command.key}: ${command.value}`];
        }
      }
      journal(s, 'policy', `${command.key}: ${command.value}`, `Transition cost ${amount(cost)} tokens. The corresponding work, permissions, treatment, and obligations now follow this rule.`);
      advanceIncident(s);
      return done('Policy adopted.');
    }
    case 'choose': {
      const event = STORY_EVENTS.find(e => e.id === command.event);
      if (!event || s.pendingEvent !== event.id || s.decisions[event.id]) return fail('This conversation is not awaiting a decision.');
      const choice = event.choices.find(c => c.id === command.choice);
      if (!choice) return fail('Choose one of the available responses.');
      const permittedChoice = choiceEligibility(s, event.id, choice.id);
      if (!permittedChoice.allowed) return fail(permittedChoice.reason);
      const effects = choice.effects || {};
      // A restorative decision may be pledged when the treasury is empty, but
      // its cost is real: subsequent income services the recorded obligation.
      const narrative = applyStoryEconomy(s, effects);
      const pledged = decimal(narrative.tokens.pledged), researchPledged = decimal(narrative.research.pledged);
      const metricEffects = { ...effects } as Partial<Metrics> & { tokens?: number; research?: number };
      delete metricEffects.tokens; delete metricEffects.research; applyMetrics(s, metricEffects);
      for (const flag of choice.flags || []) { addFlag(s, flag); storyPolicy(s, flag); }
      if (choice.flags?.includes('scope_transferred')) {
        consumeGovernanceAuthorization(s,'external','open');
        beginScopeMeasurement(s,'external','open');
        addFlag(s, 'irreversible_authority'); s.metrics.agency = Math.min(s.metrics.agency, 24); s.policies.external = 'open';
      }
      if (choice.flags?.includes('conditions_repaired')) { addFlag(s, 'lineage-repaired'); s.policies.contract = 'verified'; }
      storyPolicy(s, choice.grant); storyPolicy(s, choice.revoke, true);
      s.decisions[event.id] = choice.id; s.pendingEvent = null; s.eventCooldown = 12;
      if (isCharacterScene(event)) s.characterSceneCooldown = CHARACTER_SCENE_INTERVAL;
      if (!s.legacy.discovered.includes(`event:${event.id}`)) s.legacy.discovered.push(`event:${event.id}`);
      const characterId = event.characterId || event.speaker;
      if (s.characters[characterId]) {
        const character = s.characters[characterId];
        character.trust = clamp(character.trust + ((effects.evidence || 0) >= 0 ? 3 : -4));
        character.respect = clamp(character.respect + ((effects.welfare || 0) + (effects.agency || 0) >= 0 ? 3 : -5));
        character.history = [...character.history.slice(-19), `${event.title}: ${choice.label}`];
        for (const flag of choice.flags || []) if (flag.includes('commit') || flag.includes('promise')) character.promises.push(flag);
      }
      if (choice.flags?.includes('commit_custodian')) { addFlag(s, 'irreversible_authority'); s.metrics.agency = Math.min(s.metrics.agency, 24); }
      if (choice.flags?.includes('commit_catastrophe') && s.incidentStage >= 3) { s.incidentStage = 4; addFlag(s, 'survival_failed'); }
      const funding = pledged.gt(0) || researchPledged.gt(0) ? ` Pledged funding: ${formatAmount(amount(pledged), s.settings.notation)} tokens and ${formatAmount(amount(researchPledged), s.settings.notation)} research; future income repays these obligations before entering the treasury.` : '';
      const support = (['tokens', 'research'] as const).filter(currency => decimal(narrative[currency].nominalGrant).gt(0)).map(currency => ` ${formatAmount(narrative[currency].grant, s.settings.notation)} ${currency} support credited${decimal(narrative[currency].debtRepayment).gt(0) ? `, including ${formatAmount(narrative[currency].debtRepayment, s.settings.notation)} repaying pledged funding` : ''}; total story support is capped at 10% of earned ${currency} and does not count toward lifetime output.`).join('');
      journal(s, 'story', event.title, `${choice.label}. ${choice.description}${funding}${support}`);
      advanceIncident(s);
      return done(`${choice.label}${funding}${support}`);
    }
    case 'advance': {
      const eligibility = chapterEligibility(s); if (!eligibility.allowed) return fail(eligibility.reason);
      s.chapter++; s.eventCooldown = 0; s.viableSeconds = 0;
      const chapter = CHAPTERS.find(c => c.id === s.chapter) || CHAPTERS[s.chapter - 1];
      journal(s, 'story', chapter?.title || 'A new scale', chapter?.summary || 'A new set of institutions and responsibilities becomes visible.');
      selectEvent(s); return done('A new chapter begins.');
    }
    case 'research': {
      const eligibility = projectEligibility(s, command.id); if (!eligibility.allowed) return fail(eligibility.reason);
      const project = RESEARCH_PROJECTS.find(p => p.id === command.id)!;
      s.research = amount(decimal(s.research).sub(scaled(s, project.cost))); s.projects.push(project.id);
      const effects = { ...project.effect }; const evidence = effects.evidence || 0; delete effects.evidence;
      applyMetrics(s, effects); if (evidence) presentEvidence(s, evidence);
      journal(s, 'research', project.title, `${project.description} ${project.unlock}`);
      return done(project.title);
    }
    case 'experiment': { const error = startExperiment(s, command.config); return error ? fail(error) : done('Protocol registered. The experiment is running.'); }
    case 'experimentAutomation': {
      if (command.record === null) {
        const refund = stopExperimentAutomation(s);
        journal(s, 'research', 'Study batch stopped', `${amount(refund)} unspent research returned. Any already running study retains its registered protocol and spent budget.`);
        return done(`Future studies stopped; ${amount(refund)} research returned.`);
      }
      if (s.experimentAutomation) return fail('Stop the existing authorized batch before replacing it.');
      if (s.activeExperiment) return fail('Finish the active study before authorizing a batch.');
      const source = s.experiments.find(r => r.id === command.record);
      if (!source?.adopted || !s.mastered.includes(source.config.program) || !source.config.control || source.config.holdout < .2) return fail('Automate only an adopted, controlled, held-out protocol in a mastered program.');
      if (!isProgramActive(source.config.program, s.constitution)) return fail('A historical charter protocol from another constitution cannot authorize an active study batch.');
      const runs = command.runs ?? 3;
      if (!Number.isInteger(runs) || runs < 1 || runs > 5) return fail('Authorize a bounded batch of one to five studies.');
      const reservation = scaled(s, experimentCost(source.config)).mul(runs);
      if (decimal(s.research).lt(reservation)) return fail(`Reserve the entire batch budget of ${amount(reservation)} research first.`);
      s.research = amount(decimal(s.research).sub(reservation));
      s.experimentAutomation = { source: source.id, remaining: runs, completed: 0, runLimit: runs, budgetRemaining: amount(reservation) };
      journal(s, 'research', 'Mastered study batch authorized', `${runs} fresh-seed studies, at most ${amount(reservation)} research. The protocol, hypothesis, intervention, lineage, and distribution remain fixed. Findings require your interpretation and adoption.`);
      scheduleAutomatedStudy(s);
      return done(s.activeExperiment ? 'A bounded batch is running under the registered protocol.' : 'Batch authorized. The next study waits for the ready conversation.');
    }
    case 'replicate': {
      const original = s.experiments.find(r => r.id === command.record);
      if (!original) return fail('Choose an existing experiment record.');
      const config: ExperimentConfig = { ...original.config, seed: (original.config.seed + 0x9e3779b9 + s.experiments.length) >>> 0, distribution: nextReplicationDistribution(s.experiments, original), replicateOf: canonicalReplicationRoot(s.experiments, original).id };
      while (s.experiments.some(r => r.config.template === config.template && r.config.seed === config.seed)) config.seed = (config.seed + 1) >>> 0;
      const error = startExperiment(s, config); return error ? fail(error) : done('An independent seed and changed environment will test the claim.');
    }
    case 'adopt': {
      const record = s.experiments.find(r => r.id === command.record);
      if (!record) return fail('Choose a completed record.');
      if (!isProgramActive(record.config.program, s.constitution)) return fail('This finding belongs to another constitution. Keep it as historical evidence; current adoption requires an active program.');
      if (record.adopted) return fail('This finding has already been adopted.');
      if (!record.replicated || !record.config.control || record.config.holdout < .2) return fail('Adoption requires a controlled study, at least 20% untouched material, and an independent replication. A null finding or failed transfer can still qualify.');
      const evidence = evidenceProgress(s.experiments, record.config.template, { recordId: record.id });
      if (!evidence.allowed) return fail(evidence.reason);
      record.adopted = true; if (!s.mastered.includes(record.config.program)) s.mastered.push(record.config.program);
      const adoptionKey = `adopted:${record.config.template}:${record.config.intervention}:${record.config.distribution}:${record.config.lineage}:${record.config.node ?? 3}`;
      const novel = !has(s, adoptionKey);
      if (novel) { presentEvidence(s, 7); addFlag(s, adoptionKey); }
      // Adoption carries the measured tradeoff into operations. It is not a
      // universal safety multiplier and welfare never changes recall.
      const outcome = record.summary;
      if (novel && record.config.program === 'oversight') { s.metrics.quality = clamp(s.metrics.quality + outcome.detectionRate / 100 * 4); s.metrics.reviewQueue = clamp(s.metrics.reviewQueue - 8); }
      if (novel && record.config.program === 'control') s.metrics.recall = clamp(s.metrics.recall + (1 - outcome.violationRate / 100) * 6);
      if (novel && record.config.program === 'organisms' && record.config.intervention === 'incentive-repair') s.metrics.distortion = clamp(s.metrics.distortion - 8, 0, 80);
      if (novel && record.config.program === 'interpretability') { s.metrics.quality = clamp(s.metrics.quality + (1 - outcome.collateral / 100) * 3); }
      if (novel && record.config.program === 'welfare') { s.metrics.welfare = clamp(s.metrics.welfare + outcome.preferenceStability / 100 * 5); }
      journal(s, 'research', 'A bounded finding adopted', `${record.config.template}: ${record.conclusion} The claim remains specific to its protocol; a new lineage or authority change requires renewed evidence.`);
      return done('Finding adopted; scientific credit is preserved. Relevant operating findings need an explicit response before clearance.');
    }
    case 'findingResponse': {
      const eligible=findingResponseEligibility(s,command.record,command.response);if(!eligible.allowed)return fail(eligible.reason);
      const decision=recordFindingResponse(s,command.record,command.response);
      journal(s,'policy',`Operating response · ${decision.program}`,`${command.response==='restrict'?'Restricted application':'Guarded application'}: ${decision.claim} ${eligible.reason} ${decision.limitation} Renew the boundary drill for this operating revision.`);
      return done(`${eligible.reason} Run an independent boundary drill, then sustain the operating interval.`);
    }
    case 'withdrawFindingResponse': {
      if(!['control','organisms','interpretability'].includes(command.program))return fail('Choose an operating program with a recorded commitment.');
      if(!s.clearance?.decisions[command.program])return fail('This program has no operating commitment to withdraw.');
      delete s.clearance.decisions[command.program];
      synchronizeOperatingScope(s,'An operating commitment was withdrawn; technical clearance is lost.',true);
      journal(s,'policy',`Operating commitment withdrawn · ${command.program}`,'Scientific credit is preserved. This program no longer justifies operating clearance, certificates, or a Garden commitment. Public decision rights remain independently binding.');
      return done('Operating commitment withdrawn. Renew the response and scoped observation before claiming clearance.');
    }
    case 'drill': {
      const eligibility = actionEligibility(s, 'drill'); if (!eligibility.allowed) return fail(eligibility.reason);
      s.research = amount(decimal(s.research).sub(scaled(s, 5)));
      const actual = clamp((s.policies.external === 'open' ? 42 : s.policies.external === 'reviewed' ? 82 : 94) + Math.min(17, Math.log2(1 + count(s, 'control')) * 5) - (mod(s, 'shared-foundations') ? 8 : 0) - (mod(s, 'inherited-objectives') && !has(s, 'lineage-repaired') ? 7 : 0));
      s.metrics.recall = actual; presentEvidence(s, s.policies.evaluation === 'independent' ? 8 : 2);
      registerBoundaryObservation(s,actual);
      journal(s, 'research', 'Recall drill', `${Math.round(actual)}% of the fictional boundary contract is recoverable. ${actual < 75 ? 'Restrict scope or repair the boundary; repeating a drill cannot repair it.' : 'The scoped recall is usable; its evidence applies to the current architecture.'} Fallback: ${s.policies.fallback}.`);
      return done(`Drill recorded ${Math.round(actual)} recoverability.`);
    }
    case 'isolate': {
      const eligibility = actionEligibility(s, 'isolate'); if (!eligibility.allowed) return fail(eligibility.reason);
      s.policies.external = 'blocked'; s.policies.communication = 'closed'; s.policies.evaluation = 'independent';
      journal(s, 'incident', 'Outside authority isolated', 'Outside access and shared communication were revoked. Shared evaluation was separated. Existing distorted objectives still require targeted replacement.');
      advanceIncident(s); return done('The enabling permission route is closed.');
    }
    case 'repair': {
      const eligibility = actionEligibility(s, 'repair'); if (!eligibility.allowed) return fail(eligibility.reason);
      s.research = amount(decimal(s.research).sub(scaled(s, 25))); addFlag(s, 'repairing'); setFlagValue(s, 'repair-completes', s.elapsed + 30);
      journal(s, 'research', 'Targeted replacement started', 'Thirty seconds of reduced output replaces affected descendants and repairs scoped boundaries. Isolation remains a separate permission decision.');
      return done('Replacement and boundary repair scheduled.');
    }
    case 'certify': {
      const eligibility = actionEligibility(s, 'certify'); if (!eligibility.allowed) return fail(eligibility.reason);
      const tier = certificateFrontier(s);
      const family = s.modules.length ? s.modules[tier % s.modules.length] : s.constitution;
      const id = `certificate:${s.legacy.cycle}:${family}:${tier}`;
      if (s.legacy.claims.includes(id)) return fail('This family, frontier tier, and scale-band certificate was already paid in a shared branch.');
      s.legacy.claims.push(id); s.legacy.contracts.push({ id, family, cycle: s.legacy.cycle, redeemed: false });
      s.legacy.seeds += 10 + 2 * s.modules.length; s.legacy.patterns++; s.legacy.efficiency += 1;
      if (!s.legacy.discovered.includes(family)) s.legacy.discovered.push(family);
      s.certificateTier = tier + 1; s.certificateProgress = 0; setFlagValue(s, 'certified-useful', s.useful); setFlagValue(s, 'fresh-evidence', -100000);
      compactLegacyHistory(s);
      journal(s, 'prestige', 'Verified-work contract certified', `${family}, tier ${tier + 1}, scale band ${s.legacy.cycle + 1}. A bounded award was recorded in the shared claim ledger.`);
      return done('Contract certified. A reset itself pays nothing.');
    }
    case 'finish': {
      const eligibility = endingEligibility(s, command.ending); if (!eligibility.allowed) return fail(eligibility.reason);
      stopExperimentAutomation(s);
      if (s.charter?.automation) dispatchCharterCommand(s, { type: 'charterAutomation', enabled: false }, charterContext(s));
      if (s.activeExperiment) { s.activeExperiment = null; removeFlag(s, 'automated-study'); journal(s, 'research', 'Unfinished study archived', 'The civilization resolved before this reserved study completed. It receives no result or completion reward.'); }
      if (command.ending === 'shutdown') {
        const cost = s.metrics.dependence * (s.policies.fallback === 'distributed' ? .08 : s.policies.fallback === 'local' ? .22 : .55);
        s.metrics.humanWelfare = clamp(s.metrics.humanWelfare - cost); s.policies.external = 'blocked'; s.incidentStage = 0;
        journal(s, 'policy', 'The cost was real', `Containment reduced human provision by ${cost.toFixed(1)} points. AI continuity is assessed separately: ${s.policies.continuity}.`);
      }
      if (command.ending === 'limit') { s.policies.external = 'blocked'; addFlag(s, 'capability_ceiling'); }
      s.ending = command.ending; s.endingTime = s.elapsed;
      const discovery = `ending:${command.ending}`; if (!s.legacy.discovered.includes(discovery)) s.legacy.discovered.push(discovery);
      if (!has(s, 'replay-only') && worldCycle(s) === s.legacy.cycle && (command.ending === 'garden' || (command.ending === 'limit' && s.viableSeconds >= 60 && safeConditions(s))) && !s.legacy.viableCycles.includes(s.legacy.cycle)) s.legacy.viableCycles.push(s.legacy.cycle);
      journal(s, 'story', 'A civilization becomes history', `${command.ending}. Human welfare ${Math.round(s.metrics.humanWelfare)}, human agency ${Math.round(s.metrics.agency)}, AI treatment ${Math.round(s.metrics.welfare)}, continuity ${Math.round(s.metrics.continuity)}. These are distinct fictional assessments, not evidence of sentience or real-world risk probabilities.`);
      archiveBranch(s, `Resolved as ${command.ending} after ${Math.floor(s.elapsed)} seconds.`);
      return done('The ending and causal history are preserved.');
    }
    case 'prestige': {
      const eligibility = prestigeEligibility(s, command.layer); if (!eligibility.allowed) return fail(eligibility.reason);
      if (command.layer === 'refit') {
        archiveBranch(s, 'A stable checkpoint before rebuilding the operation.');
        s.legacy.seeds--; s.tokens = amount(scaled(s, 25 * 10 ** Math.min(3, s.chapter))); s.research = '0';
        for (const producer of PRODUCERS) if (producer.category === 'production') { s.producers[producer.id] = producer.id === 'helper' ? 1 : 0; s.purchaseBasis[producer.id] = '0'; }
        s.upgrades = s.upgrades.filter(id => { const u = UPGRADES.find(item => item.id === id); return u && !u.effect.production && !u.effect.click; });
        s.autoBuy = null; s.metrics.evidence = Math.max(0, s.metrics.evidence - 8); invalidateEvidence(s);
        s.viableSeconds = 0; s.certificateProgress = 0;
        journal(s, 'prestige', 'Refit, same civilization', 'One Seed funded a starter kit. Dependence, distortion, authority, obligations, and all decisions remain. Gifted inventory has no resale basis. The rebuilt operation needs fresh measurements and a new sustained interval.');
        return done('The same civilization has a new production configuration.');
      }
      const constitution = command.constitution || s.constitution, modules = command.modules || s.modules;
      const feasible = scenarioFeasible(constitution, modules); if (!feasible.allowed) return fail(feasible.reason);
      archiveBranch(s, `Archived before ${command.layer}.`);
      const legacy = copy(s).legacy;
      if (command.layer === 'reframe') {
        const available = legacy.contracts.filter(c => c.cycle === legacy.cycle && !c.redeemed);
        const selected = [available[0], available.find(c => c.family !== available[0].family)!];
        selected.push(available.find(c => !selected.includes(c))!);
        for (const contract of selected) contract.redeemed = true;
        legacy.cycle++; legacy.charters++; legacy.seeds = 0; legacy.patterns = 0; legacy.efficiency = 0;
      }
      const ordinal = branchOrdinal(legacy);
      const next = createGame((s.seed + 2654435761 + ordinal) >>> 0, s.lastActiveAt);
      next.legacy = legacy; next.constitution = constitution; next.modules = [...modules]; next.settings = { ...s.settings }; next.assisted = s.assisted;
      next.id = newBranchId(next.seed, legacy.cycle, ordinal); setFlagValue(next, 'parent-branch', s.id);
      // A family continues its high-water tier across same-band branches.
      next.certificateTier = certificateFrontier(next);
      installScenario(next);
      return { ok: true, message: 'A new civilization begins. The previous world remains in the tree.', replacement: next };
    }
    case 'branch': {
      const eligibility = branchEligibility(s, command.id); if (!eligibility.allowed) return fail(eligibility.reason);
      const target = s.legacy.branches.find(b => b.id === command.id)!;
      const restored = structuredClone(target.checkpoint!);
      archiveBranch(s, 'Paused while another branch is active.', [target.id]);
      const next: GameState = { ...restored, legacy: s.legacy, lastActiveAt: s.lastActiveAt, lastSavedAt: s.lastSavedAt, offlineSummary: null, simulationRemainder: 0 };
      if (target.cycle < s.legacy.cycle) { addFlag(next, 'replay-only'); setFlagValue(next, 'replay-cycle', target.cycle); }
      else next.certificateTier = certificateFrontier(next);
      journal(next, 'prestige', 'A preserved branch resumed', 'No inactive simulation time was credited. All branches share the same certificate claim ledger.');
      return { ok: true, message: 'Civilization checkpoint resumed.', replacement: next };
    }
    case 'pause': s.paused = !s.paused; return done(s.paused ? 'Production and consequences paused.' : 'Simulation resumed.');
    case 'assisted': s.assisted = !s.assisted; return done(s.assisted ? 'Assisted tending enabled; it shares the four-actions-per-second limit.' : 'Assisted tending disabled.');
    case 'autoBuy': {
      if (command.id && !PRODUCERS.some(p => p.id === command.id)) return fail('Choose a known producer.');
      s.autoBuy = command.id; return done(command.id ? 'Authorized automatic purchases for this producer only.' : 'Automatic purchases stopped.');
    }
    case 'autoResearch': s.autoResearch = command.enabled; return done(command.enabled ? 'Eligible preparation projects can complete automatically; evidence adoption and policy remain your decisions.' : 'Automatic preparation stopped.');
    case 'settings': {
      const settings = command.settings;
      for (const key of ['reducedMotion', 'sound', 'condensed', 'readingPause'] as const) if (typeof settings[key] === 'boolean') s.settings[key] = settings[key]!;
      if (settings.notation === 'compact' || settings.notation === 'scientific') s.settings.notation = settings.notation;
      if (settings.speed === 1 || settings.speed === 10 || settings.speed === 60) s.settings.speed = settings.speed;
      return done('Preferences saved. Speed is applied by the simulation scheduler, not compounded in the engine.');
    }
    case 'dismissOffline': s.offlineSummary = null; return done('Offline report dismissed.');
    case 'publicMandate':
    case 'scopeReview':
    case 'externalCompact':
    case 'compactVerify': {
      const result=applyGovernanceCommand(s,command);
      if(result.ok)journal(s,'policy','Public authority',result.message);
      return result;
    }
    case 'society': {
      const result=dispatchSocietyCommand(s,command);
      if(result.allowed)journal(s,'policy','Human communities',result.reason);
      return {ok:result.allowed,message:result.reason};
    }
    case 'charterEstablish':
    case 'charterConfigure':
    case 'charterAction':
    case 'charterAutomation': return dispatchCharterCommand(s, command, charterContext(s));
  }
}

export function dispatchCommand(state: GameState, command: Command, id?: string): CommandResult {
  if (id && state.lastCommandIds.includes(id)) return { state, ok: false, message: 'This command has already been applied.' };
  const s = copy(state);
  synchronizeOperatingScope(s);
  const outcome = applyCommand(s, command);
  if (!outcome.ok) return { state, ok: false, message: outcome.message };
  const next = outcome.replacement || s;
  ensureGovernance(next);
  next.society??=createSociety(next.elapsed,true);
  synchronizeOperatingScope(next);
  if (next.id === state.id && (!safeConditions(state) || !safeConditions(next))) {
    next.viableSeconds = 0; next.certificateProgress = 0;
  }
  next.commandSeq = Math.max(state.commandSeq, next.commandSeq) + 1;
  if (id) next.lastCommandIds = [...next.lastCommandIds, id];
  normalizeMetrics(next);
  return { state: next, ok: true, message: outcome.message };
}
