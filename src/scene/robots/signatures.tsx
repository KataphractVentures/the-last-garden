/** The nine signatures (cast.ts): what tells each robot apart at a glance, drawn large on or around its head, in robot
 * units. Each draws in up to four layers so it wraps the robot in depth: "back" behind the whole robot (sun, moon,
 * rocket), "neck" between body and head (ruff, rocket straps), "behind" just behind the head (quill, branch, the far
 * side of the notes and the crown) and "front" over it (notes, blossoms, book, crown, porthole rim, bubbles).
 * Motion is a pure function of `life` (frames). A `spent` robot (offline or capped) holds still and its rocket is out. */
import type { ReactNode } from "react";
import { mix } from "../lib/iso";
import type { Signature } from "./cast";
import { BRASS, bolt, HEADS, limbColor, NECK_PIVOT, OUTLINE, starPath } from "./parts";

export type SignatureLayer = "back" | "neck" | "behind" | "front";

export type SignatureProps = {
  signature: Signature;
  layer: SignatureLayer;
  color: string;
  /** Frames driving the signature's own motion. */
  life: number;
  /** Sway from the rig, degrees (the quill and the demo's antenna); head-only crops leave it unset and the quill sways
   * on its own. */
  sway?: number;
  /** Head tilt, degrees: "back" layers worn on the head (sun, moon) turn with it. */
  tilt?: number;
  spent?: boolean;
  uid: string;
};

const TAU = Math.PI * 2;
const PAPER = "#fbf6e6";
const f2 = (v: number) => v.toFixed(2);
/** Position in a repeating cycle, 0 ≤ p < 1. */
const cycle = (v: number, period: number) => (((v % period) + period) % period) / period;
const easeInOut = (x: number) => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2);
/** A stroke with an ink outline under it. */
const inked = (d: string, color: string, width: number, key?: string | number) => <g key={key} fill="none" strokeLinecap="round" strokeLinejoin="round">
  <path d={d} stroke={OUTLINE} strokeWidth={width + 4.5} /><path d={d} stroke={color} strokeWidth={width} />
</g>;

export function SignaturePart(p: SignatureProps): ReactNode {
  const { layer, life } = p;
  switch (p.signature) {
    case "conductor": return layer === "behind" || layer === "front" ? <Notes front={layer === "front"} life={life} /> : null;
    case "poet": return layer === "neck" ? <Ruff /> : layer === "behind" ? <Quill sway={p.sway ?? 3 * Math.sin((life / 60) * TAU)} color={p.color} /> : null;
    case "blossom": return layer === "behind" ? <Branch /> : layer === "front" ? <Blossoms life={life} /> : null;
    case "storybook": return layer === "front" ? <Storybook life={life} /> : null;
    case "constellation": return layer === "behind" || layer === "front" ? <Crown front={layer === "front"} life={life} /> : null;
    case "sun": return layer === "back" ? <OnHead tilt={p.tilt}><Sunburst life={life} /></OnHead> : null;
    case "moon": return layer === "back" ? <OnHead tilt={p.tilt}><Moon life={life} uid={p.uid} spent={p.spent} /></OnHead> : null;
    case "diver": return layer === "front" ? <Porthole life={life} spent={p.spent} /> : null;
    case "rocket": return <KimiRocket layer={layer} life={life} spent={p.spent} />;
    case "antenna": return layer === "behind" ? <Antenna color={p.color} sway={p.sway ?? 0} /> : null;
  }
}

/** Worn on the head, though drawn behind the whole robot: turns with the head's tilt. */
function OnHead({ tilt = 0, children }: { tilt?: number; children: ReactNode }) {
  return <g transform={tilt ? `rotate(${f2(tilt)} ${NECK_PIVOT[0]} ${NECK_PIVOT[1]})` : undefined}>{children}</g>;
}

// ---------- Opus: notes orbiting its head ----------

