/**
 * Zwei eingebaute Demo-Mannschaften mit fiktiven Spielern – nur für die 2D-Testansicht,
 * solange in src/data/teams/ noch keine echten TeamSheets liegen.
 */

import type { LineupSlot, Player, PlayerAttributes, Position, Role, TeamSheet, Vec2 } from '../engine/types';

interface SlotDef {
  pos: Position;
  role: Role;
  num: number;
  name: string;
  def: [number, number];
  att: [number, number];
}

function attrs(base: number, pos: Position): PlayerAttributes {
  const gk = pos === 'GK';
  const fwd = ['ST', 'CF', 'LW', 'RW', 'AM'].includes(pos);
  const def = ['CB', 'SW', 'LB', 'RB', 'LWB', 'RWB', 'DM'].includes(pos);
  const f = (d: number) => Math.max(1, Math.min(99, Math.round(base + d)));
  return {
    pace: f(fwd ? 4 : 0),
    acceleration: f(fwd ? 4 : 0),
    stamina: f(2),
    strength: f(def ? 3 : 0),
    firstTouch: f(fwd ? 2 : 0),
    dribbling: f(fwd ? 4 : -4),
    shortPassing: f(0),
    longPassing: f(def ? 0 : -2),
    crossing: f(pos === 'LB' || pos === 'RB' || pos === 'LW' || pos === 'RW' ? 4 : -6),
    finishing: f(fwd ? 6 : -15),
    longShots: f(fwd ? 0 : -8),
    heading: f(def || pos === 'ST' ? 4 : -6),
    tackling: f(def ? 6 : -12),
    marking: f(def ? 6 : -12),
    positioning: f(fwd ? 6 : -4),
    vision: f(pos === 'AM' || pos === 'CM' ? 6 : 0),
    composure: f(0),
    workRate: f(2),
    gkReflexes: gk ? f(6) : 10,
    gkHandling: gk ? f(4) : 10,
    gkPositioning: gk ? f(4) : 10,
    gkDistribution: gk ? f(0) : 10,
  };
}

function makePlayer(teamId: string, d: { pos: Position; num: number; name: string }, base: number): Player {
  const parts = d.name.split(' ');
  return {
    id: `${teamId}-${d.num}`,
    name: d.name,
    shortName: parts[parts.length - 1] ?? d.name,
    number: d.num,
    positions: [d.pos],
    foot: d.num % 3 === 0 ? 'left' : 'right',
    overall: base,
    attributes: attrs(base, d.pos),
    confidence: 'geschätzt',
    sources: ['Demo-Spieler (fiktiv)'],
  };
}

function v(p: [number, number]): Vec2 {
  return { x: p[0], y: p[1] };
}

function buildTeam(opts: {
  id: string;
  name: string;
  shortName: string;
  formation: string;
  colors: TeamSheet['colors'];
  coach: string;
  base: number;
  slots: SlotDef[];
  bench: { pos: Position; num: number; name: string }[];
  tactic: Partial<TeamSheet['tactic']>;
}): TeamSheet {
  const starters = opts.slots.map((s) => makePlayer(opts.id, s, opts.base));
  const bench = opts.bench.map((b) => makePlayer(opts.id, b, opts.base - 3));
  const lineup: LineupSlot[] = opts.slots.map((s, i) => ({
    playerId: starters[i]!.id,
    position: s.pos,
    role: s.role,
    anchorAttack: v(s.att),
    anchorDefend: v(s.def),
  }));
  const ids = (nums: number[]) => nums.map((n) => `${opts.id}-${n}`);
  return {
    id: opts.id,
    name: opts.name,
    shortName: opts.shortName,
    season: 'Demo',
    era: 2020,
    colors: opts.colors,
    coach: {
      name: opts.coach,
      firstSubMinute: 60,
      aggressionWhenTrailing: 0.5,
      cautionWhenLeading: 0.4,
      maxSubs: 5,
    },
    tactic: {
      formation: opts.formation,
      pressingHeight: 0.5,
      pressingIntensity: 0.5,
      defensiveLine: 0.5,
      width: 0.5,
      directness: 0.5,
      tempo: 0.5,
      crossingFocus: 0.4,
      counterAttack: 0.5,
      manMarking: 0.2,
      offsideTrap: 0.4,
      gameManagement: 0.4,
      freeKickTakers: ids([10]),
      cornerTakers: ids([10, 7]),
      penaltyTakers: ids([9, 10]),
      captain: `${opts.id}-${opts.slots[1]?.num ?? 1}`,
      ...opts.tactic,
    },
    lineup,
    bench,
    players: [...starters, ...bench],
    notes: 'Demo-Mannschaft mit fiktiven Spielern (nur für die Testansicht).',
  };
}

