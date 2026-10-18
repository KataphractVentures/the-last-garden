import type { CSSProperties } from 'react';
import { RobotHead } from './robots/Robot';
import { appearanceFor } from './robots/cast';
import type { Expression } from './robots/expressions';

/** Static, deterministic portraits for any fictional campaign identity. */
export function CharacterPortrait({ id, size = 64, expression = 'happy', style }: { id?: string; size?: number; expression?: Expression; style?: CSSProperties }) {
  return <span className="garden-character-portrait" aria-hidden="true" style={{ display: 'inline-block', width: size, flexShrink: 0, ...style }}><RobotHead id={appearanceFor(id)} size={size} expression={expression} t={40} /></span>;
}