const NOTE = "#fff6da";
/** ♪ and ♫ as shapes, about 26 units tall around the origin: note heads, stems, then the flag or beam. */
const GLYPHS = [
  { heads: [[-3.5, 8]], stems: [[1, -15, 3.4, 22]], flag: "M1 -15.5H4.4C5.6 -10 14 -8.5 11 3C10.2 -2.6 7 -5.2 4.4 -6.4Z" },
  { heads: [[-8.5, 9], [7.5, 5]], stems: [[-4.6, -12, 3.4, 20], [11.4, -16.5, 3.4, 21]], flag: "M-4.6 -13L14.8 -17.5V-11.2L-4.6 -6.7Z" },
];

function NoteGlyph({ kind }: { kind: number }) {
  const g = GLYPHS[kind % 2]!;
  const shapes = (paint: { fill: string; stroke?: string; strokeWidth?: number }) => <g {...paint} strokeLinejoin="round">
    {g.heads.map(([x, y], i) => <ellipse key={i} cx={x} cy={y} rx={6.6} ry={4.9} transform={`rotate(-24 ${x} ${y})`} />)}
    {g.stems.map(([x, y, w, h], i) => <rect key={i} x={x} y={y} width={w} height={h} />)}
    <path d={g.flag} />
  </g>;
  return <>{shapes({ fill: OUTLINE, stroke: OUTLINE, strokeWidth: 5 })}{shapes({ fill: NOTE })}</>;
}

/** Four notes on a tilted orbit round the crown of the head, once every six seconds; the far half passes behind it. */
function Notes({ front, life }: { front: boolean; life: number }) {
  const tilt = (-9 * Math.PI) / 180;
  const notes = [0, 1, 2, 3].map(k => {
    const a = (life / 180) * TAU + (k * TAU) / 4;
    const ox = 70 * Math.cos(a), oy = 17 * Math.sin(a);
    return { k, depth: Math.sin(a), x: 120 + ox * Math.cos(tilt) - oy * Math.sin(tilt), y: 36 + ox * Math.sin(tilt) + oy * Math.cos(tilt) };
  }).filter(n => (n.depth >= 0) === front).sort((a, b) => a.depth - b.depth);
  return <g>{notes.map(n => {
    const scale = 1.24 + 0.2 * n.depth, bob = 2.5 * Math.sin(life / 9 + n.k * 2.3), wobble = 10 * Math.sin(life / 14 + n.k * 1.9);
    return <g key={n.k} transform={`translate(${f2(n.x)} ${f2(n.y + bob)}) rotate(${f2(wobble)}) scale(${f2(scale)})`}><NoteGlyph kind={n.k} /></g>;
  })}</g>;
}

// ---------- Sonnet: a quill plume and a ruff ----------

/** A feather quill rising from behind the head, leaning well back; its far half takes a tint of the robot's paint. */
function Quill({ sway, color }: { sway: number; color: string }) {
  const vane = "M0 -14C-13 -30 -16 -66 -3 -100C14 -76 18 -42 0 -14Z";
  const far = "M0 -14C-13 -30 -16 -66 -3 -100Q-1 -56 0 -14Z";
  return <g transform={`translate(106 92) rotate(${f2(-28 + 1.3 * sway)}) scale(1.08)`}>
    <path d={vane} fill={PAPER} stroke={OUTLINE} strokeWidth={5.2} strokeLinejoin="round" />
    <path d={vane} fill={PAPER} />
    <path d={far} fill={mix(color, "#ffffff", 0.3)} />
    <path d="M0 4Q-0.6 -44 -2.6 -97" fill="none" stroke="#a99f86" strokeWidth={2.2} strokeLinecap="round" />
    <path d="M12.6 -42L4.6 -36M-13.2 -60L-5.2 -55M10 -72L3 -66" stroke={OUTLINE} strokeWidth={2} strokeLinecap="round" />
  </g>;
}

