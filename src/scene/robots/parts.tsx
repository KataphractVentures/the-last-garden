/** Drawing parts for the robot gardeners, in robot units: a 240 × 320 box, feet on y ≈ 318, centre line x = 120.
 * Unmirrored, a robot faces right: its "near" arm (x > 120) waves and points, its "far" arm carries the accessory.
 * Signatures (what sits on or around each head) are in signatures.tsx. */
import type { ReactNode } from "react";
import { MONO } from "../fonts";
import { mix, shade } from "../lib/iso";
import type { Accessory, BodyShape, HeadShape } from "./cast";
import { type Expression, SMILING } from "./expressions";
import type { Arm } from "./motion";

export const OUTLINE = "#0b110b";
export type Pt = [number, number];

type BodyGeometry = { d: string; top: number; shoulders: { near: Pt; far: Pt }; hips: { near: Pt; far: Pt }; chest: Pt };
export const BODIES: Record<BodyShape, BodyGeometry> = {
  pebble: { d: "M64 222C64 182 90 168 120 168C152 168 176 182 176 224C176 258 152 272 120 272C88 272 64 256 64 222Z", top: 168, shoulders: { near: [168, 196], far: [72, 196] }, hips: { near: [138, 266], far: [102, 266] }, chest: [120, 214] },
  capsule: { d: "M120 168A46 46 0 0 1 166 214V226A46 46 0 0 1 120 272A46 46 0 0 1 74 226V214A46 46 0 0 1 120 168Z", top: 168, shoulders: { near: [162, 198], far: [78, 198] }, hips: { near: [136, 266], far: [104, 266] }, chest: [120, 214] },
  boxy: { d: "M76 172H164Q178 172 178 186V256Q178 270 164 270H76Q62 270 62 256V186Q62 172 76 172Z", top: 172, shoulders: { near: [174, 194], far: [66, 194] }, hips: { near: [140, 266], far: [100, 266] }, chest: [120, 216] },
  teardrop: { d: "M120 166C134 186 174 206 174 234C174 258 150 274 120 274C90 274 66 258 66 234C66 206 106 186 120 166Z", top: 166, shoulders: { near: [154, 210], far: [86, 210] }, hips: { near: [138, 268], far: [102, 268] }, chest: [120, 238] },
  plain: { d: "M96 170H144Q168 170 168 194V246Q168 270 144 270H96Q72 270 72 246V194Q72 170 96 170Z", top: 170, shoulders: { near: [164, 196], far: [76, 196] }, hips: { near: [136, 266], far: [104, 266] }, chest: [120, 214] },
};

type Screen = { x: number; y: number; w: number; h: number; r: number };
type HeadGeometry = { d: string; screen: Screen; anchor: Pt; neck: number };
export const HEADS: Record<HeadShape, HeadGeometry> = {
  rounded: { d: "M90 50H150Q182 50 182 82V128Q182 160 150 160H90Q58 160 58 128V82Q58 50 90 50Z", screen: { x: 72, y: 70, w: 96, h: 70, r: 18 }, anchor: [120, 50], neck: 30 },
  dome: { d: "M60 156V112A60 60 0 0 1 180 112V156Q180 162 174 162H66Q60 162 60 156Z", screen: { x: 74, y: 96, w: 92, h: 56, r: 18 }, anchor: [120, 52], neck: 28 },
  // DeepSeek's brass diving helmet: a bonnet whose round front porthole is the face-screen.
  helmet: { d: "M58 99A62 62 0 1 0 182 99A62 62 0 1 0 58 99Z", screen: { x: 85, y: 66, w: 70, h: 70, r: 35 }, anchor: [50, 58], neck: 30 },
  round: { d: "M62 98A58 58 0 1 0 178 98A58 58 0 1 0 62 98Z", screen: { x: 80, y: 72, w: 80, h: 58, r: 29 }, anchor: [120, 40], neck: 14 },
  plain: { d: "M84 58H156Q178 58 178 80V138Q178 160 156 160H84Q62 160 62 138V80Q62 58 84 58Z", screen: { x: 76, y: 76, w: 88, h: 64, r: 14 }, anchor: [120, 58], neck: 28 },
};

/** Where the head turns when it tilts. */
export const NECK_PIVOT: Pt = [120, 160];
export const limbColor = (color: string) => mix("#5b6656", color, 0.22);

