import { memo, useEffect, useId, useRef, useState, type ReactNode, type CSSProperties } from 'react';
import { Robot } from './robots/Robot';
import { appearanceFor, type RobotId } from './robots/cast';
import type { Expression } from './robots/expressions';
import './world.css';

export type WorldSceneProps = {
  chapter: number;
  producerCount: number;
  quality: number;
  distortion: number;
  agency: number;
  welfare: number;
  dependence: number;
  paused: boolean;
  reducedMotion: boolean;
  onTend: () => void;
  selectedCharacter?: string;
  tendingControl?: ReactNode;
};

const CAMERAS = [
  { name: 'Workbench', x: 1008, y: 1075, scale: 1.84, detail: 'Every future begins with a small act of care.' },
  { name: 'Garden', x: 1000, y: 1005, scale: 1.20, detail: 'A little place worth looking after.' },
  { name: 'Campus', x: 1010, y: 830, scale: .79, detail: 'Knowledge grows between the buildings.' },
  { name: 'Region', x: 1000, y: 790, scale: .57, detail: 'Follow the paths. Everything is connected.' },
  { name: 'Planet', x: 1000, y: 835, scale: .40, detail: 'The original garden is still down there.' },
] as const;

const clamp = (n: number) => Math.max(0, Math.min(100, Number.isFinite(n) ? n : 0));
const CONSERVATORY_ART = `${import.meta.env.BASE_URL}assets/opus/conservatory.svg`;
const SKY_STARS = Array.from({ length: 38 }, (_, i) => ({ x: (i * 197 + 53) % 1200, y: (i * 71 + 19) % 395, r: i % 5 === 0 ? 1.8 : 1, delay: -(i % 9) }));
const TREES = [
  [450, 850, 1.1], [500, 930, .9], [585, 880, .7], [470, 1040, 1.2], [560, 1150, 1.1], [680, 1250, 1.3],
  [810, 1305, .8], [1300, 1240, 1.1], [1400, 1170, 1.4], [1500, 1050, 1], [1570, 930, 1.4], [1480, 800, .9],
  [1390, 710, .8], [475, 690, 1], [595, 580, .8], [710, 490, 1.1], [1250, 440, 1.2], [1390, 520, 1],
] as const;

function Tree({ x, y, scale = 1, color = '#4b7550', fruit = false }: { x: number; y: number; scale?: number; color?: string; fruit?: boolean }) {
  return <g transform={`translate(${x} ${y}) scale(${scale})`}>
    <ellipse cy={4} rx={33} ry={12} fill="#06140e" opacity=".28" />
    <path d="M0 0V-63M0-30L-20-45M0-43L20-62" fill="none" stroke="#715847" strokeWidth="9" strokeLinecap="round" />
    <g className="garden-tree-crown" style={{ animationDelay: `${-(x % 9)}s` }}>
      <path d="M-40-60C-64-91-31-119-12-112C-3-143 41-128 41-100C72-87 51-44 22-47C9-25-35-34-40-60Z" fill={color} stroke="#243f2b" strokeWidth="3" />
      <path d="M-35-90C-27-110-10-105-7-114M10-104Q27-111 36-95" fill="none" stroke="#afd489" strokeWidth="7" strokeLinecap="round" opacity=".35" />
      {fruit && <g fill="#f0ba7b"><circle cx={-24} cy={-79} r={5} /><circle cx={22} cy={-65} r={5} /><circle cx={6} cy={-108} r={4} /></g>}
    </g>
  </g>;
}