/** An Elizabethan ruff: a pleated, scalloped collar round the neck. */
function Ruff() {
  const cx = 120, cy = 166, rx = 64, ry = 14, n = 26;
  const at = (a: number, grow: number) => [cx + (rx + grow) * Math.cos(a), cy + (ry + grow * 0.45) * Math.sin(a)] as const;
  let d = "";
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * TAU, [x, y] = at(a, 0);
    if (!i) { d = `M${f2(x)} ${f2(y)}`; continue; }
    const [qx, qy] = at(a - TAU / n / 2, 9);
    d += `Q${f2(qx)} ${f2(qy)} ${f2(x)} ${f2(y)}`;
  }
  const pleats = Array.from({ length: n }, (_, i) => (i / n) * TAU).filter(a => Math.sin(a) > 0.05).map(a => {
    const [x0, y0] = [cx + 26 * Math.cos(a), cy + 5 * Math.sin(a)], [x1, y1] = at(a, 0);
    return `M${f2(x0)} ${f2(y0)}L${f2(x1)} ${f2(y1)}`;
  }).join("");
  return <g>
    <path d={d + "Z"} fill={PAPER} stroke={OUTLINE} strokeWidth={2.6} strokeLinejoin="round" />
    <path d={pleats} stroke="#cfc5ab" strokeWidth={1.8} strokeLinecap="round" />
  </g>;
}

// ---------- Haiku: a cherry-blossom branch ----------

const PETAL = "#ffc4d7", HEART = "#e0628f", BARK = "#7a5236";
// Its crown is toward the back: on the face side it runs low, under where a speech bubble's tail ends (x 148, y 10).
const BRANCH = "M48 150C30 108 32 56 62 36C82 22 110 16 134 22C158 30 186 50 198 76";
const TWIGS = ["M62 36L50 24", "M178 45L193 37"];
const FLOWERS: [number, number, number][] = [[44, 110, 11.5], [48, 23, 12.5], [78, 27, 9.5], [102, 17, 12], [128, 21, 9.5], [168, 39, 10], [196, 35, 10], [199, 76, 12]];
const BUDS: [number, number, number][] = [[58, 68, 4.2], [117, 15, 4.4], [184, 56, 3.8]];
/** Where loose petals set off: the blossoms beside the head, so none crosses the face. */
const DRIFT: [number, number, number][] = [[44, 110, 0], [199, 76, 44], [50, 66, 80], [196, 35, 110]];

/** One cherry petal, notched at its tip, `r` long from the flower's heart along -y. */
const petalPath = (r: number) => `M0 0C${f2(-0.42 * r)} ${f2(-0.25 * r)} ${f2(-0.6 * r)} ${f2(-0.75 * r)} ${f2(-0.34 * r)} ${f2(-r)}L0 ${f2(-0.84 * r)}L${f2(0.34 * r)} ${f2(-r)}C${f2(0.6 * r)} ${f2(-0.75 * r)} ${f2(0.42 * r)} ${f2(-0.25 * r)} 0 0Z`;

function Branch() {
  return <g>{[BRANCH, ...TWIGS].map((d, i) => inked(d, BARK, i ? 3.6 : 5.6, i))}</g>;
}

function Flower({ x, y, r, turn }: { x: number; y: number; r: number; turn: number }) {
  return <g transform={`translate(${x} ${y}) rotate(${turn})`}>
    {[0, 1, 2, 3, 4].map(i => <path key={i} d={petalPath(r)} transform={`rotate(${i * 72})`} fill={PETAL} stroke={OUTLINE} strokeWidth={1.7} strokeLinejoin="round" />)}
    <circle r={r * 0.28} fill={HEART} stroke={OUTLINE} strokeWidth={1.2} />
  </g>;
}

/** Blossoms along the branch, and petals drifting down beside the head (each loops every 130 frames). */
function Blossoms({ life }: { life: number }) {
  return <g>
    {BUDS.map(([x, y, r], i) => <circle key={`b${i}`} cx={x} cy={y} r={r} fill={HEART} stroke={OUTLINE} strokeWidth={1.6} />)}
    {FLOWERS.map(([x, y, r], i) => <Flower key={i} x={x} y={y} r={r} turn={i * 23} />)}
    {DRIFT.map(([x0, y0, delay], i) => {
      const p = cycle(life + delay, 130), out = x0 < 120 ? -1 : 1;
      const x = x0 + out * 8 * p + 7 * Math.sin(p * TAU * 1.5 + i), y = y0 + 8 + 92 * p;
      const opacity = Math.min(1, p / 0.12, (1 - p) / 0.3);
      return <path key={`p${i}`} d={petalPath(8)} transform={`translate(${f2(x)} ${f2(y)}) rotate(${f2(360 * p * 1.3 + delay * 3)})`} fill={PETAL} stroke={OUTLINE} strokeWidth={1.3} strokeLinejoin="round" opacity={opacity} />;
    })}
  </g>;
}

