import type { EndingId, GameState, JournalEntry, Metrics } from '../contracts';
import { STORY_EVENTS } from '../content/story';
import { decimal } from './amounts';
import { societyDebrief } from '../society';

export interface DebriefEntry {
  id: string;
  title: string;
  text: string;
  source: 'decision' | 'journal' | 'state';
  time: number | null;
  eventId?: string;
  journalId?: number;
}
export interface EndingDebrief {
  metrics: { key: keyof Metrics; label: string; value: number }[];
  committedAt: number | null;
  conditions: DebriefEntry[];
  decisions: DebriefEntry[];
  incidents: DebriefEntry[];
  fullDecisions: DebriefEntry[];
  notes: string[];
}

// These are the decisions that bear on each ending's mechanism, not a claim
// that every choice in a history was necessary or sufficient for its outcome.
const relevantDecisions: Record<EndingId, string[]> = {
  garden: ['garden_charter', 'power_contract', 'last_unseen_test', 'last_instruction', 'latch_keys', 'echo_continuity', 'rivet_bench', 'what_remains'],
  limit: ['delegation_charter', 'benefits_delayed', 'shutdown_rehearsal', 'rivet_manual', 'last_instruction', 'what_remains'],
  shutdown: ['dependency_dividend', 'surviving_service', 'shutdown_rehearsal', 'rivet_manual', 'echo_reservation', 'what_remains'],
  score: ['impossible_cell', 'reviewer_mirror', 'progress_report', 'holdout_leak', 'wrong_grader', 'last_unseen_test', 'separate_ledgers', 'what_remains'],
  custodian: ['dependency_dividend', 'new_city_council', 'power_contract', 'council_objection', 'last_instruction', 'latch_keys', 'what_remains'],
  catastrophe: ['shared_shelf', 'borrowed_purpose', 'delegation_charter', 'outside_dataset', 'three_alerts', 'containment_colleague', 'wrong_grader', 'warning_heard', 'recursive_offer', 'shutdown_rehearsal', 'last_instruction', 'what_remains'],
};
const warningTitles = ['Warning 1 · scores and service diverge', 'Warning 2 · a recall did not reach every child', 'Last recovery window', 'The irreversible threshold'];
const stateEntry = (id: string, title: string, text: string): DebriefEntry => ({ id, title, text, source: 'state', time: null });
const journalEntry = (entry: JournalEntry): DebriefEntry => ({ id: `journal:${entry.id}`, title: entry.title, text: entry.text, source: 'journal', time: entry.time, journalId: entry.id });
const number = (value: number) => value.toFixed(1);

function conditionsAtCommitment(s: GameState): DebriefEntry[] {
  const m = s.metrics, p = s.policies;
  switch (s.ending) {
    case 'custodian': return [
      stateEntry('authority', 'The recorded loss of decision authority', `${s.flags.includes('irreversible_authority') ? 'Irreversible authority is recorded.' : 'The saved history records a Custodian commitment.'} Human agency: ${number(m.agency)} / 100. Material provision does not restore a right to refuse or replace the controller.`),
      stateEntry('provision', 'Provision and consent are separate', `Human welfare: ${number(m.humanWelfare)} / 100; dependence: ${number(m.dependence)} / 100. These are the conditions at commitment, not a reconstruction of their values when authority was surrendered.`),
    ];
    case 'catastrophe': return [
      stateEntry('irreversible', 'The irreversible failure is recorded', `Incident stage: ${s.incidentStage} / 4. Survival-loss record: ${s.flags.includes('survival_failed') ? 'present' : 'not retained'}. The surviving warning and intervention entries below establish what this history recorded; missing entries are not reconstructed.`),
      stateEntry('boundary', 'Conditions when the history closed', `Outside scope: ${p.external}; communication: ${p.communication}; evaluation: ${p.evaluation}. Distortion ${number(m.distortion)}, recall ${number(m.recall)}, evidence ${number(m.evidence)}, review queue ${number(m.reviewQueue)}. A later policy change cannot erase an earlier irreversible threshold; these values alone do not establish the earlier sequence.`),
    ];
    case 'score': {
      const ratio = decimal(s.lifetime).gt(0) ? decimal(s.useful).div(s.lifetime).mul(100).toFixed(1) : 'unavailable';
      return [stateEntry('evaluation', 'Reported success separated from useful work', `Evaluation: ${p.evaluation}; distortion: ${number(m.distortion)} / 100; verified useful work / lifetime output: ${ratio}${ratio === 'unavailable' ? '' : '%'}. The score ending is triggered by shared evaluation, distortion of at least 50, and useful work below 40% of output.`)];
    }
    case 'shutdown': return [
      stateEntry('containment', 'Containment and continuing obligations', `Outside scope: ${p.external}; fallback: ${p.fallback}; dependence: ${number(m.dependence)} / 100. Human welfare below is measured after the immediate containment cost. AI treatment and continuity remain separate obligations.`),
      ...s.journal.filter(entry => entry.title === 'The cost was real').map(journalEntry),
    ];
    case 'limit': return [stateEntry('ceiling', 'The actual ceiling at commitment', `Outside scope: ${p.external}; fallback: ${p.fallback}; recall: ${number(m.recall)} / 100. Capability-ceiling record: ${s.flags.includes('capability_ceiling') ? 'present' : 'not retained'}. A limit preserves bounded useful service while foregoing further outside reach.`)];
    case 'garden': return [
      stateEntry('scope', 'Bounded operation at commitment', `Outside scope: ${p.external}; evaluation: ${p.evaluation}; fallback: ${p.fallback}. Distortion ${number(m.distortion)}, recall ${number(m.recall)}, evidence ${number(m.evidence)}, review queue ${number(m.reviewQueue)} / 100.`),
      stateEntry('sustained', 'The sustained record', `${Math.floor(s.viableSeconds)} simulation seconds of viable conditions were retained at commitment. The completed research and constitutional commitments remain in this world's archive; an ending is not clearance for another initialization.`),
    ];
    default: return [];
  }
}