const rad = (degrees: number) => (degrees * Math.PI) / 180;

/** Elbow and hand of an arm. `side` +1 is the near (facing) side, -1 the far side. */
export function armJoints(shoulder: Pt, arm: Arm, side: 1 | -1, upper = 32, fore = 30) {
  const elbow: Pt = [shoulder[0] + side * upper * Math.sin(rad(arm.a)), shoulder[1] + upper * Math.cos(rad(arm.a))];
  const hand: Pt = [elbow[0] + side * fore * Math.sin(rad(arm.a + arm.b)), elbow[1] + fore * Math.cos(rad(arm.a + arm.b))];
  return { elbow, hand };
}

export function Limb({ points, color, width = 13 }: { points: Pt[]; color: string; width?: number }) {
  const d = points.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join("");
  return <>
    <path d={d} fill="none" stroke={OUTLINE} strokeWidth={width + 6} strokeLinecap="round" strokeLinejoin="round" />
    <path d={d} fill="none" stroke={color} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" />
  </>;
}

export function ArmPart({ shoulder, arm, side, color }: { shoulder: Pt; arm: Arm; side: 1 | -1; color: string }) {
  const { elbow, hand } = armJoints(shoulder, arm, side);
  return <g>
    <Limb points={[shoulder, elbow, hand]} color={limbColor(color)} />
    <circle cx={hand[0]} cy={hand[1]} r={10} fill={limbColor(color)} stroke={OUTLINE} strokeWidth={3} />
  </g>;
}

export function LegPart({ hip, angle, color }: { hip: Pt; angle: number; color: string }) {
  const ankle: Pt = [hip[0] - 34 * Math.sin(rad(angle)), hip[1] + 34 * Math.cos(rad(angle))];
  return <g>
    <Limb points={[hip, ankle]} color={limbColor(color)} width={14} />
    <rect x={ankle[0] - 18} y={ankle[1] + 2} width={36} height={16} rx={8} fill={shade(color, 0.62)} stroke={OUTLINE} strokeWidth={3} />
  </g>;
}

/** Body with flat two-tone shading, and the demo robot's panel (plain). The maker's badge goes on its `chest`. */
export function BodyPart({ shape, color, uid }: { shape: BodyShape; color: string; uid: string }) {
  const g = BODIES[shape];
  const [cx, cy] = g.chest;
  return <g>
    <clipPath id={`${uid}-body`}><path d={g.d} /></clipPath>
    <path d={g.d} fill={color} />
    <g clipPath={`url(#${uid}-body)`}>
      <ellipse cx={170} cy={262} rx={80} ry={70} fill={shade(color, 0.78)} opacity={0.6} />
      <ellipse cx={92} cy={g.top + 18} rx={30} ry={12} fill="#ffffff" opacity={0.2} />
    </g>
    <path d={g.d} fill="none" stroke={OUTLINE} strokeWidth={3.2} />
    {shape === "plain" ? <g>
      <rect x={cx - 15} y={cy - 9} width={30} height={20} rx={4} fill={shade(color, 0.8)} stroke={OUTLINE} strokeWidth={2.5} />
      <circle cx={cx + 7} cy={cy + 1} r={3} fill="#e8eee0" />
    </g> : null}
  </g>;
}

function star(points: number, outer: number, inner: number) {
  return Array.from({ length: points * 2 }, (_, i) => {
    const r = i % 2 ? inner : outer, a = (Math.PI * i) / points - Math.PI / 2;
    return `${i ? "L" : "M"}${(r * Math.cos(a)).toFixed(2)} ${(r * Math.sin(a)).toFixed(2)}`;
  }).join("") + "Z";
}
export const starPath = star;

/** DeepSeek's diving helmet: polished brass. */
export const BRASS = { base: "#d9a64c", shade: "#a8762f", light: "#f4d68f", dark: "#7a521d" } as const;
export const bolt = (x: number, y: number, key: string | number, r = 2.8) => <g key={key}><circle cx={x} cy={y} r={r} fill={BRASS.dark} stroke={OUTLINE} strokeWidth={1.4} /><circle cx={x - r * 0.3} cy={y - r * 0.3} r={r * 0.35} fill={BRASS.light} /></g>;