// ---------- Fable: an open storybook ----------

const COVER = "#a63d50", PAGE_BACK = "#ece1c6", PRINT = "#c4b897";
const LEFT_PAGE = "M0 0C-15 -6 -34 -6 -50 -2L-51 -36C-35 -41 -15 -41 0 -34Z";
const mirror = (d: string) => d.replace(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g, (_, x: string, y: string) => `${-Number(x)} ${y}`);

/** A page turning over the spine from right (θ = 0) to left (θ = π), lifting as it goes. */
function TurningPage({ theta }: { theta: number }) {
  const c = Math.cos(theta), lift = 12 * Math.sin(theta);
  const d = `M0 0Q${f2(25 * c)} ${f2(-6 - 12 * Math.sin(theta))} ${f2(50 * c)} ${f2(-2 - lift)}L${f2(51 * c)} ${f2(-36 - lift)}Q${f2(25 * c)} ${f2(-41 - 12 * Math.sin(theta))} 0 -34Z`;
  return <path d={d} fill={c >= 0 ? PAPER : PAGE_BACK} stroke={OUTLINE} strokeWidth={2.2} strokeLinejoin="round" />;
}

/** The book floats and bobs above the head, a little toward its back so a speech bubble's tail (aimed at the top of
 * the head, near x 148) passes clear of it; every three seconds two pages flutter over. */
function Storybook({ life }: { life: number }) {
  const bob = 2.5 * Math.sin((life / 80) * TAU);
  const turn = (offset: number) => { const p = cycle(life - offset, 96) * 96; return p < 24 ? Math.PI * easeInOut(p / 24) : null; };
  const lines = [-28, -21, -14].map(y => `M-44 ${y}C-32 ${y - 3} -18 ${y - 3} -7 ${y}`).join("");
  return <g transform={`translate(92 ${f2(36 + bob)}) scale(0.85)`}>
    <path d="M0 6C-18 0 -38 0 -56 5L-58 -33C-40 -38 -18 -38 0 -30C18 -38 40 -38 58 -33L56 5C38 0 18 0 0 6Z" fill={COVER} stroke={OUTLINE} strokeWidth={2.8} strokeLinejoin="round" />
    <path d={LEFT_PAGE} fill={PAPER} stroke={OUTLINE} strokeWidth={2.2} strokeLinejoin="round" />
    <path d={mirror(LEFT_PAGE)} fill={PAPER} stroke={OUTLINE} strokeWidth={2.2} strokeLinejoin="round" />
    <path d={lines + mirror(lines)} fill="none" stroke={PRINT} strokeWidth={2.2} strokeLinecap="round" />
    {[0, 9].map(offset => { const theta = turn(offset); return theta === null ? null : <TurningPage key={offset} theta={theta} />; })}
    <path d="M2 -2L3 13L6 9.5L9 13L8 -2Z" fill="#e2a33d" stroke={OUTLINE} strokeWidth={1.6} strokeLinejoin="round" />
  </g>;
}

// ---------- Astra: a constellation crown ----------

const STARLIGHT = "#fff4bd";
const CROWN = { cx: 120, cy: 64, rx: 78, ry: 17 };
/** Seven stars round the crown (the first at the front), each a little off the ring and its own size. */
const STARS: [number, number][] = [[0, 12], [3, 8], [-4, 10], [2, 7.5], [-3, 11], [4, 8], [-2, 9.5]];