function Flower({ x, y, scale = 1, hue = '#d9e9a0', seed = 0, grown = true }: { x: number; y: number; scale?: number; hue?: string; seed?: number; grown?: boolean }) {
  return <g transform={`translate(${x} ${y}) scale(${scale})`}>
    <ellipse rx={10} ry={4} fill="#0a2318" opacity=".4" />
    <g className="garden-plant-sway" style={{ animationDelay: `${-(seed % 7)}s` }}>
      <path d={grown ? 'M0 0Q-3-21 1-43' : 'M0 0Q-3-12 1-23'} fill="none" stroke="#91b97a" strokeWidth="4" strokeLinecap="round" />
      <path d="M-1-14C-25-13-20-32-6-24ZM0-24C19-27 20-12 1-15Z" fill="#89ba76" />
      {grown ? <><path d="M1-52C13-63 23-50 15-41C19-27 1-25-3-34C-18-31-25-49-11-54C-11-65 1-64 1-52Z" fill={hue} /><circle cy={-45} r={6} fill="#fbe7a6" /><circle cx={-2} cy={-47} r={2} fill="#fff9df" /></> : <ellipse cx={1} cy={-26} rx={6} ry={9} fill={hue} />}
    </g>
  </g>;
}

function Bed({ x, y, hue, rows = 3, growth = 100 }: { x: number; y: number; hue: string; rows?: number; growth?: number }) {
  return <g transform={`translate(${x} ${y})`}>
    <path d="M0 10L130-27L197 15V39L65 77L0 34Z" fill="#604b38" stroke="#2c3526" strokeWidth="3" />
    <path d="M0 10L130-27L197 15L65 54Z" fill="#9c8060" stroke="#b39b70" strokeWidth="2" />
    <path d="M13 11L128-20L182 14L67 47Z" fill="#3c3930" />
    <path d="M65 54V77M11 32L55 59M78 61L183 32" stroke="#bb9570" strokeWidth="2" opacity=".5" />
    {Array.from({ length: rows }, (_, i) => <Flower key={i} x={42 + i * 46} y={19 - i * 12} hue={hue} scale={.85 + i % 2 * .18} seed={x + i * 2} grown={growth > 25 + i * 12} />)}
    <g transform="translate(162 30) rotate(-16)"><path d="M0 0V25" stroke="#b29467" strokeWidth="3" /><rect x={-10} y={-10} width={20} height={16} rx={2} fill="#e2d5aa" /><path d="M-5-3H5M-5 1H2" stroke="#6a754f" strokeWidth="2" /></g>
  </g>;
}

function Greenhouse({ x, y, scale = 1 }: { x: number; y: number; scale?: number }) {
  return <g transform={`translate(${x} ${y}) scale(${scale})`}>
    <ellipse cx={10} cy={16} rx={150} ry={47} fill="#142c20" opacity=".35" />
    {/* Complete unmodified SVG authored by Opus 5.5 with Max requested; see ART_PROVENANCE. */}
    <image href={CONSERVATORY_ART} x={-180} y={-260} width={360} height={300} preserveAspectRatio="xMidYMid meet" />
  </g>;
}

function Building({ x, y, width = 100, height = 90, color = '#77999c', kind = 'lab', active = true }: { x: number; y: number; width?: number; height?: number; color?: string; kind?: 'lab' | 'home' | 'tower'; active?: boolean }) {
  const d = width * .48;
  return <g transform={`translate(${x} ${y})`} opacity={active ? 1 : .22}>
    <path d={`M${-width / 2} 0L0 ${d / 2}L${width / 2} 0L0 ${-d / 2}Z`} fill="#162d26" transform="translate(12 10) scale(1.25)" opacity=".5" />
    <path d={`M${-width / 2} ${-height}L0 ${-height + d / 2}V${d / 2}L${-width / 2} 0Z`} fill={color} stroke="#1e3c32" strokeWidth="2" />
    <path d={`M0 ${-height + d / 2}L${width / 2} ${-height}V0L0 ${d / 2}Z`} fill="#2f5149" stroke="#1e3c32" strokeWidth="2" />
    <path d={`M${-width / 2} ${-height}L0 ${-height - d / 2}L${width / 2} ${-height}L0 ${-height + d / 2}Z`} fill={kind === 'home' ? '#b19d7e' : '#a5c5b1'} stroke="#365d49" strokeWidth="2" />
    {Array.from({ length: Math.min(5, Math.floor(height / 25)) }, (_, i) => <g key={i} fill={active ? '#e7dba3' : '#46655a'} opacity={.65 + i % 2 * .3}>
      <path d={`M${-width * .4} ${-height + 15 + i * 24}l${width * .13} ${width * .06}v10l${-width * .13} ${-width * .06}Z`} /><path d={`M${-width * .2} ${-height + 24 + i * 24}l${width * .13} ${width * .06}v10l${-width * .13} ${-width * .06}Z`} />
      <path d={`M${width * .1} ${-height + d / 2 + 7 + i * 24}l${width * .28} ${-width * .13}v10l${-width * .28} ${width * .13}Z`} />
    </g>)}
    {kind === 'lab' && <g transform={`translate(0 ${-height - 10})`}><ellipse cy={0} rx={20} ry={10} fill="#355b50" stroke="#d0ddba" strokeWidth="2" /><path d="M0 0V-34M-15-23L0-34L15-23" fill="none" stroke="#b1cebd" strokeWidth="3" /><circle cy={-34} r={4} fill="#e9dda9" className="garden-status-light" /></g>}
    {kind === 'tower' && <><path d={`M0 ${-height - d / 2}V${-height - 50}`} stroke="#a4c8c0" strokeWidth="3" /><circle cy={-height - 50} r={4} fill="#d6edd0" className="garden-status-light" /></>}
  </g>;
}