export function NeckPart({ head, bodyTop, color }: { head: HeadShape; bodyTop: number; color: string }) {
  if (head === "helmet") return <Corselet />;
  const w = HEADS[head].neck;
  return <rect x={120 - w / 2} y={150} width={w} height={bodyTop - 146} rx={Math.min(6, w / 2)} fill={shade(limbColor(color), 0.8)} stroke={OUTLINE} strokeWidth={3} />;
}

/** The helmet's corselet: the bolted brass collar it sits in, resting on the shoulders (it does not turn with the head). */
export function Corselet() {
  const plate = "M48 162C62 146 178 146 192 162L196 174C172 188 68 188 44 174Z";
  return <g>
    <path d={plate} fill={BRASS.base} />
    <path d="M45 170C70 182 170 182 195 170L196 174C172 188 68 188 44 174Z" fill={BRASS.shade} />
    <path d={plate} fill="none" stroke={OUTLINE} strokeWidth={3} strokeLinejoin="round" />
    <ellipse cx={120} cy={155} rx={47} ry={10} fill={BRASS.shade} stroke={OUTLINE} strokeWidth={2.6} />
    {[[60, 167], [88, 175], [120, 177], [152, 175], [180, 167]].map(([x, y], i) => bolt(x!, y!, i))}
  </g>;
}

export function HeadShell({ shape, color, uid }: { shape: HeadShape; color: string; uid: string }) {
  if (shape === "helmet") return <HelmetShell uid={uid} />;
  const g = HEADS[shape];
  return <g>
    <clipPath id={`${uid}-head`}><path d={g.d} /></clipPath>
    <path d={g.d} fill={color} />
    <g clipPath={`url(#${uid}-head)`}>
      <ellipse cx={176} cy={156} rx={70} ry={52} fill={shade(color, 0.8)} opacity={0.55} />
      <ellipse cx={86} cy={g.screen.y - 8} rx={22} ry={8} fill="#ffffff" opacity={0.22} />
    </g>
    <path d={g.d} fill="none" stroke={OUTLINE} strokeWidth={3.2} />
  </g>;
}

/** The helmet's bonnet: a brass sphere with side ports and, on its back, an exhaust valve (its outlet is the head's
 * `anchor`). The "diver" signature draws the front porthole's rim over the face-screen, and the bubbles. */
function HelmetShell({ uid }: { uid: string }) {
  const g = HEADS.helmet;
  const valve = "M68 74H58Q50 74 50 66V62";
  const port = (x: number) => <g>
    <ellipse cx={x} cy={96} rx={10} ry={17} fill={BRASS.light} stroke={OUTLINE} strokeWidth={2.6} />
    <ellipse cx={x} cy={96} rx={5} ry={11} fill="#14252b" stroke={OUTLINE} strokeWidth={2} />
  </g>;
  return <g>
    <path d={valve} fill="none" stroke={OUTLINE} strokeWidth={11} strokeLinecap="round" strokeLinejoin="round" />
    <path d={valve} fill="none" stroke={BRASS.base} strokeWidth={5.5} strokeLinecap="round" strokeLinejoin="round" />
    <circle cx={50} cy={60} r={5} fill={BRASS.light} stroke={OUTLINE} strokeWidth={2.4} />
    <clipPath id={`${uid}-head`}><path d={g.d} /></clipPath>
    <path d={g.d} fill={BRASS.base} />
    <g clipPath={`url(#${uid}-head)`}>
      <ellipse cx={176} cy={152} rx={80} ry={64} fill={BRASS.shade} opacity={0.6} />
      <ellipse cx={86} cy={60} rx={24} ry={9} transform="rotate(-36 86 60)" fill="#ffffff" opacity={0.34} />
      {port(64)}{port(176)}
    </g>
    <path d={g.d} fill="none" stroke={OUTLINE} strokeWidth={3.2} />
  </g>;
}