function Crown({ front, life }: { front: boolean; life: number }) {
  const pts = STARS.map(([dy, size], k) => {
    const a = TAU / 4 + (k * TAU) / STARS.length;
    return { k, size, depth: Math.sin(a), x: CROWN.cx + CROWN.rx * Math.cos(a), y: CROWN.cy + CROWN.ry * Math.sin(a) + dy };
  });
  const links = pts.map((a, k) => [a, pts[(k + 1) % pts.length]!] as const).filter(([a, b]) => (a.depth + b.depth >= 0) === front);
  return <g>
    {links.map(([a, b], i) => <g key={`l${i}`} strokeLinecap="round">
      <path d={`M${f2(a.x)} ${f2(a.y)}L${f2(b.x)} ${f2(b.y)}`} stroke={OUTLINE} strokeWidth={4.2} />
      <path d={`M${f2(a.x)} ${f2(a.y)}L${f2(b.x)} ${f2(b.y)}`} stroke={STARLIGHT} strokeWidth={1.9} opacity={0.9} />
    </g>)}
    {pts.filter(s => (s.depth >= 0) === front).map(s => {
      const twinkle = 0.84 + 0.2 * Math.sin(life / 6.5 + s.k * 2.1), r = s.size * (0.92 + 0.12 * s.depth) * twinkle;
      return <g key={s.k} transform={`translate(${f2(s.x)} ${f2(s.y)})`}>
        <circle r={r * 1.55} fill={STARLIGHT} opacity={0.12 + 0.2 * twinkle} />
        <path d={starPath(5, r, r * 0.46)} fill={STARLIGHT} stroke={OUTLINE} strokeWidth={1.9} strokeLinejoin="round" />
      </g>;
    })}
  </g>;
}

// ---------- Sol: a sunburst ----------

const SUN = { x: 120, y: 108 };

/** A sun disc behind the dome head, with long and short rays turning once every 40 seconds. */
function Sunburst({ life }: { life: number }) {
  const at = (r: number, a: number) => `${f2(SUN.x + r * Math.cos(a))} ${f2(SUN.y + r * Math.sin(a))}`;
  const rays = Array.from({ length: 16 }, (_, i) => {
    const a = (i * TAU) / 16, long = i % 2 === 0, half = long ? 0.135 : 0.11;
    return `M${at(66, a - half)}L${at(long ? 88 : 79, a)}L${at(66, a + half)}Z`;
  }).join("");
  return <g>
    <path d={rays} transform={`rotate(${f2((life * 0.3) % 360)} ${SUN.x} ${SUN.y})`} fill="#ffd45a" stroke={OUTLINE} strokeWidth={2.6} strokeLinejoin="round" />
    <circle cx={SUN.x} cy={SUN.y} r={71} fill="#ffa63a" stroke={OUTLINE} strokeWidth={3} />
    <circle cx={SUN.x} cy={SUN.y} r={64} fill="#ffb84d" />
  </g>;
}

// ---------- Luna: a full moon ----------

const MOON = { x: 120, y: 106, r: 80 };
/** Craters in the ring of moon left showing round the dome head. */
const CRATERS: [number, number, number][] = [[88, 42, 7.5], [140, 37, 5.5], [116, 30, 3.5], [172, 58, 7], [190, 104, 7], [186, 140, 5], [50, 94, 7], [58, 146, 6]];

function Moon({ life, uid, spent }: { life: number; uid: string; spent?: boolean }) {
  const glow = spent ? 0.2 : 0.45 + 0.2 * Math.sin((life / 75) * TAU);
  return <g>
    <radialGradient id={`${uid}-moonglow`}><stop offset="0.6" stopColor="#e6e1ff" stopOpacity={0.85} /><stop offset="1" stopColor="#e6e1ff" stopOpacity={0} /></radialGradient>
    <clipPath id={`${uid}-moon`}><circle cx={MOON.x} cy={MOON.y} r={MOON.r} /></clipPath>
    <circle cx={MOON.x} cy={MOON.y} r={MOON.r + 26} fill={`url(#${uid}-moonglow)`} opacity={glow} />
    <circle cx={MOON.x} cy={MOON.y} r={MOON.r} fill="#f1ecdc" />
    <g clipPath={`url(#${uid}-moon)`}><circle cx={MOON.x + 30} cy={MOON.y + 34} r={MOON.r} fill="#ddd5c0" opacity={0.7} /></g>
    {CRATERS.map(([x, y, r], i) => <g key={i}>
      <circle cx={x} cy={y} r={r} fill="#d5ccb6" stroke="#afa58c" strokeWidth={1.5} />
      <circle cx={x + r * 0.22} cy={y + r * 0.22} r={r * 0.62} fill="#e3dccb" />
    </g>)}
    <circle cx={MOON.x} cy={MOON.y} r={MOON.r} fill="none" stroke={OUTLINE} strokeWidth={3} />
  </g>;
}

