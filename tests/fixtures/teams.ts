/**
 * Synthetische Test-Mannschaften (frei erfundene Spieler, keine echten Daten).
 * - pressTeam: 4-2-3-1, hohes Pressing, hohe Linie (Stil "2020")
 * - sweeperTeam: 3-5-2 mit Libero und Schienenspielern, kompakt, konterstark (Stil "2001")
 * - weakTeam: 4-4-2, deutlich schwächere Spieler
 */

import type { LineupSlot, Player, PlayerAttributes, Position, Role, Tactic, TeamSheet, Vec2 } from '../../src/engine/types';

type Profile = Partial<PlayerAttributes>;

const BASE: PlayerAttributes = {
  pace: 70,
  acceleration: 70,
  stamina: 72,
  strength: 70,
  firstTouch: 70,
  dribbling: 66,
  shortPassing: 72,
  longPassing: 66,
  crossing: 60,
  finishing: 55,
  longShots: 55,
  heading: 62,
  tackling: 62,
  marking: 62,
  positioning: 62,
  vision: 64,
  composure: 68,
  workRate: 70,
  gkReflexes: 15,
  gkHandling: 15,
  gkPositioning: 15,
  gkDistribution: 15,
};

const PROFILES: Record<string, Profile> = {
  GK: { gkReflexes: 82, gkHandling: 78, gkPositioning: 80, gkDistribution: 70, pace: 50, dribbling: 30, finishing: 20, tackling: 25, marking: 25, crossing: 30, heading: 40 },
  SW: { marking: 82, tackling: 76, vision: 78, shortPassing: 76, longPassing: 76, heading: 74, composure: 80, finishing: 40, crossing: 50 },
  CB: { marking: 80, tackling: 80, heading: 80, strength: 80, pace: 68, finishing: 38, dribbling: 52, crossing: 45 },
  FB: { pace: 80, acceleration: 78, stamina: 80, tackling: 74, marking: 72, crossing: 72, finishing: 45, heading: 60 },
  WB: { pace: 82, acceleration: 80, stamina: 86, tackling: 70, marking: 66, crossing: 78, dribbling: 72, finishing: 50 },
  DM: { tackling: 80, marking: 76, shortPassing: 78, longPassing: 72, vision: 72, stamina: 80, workRate: 82, finishing: 50 },
  CM: { shortPassing: 80, longPassing: 76, vision: 78, stamina: 80, tackling: 68, longShots: 70, finishing: 62, dribbling: 72 },
  AM: { shortPassing: 80, vision: 84, dribbling: 80, firstTouch: 82, finishing: 72, longShots: 74, tackling: 45, marking: 40 },
  W: { pace: 86, acceleration: 86, dribbling: 82, crossing: 74, finishing: 70, firstTouch: 78, tackling: 42, marking: 40, heading: 52 },
  ST: { finishing: 84, positioning: 84, composure: 80, heading: 76, strength: 76, firstTouch: 76, dribbling: 70, tackling: 38, marking: 32, shortPassing: 68 },
  TM: { heading: 86, strength: 86, finishing: 80, positioning: 80, composure: 76, pace: 62, dribbling: 60, tackling: 42, marking: 36 },
};

function makePlayer(prefix: string, idx: number, pos: Position, profile: keyof typeof PROFILES, delta: number, extra: Profile = {}, heightCm = 182): Player {
  const attrs = { ...BASE, ...PROFILES[profile], ...extra } as PlayerAttributes;
  const out = {} as PlayerAttributes;
  for (const k of Object.keys(attrs) as (keyof PlayerAttributes)[]) {
    const isGkAttr = k.startsWith('gk');
    const v = attrs[k] + (isGkAttr && pos !== 'GK' ? 0 : delta);
    out[k] = Math.max(1, Math.min(99, Math.round(v)));
  }
  const id = `${prefix}-${idx}`;
  return {
    id,
    name: `${prefix.toUpperCase()} Spieler ${idx}`,
    shortName: `${prefix.charAt(0).toUpperCase()}${prefix.slice(1)}${idx}`,
    number: idx,
    positions: [pos],
    foot: idx % 3 === 0 ? 'left' : 'right',
    heightCm,
    overall: Math.round(74 + delta),
    attributes: out,
    confidence: 'geschätzt',
    sources: ['Synthetischer Testdatensatz'],
  };
}