/** The face-screen: dark glass with the features glowing in the robot's colour. `mouth` (0–9) opens the mouth while talking. */
export function ScreenPart({ head, color, expression, mouth, blink, dim, uid }: { head: HeadShape; color: string; expression: Expression; mouth?: number; blink: number; dim: number; uid: string }) {
  const s = HEADS[head].screen;
  const cx = s.x + s.w / 2, cy = s.y + s.h / 2;
  return <g>
    <rect x={s.x} y={s.y} width={s.w} height={s.h} rx={s.r} fill="#0a0f0a" stroke={OUTLINE} strokeWidth={3} />
    <rect x={s.x + 4} y={s.y + 4} width={s.w - 8} height={s.h - 8} rx={Math.max(4, s.r - 4)} fill={color} opacity={0.07 * (1 - dim)} />
    <path d={`M${s.x + s.r * 0.7} ${s.y + 6}H${s.x + s.w - s.r * 0.7}`} stroke="#ffffff" strokeOpacity={0.12} strokeWidth={2.5} strokeLinecap="round" />
    <g filter={dim < 0.5 ? `url(#${uid}-glow)` : undefined} opacity={1 - 0.65 * dim}>
      <Face expression={expression} mouth={mouth} blink={blink} color={color} cx={cx} cy={cy} w={s.w} h={s.h} />
    </g>
  </g>;
}

const SW = 4.4;

