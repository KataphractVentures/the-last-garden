export function mix(from: string, to: string, amount: number) {
  const channel = (hex: string, index: number) => parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16);
  return "#" + [0, 1, 2].map(index => Math.round(channel(from, index) + (channel(to, index) - channel(from, index)) * amount).toString(16).padStart(2, "0")).join("");
}
export const shade = (hex: string, factor: number) => mix("#000000", hex, factor);