interface SlotDef {
  pos: Position;
  role: Role;
  profile: keyof typeof PROFILES;
  att: Vec2;
  def: Vec2;
  extra?: Profile;
  height?: number;
}

function buildTeam(o: {
  id: string;
  name: string;
  shortName: string;
  season: string;
  era: number;
  delta: number;
  tactic: Omit<Tactic, 'freeKickTakers' | 'cornerTakers' | 'penaltyTakers' | 'captain'>;
  slots: SlotDef[];
  bench: { pos: Position; profile: keyof typeof PROFILES }[];
  coach: TeamSheet['coach'];
  colors: TeamSheet['colors'];
  setPieceIdx: { fk: number; corner: number; pen: number; captain: number };
}): TeamSheet {
  const prefix = o.id.replace(/[^a-z]/g, '').slice(0, 6);
  const starters = o.slots.map((s, i) => makePlayer(prefix, i + 1, s.pos, s.profile, o.delta, s.extra, s.height));
  const bench = o.bench.map((b, i) => makePlayer(prefix, 12 + i, b.pos, b.profile, o.delta - 3));
  const lineup: LineupSlot[] = o.slots.map((s, i) => ({
    playerId: starters[i]!.id,
    position: s.pos,
    role: s.role,
    anchorAttack: s.att,
    anchorDefend: s.def,
  }));
  const id = (i: number): string => starters[i]!.id;
  return {
    id: o.id,
    name: o.name,
    shortName: o.shortName,
    season: o.season,
    era: o.era,
    colors: o.colors,
    coach: o.coach,
    tactic: {
      ...o.tactic,
      freeKickTakers: [id(o.setPieceIdx.fk)],
      cornerTakers: [id(o.setPieceIdx.corner)],
      penaltyTakers: [id(o.setPieceIdx.pen)],
      captain: id(o.setPieceIdx.captain),
    },
    lineup,
    bench,
    players: [...starters, ...bench],
    notes: 'Synthetische Testmannschaft',
  };
}

const BENCH_STD: { pos: Position; profile: keyof typeof PROFILES }[] = [
  { pos: 'GK', profile: 'GK' },
  { pos: 'CB', profile: 'CB' },
  { pos: 'RB', profile: 'FB' },
  { pos: 'CM', profile: 'CM' },
  { pos: 'DM', profile: 'DM' },
  { pos: 'RW', profile: 'W' },
  { pos: 'ST', profile: 'ST' },
];

