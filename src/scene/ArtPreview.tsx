import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { WorldScene } from './WorldScene';
import { CharacterPortrait } from './CharacterPortrait';

function ArtPreview() {
  const [chapter, setChapter] = useState(1);
  const [tokens, setTokens] = useState(0);
  const [strained, setStrained] = useState(false);
  return <main style={{ maxWidth: 1000, margin: '30px auto', fontFamily: 'system-ui', color: '#dbe4ce' }}>
    <h1 style={{ fontWeight: 500 }}>The Last Garden · art inspection</h1>
    <p>Source-derived robot rigs. Fictional characters. Shared world coordinates.</p>
    <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 20 }}><label>Chapter <select value={chapter} onChange={e => setChapter(Number(e.target.value))}>{[0,1,2,3,4,5,6].map(n => <option key={n} value={n}>{n}</option>)}</select></label><button onClick={() => setStrained(!strained)}>{strained ? 'Restore care' : 'Show strain'}</button><span>Tended: {tokens}</span></div>
    <WorldScene chapter={chapter} producerCount={chapter * 4} quality={strained ? 24 : 70} distortion={strained ? 70 : 12} agency={strained ? 20 : 70} welfare={strained ? 20 : 70} dependence={strained ? 90 : 30} paused={false} reducedMotion={false} onTend={() => setTokens(n => n + 1)} />
    <div style={{ display: 'flex', justifyContent: 'space-around', padding: '30px 0' }}>{['sprig','lens','latch','moss','prism','echo','rivet'].map(id => <div key={id} style={{ textAlign: 'center' }}><CharacterPortrait id={id} size={70} /><div>{id}</div></div>)}</div>
  </main>;
}
createRoot(document.getElementById('root')!).render(<ArtPreview />);