export const DEMO_RED: TeamSheet = buildTeam({
  id: 'demo-rot',
  name: 'Rot 4-2-3-1',
  shortName: 'ROT',
  formation: '4-2-3-1',
  colors: { primary: '#c8102e', secondary: '#ffffff', numbers: '#ffffff', gkPrimary: '#2bb673' },
  coach: 'Trainer Rot',
  base: 78,
  tactic: { pressingHeight: 0.7, pressingIntensity: 0.75, defensiveLine: 0.65, tempo: 0.7 },
  slots: [
    { pos: 'GK', role: 'goalkeeper', num: 1, name: 'Tom Albers', def: [5, 34], att: [10, 34] },
    { pos: 'RB', role: 'full-back', num: 2, name: 'Jan Becker', def: [22, 56], att: [55, 61] },
    { pos: 'CB', role: 'centre-back', num: 4, name: 'Mats Claasen', def: [20, 41], att: [36, 43] },
    { pos: 'CB', role: 'ball-playing-cb', num: 5, name: 'Nils Dorn', def: [20, 27], att: [36, 25] },
    { pos: 'LB', role: 'full-back', num: 3, name: 'Paul Engel', def: [22, 12], att: [55, 7] },
    { pos: 'DM', role: 'holding-mid', num: 6, name: 'Lars Franke', def: [33, 40], att: [50, 39] },
    { pos: 'CM', role: 'box-to-box', num: 8, name: 'Kai Gerber', def: [35, 28], att: [58, 28] },
    { pos: 'RW', role: 'winger', num: 7, name: 'Leon Hahn', def: [45, 57], att: [80, 58] },
    { pos: 'AM', role: 'advanced-playmaker', num: 10, name: 'Finn Iske', def: [47, 34], att: [76, 36] },
    { pos: 'LW', role: 'inside-forward', num: 11, name: 'Ole Jansen', def: [45, 11], att: [80, 12] },
    { pos: 'ST', role: 'complete-forward', num: 9, name: 'Ben Kraus', def: [54, 34], att: [90, 33] },
  ],
  bench: [
    { pos: 'GK', num: 12, name: 'Erik Lang' },
    { pos: 'CB', num: 15, name: 'Tim Moser' },
    { pos: 'CM', num: 14, name: 'Jonas Nolte' },
    { pos: 'RW', num: 17, name: 'Luca Ortmann' },
    { pos: 'ST', num: 19, name: 'Max Pohl' },
  ],
});

export const DEMO_WHITE: TeamSheet = buildTeam({
  id: 'demo-weiss',
  name: 'Weiß 3-5-2',
  shortName: 'WEI',
  formation: '3-5-2',
  colors: { primary: '#f1f3f6', secondary: '#1d2b4f', numbers: '#1d2b4f', gkPrimary: '#f5b700' },
  coach: 'Trainer Weiß',
  base: 76,
  tactic: { pressingHeight: 0.35, pressingIntensity: 0.4, defensiveLine: 0.35, directness: 0.7, counterAttack: 0.75 },
  slots: [
    { pos: 'GK', role: 'goalkeeper', num: 1, name: 'Rico Quast', def: [5, 34], att: [9, 34] },
    { pos: 'CB', role: 'stopper', num: 4, name: 'Sven Roth', def: [17, 47], att: [30, 49] },
    { pos: 'SW', role: 'sweeper', num: 5, name: 'Udo Sauer', def: [14, 34], att: [26, 34] },
    { pos: 'CB', role: 'stopper', num: 3, name: 'Veit Thiel', def: [17, 21], att: [30, 19] },
    { pos: 'RWB', role: 'wing-back', num: 2, name: 'Wim Ulrich', def: [26, 60], att: [62, 62] },
    { pos: 'CM', role: 'deep-playmaker', num: 6, name: 'Yann Vogt', def: [30, 34], att: [48, 34] },
    { pos: 'CM', role: 'box-to-box', num: 8, name: 'Theo Wendt', def: [34, 45], att: [60, 44] },
    { pos: 'CM', role: 'box-to-box', num: 10, name: 'Emil Zander', def: [34, 23], att: [64, 24] },
    { pos: 'LWB', role: 'wing-back', num: 11, name: 'Arne Bauer', def: [26, 8], att: [62, 6] },
    { pos: 'ST', role: 'target-man', num: 9, name: 'Carl Damm', def: [50, 40], att: [88, 38] },
    { pos: 'ST', role: 'poacher', num: 7, name: 'Hugo Eich', def: [50, 28], att: [86, 28] },
  ],
  bench: [
    { pos: 'GK', num: 12, name: 'Ivo Faber' },
    { pos: 'CB', num: 13, name: 'Kurt Graf' },
    { pos: 'CM', num: 16, name: 'Lutz Horn' },
    { pos: 'LWB', num: 18, name: 'Mirko Imhof' },
    { pos: 'ST', num: 20, name: 'Nico Jost' },
  ],
});

export const DEMO_TEAMS: TeamSheet[] = [DEMO_RED, DEMO_WHITE];