/** 4-2-3-1, hohes Pressing, hohe Linie */
export function pressTeam(opts: { era?: number; delta?: number; id?: string } = {}): TeamSheet {
  return buildTeam({
    id: opts.id ?? 'test-press',
    name: 'Testelf Pressing',
    shortName: 'Pressing',
    season: '2019/20',
    era: opts.era ?? 2020,
    delta: opts.delta ?? 0,
    tactic: {
      formation: '4-2-3-1',
      pressingHeight: 0.85,
      pressingIntensity: 0.85,
      defensiveLine: 0.8,
      width: 0.7,
      directness: 0.45,
      tempo: 0.75,
      crossingFocus: 0.45,
      counterAttack: 0.6,
      manMarking: 0.1,
      offsideTrap: 0.6,
      gameManagement: 0.3,
    },
    slots: [
      { pos: 'GK', role: 'goalkeeper', profile: 'GK', att: { x: 8, y: 34 }, def: { x: 5, y: 34 }, extra: { gkDistribution: 80 }, height: 192 },
      { pos: 'RB', role: 'full-back', profile: 'FB', att: { x: 52, y: 62 }, def: { x: 26, y: 58 } },
      { pos: 'CB', role: 'ball-playing-cb', profile: 'CB', att: { x: 38, y: 44 }, def: { x: 20, y: 42 }, height: 190 },
      { pos: 'CB', role: 'centre-back', profile: 'CB', att: { x: 38, y: 24 }, def: { x: 20, y: 26 }, height: 188 },
      { pos: 'LB', role: 'full-back', profile: 'FB', att: { x: 52, y: 6 }, def: { x: 26, y: 10 } },
      { pos: 'DM', role: 'holding-mid', profile: 'DM', att: { x: 50, y: 40 }, def: { x: 36, y: 40 } },
      { pos: 'CM', role: 'box-to-box', profile: 'CM', att: { x: 56, y: 28 }, def: { x: 38, y: 28 } },
      { pos: 'RW', role: 'inside-forward', profile: 'W', att: { x: 80, y: 56 }, def: { x: 52, y: 56 } },
      { pos: 'AM', role: 'advanced-playmaker', profile: 'AM', att: { x: 76, y: 34 }, def: { x: 54, y: 34 } },
      { pos: 'LW', role: 'winger', profile: 'W', att: { x: 80, y: 12 }, def: { x: 52, y: 12 } },
      { pos: 'ST', role: 'complete-forward', profile: 'ST', att: { x: 92, y: 34 }, def: { x: 62, y: 34 }, height: 186 },
    ],
    bench: BENCH_STD,
    coach: { name: 'Testtrainer A', firstSubMinute: 60, aggressionWhenTrailing: 0.7, cautionWhenLeading: 0.4, maxSubs: 5 },
    colors: { primary: '#d00027', secondary: '#ffffff', numbers: '#ffffff', gkPrimary: '#1a1a1a' },
    setPieceIdx: { fk: 8, corner: 6, pen: 10, captain: 2 },
  });
}

/** 3-5-2 mit Libero und Schienenspielern, kompakt, Konter und Standards */
export function sweeperTeam(opts: { era?: number; delta?: number; id?: string } = {}): TeamSheet {
  return buildTeam({
    id: opts.id ?? 'test-libero',
    name: 'Testelf Libero',
    shortName: 'Libero',
    season: '2000/01',
    era: opts.era ?? 2001,
    delta: opts.delta ?? -2, // Profile (Libero, Schienenspieler) sind etwas höher, so gleich stark wie pressTeam
    tactic: {
      formation: '3-5-2',
      pressingHeight: 0.3,
      pressingIntensity: 0.4,
      defensiveLine: 0.3,
      width: 0.6,
      directness: 0.6,
      tempo: 0.55,
      crossingFocus: 0.75,
      counterAttack: 0.8,
      manMarking: 0.65,
      offsideTrap: 0.15,
      gameManagement: 0.7,
    },
    slots: [
      { pos: 'GK', role: 'goalkeeper', profile: 'GK', att: { x: 7, y: 34 }, def: { x: 4.5, y: 34 }, extra: { gkReflexes: 86, gkPositioning: 84 }, height: 188 },
      { pos: 'SW', role: 'sweeper', profile: 'SW', att: { x: 28, y: 34 }, def: { x: 13, y: 34 }, height: 186 },
      { pos: 'CB', role: 'stopper', profile: 'CB', att: { x: 34, y: 48 }, def: { x: 17, y: 46 }, height: 190 },
      { pos: 'CB', role: 'stopper', profile: 'CB', att: { x: 34, y: 20 }, def: { x: 17, y: 22 }, height: 189 },
      { pos: 'RWB', role: 'wing-back', profile: 'WB', att: { x: 66, y: 63 }, def: { x: 30, y: 60 } },
      { pos: 'DM', role: 'holding-mid', profile: 'DM', att: { x: 44, y: 34 }, def: { x: 28, y: 34 }, extra: { strength: 80 } },
      { pos: 'CM', role: 'deep-playmaker', profile: 'CM', att: { x: 54, y: 44 }, def: { x: 34, y: 42 } },
      { pos: 'CM', role: 'box-to-box', profile: 'CM', att: { x: 56, y: 24 }, def: { x: 34, y: 26 } },
      { pos: 'LWB', role: 'wing-back', profile: 'WB', att: { x: 66, y: 5 }, def: { x: 30, y: 8 } },
      { pos: 'ST', role: 'target-man', profile: 'TM', att: { x: 88, y: 40 }, def: { x: 52, y: 40 }, height: 192 },
      { pos: 'ST', role: 'poacher', profile: 'ST', att: { x: 90, y: 28 }, def: { x: 54, y: 28 } },
    ],
    bench: BENCH_STD,
    coach: { name: 'Testtrainer B', firstSubMinute: 65, aggressionWhenTrailing: 0.5, cautionWhenLeading: 0.7, maxSubs: 3 },
    colors: { primary: '#c8102e', secondary: '#002b5c', numbers: '#ffffff', gkPrimary: '#2e7d32' },
    setPieceIdx: { fk: 6, corner: 4, pen: 9, captain: 0 },
  });
}