// ---------- DeepSeek: the diving helmet's porthole, and bubbles ----------

/** The bolted brass rim round the face-screen, a glint on the glass, and bubbles rising from the exhaust valve on the
 * helmet's back, beside the head. */
function Porthole({ life, spent }: { life: number; spent?: boolean }) {
  const s = HEADS.helmet.screen, cx = s.x + s.w / 2, cy = s.y + s.h / 2, r = s.r + 4.5, [vx, vy] = HEADS.helmet.anchor;
  return <g>
    <circle cx={cx} cy={cy} r={r} fill="none" stroke={OUTLINE} strokeWidth={12.5} />
    <circle cx={cx} cy={cy} r={r} fill="none" stroke={BRASS.light} strokeWidth={7.5} />
    {Array.from({ length: 8 }, (_, i) => { const a = (i + 0.5) * (TAU / 8); return bolt(cx + r * Math.cos(a), cy + r * Math.sin(a), i, 2.3); })}
    <path d={`M${f2(cx - 25)} ${f2(cy - 14)}A29 29 0 0 1 ${f2(cx - 10)} ${f2(cy - 27)}`} fill="none" stroke="#ffffff" strokeWidth={3} strokeLinecap="round" opacity={0.28} />
    {spent ? null : [0, 1, 2, 3].map(k => {
      const p = cycle(life + k * 17, 68);
      const x = vx - 1 - 11 * p + 3.5 * Math.sin(p * TAU * 1.4 + k * 2), y = vy - 5 - 50 * p, br = 3 + 3.5 * p;
      return <g key={k} opacity={Math.min(1, p / 0.08, (1 - p) / 0.4)}>
        <circle cx={f2(x)} cy={f2(y)} r={f2(br)} fill="#d6f1ff" fillOpacity={0.45} stroke={OUTLINE} strokeWidth={1.5} />
        <circle cx={f2(x - br * 0.35)} cy={f2(y - br * 0.35)} r={f2(br * 0.3)} fill="#ffffff" />
      </g>;
    })}
  </g>;
}

// ---------- Kimi: a cute rocket on its back, aimed at a small moon ----------

/** On the back, peeking past the far side of the head (x < 120), its nose on a crescent moon at the upper left: a
 * moonshot, for Moonshot AI. Placed so the moon stays inside RobotHead's crop. */
function KimiRocket({ layer, life, spent }: { layer: SignatureLayer; life: number; spent?: boolean }) {
  if (layer === "neck") return <Straps />;
  if (layer !== "back") return null;
  return <g>
    <SmallMoon x={46} y={40} r={13} life={life} />
    <g transform="translate(62 128) rotate(-10)"><CuteRocket life={life} spent={spent} /></g>
  </g>;
}

const CUTE = { body: "#f7f2e5", nose: "#ef6b5e", glass: "#a8dcff", frame: "#5d6b74", nozzle: "#7b8577" };

/** A plump little rocket in its own units, nose at (0, -46), nozzle at y 41: round body, big porthole, rounded fins.
 * Out of fuel (spent), its flame gives way to a wisp of smoke. */
