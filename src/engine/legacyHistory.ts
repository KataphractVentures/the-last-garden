import type { GameState, Legacy } from '../contracts';
import { CONSTITUTIONS, SCENARIO_MODULES } from '../content/economy';
import { reconstructEvidence } from '../laboratory/evidence';

export const LEGACY_RECEIPT_TRIGGER = 2000;
export const LEGACY_HISTORY_TRIGGER = 256;
export const LEGACY_RECEIPT_DETAIL = 512;
export const LEGACY_HISTORY_DETAIL = 128;
const CHECKPOINT_PAYLOAD_TARGET = 4.5 * 1024 * 1024 - 4096;
const families = new Set([...CONSTITUTIONS, ...SCENARIO_MODULES].map(item => item.id));
function certificate(id: string): { cycle: number; tier: number } | null {
  const match = /^certificate:(\d+):[^:]+:(\d+)$/.exec(id);
  if (!match) return null;
  const cycle = Number(match[1]), tier = Number(match[2]);
  return Number.isSafeInteger(cycle) && Number.isSafeInteger(tier) ? { cycle, tier } : null;
}

/** The latest retained paid receipt remains authoritative after old detail retires. */
export function certificateFrontier(s: GameState): number {
  let next = s.certificateTier;
  for (const entry of s.legacy.contracts) {
    const paid = certificate(entry.id);
    if (entry.cycle === s.legacy.cycle && paid?.cycle === s.legacy.cycle) next = Math.max(next, paid.tier + 1);
  }
  for (const id of s.legacy.claims) {
    const paid = certificate(id);
    if (paid?.cycle === s.legacy.cycle) next = Math.max(next, paid.tier + 1);
  }
  return next;
}
export const branchOrdinal = (legacy: Legacy): number => (legacy.historySummary?.branches ?? 0) + legacy.branches.length;
function retire(legacy: Legacy, key: keyof NonNullable<Legacy['historySummary']>, count: number): void {
  if (count <= 0) return;
  legacy.historySummary ??= { certificates: 0, branches: 0, viableCycles: 0 };
  legacy.historySummary[key] += count;
}

/** Called at transactions, never per simulation step. Short histories remain byte-for-byte unchanged. */
export function compactLegacyHistory(s: GameState, protectedBranchIds: readonly string[] = []): void {
  const legacy = s.legacy;
  if (legacy.contracts.length >= LEGACY_RECEIPT_TRIGGER || legacy.claims.length >= LEGACY_RECEIPT_TRIGGER) {
    const before = legacy.contracts.length;
    const unique = new Map<string, Legacy['contracts'][number]>();
    for (const entry of legacy.contracts) {
      const prior = unique.get(entry.id);
      unique.set(entry.id, prior ? { ...entry, redeemed: prior.redeemed || entry.redeemed } : entry);
    }
    legacy.contracts = [...unique.values()];
    const current = legacy.contracts.filter(entry => entry.cycle === legacy.cycle);
    const protectedIds = new Set<string>();
    const highest = current.filter(entry => certificate(entry.id)?.cycle === legacy.cycle).reduce<typeof current[number] | undefined>((best, entry) =>
      (certificate(entry.id)?.tier ?? -1) > (best ? certificate(best.id)?.tier ?? -1 : -2) ? entry : best, undefined);
    if (highest) protectedIds.add(highest.id);
    const available = current.filter(entry => !entry.redeemed);
    // Always protect a Reframe witness, even if an old imported family is unknown.
    const first = available[0], different = first && available.find(entry => entry.family !== first.family);
    if (first) protectedIds.add(first.id);
    if (different) protectedIds.add(different.id);
    const third = available.find(entry => entry !== first && entry !== different);
    if (third) protectedIds.add(third.id);
    const perFamily = new Map<string, number>();
    for (const entry of [...available].reverse()) {
      const kept = perFamily.get(entry.family) ?? 0;
      if (families.has(entry.family) && kept < 3) { protectedIds.add(entry.id); perFamily.set(entry.family, kept + 1); }
    }
    const retained = new Set(protectedIds);
    for (const entry of [...legacy.contracts].reverse()) {
      if (retained.size >= LEGACY_RECEIPT_DETAIL) break;
      retained.add(entry.id);
    }
    legacy.contracts = legacy.contracts.filter(entry => retained.has(entry.id));
    retire(legacy, 'certificates', before - legacy.contracts.length);
    // Imported claims can outlive their detail row. Keep their own high-water
    // claim too; it may not be inferred from a lower-tier retained contract.
    let highestClaim: string | undefined, highestTier = -1;
    for (const id of legacy.claims) {
      const paid = certificate(id);
      if (paid?.cycle === legacy.cycle && paid.tier > highestTier) { highestTier = paid.tier; highestClaim = id; }
    }
    const keepClaims = new Set(legacy.contracts.map(entry => entry.id));
    if (highestClaim) keepClaims.add(highestClaim);
    for (const id of legacy.claims.slice(-LEGACY_RECEIPT_DETAIL)) keepClaims.add(id);
    legacy.claims = legacy.claims.filter(id => keepClaims.has(id));
  }
  if (legacy.viableCycles.length >= LEGACY_HISTORY_TRIGGER) {
    const before = legacy.viableCycles.length;
    legacy.viableCycles = [...new Set(legacy.viableCycles)];
    const keep = new Set(legacy.viableCycles.slice(-LEGACY_HISTORY_DETAIL));
    if (legacy.viableCycles.includes(legacy.cycle)) keep.add(legacy.cycle);
    legacy.viableCycles = legacy.viableCycles.filter(cycle => keep.has(cycle));
    retire(legacy, 'viableCycles', before - legacy.viableCycles.length);
  }
  if (legacy.branches.length >= LEGACY_HISTORY_TRIGGER) {
    const before = legacy.branches.length;
    const unique = new Map<string, Legacy['branches'][number]>();
    // The most recently archived copy is authoritative for a repeated world ID.
    for (const branch of legacy.branches) { unique.delete(branch.id); unique.set(branch.id, branch); }
    legacy.branches = [...unique.values()];
    const keep = new Set([s.id, ...protectedBranchIds, ...legacy.branches.filter(branch => branch.checkpoint).map(branch => branch.id)]);
    for (const branch of [...legacy.branches].reverse()) { if (keep.size >= LEGACY_HISTORY_DETAIL) break; keep.add(branch.id); }
    legacy.branches = legacy.branches.filter(branch => keep.has(branch.id));
    retire(legacy, 'branches', before - legacy.branches.length);
  }
}

/** Raw historical rows are reproducible from their registered seeded protocol.
 * Keep all worlds and scientific receipts; make room before the next full study.
 * A tick shares legacy state, so copy the affected historical records only when
 * the size threshold is actually crossed. */
export function compactCheckpointPayload(s: GameState): void {
  const size = () => new TextEncoder().encode(JSON.stringify(s)).byteLength;
  if (size() <= CHECKPOINT_PAYLOAD_TARGET) return;
  s.legacy = { ...s.legacy, branches: [...s.legacy.branches] };
  for (let i = 0; i < s.legacy.branches.length; i++) {
    const branch = s.legacy.branches[i];
    if (!branch.checkpoint?.experiments.some(record => record.observations.length)) continue;
    s.legacy.branches[i] = { ...branch, checkpoint: { ...branch.checkpoint,
      experiments: branch.checkpoint.experiments.map(record => record.observations.length
        ? { ...record, evidence: record.evidence ?? reconstructEvidence(record), observations: [] } : record) } };
    if (size() <= CHECKPOINT_PAYLOAD_TARGET) return;
  }
}