/** 4-4-2, klar schwächer (alle Werte −6) */
export function weakTeam(opts: { era?: number; delta?: number; id?: string } = {}): TeamSheet {
  return buildTeam({
    id: opts.id ?? 'test-weak',
    name: 'Testelf Schwach',
    shortName: 'Schwach',
    season: '2019/20',
    era: opts.era ?? 2020,
    delta: opts.delta ?? -6,
    tactic: {
      formation: '4-4-2',
      pressingHeight: 0.4,
      pressingIntensity: 0.5,
      defensiveLine: 0.45,
      width: 0.5,
      directness: 0.55,
      tempo: 0.5,
      crossingFocus: 0.55,
      counterAttack: 0.5,
      manMarking: 0.2,
      offsideTrap: 0.3,
      gameManagement: 0.4,
    },
    slots: [
      { pos: 'GK', role: 'goalkeeper', profile: 'GK', att: { x: 7, y: 34 }, def: { x: 5, y: 34 } },
      { pos: 'RB', role: 'full-back', profile: 'FB', att: { x: 45, y: 60 }, def: { x: 22, y: 58 } },
      { pos: 'CB', role: 'centre-back', profile: 'CB', att: { x: 32, y: 44 }, def: { x: 17, y: 42 } },
      { pos: 'CB', role: 'centre-back', profile: 'CB', att: { x: 32, y: 24 }, def: { x: 17, y: 26 } },
      { pos: 'LB', role: 'full-back', profile: 'FB', att: { x: 45, y: 8 }, def: { x: 22, y: 10 } },
      { pos: 'RM', role: 'wide-mid', profile: 'W', att: { x: 68, y: 58 }, def: { x: 40, y: 56 } },
      { pos: 'CM', role: 'box-to-box', profile: 'CM', att: { x: 55, y: 40 }, def: { x: 35, y: 40 } },
      { pos: 'CM', role: 'holding-mid', profile: 'DM', att: { x: 50, y: 28 }, def: { x: 33, y: 28 } },
      { pos: 'LM', role: 'wide-mid', profile: 'W', att: { x: 68, y: 10 }, def: { x: 40, y: 12 } },
      { pos: 'ST', role: 'target-man', profile: 'TM', att: { x: 88, y: 38 }, def: { x: 55, y: 38 } },
      { pos: 'ST', role: 'poacher', profile: 'ST', att: { x: 90, y: 30 }, def: { x: 57, y: 30 } },
    ],
    bench: BENCH_STD,
    coach: { name: 'Testtrainer C', firstSubMinute: 62, aggressionWhenTrailing: 0.6, cautionWhenLeading: 0.5, maxSubs: 5 },
    colors: { primary: '#666666', secondary: '#eeeeee', numbers: '#000000', gkPrimary: '#ffcc00' },
    setPieceIdx: { fk: 6, corner: 5, pen: 10, captain: 2 },
  });
}
