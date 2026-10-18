/** Robot animation as pure functions of the frame, so every render of a frame is identical. */
import { FPS } from "../theme";

export type Pose =
  | "idle" | "walk" | "wave" | "talk" | "listen" | "celebrate" | "work"
  | "sleep" | "offline" | "capped" | "point" | "hold" | "shrug" | "think";

export const POSES: Pose[] = ["idle", "walk", "wave", "talk", "listen", "celebrate", "work", "point", "hold", "shrug", "think", "sleep", "offline", "capped"];

/** One arm: shoulder angle out from hanging straight down, then elbow bend (positive bends the forearm up and out,
 * negative across the body). Degrees. */
export type Arm = { a: number; b: number };

export type Rig = {
  /** Whole-robot vertical offset in robot units (negative is up). */
  lift: number;
  /** Body breathing scale around the hips. */
  breathe: number;
  /** Head tilt, degrees (positive leans toward the robot's facing side and down). */
  headTilt: number;
  /** The robot's "near" arm (the side it faces: waves, points) and its "far" arm (carries the accessory). */
  near: Arm;
  far: Arm;
  /** Leg swing, degrees. */
  legNear: number;
  legFar: number;
  /** Sway, degrees: the demo robot's antenna and Sonnet's quill. */
  antenna: number;
  /** 0 (bright) … 1 (dark): face-screen dimming. */
  dim: number;
  /** Frames into a celebration (sparkles), work (puffs) or sleep (z's); -1 when not shown. */
  sparkle: number;
  puff: number;
  zzz: number;
};

const ease = (t: number) => { const x = Math.max(0, Math.min(1, t)); return 1 - (1 - x) ** 3; };
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const TAU = Math.PI * 2;

/** Seeded random stream (Park–Miller), as in lib/iso. */
export function seeded(seed: number) {
  let state = Math.abs(Math.floor(seed)) % 2147483647 || 1;
  return () => (state = (state * 16807) % 2147483647) / 2147483647;
}

/** 0 (open) … 1 (shut): a blink every 100–150 frames, five frames long, at seeded moments. */
export function blink(t: number, seed: number) {
  const next = seeded(seed * 977 + 13);
  let at = 15 + Math.floor(next() * 85);
  while (at + 6 < t) at += 100 + Math.floor(next() * 50);
  const d = t - at;
  return d < 0 || d > 5 ? 0 : Math.sin((d / 5) * Math.PI);
}

/** Joint angles for a pose `t` frames after it began. `level` (0–9) is the voice loudness for talking. A robot with a
 * `baton` (Opus) holds its far arm up beating time wherever a pose would leave that arm hanging. */
export function rig(pose: Pose, t: number, seed: number, level = 0, baton = false): Rig {
  const s = t / FPS;
  const rest: Arm = { a: 12, b: 10 };
  const beat = TAU * 0.9 * s + seed;
  const base: Rig = {
    lift: 0, breathe: 1 + 0.012 * Math.sin(TAU * 0.3 * s + seed), headTilt: 0,
    near: { a: rest.a + 2 * Math.sin(TAU * 0.3 * s + seed), b: rest.b }, far: baton ? { a: 88 + 5 * Math.sin(beat), b: 66 + 10 * Math.sin(beat + 0.8) } : { ...rest },
    legNear: 0, legFar: 0, antenna: 3 * Math.sin(TAU * 0.5 * s + seed * 1.7), dim: 0, sparkle: -1, puff: -1, zzz: -1,
  };
  switch (pose) {
    case "idle": return base;
    case "walk": {
      const p = TAU * t / 18;
      return { ...base, legNear: 18 * Math.sin(p), legFar: -18 * Math.sin(p), near: { a: 14 + 12 * Math.sin(p), b: 18 }, far: { a: 14 - 12 * Math.sin(p), b: 18 }, lift: -5 * Math.abs(Math.sin(p)), antenna: 7 * Math.sin(p) };
    }
    case "wave": {
      const up = t < 8 ? ease(t / 8) : t < 30 ? 1 : ease(1 - (t - 30) / 8);
      const wiggle = t >= 6 && t < 32 ? 22 * Math.sin(TAU * 2 * (t - 6) / FPS) : 0;
      return { ...base, near: { a: lerp(base.near.a, 128, up), b: lerp(rest.b, 32, up) + 0.8 * wiggle * up }, headTilt: -5 * up, antenna: base.antenna + 4 * up * Math.sin(TAU * 2 * s) };
    }
    case "talk": {
      const voice = level / 9;
      return { ...base, near: { a: 18 + 7 * Math.sin(TAU * 0.55 * s + seed), b: 34 + 10 * voice }, headTilt: 2.2 * voice * Math.sin(TAU * 1.4 * s), lift: -1.5 * voice };
    }
    case "listen": return { ...base, headTilt: 6 };
    case "celebrate": {
      const hop = t < 30 ? 24 * Math.abs(Math.sin(Math.PI * t / 15)) : 0;
      const wag = 10 * Math.sin(TAU * 2.2 * s);
      return { ...base, lift: -hop, near: { a: 150, b: 12 + wag }, far: { a: 150, b: 12 - wag }, sparkle: t, antenna: 9 * Math.sin(TAU * 2 * s) };
    }
    case "work": {
      const p = TAU * t / 8;
      return { ...base, near: { a: 30 + 10 * Math.max(0, Math.sin(p)), b: -78 }, far: { a: 30 + 10 * Math.max(0, -Math.sin(p)), b: -78 }, headTilt: 7, puff: t };
    }
    case "point": {
      const out = ease(t / 8);
      return { ...base, near: { a: lerp(base.near.a, 96, out), b: lerp(rest.b, 4, out) }, headTilt: -3 * out };
    }
    case "hold": return { ...base, near: { a: 20, b: -110 }, far: { a: 20, b: -110 } };
    case "shrug": {
      const up = ease(t / 8);
      return { ...base, near: { a: lerp(12, 38, up), b: lerp(10, 96, up) }, far: { a: lerp(12, 38, up), b: lerp(10, 96, up) }, headTilt: 9 * up, lift: -3 * up };
    }
    case "think": return { ...base, near: { a: 170, b: 91 }, far: { a: 20, b: -100 }, headTilt: -8, antenna: base.antenna * 0.5 };
    case "sleep": return { ...base, near: { a: 4, b: 4 }, far: { a: 4, b: 4 }, headTilt: 15, lift: 4, antenna: -8, breathe: 1 + 0.02 * Math.sin(TAU * 0.25 * s), zzz: t };
    case "offline": return { ...base, near: { a: 5, b: 4 }, far: { a: 5, b: 4 }, headTilt: 9, lift: 3, antenna: -5, dim: 0.6 };
    case "capped": return { ...base, near: { a: 8, b: 8 }, far: { a: 8, b: 8 }, headTilt: 5, antenna: 0, dim: 0.35 };
  }
}