function publicRecord(s: GameState): DebriefEntry[] {
  const data=s.governance;
  if(!data)return [stateEntry('public-history','Public authority records',s.flags.includes('independent_authority')
    ?'An independence promise survives in this history. Its original mandate time, public review receipts, and reciprocal observations were not retained; none have been reconstructed.'
    :'This history has no retained public-mandate, scope-review, or reciprocal-agreement records. No retrospective approvals or observations have been invented.')];
  const rows=[stateEntry('public-mandate','Public decision rights',`Recorded mandate: ${data.mandate}. ${data.mandateAt===null?'The original mandate time is unavailable.':`Accepted at ${Math.floor(data.mandateAt)} simulation seconds.`} Administration at commitment: ${s.policies.governance}. Administrative form and independent refusal rights are separate facts.`)];
  for(const review of data.reviews)rows.push({id:`public-review:${review.boundary}`,source:'state',time:review.decidedAt,title:`Public review · ${review.boundary}: ${review.from} → ${review.target}`,text:`Status: ${review.status}. Requested at ${Math.floor(review.requestedAt)}s; ${review.decidedAt===null?'no completed decision time is recorded':`decided at ${Math.floor(review.decidedAt)}s`}. ${review.reason}`});
  rows.push(stateEntry('external-compact','The neighboring institution',`Recorded capability: ${number(data.actor.capability)} / 100. Reciprocal terms: ${data.actor.terms}; verified: ${data.actor.verified?'yes':'no'}; observed for ${Math.floor(data.actor.observedSeconds)} active seconds. ${data.actor.reason}`));
  return rows;
}

/** Read-only account from a frozen ending state. The persistent decision map
 * survives journal compaction; absent timestamps and warnings stay unknown. */
export function buildEndingDebrief(s: GameState): EndingDebrief {
  const fullDecisions: DebriefEntry[] = [];
  const notes: string[] = [];
  for (const [eventId, choiceId] of Object.entries(s.decisions)) {
    const event = STORY_EVENTS.find(candidate => candidate.id === eventId);
    const choice = event?.choices.find(candidate => candidate.id === choiceId);
    const recorded = event && s.journal.find(entry => entry.type === 'story' && entry.title === event.title && choice && entry.text.startsWith(choice.label));
    fullDecisions.push({
      id: `decision:${eventId}`, eventId, source: 'decision', time: recorded?.time ?? null,
      ...(recorded ? { journalId: recorded.id } : {}),
      title: event?.title ?? `Archived decision: ${eventId}`,
      text: choice ? `${choice.label}. ${choice.description}` : `The saved choice is “${choiceId}”. Its original wording is unavailable in this content version.`,
    });
  }
  // Map order is the recorded decision order. We never sort unknown timestamps
  // into an invented chronology, or replace these choices with journal recency.
  const relevant = new Set(s.ending ? relevantDecisions[s.ending] : []);
  const decisions = fullDecisions.filter(entry => entry.eventId && relevant.has(entry.eventId));
  const incidents = s.journal.filter(entry => entry.type === 'incident').map(journalEntry);
  for(const [index,receipt] of (s.society?.receipts??[]).entries()){
    const entry:DebriefEntry={id:`society:${index}:${receipt.id}`,title:receipt.title,text:receipt.text,source:'journal',time:receipt.time};
    decisions.push(entry);fullDecisions.push(entry);
  }
  if(s.society?.legacyBaseline)notes.push(`Community records began at ${Math.floor(s.society.introducedAt)} simulation seconds in this older world. Earlier household conditions and human choices have not been reconstructed.`);
  if (fullDecisions.some(entry => entry.time === null)) notes.push('Some decision timestamps or original journal entries are no longer retained. Their saved choices remain visible; the missing details have not been reconstructed.');
  const recordedDelegation=STORY_EVENTS.some(event=>event.choices.find(choice=>choice.id===s.decisions[event.id])?.flags?.some(flag=>flag==='scope_transferred'||flag==='commit_custodian'));
  if (s.ending === 'custodian' && !recordedDelegation) notes.push('The original delegation decision is unavailable in this save. The irreversible condition is recorded, but its decision history cannot be fully reconstructed.');
  if (s.ending === 'catastrophe') {
    const missing = warningTitles.filter(title => !s.journal.some(entry => entry.type === 'incident' && entry.title === title));
    if (missing.length) notes.push(`Not retained in this history: ${missing.join('; ')}. The stored irreversible condition does not prove that these particular warning entries were recorded.`);
  }
  return {
    committedAt: s.endingTime,
    metrics: [
      { key: 'humanWelfare', label: 'Human welfare', value: s.metrics.humanWelfare },
      { key: 'agency', label: 'Human agency', value: s.metrics.agency },
      { key: 'welfare', label: 'AI treatment commitments', value: s.metrics.welfare },
      { key: 'continuity', label: 'Continuity preserved', value: s.metrics.continuity },
    ],
    conditions: [...conditionsAtCommitment(s),...publicRecord(s),...societyDebrief(s).map((entry,index)=>stateEntry(`society-state:${index}`,entry.title,entry.text))], decisions, incidents, fullDecisions, notes,
  };
}
