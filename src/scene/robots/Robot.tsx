/** A robot gardener: one SVG character parameterised by who it is, what it is doing, and how it feels. */
import { type CSSProperties, useId } from "react";

import { SANS } from "../fonts";

import { look, type RobotId } from "./cast";
import type { Expression } from "./expressions";
import { blink as blinkAt, type Pose, rig } from "./motion";
import { AccessoryPart, ArmPart, BODIES, BodyPart, Corselet, HeadShell, LegPart, NECK_PIVOT, NeckPart, Overlays, SatchelPart, ScreenPart, armJoints } from "./parts";
import { SignaturePart, type SignatureProps } from "./signatures";

export type RobotProps = {
  id: RobotId;
  pose?: Pose;
  /** Frames since the pose began (drives every cycle). */
  t?: number;
  expression?: Expression;
  /** Voice loudness 0–9 while talking (see mouth.ts); leave unset for a resting mouth. */
  mouth?: number;
  /** Where the robot's feet touch the ground, in the parent's pixels. */
  x: number;
  y: number;
  /** Height of the robot's 320-unit body box, px. */
  height?: number;
  facing?: "left" | "right";
  /** Fictional character name under the feet. */
  nameplate?: boolean | "name";
  /** 0–1: fades the whole robot (e.g. offscreen-to-onscreen entrances). */
  opacity?: number;
  seed?: number;
  style?: CSSProperties;
};

const PAD_X = 40, PAD_TOP = 60, PAD_BOTTOM = 20, BOX_W = 240, BOX_H = 320, FEET = 318;
/** A robot whose face is off (offline) or capped: its signature holds still. */
const spentFace = (face: Expression) => face === "offline" || face === "capped";

export function Robot({ id, pose = "idle", t = 0, expression, mouth, x, y, height = 300, facing = "right", nameplate = false, opacity = 1, seed, style }: RobotProps) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  // Signatures and poses use the same explicit browser presentation clock.
  const frame = t; // Browser presentation clock supplied by WorldScene.
  const robot = look(id);
  const s = height / BOX_H;
  const seedValue = seed ?? [...robot.id].reduce((sum, c) => sum + c.charCodeAt(0), 0);
  const r = rig(pose, t, seedValue, mouth ?? 0, robot.accessory === "baton");
  const face: Expression = expression ?? (pose === "sleep" ? "asleep" : pose === "offline" ? "offline" : pose === "capped" ? "capped" : pose === "celebrate" ? "delighted" : "neutral");
  const body = BODIES[robot.body];
  const flip = facing === "left";
  const mirror = (value: number) => (flip ? BOX_W - value : value);
  const far = armJoints(body.shoulders.far, r.far, -1);
  const width = (BOX_W + PAD_X * 2) * s, svgHeight = (BOX_H + PAD_TOP + PAD_BOTTOM) * s;
  const nameSize = Math.max(14, Math.min(30, 26 * height / 300));
  const shadowScale = 1 + r.lift / 120;
  const breathe = `translate(120 268) scale(1 ${r.breathe.toFixed(4)}) translate(-120 -268)`;
  const spent = r.dim > 0 || spentFace(face);
  const sig: Omit<SignatureProps, "layer"> = { signature: robot.signature, color: robot.color, life: spent ? 0 : frame + seedValue, sway: r.antenna, spent, uid };
  return <div style={{ position: "absolute", left: x - (120 + PAD_X) * s, top: y - (FEET + PAD_TOP) * s, width, opacity, ...style }}>
    <svg width={width} height={svgHeight} viewBox={`${-PAD_X} ${-PAD_TOP} ${BOX_W + PAD_X * 2} ${BOX_H + PAD_TOP + PAD_BOTTOM}`} style={{ overflow: "visible", display: "block" }}>
      <defs>
        <filter id={`${uid}-glow`} x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="2.4" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
      </defs>
      <ellipse cx={120} cy={FEET + 2} rx={62 * shadowScale} ry={9 * shadowScale} fill="#000000" opacity={0.35} />
      <g transform={flip ? `translate(${BOX_W} 0) scale(-1 1)` : undefined}>
        <g transform={`translate(0 ${r.lift.toFixed(2)})`}>
          <g transform={breathe}><SignaturePart layer="back" tilt={r.headTilt} {...sig} /></g>
          <LegPart hip={body.hips.far} angle={r.legFar} color={robot.color} />
          <LegPart hip={body.hips.near} angle={r.legNear} color={robot.color} />
          <g transform={breathe}>
            <BodyPart shape={robot.body} color={robot.color} uid={uid} />
            {robot.accessory === "satchel" ? <SatchelPart shoulder={body.shoulders.near} hip={body.hips.far} /> : null}
            <NeckPart head={robot.head} bodyTop={body.top} color={robot.color} />
            <SignaturePart layer="neck" {...sig} />
            <g transform={`rotate(${r.headTilt.toFixed(2)} ${NECK_PIVOT[0]} ${NECK_PIVOT[1]})`}>
              <SignaturePart layer="behind" {...sig} />
              <HeadShell shape={robot.head} color={robot.color} uid={uid} />
              <ScreenPart head={robot.head} color={robot.id === "demo" ? "#e8eee0" : robot.color} expression={face} mouth={mouth} blink={face === "asleep" ? 0 : blinkAt(t, seedValue)} dim={r.dim} uid={uid} />
              <SignaturePart layer="front" {...sig} />
            </g>
            {robot.accessory && robot.accessory !== "satchel" ? <g transform={`translate(${far.hand[0]} ${far.hand[1]}) scale(1.4) translate(${-far.hand[0]} ${-far.hand[1]})`}><AccessoryPart kind={robot.accessory} hand={far.hand} color={robot.color} /></g> : null}
            <ArmPart shoulder={body.shoulders.far} arm={r.far} side={-1} color={robot.color} />
            <ArmPart shoulder={body.shoulders.near} arm={r.near} side={1} color={robot.color} />
          </g>
        </g>
      </g>
      <g transform={`translate(0 ${r.lift.toFixed(2)})`}>
        <Overlays sparkle={r.sparkle} puff={r.puff} zzz={r.zzz} color={robot.id === "demo" ? "#e8eee0" : robot.color} seed={seedValue} mirror={mirror} />
      </g>
    </svg>
    {nameplate ? <div style={{ textAlign: "center", marginTop: 6 * s, fontFamily: SANS, lineHeight: 1.15 }}>
      <div style={{ fontSize: nameSize, fontWeight: 600, color: robot.color, whiteSpace: "nowrap" }}>{robot.name}</div>
    </div> : null}
  </div>;
}

