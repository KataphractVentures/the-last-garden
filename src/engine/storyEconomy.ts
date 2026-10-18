import type { Amount, GameState } from '../contracts';
import type { StoryEffects } from '../content/story';
import { Decimal, amount, decimal, scaleFor } from './amounts';

/** Narrative support is a small dividend on actual work, never a production source. */
export const STORY_GRANT_FRACTION = '0.1';
/** One tuning point for authored sacrifices; grants never use this multiplier. */
export const STORY_COST_MULTIPLIER = 0.7;
export const STORY_ACCOUNTING_PREFIXES = [
  'story-earned-tokens', 'story-earned-research', 'story-granted-tokens', 'story-granted-research',
] as const;
type Currency = 'tokens' | 'research';
// A payable remainder must never round upward. Otherwise subtracting a prior
// grant and adding the rounded remainder can exceed an exact cap by one ULP.
// Keep this directed arithmetic local; production and prices retain their own
// normal rounding rules.
const AllowanceDecimal = Decimal.clone({ precision: Decimal.precision, rounding: Decimal.ROUND_DOWN });
const allowanceDifference = (total: Amount, used: Amount): Amount => amount(new AllowanceDecimal(total).sub(used).toString());
interface StoryBudget {
  earned: Amount;
  granted: Amount;
  maxBudget: Amount;
  remainingBudget: Amount;
}
export interface StoryCurrencyPreview extends StoryBudget {
  cost: Amount;
  nominalGrant: Amount;
  grant: Amount;
  pledged: Amount;
  debtRepayment: Amount;
  treasuryGain: Amount;
}

const value = (s: GameState, key: string): Amount => s.flags.find(f => f.startsWith(`${key}:`))?.slice(key.length + 1) || '0';
function set(s: GameState, key: string, next: Amount): void {
  s.flags = s.flags.filter(f => !f.startsWith(`${key}:`));
  s.flags.push(`${key}:${next}`);
}
export function isStoryAccountingFlag(flag: string): boolean {
  return flag.startsWith('story-earned-') || flag.startsWith('story-granted-');
}

/**
 * Version-one saves did not distinguish earned income from story support.
 * Keep their historical balances and achieved progression. Start the new ledger
 * at zero; historical output cannot create a fresh windfall on migration.
 */
export function initializeStoryAccounting(s: GameState): void {
  for (const key of STORY_ACCOUNTING_PREFIXES) {
    if (!s.flags.some(f => f.startsWith(`${key}:`))) set(s, key, '0');
  }
}

export function getStoryEconomy(s: GameState): { initialized: boolean; tokens: StoryBudget; research: StoryBudget } {
  const budget = (currency: Currency): StoryBudget => {
    const earned = value(s, `story-earned-${currency}`), granted = value(s, `story-granted-${currency}`);
    const maxBudget = decimal(earned).mul(STORY_GRANT_FRACTION);
    return { earned, granted, maxBudget: amount(maxBudget), remainingBudget: allowanceDifference(amount(maxBudget), granted) };
  };
  return { initialized: STORY_ACCOUNTING_PREFIXES.every(key => s.flags.some(f => f.startsWith(`${key}:`))), tokens: budget('tokens'), research: budget('research') };
}

/** Call only for newly produced income: refunds and transfers must not qualify. */
export function recordEarnedIncome(s: GameState, currency: Currency, income: Decimal): void {
  const key = `story-earned-${currency}`;
  // Fresh games and validated migrated ledgers already contain all four keys.
  // Avoid rescanning all four entries on every simulation quarter-step.
  if (!s.flags.some(f => f.startsWith(`${key}:`))) initializeStoryAccounting(s);
  if (income.gt(0)) set(s, key, amount(decimal(value(s, key)).add(income)));
}

/** The shared quote used by story cards, command execution, and player simulations. */
export function previewStoryEconomy(s: GameState, effects: StoryEffects): { tokens: StoryCurrencyPreview; research: StoryCurrencyPreview } {
  const ledger = getStoryEconomy(s);
  const replayCycle = s.flags.find(f => f.startsWith('replay-cycle:'))?.slice('replay-cycle:'.length);
  const scale = scaleFor(replayCycle === undefined ? s.legacy.cycle : Number(replayCycle));
  const quote = (currency: Currency): StoryCurrencyPreview => {
    const delta = scale.mul(effects[currency] || 0);
    const cost = delta.lt(0) ? delta.abs().mul(STORY_COST_MULTIPLIER) : decimal(0);
    const nominalGrant = Decimal.max(0, delta);
    const grant = Decimal.min(nominalGrant, ledger[currency].remainingBudget);
    const debt = value(s, currency === 'tokens' ? 'story-debt' : 'research-debt');
    const debtRepayment = Decimal.min(debt, grant);
    return { ...ledger[currency], cost: amount(cost), nominalGrant: amount(nominalGrant), grant: amount(grant),
      pledged: amount(cost.sub(s[currency])), debtRepayment: amount(debtRepayment), treasuryGain: allowanceDifference(amount(grant), amount(debtRepayment)) };
  };
  return { tokens: quote('tokens'), research: quote('research') };
}

/** Applies only treasury transfers and obligations. Lifetime and usefulness stay earned. */
export function applyStoryEconomy(s: GameState, effects: StoryEffects): ReturnType<typeof previewStoryEconomy> {
  initializeStoryAccounting(s);
  const preview = previewStoryEconomy(s, effects);
  for (const currency of ['tokens', 'research'] as const) {
    const quote = preview[currency];
    const debtKey = currency === 'tokens' ? 'story-debt' : 'research-debt';
    if (decimal(quote.pledged).gt(0) || decimal(quote.debtRepayment).gt(0)) {
      set(s, debtKey, amount(decimal(value(s, debtKey)).add(quote.pledged).sub(quote.debtRepayment)));
    }
    s[currency] = amount(Decimal.max(0, decimal(s[currency]).sub(quote.cost)).add(quote.treasuryGain));
    if (decimal(quote.grant).gt(0)) set(s, `story-granted-${currency}`, amount(Decimal.min(quote.maxBudget, decimal(quote.granted).add(quote.grant))));
  }
  return preview;
}