function Bench({ x, y }: { x: number; y: number }) {
  return <g transform={`translate(${x} ${y})`}>
    <path d="M-50-4V38M39 21V59M97-13V24" stroke="#645342" strokeWidth="10" />
    <path d="M-66-17L11-53L109-5L33 31Z" fill="#b5996b" stroke="#4b5139" strokeWidth="3" />
    <path d="M-66-17V-6L33 42L109 6V-5L33 31Z" fill="#806645" stroke="#4b5139" strokeWidth="2" />
    <path d="M-44-25L52 20M-25-35L72 10M-4-44L92 0" stroke="#dac295" strokeWidth="2" opacity=".55" />
    <g transform="translate(18 -42)"><path d="M-20-10L8-23L29-12L1 0Z" fill="#ddd7b1" /><path d="M-13-11L9-20M-8-8L14-17M-2-6L20-14" stroke="#8d9a79" strokeWidth="2" /></g>
    <path d="M-31-34V-59H-10V-24Q-21-19-31-27Z" fill="#779d80" stroke="#385e42" strokeWidth="2" /><ellipse cx={-20.5} cy={-59} rx={10.5} ry={5} fill="#9bba91" /><path d="M-10-52Q8-55 3-39H-10" fill="none" stroke="#779d80" strokeWidth="5" />
    <g transform="translate(61 -8)"><ellipse cy={2} rx={14} ry={6} fill="#73573c" /><path d="M-14-14H14L10 2H-10Z" fill="#ba875e" /><Flower x={0} y={-15} scale={.48} hue="#f0bfbe" /></g>
  </g>;
}