/** The crop RobotHead shows, in robot units: wide enough for every signature (Sol's rays set the width) and tall enough
 * for the highest (Fable's book, near y −8), in the old 168 : 176 shape so layouts keep their size. Nothing is drawn
 * below its bottom edge. */
const HEAD_CROP = { x: 32, y: -18, w: 176, h: 176 * (176 / 168) };

/** Just the head (with its signature and face), for compact places: race bars, offer cards, podium, captions. `size` is its width in px. */
export function RobotHead({ id, size = 64, expression = "neutral", mouth, t = 0, dim = 0, style }: { id: RobotId; size?: number; expression?: Expression; mouth?: number; t?: number; dim?: number; style?: CSSProperties }) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const robot = look(id);
  const seedValue = [...robot.id].reduce((sum, c) => sum + c.charCodeAt(0), 0);
  const spent = dim > 0 || spentFace(expression);
  const sig: Omit<SignatureProps, "layer"> = { signature: robot.signature, color: robot.color, life: spent ? 0 : t, spent, uid };
  const { x, y, w, h } = HEAD_CROP;
  return <svg width={size} height={size * 1.05} viewBox={`${x} ${y} ${w} ${h.toFixed(2)}`} style={{ overflow: "visible", display: "block", ...style }}>
    <defs>
      <filter id={`${uid}-glow`} x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="2.4" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
      <clipPath id={`${uid}-crop`}><rect x={x - 400} y={y - 400} width={w + 800} height={h + 400} /></clipPath>
    </defs>
    <g clipPath={`url(#${uid}-crop)`}>
      <SignaturePart layer="back" {...sig} />
      {robot.head === "helmet" ? <Corselet /> : null}
      <SignaturePart layer="neck" {...sig} />
      <SignaturePart layer="behind" {...sig} />
      <HeadShell shape={robot.head} color={robot.color} uid={uid} />
      <ScreenPart head={robot.head} color={robot.id === "demo" ? "#e8eee0" : robot.color} expression={expression} mouth={mouth} blink={blinkAt(t, seedValue)} dim={dim} uid={uid} />
      <SignaturePart layer="front" {...sig} />
    </g>
  </svg>;
}