function Face({ expression, mouth, blink, color, cx, cy, w, h }: { expression: Expression; mouth?: number; blink: number; color: string; cx: number; cy: number; w: number; h: number }) {
  const k = h / 70, ex = Math.min(w * 0.2, 26), ey = -h * 0.1, my = h * 0.22;
  const at = (x: number, y: number, children: ReactNode, mirror = false) => <g transform={`translate(${(cx + x).toFixed(2)} ${(cy + y).toFixed(2)}) scale(${(mirror ? -k : k).toFixed(3)} ${k.toFixed(3)})`}>{children}</g>;
  const stroke = { fill: "none", stroke: color, strokeWidth: SW, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

  if (expression === "offline") {
    return <g opacity={0.8}>
      {[0, 1, 2].map(i => <rect key={i} x={cx - 15 + i * 11} y={cy + 9 - (i + 1) * 7} width={7} height={(i + 1) * 7} rx={1.5} fill="#56604f" />)}
      <path d={`M${cx + 13} ${cy - 17}l9 9m0 -9l-9 9`} stroke="#f0aa98" strokeWidth={3.2} strokeLinecap="round" />
    </g>;
  }

  const pill = (scaleY = 1, height = 20) => { const hh = height * Math.max(0.12, scaleY * (1 - 0.88 * blink)); return <rect x={-6} y={-hh / 2} width={12} height={hh} rx={6} fill={color} />; };
  const eye = (side: 1 | -1) => {
    switch (expression) {
      case "happy": return <path d="M-8 3Q0 -9 8 3" {...stroke} />;
      case "delighted": return <path d="M-9 4Q0 -11 9 4" {...stroke} strokeWidth={SW + 0.6} />;
      case "proud": return <path d="M-8 1Q0 -5 8 1" {...stroke} />;
      case "asleep": return <path d="M-8 1H8" {...stroke} />;
      case "surprised": return <circle r={8} fill={color} />;
      case "focused": return <rect x={-7} y={-4} width={14} height={8 * (1 - 0.8 * blink)} rx={4} fill={color} />;
      case "thinking": return side === 1 ? <g transform="translate(1 -4)">{pill(0.75)}</g> : pill();
      case "sheepish": return <g transform="translate(-3 3)"><path d="M-7 2Q0 -6 7 2" {...stroke} /></g>;
      case "wistful": case "capped": return <g><rect x={-6} y={-1} width={12} height={9 * (1 - 0.85 * blink)} rx={4.5} fill={color} /><path d="M-8 -3H8" {...stroke} strokeWidth={3} /></g>;
      case "starry": return <path d={starPath(5, 10, 4.2)} fill={color} />;
      default: return pill();
    }
  };
  const brow = (side: 1 | -1) => {
    if (expression === "worried") return <path d="M-8 -17L6 -21" {...stroke} strokeWidth={3.4} />;
    if (expression === "focused") return <path d="M-8 -18.5L6 -16" {...stroke} strokeWidth={3.2} />;
    return null;
  };

  let mouthShape: ReactNode;
  const level = mouth ?? 0;
  if (expression === "capped") {
    mouthShape = <g>
      <path d="M-11 6A11 11 0 0 1 11 6" fill="none" stroke="#56604f" strokeWidth={3} strokeLinecap="round" />
      <path d="M0 6L10 1" stroke="#f8ce8e" strokeWidth={3} strokeLinecap="round" /><circle cx={0} cy={6} r={2.5} fill="#f8ce8e" />
    </g>;
  } else if (level >= 6) {
    mouthShape = SMILING.has(expression) ? <path d="M-11 -2Q0 14 11 -2Z" fill={color} /> : <ellipse cx={0} cy={2} rx={10} ry={7} fill={color} />;
  } else if (level >= 3) {
    mouthShape = SMILING.has(expression) ? <path d="M-9 -1Q0 9 9 -1Z" fill={color} /> : <ellipse cx={0} cy={1} rx={7} ry={4.5} fill={color} />;
  } else if (level >= 1) {
    mouthShape = <rect x={-8} y={-1.5} width={16} height={3.4} rx={1.7} fill={color} />;
  } else {
    switch (expression) {
      case "happy": case "proud": mouthShape = <path d="M-10 -2Q0 8 10 -2" {...stroke} />; break;
      case "delighted": case "starry": mouthShape = <path d="M-11 -3Q0 13 11 -3Z" fill={color} />; break;
      case "focused": mouthShape = <path d="M-5 1H5" {...stroke} />; break;
      case "thinking": mouthShape = <path d="M-1 1H9" {...stroke} />; break;
      case "surprised": mouthShape = <circle cx={0} cy={2} r={4.6} fill="none" stroke={color} strokeWidth={SW - 0.6} />; break;
      case "sheepish": mouthShape = <path d="M-8 1Q-4 -2 0 1T8 1" {...stroke} />; break;
      case "worried": mouthShape = <path d="M-9 4Q0 -4 9 4" {...stroke} />; break;
      case "wistful": mouthShape = <path d="M-6 2Q0 -1 6 2" {...stroke} />; break;
      case "asleep": mouthShape = <path d="M-4 1H4" {...stroke} />; break;
      default: mouthShape = <path d="M-7 1H7" {...stroke} />;
    }
  }

  return <g>
    {at(-ex, ey, eye(-1))}
    {at(ex, ey, eye(1))}
    {at(-ex, ey, brow(-1))}
    {at(ex, ey, brow(1), true)}
    {expression === "sheepish" ? <g stroke="#f2abc2" strokeWidth={2.4} strokeLinecap="round" opacity={0.85}>{at(-ex - 2, ey + 13, <path d="M-6 0l3 -3M0 0l3 -3" />)}{at(ex - 2, ey + 13, <path d="M-6 0l3 -3M0 0l3 -3" />)}</g> : null}
    {expression === "thinking" ? at(ex + 18, ey - 16, <g fill={color}><circle cx={0} cy={0} r={2.2} /><circle cx={6} cy={-4} r={2.6} /><circle cx={13} cy={-9} r={3} /></g>) : null}
    {at(0, my, mouthShape)}
  </g>;
}

/** What each robot carries, drawn at its far hand. Fable's satchel is worn across the body instead. */
export function AccessoryPart({ kind, hand, color }: { kind: Accessory; hand: Pt; color: string }) {
  const [hx, hy] = hand;
  const o = { stroke: OUTLINE, strokeWidth: 2.6, strokeLinejoin: "round" as const };
  switch (kind) {
    // Opus's conductor's baton, held up and pointing a little forward.
    case "baton": return <g transform={`translate(${hx} ${hy}) rotate(24)`}>
      <path d="M0 0V-44" stroke={OUTLINE} strokeWidth={6.6} strokeLinecap="round" /><path d="M0 0V-44" stroke="#fbf7ea" strokeWidth={3.2} strokeLinecap="round" />
      <ellipse cx={0} cy={-2} rx={3.6} ry={6.4} fill={mix("#b98a5a", color, 0.15)} {...o} strokeWidth={2} />
    </g>;
    case "watering-can": return <g transform={`translate(${hx - 18} ${hy + 8})`}>
      <path d="M-4 9L-18 -2" stroke={OUTLINE} strokeWidth={7} strokeLinecap="round" /><path d="M-4 9L-18 -2" stroke="#86bdb3" strokeWidth={3.5} strokeLinecap="round" />
      <ellipse cx={-20} cy={-3} rx={4} ry={5.5} fill="#86bdb3" {...o} />
      <path d="M8 2Q18 -14 30 2" fill="none" stroke={OUTLINE} strokeWidth={6} /><path d="M8 2Q18 -14 30 2" fill="none" stroke="#86bdb3" strokeWidth={3} />
      <rect x={0} y={2} width={36} height={26} rx={5} fill="#86bdb3" {...o} /><path d="M4 9H32" stroke="#ffffff" strokeOpacity={0.35} strokeWidth={2.5} strokeLinecap="round" />
    </g>;
    case "magnifier": return <g>
      <path d={`M${hx} ${hy}L${hx - 10} ${hy - 13}`} stroke={OUTLINE} strokeWidth={9} strokeLinecap="round" /><path d={`M${hx} ${hy}L${hx - 10} ${hy - 13}`} stroke="#9a7650" strokeWidth={5} strokeLinecap="round" />
      <circle cx={hx - 17} cy={hy - 23} r={12} fill="#cfe6ff" fillOpacity={0.45} stroke={OUTLINE} strokeWidth={4.5} /><circle cx={hx - 17} cy={hy - 23} r={12} fill="none" stroke="#b7c1b0" strokeWidth={2} />
      <path d={`M${hx - 23} ${hy - 28}q4 -4 9 -3`} stroke="#ffffff" strokeWidth={2.2} strokeLinecap="round" fill="none" opacity={0.8} />
    </g>;
    case "star-trowel": return <g>
      <rect x={hx - 3.5} y={hy - 12} width={7} height={22} rx={3} fill="#b78c5c" {...o} />
      <path d={`M${hx - 9} ${hy + 10}H${hx + 9}L${hx} ${hy + 34}Z`} fill="#cfd6c8" {...o} />
      <path d={starPath(5, 7, 3)} transform={`translate(${hx} ${hy - 17})`} fill="#f6e27a" {...o} strokeWidth={1.8} />
    </g>;
    case "contract": return <g transform={`translate(${hx} ${hy}) rotate(-20)`}>
      <rect x={-22} y={-8} width={44} height={16} rx={8} fill="#f4ead2" {...o} />
      <ellipse cx={-22} cy={0} rx={5} ry={8} fill="#e6d6ad" {...o} /><ellipse cx={22} cy={0} rx={5} ry={8} fill="#e6d6ad" {...o} />
      <rect x={-3.5} y={-8.5} width={7} height={17} fill="#d0564c" stroke={OUTLINE} strokeWidth={1.8} />
    </g>;
    case "lantern": return <g>
      <circle cx={hx} cy={hy + 26} r={22} fill="#ffe7a3" opacity={0.18} />
      <path d={`M${hx} ${hy}V${hy + 9}`} stroke={OUTLINE} strokeWidth={3} />
      <rect x={hx - 9} y={hy + 9} width={18} height={6} rx={2} fill="#6b7766" {...o} />
      <rect x={hx - 10} y={hy + 15} width={20} height={22} rx={5} fill="#ffe7a3" {...o} />
      <path d={`M${hx - 4} ${hy + 19}V${hy + 33}M${hx + 4} ${hy + 19}V${hy + 33}`} stroke="#e0b860" strokeWidth={1.6} />
      <rect x={hx - 9} y={hy + 37} width={18} height={5} rx={2} fill="#6b7766" {...o} />
    </g>;
    case "hoe": return <g>
      <path d={`M${hx} ${hy - 44}V${hy + 62}`} stroke={OUTLINE} strokeWidth={10} strokeLinecap="round" /><path d={`M${hx} ${hy - 44}V${hy + 62}`} stroke="#b78c5c" strokeWidth={5.5} strokeLinecap="round" />
      <path d={`M${hx - 2} ${hy + 56}H${hx + 20}L${hx + 22} ${hy + 70}H${hx + 2}Z`} fill="#cfd6c8" {...o} />
    </g>;
    case "clover": {
      const top: Pt = [hx + 3, hy - 30];
      return <g>
        <path d={`M${hx} ${hy}Q${hx + 6} ${hy - 14} ${top[0]} ${top[1]}`} fill="none" stroke={OUTLINE} strokeWidth={6} strokeLinecap="round" />
        <path d={`M${hx} ${hy}Q${hx + 6} ${hy - 14} ${top[0]} ${top[1]}`} fill="none" stroke="#4f8c3c" strokeWidth={3} strokeLinecap="round" />
        {[[-6, -6], [6, -6], [-6, 6], [6, 6]].map(([dx, dy], i) => <circle key={i} cx={top[0] + dx!} cy={top[1] + dy!} r={6.5} fill="#6cc04a" stroke={OUTLINE} strokeWidth={2} />)}
        <circle cx={top[0]} cy={top[1]} r={2.4} fill="#4f8c3c" />
      </g>;
    }
    case "satchel": return null;
  }
}

/** Fable's satchel of letters, worn across the body from the near shoulder to the far hip. */
export function SatchelPart({ shoulder, hip }: { shoulder: Pt; hip: Pt }) {
  const [bx, by] = [hip[0] - 18, hip[1] - 30];
  return <g>
    <path d={`M${shoulder[0]} ${shoulder[1] - 4}L${hip[0] - 4} ${hip[1] - 22}`} stroke={OUTLINE} strokeWidth={9} strokeLinecap="round" />
    <path d={`M${shoulder[0]} ${shoulder[1] - 4}L${hip[0] - 4} ${hip[1] - 22}`} stroke="#9a5f45" strokeWidth={5} strokeLinecap="round" />
    <rect x={bx + 6} y={by - 7} width={12} height={14} rx={1.5} fill="#f4f0e3" stroke={OUTLINE} strokeWidth={2} transform={`rotate(-12 ${bx + 12} ${by})`} />
    <rect x={bx + 16} y={by - 9} width={13} height={15} rx={1.5} fill="#fdfbf3" stroke={OUTLINE} strokeWidth={2} transform={`rotate(10 ${bx + 22} ${by})`} />
    <path d={`M${bx + 17} ${by - 7}l6 5 6 -5`} fill="none" stroke="#c9a088" strokeWidth={1.6} transform={`rotate(10 ${bx + 22} ${by})`} />
    <rect x={bx} y={by} width={40} height={30} rx={7} fill="#b4765c" stroke={OUTLINE} strokeWidth={2.8} />
    <path d={`M${bx} ${by + 4}Q${bx + 20} ${by + 20} ${bx + 40} ${by + 4}`} fill="#9a5f45" stroke={OUTLINE} strokeWidth={2.4} />
    <circle cx={bx + 20} cy={by + 12} r={2.6} fill="#f1d27a" stroke={OUTLINE} strokeWidth={1.4} />
  </g>;
}

/** Celebration sparkles, work puffs (abstract glyphs, never code) and sleep z's. Positions are in unmirrored robot units. */
export function Overlays({ sparkle, puff, zzz, color, seed, mirror }: { sparkle: number; puff: number; zzz: number; color: string; seed: number; mirror: (x: number) => number }) {
  const light = mix(color, "#ffffff", 0.5);
  const items: ReactNode[] = [];
  if (sparkle >= 0) {
    for (let i = 0; i < 10; i++) {
      const start = i * 3, life = 20, d = sparkle - start;
      if (d < 0 || d > life) continue;
      const angle = (i / 10) * Math.PI * 2 + seed, radius = 118 + ((i * 37 + seed * 13) % 40);
      const x = 120 + Math.cos(angle) * radius, y = 150 + Math.sin(angle) * radius * 0.8;
      const size = 9 * Math.sin((d / life) * Math.PI);
      items.push(<path key={`s${i}`} d={starPath(4, size, size * 0.35)} transform={`translate(${mirror(x).toFixed(1)} ${y.toFixed(1)})`} fill={light} />);
    }
  }
  if (puff >= 0) {
    for (let k = Math.max(0, Math.floor((puff - 27) / 9)); k * 9 <= puff; k++) {
      const d = puff - k * 9;
      if (d > 27) continue;
      const x = 120 + (((k * 53 + seed * 7) % 40) - 20), y = 214 - d * 1.6, o = 1 - d / 27, kind = k % 3;
      const shape = kind === 0 ? <path d="M0 -6L6 0L0 6L-6 0Z" /> : kind === 1 ? <circle r={5} /> : <path d="M0 -6L6 5H-6Z" />;
      items.push(<g key={`p${k}`} transform={`translate(${mirror(x).toFixed(1)} ${y.toFixed(1)})`} fill={color} opacity={o * 0.9}>{shape}</g>);
    }
  }
  if (zzz >= 0) {
    for (let k = 0; k < 3; k++) {
      const d = (zzz + k * 20) % 60, o = Math.sin((d / 60) * Math.PI);
      items.push(<text key={`z${k}`} x={mirror(158 + d * 0.6)} y={64 - d * 0.75} fontFamily={MONO} fontSize={16 + d * 0.2} fontWeight={600} fill={light} opacity={o} textAnchor="middle">z</text>);
    }
  }
  return <g>{items}</g>;
}