const WorldTerrain = memo(function WorldTerrain({ uid, chapter, quality, distortion, agency, welfare, dependence }: { uid: string; chapter: number; quality: number; distortion: number; agency: number; welfare: number; dependence: number }) {
  const danger = distortion > 55 || dependence > 83;
  const thriving = welfare >= 50 && quality >= 45;
  const campus = chapter >= 2;
  const city = chapter >= 4;
  const planet = chapter >= 5;
  return <svg className="garden-terrain" width="2000" height="1600" viewBox="0 0 2000 1600" aria-hidden="true">
    <defs>
      <radialGradient id={`${uid}-land`} cx="48%" cy="42%" r="64%"><stop stopColor={thriving ? '#416447' : '#324d3b'} /><stop offset=".55" stopColor="#294b36" /><stop offset="1" stopColor="#18382d" /></radialGradient>
      <linearGradient id={`${uid}-water`} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#356c62" /><stop offset="1" stopColor="#20423d" /></linearGradient>
      <linearGradient id={`${uid}-soil`} x1="0" y1="0" x2="0" y2="1"><stop stopColor="#79845e" /><stop offset="1" stopColor="#4e6b47" /></linearGradient>
      <filter id={`${uid}-bloom`} x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="8" /></filter>
      <clipPath id={`${uid}-world-edge`}><ellipse cx="1000" cy="900" rx="950" ry="580" /></clipPath>
    </defs>
    <ellipse cx="1000" cy="950" rx="970" ry="590" fill="#071c20" opacity=".8" />
    <ellipse cx="1000" cy="920" rx="970" ry="590" fill="#163532" stroke="#547d68" strokeWidth="3" />
    <ellipse cx="1000" cy="900" rx="950" ry="580" fill={`url(#${uid}-land)`} stroke="#648e67" strokeWidth="3" />
    <g clipPath={`url(#${uid}-world-edge)`}>
      <path d="M-70 755C180 810 210 440 565 480S911 690 1140 530S1510 400 2000 610V280H-70Z" fill="#315b43" opacity=".5" />
      <path d="M-70 660C310 840 270 1220 650 1160S970 1350 1190 1270S1490 850 2070 1000" fill="none" stroke="#163e35" strokeWidth="74" />
      <path d="M-70 660C310 840 270 1220 650 1160S970 1350 1190 1270S1490 850 2070 1000" fill="none" stroke={`url(#${uid}-water)`} strokeWidth="56" />
      <path d="M-70 650C310 830 270 1210 650 1150S970 1340 1190 1260S1490 840 2070 990" className="garden-river-flow" fill="none" stroke="#72aaa1" strokeWidth="2" strokeDasharray="28 49 110 25" opacity=".4" />
      {Array.from({ length: 22 }, (_, i) => <path key={i} d={`M${120 + i * 90} 430L${-550 + i * 125} 1500`} stroke="#aad38c" strokeWidth="1" opacity=".035" />)}
      <path d="M690 860L1050 720L1385 902L1170 1135L890 1170L650 1020Z" fill={`url(#${uid}-soil)`} opacity=".5" />
      <path d="M540 780L890 995L1000 1080L1330 905L1510 660M875 1000L960 775L765 650M960 775L1210 660L1190 450M1000 1080L1190 1260M765 650L650 490" fill="none" stroke="#203d2b" strokeWidth="39" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M540 780L890 995L1000 1080L1330 905L1510 660M875 1000L960 775L765 650M960 775L1210 660L1190 450M1000 1080L1190 1260M765 650L650 490" fill="none" stroke="#839171" strokeWidth="29" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M540 780L890 995L1000 1080L1330 905L1510 660M875 1000L960 775L765 650M960 775L1210 660L1190 450" className="garden-network-flow" fill="none" stroke={danger ? '#e3a180' : '#d5dfaa'} strokeWidth="2" strokeDasharray="3 28" opacity=".6" />
      <g transform="translate(1190 1260) rotate(-28)"><rect x="-28" y="-51" width="56" height="102" rx="4" fill="#b19a75" stroke="#4b5b40" strokeWidth="4" />{[0, 1, 2, 3, 4, 5].map(i => <path key={i} d={`M-27 ${-40 + i * 16}H27`} stroke="#715e44" strokeWidth="2" />)}<path d="M-33-56V56M33-56V56" stroke="#d0b688" strokeWidth="4" /></g>
      <g opacity={planet ? 1 : .3}>
        <Building x={1190} y={450} width={130} height={planet ? 190 : 75} color="#779ba0" kind="tower" active={planet} />
        <Building x={650} y={510} width={100} height={75} color="#759779" active={planet} />
        <path d="M1200 410Q1450 220 1740 450M1200 410Q900 200 650 470" stroke="#c8dda8" strokeWidth="2" strokeDasharray="4 12" fill="none" opacity=".5" />
      </g>
      {TREES.filter((_, i) => !danger || i % 3 !== 0).map(([x, y, scale], i) => <Tree key={i} x={x} y={y} scale={scale} fruit={thriving && i % 3 === 0} color={i % 3 === 0 ? '#64865a' : i % 3 === 1 ? '#426c50' : '#51764e'} />)}
      <g className="garden-campus" opacity={campus ? 1 : .2}>
        <Building x={750} y={720} width={140} height={108} color="#88a99c" active={campus} />
        <Building x={975} y={658} width={130} height={145} color="#94a6b1" active={campus} />
        <Building x={1110} y={780} width={115} height={100} color="#b0a0b4" active={campus} />
        {chapter >= 3 && <><Building x={685} y={810} width={110} height={75} color="#bdab87" kind="home" /><Building x={1200} y={670} width={115} height={80} color="#87b2a0" /></>}
        <path d="M735 709L958 653L1100 775M965 653L1190 666" stroke="#b1d4bc" strokeWidth="2" strokeDasharray="5 9" fill="none" className="garden-network-flow" />
        <g transform="translate(895 740)"><ellipse rx="48" ry="23" fill="#546e55" /><ellipse cy="-6" rx="32" ry="15" fill="#8aa397" stroke="#a0be9e" strokeWidth="3" /><ellipse cy="-8" rx="25" ry="10" fill="#56877c" /><path d="M-9-12Q0-38 9-12M0-14V-40" fill="none" stroke="#b0d7b4" strokeWidth="2" className="garden-fountain" /></g>
      </g>
      <g opacity={city ? 1 : .18}>
        <Building x={1390} y={710} width={125} height={city ? 176 : 100} kind="tower" color="#729a9c" active={city} />
        <Building x={1500} y={785} width={115} height={city ? 230 : 95} kind="tower" color="#8eabc2" active={city} />
        <Building x={1350} y={845} width={100} height={125} color="#b6b79a" kind="home" active={city} />
        <Building x={1550} y={620} width={100} height={155} color="#a6b5b1" active={city} />
        {city && <><Building x={1630} y={735} width={92} height={115} color="#809ca5" kind="home" /><Building x={1450} y={925} width={90} height={80} color="#b1a58e" kind="home" /></>}
      </g>
      <g className="garden-solar-field" opacity={chapter >= 2 ? .9 : .25} transform="translate(590 910)">{[0, 1, 2].map(i => <g key={i} transform={`translate(${i * 56} ${i * 27})`}><path d="M0 0V28M40-20V8" stroke="#879e88" strokeWidth="4" /><path d="M-21-15L23-37L55-16L11 6Z" fill="#344f61" stroke="#96b8b5" strokeWidth="2" /><path d="M-9-21L23 0M5-29L39-8M-5-5L38-27" stroke="#607f8d" strokeWidth="1.5" /></g>)}</g>
      <Tree x={795} y={925} scale={1.05} color="#70905e" fruit={thriving} />
      <Greenhouse x={1120} y={945} />
      <g transform="translate(850 1075)"><ellipse rx="95" ry="35" fill="#93a76c" opacity=".18" /><Bed x={-95} y={-10} hue={thriving ? '#e3b6c3' : '#bba98b'} growth={quality} /></g>
      <Bed x={1105} y={1045} hue="#dbdfa2" growth={quality} />
      <Bed x={1025} y={1165} hue="#b2c4e5" rows={3} growth={quality + 15} />
      {chapter > 0 && <Bed x={1215} y={1130} hue="#b7d5b1" growth={welfare} />}
      <Bench x={882} y={1005} />
      <g transform="translate(745 1020)"><path d="M0 0V-65" stroke="#a49066" strokeWidth="6" /><path d="M-39-74L32-85L42-53L-31-42Z" fill="#a68d61" stroke="#4b5a39" strokeWidth="3" /><path d="M-27-66L24-74M-24-57L13-63" stroke="#eadab4" strokeWidth="3" strokeLinecap="round" /><path d="M-5-13L-18-4M4-11L16-4" stroke="#72854d" strokeWidth="3" /></g>
      <g transform="translate(935 1122)"><ellipse cy="8" rx="23" ry="9" fill="#172a1c" opacity=".3" /><path d="M-14-24L17-23L14 4Q0 14-14 4Z" fill="#b28760" stroke="#654f39" strokeWidth="2" /><ellipse cy="-24" rx="16" ry="7" fill="#635b40" /><Flower x={0} y={-25} scale={.65} hue="#d4e59c" /></g>
      <g transform="translate(1278 1000)"><path d="M0 0V-95" stroke="#8c9775" strokeWidth="5" /><path d="M-12-84L0-106L12-84V-59H-12Z" fill="#c5b689" stroke="#526443" strokeWidth="3" /><path d="M-7-82H7V-64H-7Z" fill="#f5d996" /><ellipse cy="-74" rx="22" ry="30" fill="#f1df9c" opacity=".1" filter={`url(#${uid}-bloom)`} /></g>
      <g opacity={agency < 30 ? .9 : .12} stroke="#bbaa84" fill="none" strokeWidth="3"><path d="M720 1060L895 1165L1070 1210M720 1060V1025M765 1087V1052M810 1115V1080M855 1142V1107M895 1165V1130M950 1178V1143M1005 1193V1158M1070 1210V1175" /></g>
      {thriving && Array.from({ length: 16 }, (_, i) => <Flower key={i} x={710 + (i * 137) % 680} y={950 + (i * 73) % 280} scale={.23 + i % 3 * .06} hue={i % 2 ? '#f6d798' : '#d7b2cb'} seed={i} />)}
      <g opacity={danger ? .75 : .15}><path d="M1225 880L1250 895L1225 910L1200 895Z" fill="#b78b72" /><path d="M1225 886V897M1225 901V903" stroke="#f6e0c2" strokeWidth="3" /></g>
    </g>
    <g opacity={planet ? 1 : .35}>
      <path d="M100 580C60 210 1740 110 1910 720" fill="none" stroke="#91c8b0" strokeWidth="2" strokeDasharray="7 14" opacity=".28" />
      <g transform="translate(1680 360) rotate(18)"><path d="M-10 0H-60M10 0H60" stroke="#b4ccbf" strokeWidth="5" /><rect x="-85" y="-20" width="40" height="40" fill="#567c8b" stroke="#a4baba" strokeWidth="3" /><rect x="45" y="-20" width="40" height="40" fill="#567c8b" stroke="#a4baba" strokeWidth="3" /><path d="M-65-20V20M-85 0H-45M65-20V20M45 0H85" stroke="#a4baba" /><rect x="-16" y="-18" width="32" height="36" rx="9" fill="#dfd7b7" /><circle r="6" fill="#507b74" /></g>
    </g>
  </svg>;
});

