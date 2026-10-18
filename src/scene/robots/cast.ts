/** Fictional game cast using the user's AITokenGarden shell geometry. No maker marks. */
export type RobotId = 'demo' | 'moss' | 'lumen' | 'iris' | 'wren' | 'fable' | 'nova';
export type BodyShape = 'pebble' | 'capsule' | 'boxy' | 'teardrop' | 'plain';
export type HeadShape = 'rounded' | 'dome' | 'helmet' | 'round' | 'plain';
export type Signature = 'conductor' | 'poet' | 'blossom' | 'storybook' | 'constellation' | 'sun' | 'moon' | 'diver' | 'rocket' | 'antenna';
export type Accessory = 'baton' | 'watering-can' | 'magnifier' | 'satchel' | 'star-trowel' | 'contract' | 'lantern' | 'hoe' | 'clover';
export type RobotLook = { id: RobotId; name: string; color: string; body: BodyShape; head: HeadShape; signature: Signature; accessory?: Accessory };
export const CAST: Record<RobotId, RobotLook> = {
  demo: { id: 'demo', name: 'You', color: '#c7ee9e', body: 'plain', head: 'plain', signature: 'antenna', accessory: 'watering-can' },
  moss: { id: 'moss', name: 'Moss', color: '#91e1cf', body: 'pebble', head: 'rounded', signature: 'poet', accessory: 'watering-can' },
  lumen: { id: 'lumen', name: 'Lumen', color: '#f3dc7c', body: 'capsule', head: 'dome', signature: 'sun', accessory: 'contract' },
  iris: { id: 'iris', name: 'Iris', color: '#a7c4ff', body: 'pebble', head: 'rounded', signature: 'blossom', accessory: 'magnifier' },
  wren: { id: 'wren', name: 'Wren', color: '#bfb6ff', body: 'capsule', head: 'dome', signature: 'moon', accessory: 'lantern' },
  fable: { id: 'fable', name: 'Fable', color: '#f2abc2', body: 'pebble', head: 'rounded', signature: 'storybook', accessory: 'satchel' },
  nova: { id: 'nova', name: 'Nova', color: '#e3b1f5', body: 'capsule', head: 'dome', signature: 'constellation', accessory: 'star-trowel' },
};
export const CAST_ORDER: RobotId[] = ['demo', 'moss', 'iris', 'wren', 'lumen', 'fable', 'nova'];
export function look(id: RobotId): RobotLook { return CAST[id] ?? CAST.demo; }
export function appearanceFor(id?: string): RobotId {
  const identities: Record<string, RobotId> = { sprig: 'demo', lens: 'iris', latch: 'wren', moss: 'moss', prism: 'nova', echo: 'fable', rivet: 'lumen' };
  if (id && identities[id.toLowerCase()]) return identities[id.toLowerCase()]!;
  if (!id || ['player', 'seed', 'sprout', 'you'].includes(id.toLowerCase())) return 'demo';
  if (id in CAST) return id as RobotId;
  let hash = 0;
  for (const c of id) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
  return CAST_ORDER[1 + hash % 6]!;
}