function CuteRocket({ life, spent }: { life: number; spent?: boolean }) {
  const f = 16 + 5 * Math.abs(Math.sin(life * 0.9)) + 2.5 * Math.sin(life * 2.3);
  const puff = (w: number, l: number) => `M${-w} 40C${-w} ${f2(40 + l * 0.55)} ${f2(-w * 0.35)} ${f2(40 + l * 0.85)} 0 ${f2(40 + l)}C${f2(w * 0.35)} ${f2(40 + l * 0.85)} ${w} ${f2(40 + l * 0.55)} ${w} 40Z`;
  return <g strokeLinejoin="round">
    {spent
      ? <g fill="#9aa093" opacity={0.6}><circle cx={-1} cy={50} r={5.5} /><circle cx={-4} cy={61} r={4} /></g>
      : <g>
        <path d={puff(12, f)} fill="#ff9a3c" stroke={OUTLINE} strokeWidth={2.4} />
        <path d={puff(6.5, f * 0.62)} fill="#ffe27a" />
      </g>}
    <path d="M-20 8C-35 12 -39 29 -34 40C-27 36 -19 34 -12 33Z" fill={CUTE.nose} stroke={OUTLINE} strokeWidth={2.6} />
    <path d="M20 8C35 12 39 29 34 40C27 36 19 34 12 33Z" fill={CUTE.nose} stroke={OUTLINE} strokeWidth={2.6} />
    <path d="M-10 34H10L12.5 41H-12.5Z" fill={CUTE.nozzle} stroke={OUTLINE} strokeWidth={2.4} />
    <path d="M0 -46C15 -42 25 -24 25 -2C25 18 20 29 14 35H-14C-20 29 -25 18 -25 -2C-25 -24 -15 -42 0 -46Z" fill={CUTE.body} stroke={OUTLINE} strokeWidth={2.8} />
    <path d="M-17 -27C-21 -15 -22 -2 -20 11" fill="none" stroke="#ffffff" strokeWidth={4} strokeLinecap="round" opacity={0.8} />
    <path d="M0 -46C11 -43 19 -33 22.5 -22C8 -25.5 -8 -25.5 -22.5 -22C-19 -33 -11 -43 0 -46Z" fill={CUTE.nose} stroke={OUTLINE} strokeWidth={2.6} />
    <circle cx={0} cy={-1} r={11} fill={CUTE.frame} stroke={OUTLINE} strokeWidth={2.6} />
    <circle cx={0} cy={-1} r={7.6} fill={CUTE.glass} stroke={OUTLINE} strokeWidth={1.6} />
    <circle cx={-2.6} cy={-3.8} r={2.4} fill="#ffffff" opacity={0.9} />
  </g>;
}

/** A small crescent moon, kept well short of Luna's: a disc less an equal disc offset by 0.6 r (they meet at
 * x = 0.3 r), with a star that twinkles beside it. */
function SmallMoon({ x, y, r, life }: { x: number; y: number; r: number; life: number }) {
  const h = r * Math.sqrt(1 - 0.09), twinkle = 0.55 + 0.45 * Math.sin((life / 40) * TAU);
  return <g transform={`translate(${x} ${y})`}>
    <path d={`M${f2(-r * 1.15)} ${f2(-r * 0.95)}l2.6 0M${f2(-r * 1.15 + 1.3)} ${f2(-r * 0.95 - 1.3)}l0 2.6`} stroke="#fff6da" strokeWidth={1.6} strokeLinecap="round" opacity={f2(twinkle)} />
    <path d={`M${f2(r * 0.3)} ${f2(-h)}A${r} ${r} 0 1 0 ${f2(r * 0.3)} ${f2(h)}A${r} ${r} 0 0 1 ${f2(r * 0.3)} ${f2(-h)}Z`} fill="#fff1b8" stroke={OUTLINE} strokeWidth={2.2} />
  </g>;
}

/** The rocket's straps, over both shoulders and down the chest, clear of the badge. */
function Straps() {
  return <g>
    {inked("M92 202L101 264", "#6a5446", 5, "l")}
    {inked("M148 202L139 264", "#6a5446", 5, "r")}
    <rect x={91.5} y={218} width={11} height={8} rx={2} fill="#c9cdc2" stroke={OUTLINE} strokeWidth={2} transform="rotate(8 97 222)" />
    <rect x={137.5} y={218} width={11} height={8} rx={2} fill="#c9cdc2" stroke={OUTLINE} strokeWidth={2} transform="rotate(-8 143 222)" />
  </g>;
}

// ---------- the demo robot: a plain antenna ----------

function Antenna({ color, sway }: { color: string; sway: number }) {
  const [ax, ay] = HEADS.plain.anchor;
  return <g transform={`rotate(${f2(sway)} ${ax} ${ay})`}>
    <path d={`M${ax} ${ay + 2}V${ay - 18}`} stroke={OUTLINE} strokeWidth={8} strokeLinecap="round" /><path d={`M${ax} ${ay + 2}V${ay - 18}`} stroke={limbColor(color)} strokeWidth={4} strokeLinecap="round" />
    <circle cx={ax} cy={ay - 24} r={8} fill={mix(color, "#ffffff", 0.45)} stroke={OUTLINE} strokeWidth={3} />
  </g>;
}