function useArtClock(stopped: boolean) {
  const [frame, setFrame] = useState(40);
  const elapsed = useRef(40);
  useEffect(() => {
    if (stopped) return;
    let request = 0;
    let last = performance.now();
    const tick = (now: number) => {
      if (now - last > 65) {
        // 15 FPS rig, at the original 30 FPS pose speed. The clock never drives the economy.
        elapsed.current = (elapsed.current + Math.min(100, now - last) * .03) % 3600;
        last = now;
        setFrame(elapsed.current);
      }
      request = requestAnimationFrame(tick);
    };
    request = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(request);
  }, [stopped]);
  return frame;
}

function GardenRobots({ stopped, count, welfare, distortion, selected, camera }: { stopped: boolean; count: number; welfare: number; distortion: number; selected?: string; camera: number }) {
  const t = useArtClock(stopped);
  const mainExpression: Expression = welfare < 25 ? 'wistful' : distortion > 55 ? 'worried' : 'happy';
  const workers: { id: RobotId; x: number; y: number; h: number; task: 'work' | 'walk' | 'think' | 'listen'; seed: number }[] = [
    { id: 'moss', x: 1175, y: 1110, h: 82, task: 'work', seed: 23 },
    { id: 'iris', x: 950, y: 805, h: 64, task: 'think', seed: 55 },
    { id: 'fable', x: 710, y: 880, h: 62, task: 'walk', seed: 76 },
    { id: 'wren', x: 1330, y: 945, h: 65, task: 'listen', seed: 118 },
    { id: 'lumen', x: 690, y: 1060, h: 63, task: 'walk', seed: 191 },
    { id: 'nova', x: 1225, y: 744, h: 60, task: 'think', seed: 222 },
  ];
  const visibleCount = Math.min(workers.length, Math.ceil(Math.log2(Math.max(1, count + 1))));
  return <div className="garden-robots" aria-hidden="true">
    {workers.slice(0, visibleCount).map(worker => <Robot key={worker.id} id={worker.id} x={worker.x + (worker.task === 'walk' && !stopped ? Math.sin(t / 110 + worker.seed) * 32 : 0)} y={worker.y} height={worker.h} pose={worker.task} expression={welfare < 25 ? 'worried' : 'focused'} t={t + worker.seed} seed={worker.seed} facing={worker.seed % 2 ? 'left' : 'right'} />)}
    <Robot id={appearanceFor(selected)} x={1000} y={1090} height={camera === 0 ? 123 : 128} pose={stopped ? 'idle' : 'hold'} expression={mainExpression} t={t} seed={17} />
  </div>;
}

