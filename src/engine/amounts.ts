import Decimal from 'decimal.js';

// Currency never passes through Number. Thirty-six significant digits leave ample
// headroom for geometric purchases while supporting thousands of scale changes.
Decimal.set({ precision: 48, rounding: Decimal.ROUND_HALF_UP, toExpNeg: -9, toExpPos: 24 });
export { Decimal };
export const decimal = (value: string | number | Decimal = 0): Decimal => new Decimal(value);
export const amount = (value: string | number | Decimal): string => Decimal.max(0, decimal(value)).toString();
export const scaleFor = (cycle: number): Decimal => new Decimal(10).pow(6 * Math.max(0, Math.floor(cycle)));
export const clamp = (value: number, min = 0, max = 100): number => Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
export function formatAmount(value: string | number, notation = 'compact'): string {
  let n: Decimal;
  try { n = decimal(value); } catch { return '0'; }
  if (!n.isFinite()) return '0';
  if (n.abs().lt(1000)) return n.toFixed(n.abs().lt(10) && !n.isInteger() ? 1 : 0);
  if (notation === 'scientific' || n.abs().gte('1e36')) return n.toExponential(2).replace('e+', 'e');
  const suffixes = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc'];
  const tier = Math.min(suffixes.length - 1, Math.floor(n.e / 3));
  return `${n.div(new Decimal(1000).pow(tier)).toFixed(2).replace(/\.00$/, '')}${suffixes[tier]}`;
}