export function WorldScene({ chapter, producerCount, quality, distortion, agency, welfare, dependence, paused, reducedMotion, onTend, selectedCharacter, tendingControl }: WorldSceneProps) {
  const uid = `garden-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const host = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(900);
  const [camera, setCamera] = useState(1);
  const [visible, setVisible] = useState(true);
  const [hidden, setHidden] = useState(() => typeof document !== 'undefined' && document.hidden);
  const [localPause, setLocalPause] = useState(false);
  const [tendPulse, setTendPulse] = useState(0);
  const pulseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopped = paused || reducedMotion || localPause || !visible || hidden;
  const view = CAMERAS[camera]!;
  const harm = clamp(distortion);
  const wellbeing = clamp(welfare);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const resize = new ResizeObserver(([entry]) => { if (entry) setWidth(entry.contentRect.width); });
    const intersection = new IntersectionObserver(([entry]) => setVisible(entry?.isIntersecting ?? true), { threshold: .05 });
    resize.observe(element);
    intersection.observe(element);
    const change = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', change);
    return () => { resize.disconnect(); intersection.disconnect(); document.removeEventListener('visibilitychange', change); };
  }, []);
  useEffect(() => () => { if (pulseTimer.current) clearTimeout(pulseTimer.current); }, []);

  const tend = () => {
    if (paused) return;
    onTend();
    if (!reducedMotion) {
      setTendPulse(n => n + 1);
      if (pulseTimer.current) clearTimeout(pulseTimer.current);
      pulseTimer.current = setTimeout(() => setTendPulse(0), 1100);
    }
  };
  const civilization = chapter < 2 ? 'A garden begins' : chapter < 4 ? 'A campus awakens' : chapter < 6 ? 'A civilization takes root' : 'What will remain?';
  const climate = wellbeing < 30 ? 'The garden needs care' : harm > 55 ? 'Something is out of balance' : clamp(agency) < 30 ? 'Quiet behind the fences' : 'Room for things to grow';
  return <section className={`garden-world${stopped ? ' garden-motion-paused' : ''}${reducedMotion ? ' garden-reduced-motion' : ''}`} aria-label="The living garden" style={{ '--garden-danger': harm / 100, '--garden-warmth': wellbeing / 100 } as CSSProperties}>
    <div className="garden-world-topline"><span className="garden-live-dot" /><span>{civilization}</span><span className="garden-weather">{wellbeing >= 50 ? '✦' : '☾'} {climate}</span></div>
    <div className="garden-viewport" ref={host}>
      <div className="garden-sky" />
      <svg className="garden-sky-details" viewBox="0 0 1200 720" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <defs><radialGradient id={`${uid}-moon`}><stop stopColor="#eff0bd" stopOpacity=".16" /><stop offset="1" stopColor="#eff0bd" stopOpacity="0" /></radialGradient></defs>
        <ellipse cx="1020" cy="120" rx="170" ry="160" fill={`url(#${uid}-moon)`} /><circle cx="1020" cy="120" r="24" fill="#d8ddb4" opacity=".7" /><circle cx="1030" cy="110" r="23" fill="#203b36" />
        {SKY_STARS.map((star, i) => <circle key={i} cx={star.x} cy={star.y} r={star.r} fill="#d1e3c5" className="garden-star" style={{ animationDelay: `${star.delay}s` }} />)}
        <path d="M-40 370Q180 190 340 330T680 300T1020 320T1300 250V720H-40Z" fill="#1d3a31" opacity=".65" />
        <path d="M-40 480Q150 330 350 400T700 380T1020 440T1300 360V720H-40Z" fill="#254336" opacity=".55" />
        <path d="M-40 575Q180 400 390 540T810 490T1250 510V720H-40Z" fill="#2c4938" opacity=".4" />
      </svg>
      <div className="garden-fit" style={{ transform: `scale(${width / 1200})`, width: 1200, height: 720 }}>
        <div className="garden-camera" style={{ transform: `translate(600px,360px) scale(${view.scale}) translate(${-view.x}px,${-view.y}px)` }}>
          <WorldTerrain uid={uid} chapter={chapter} quality={clamp(quality)} distortion={harm} agency={clamp(agency)} welfare={wellbeing} dependence={clamp(dependence)} />
          <GardenRobots stopped={stopped} count={Math.max(0, producerCount)} welfare={wellbeing} distortion={harm} selected={selectedCharacter} camera={camera} />
          <button className="garden-tend-target" style={{ left: 963, top: 1014 }} onClick={tend} aria-label="Tend the garden and make useful tokens" disabled={paused}><span className="garden-tend-ring" /></button>
          {tendPulse > 0 && <span key={tendPulse} className="garden-token-flight" style={{ left: 1025, top: 990 }} aria-hidden="true"><span>✦</span><span>✧</span><span>✦</span></span>}
          {camera >= 2 && <><span className="garden-landmark garden-landmark-seed" style={{ left: 975, top: 1140 }}>The first garden</span><span className="garden-landmark" style={{ left: 820, top: 615 }}>{chapter >= 2 ? 'Research commons' : 'Future commons'}</span><span className="garden-landmark" style={{ left: 1420, top: 550 }}>{chapter >= 4 ? 'The growing city' : 'A possible city'}</span></>}
          {Array.from({ length: 12 }, (_, i) => <i key={i} className="garden-firefly" style={{ left: 680 + i * 57, top: 900 + i % 4 * 62, animationDelay: `${-i * .73}s`, animationDuration: `${6 + i % 5}s` }} />)}
        </div>
      </div>
      <div className="garden-daylight" aria-hidden="true" />
      <div className="garden-vignette" aria-hidden="true" />
      <div className="garden-scene-caption"><strong>{view.name === 'Garden' ? 'The original garden' : view.name}</strong><span>{view.detail}</span></div>
      {tendingControl && <div className="garden-tending-control">{tendingControl}</div>}
      <button className="garden-motion-button" aria-label={localPause ? 'Resume world animation' : 'Pause world animation'} title={reducedMotion ? 'Reduced motion is enabled in settings' : paused ? 'Resume the game to animate the world' : localPause ? 'Resume world animation' : 'Pause world animation'} onClick={() => setLocalPause(value => !value)} disabled={reducedMotion || paused}>{stopped ? '▶' : 'Ⅱ'}</button>
    </div>
    <div className="garden-world-toolbar">
      <div className="garden-camera-controls" role="group" aria-label="World camera scale">{CAMERAS.map((item, index) => <button key={item.name} className={camera === index ? 'is-current' : ''} aria-pressed={camera === index} onClick={() => setCamera(index)} title={item.detail}><span className="garden-camera-dot" />{item.name}</button>)}</div>
      {!tendingControl && <button className="garden-tend-button" onClick={tend} disabled={paused}><span aria-hidden="true">✧</span> Tend garden <kbd>↵</kbd></button>}
    </div>
    <p className="garden-screen-reader" aria-live="polite">{view.name} view. {climate}. {Math.max(0, Math.floor(producerCount))} producers are represented by a bounded group of workers.</p>
  </section>;
}

export default WorldScene;
