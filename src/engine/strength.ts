/**
 * Mannschaftsstärke: Rollenwerte der Spieler, Zonenstärken (Drittel × Kanal),
 * Pressing, Aufbau, Luftstärke, Standards, Torwart. Plus Ermüdung.
 */

import type { LineupSlot, Player, PlayerAttributes, Position, Role, Tactic, Vec2 } from './types';
import { clamp } from './math';

export type AttrKey = keyof PlayerAttributes;
type Weights = Partial<Record<AttrKey, number>>;

/** Gewichte für den Wert "mit Ball" je Rolle */
const ATTACK_WEIGHTS: Record<Role, Weights> = {
  goalkeeper: { gkDistribution: 0.6, shortPassing: 0.2, longPassing: 0.2 },
  sweeper: { shortPassing: 0.25, longPassing: 0.25, vision: 0.3, composure: 0.1, dribbling: 0.1 },
  stopper: { shortPassing: 0.5, composure: 0.3, strength: 0.2 },
  'centre-back': { shortPassing: 0.5, longPassing: 0.2, composure: 0.3 },
  'ball-playing-cb': { shortPassing: 0.35, longPassing: 0.35, vision: 0.2, composure: 0.1 },
  'full-back': { crossing: 0.3, pace: 0.2, shortPassing: 0.3, stamina: 0.2 },
  'wing-back': { pace: 0.25, stamina: 0.2, crossing: 0.35, dribbling: 0.2 },
  'inverted-full-back': { shortPassing: 0.4, vision: 0.3, firstTouch: 0.3 },
  'holding-mid': { shortPassing: 0.5, longPassing: 0.2, composure: 0.3 },
  'deep-playmaker': { vision: 0.35, shortPassing: 0.35, longPassing: 0.3 },
  'box-to-box': { shortPassing: 0.3, stamina: 0.2, dribbling: 0.2, longShots: 0.15, positioning: 0.15 },
  'advanced-playmaker': { vision: 0.35, shortPassing: 0.3, dribbling: 0.2, firstTouch: 0.15 },
  'shadow-striker': { positioning: 0.3, finishing: 0.3, dribbling: 0.2, acceleration: 0.2 },
  'wide-mid': { crossing: 0.35, stamina: 0.2, shortPassing: 0.25, pace: 0.2 },
  winger: { pace: 0.3, dribbling: 0.35, crossing: 0.25, acceleration: 0.1 },
  'inside-forward': { dribbling: 0.3, finishing: 0.3, pace: 0.2, longShots: 0.2 },
  'target-man': { heading: 0.35, strength: 0.35, finishing: 0.2, firstTouch: 0.1 },
  poacher: { finishing: 0.4, positioning: 0.35, composure: 0.25 },
  'complete-forward': { finishing: 0.3, dribbling: 0.2, heading: 0.15, strength: 0.15, positioning: 0.2 },
  'false-nine': { vision: 0.3, dribbling: 0.3, shortPassing: 0.2, finishing: 0.2 },
};

const FORWARD_DEF: Weights = { workRate: 0.5, tackling: 0.2, pace: 0.15, stamina: 0.15 };

/** Gewichte für den Wert "gegen den Ball" je Rolle */
const DEFEND_WEIGHTS: Record<Role, Weights> = {
  goalkeeper: { gkReflexes: 0.35, gkHandling: 0.2, gkPositioning: 0.3, gkDistribution: 0.15 },
  sweeper: { marking: 0.3, tackling: 0.2, vision: 0.2, pace: 0.1, heading: 0.1, composure: 0.1 },
  stopper: { tackling: 0.3, marking: 0.3, strength: 0.2, heading: 0.2 },
  'centre-back': { marking: 0.3, tackling: 0.25, heading: 0.2, strength: 0.1, pace: 0.15 },
  'ball-playing-cb': { marking: 0.3, tackling: 0.25, heading: 0.15, pace: 0.15, composure: 0.15 },
  'full-back': { tackling: 0.3, marking: 0.3, pace: 0.25, stamina: 0.15 },
  'wing-back': { tackling: 0.3, marking: 0.2, pace: 0.3, stamina: 0.2 },
  'inverted-full-back': { tackling: 0.3, marking: 0.3, pace: 0.2, stamina: 0.2 },
  'holding-mid': { tackling: 0.35, marking: 0.3, stamina: 0.1, strength: 0.1, workRate: 0.15 },
  'deep-playmaker': { tackling: 0.4, marking: 0.3, workRate: 0.3 },
  'box-to-box': { tackling: 0.35, workRate: 0.35, stamina: 0.3 },
  'advanced-playmaker': { workRate: 0.5, tackling: 0.3, stamina: 0.2 },
  'shadow-striker': FORWARD_DEF,
  'wide-mid': { workRate: 0.35, tackling: 0.3, stamina: 0.35 },
  winger: FORWARD_DEF,
  'inside-forward': FORWARD_DEF,
  'target-man': { strength: 0.4, heading: 0.3, workRate: 0.3 },
  poacher: FORWARD_DEF,
  'complete-forward': FORWARD_DEF,
  'false-nine': FORWARD_DEF,
};

export type Line = 'gk' | 'def' | 'mid' | 'att';

export function roleLine(role: Role): Line {
  switch (role) {
    case 'goalkeeper':
      return 'gk';
    case 'sweeper':
    case 'stopper':
    case 'centre-back':
    case 'ball-playing-cb':
    case 'full-back':
    case 'wing-back':
    case 'inverted-full-back':
      return 'def';
    case 'holding-mid':
    case 'deep-playmaker':
    case 'box-to-box':
    case 'advanced-playmaker':
    case 'wide-mid':
      return 'mid';
    default:
      return 'att';
  }
}

export function positionLine(pos: Position): Line {
  switch (pos) {
    case 'GK':
      return 'gk';
    case 'SW':
    case 'CB':
    case 'RB':
    case 'LB':
    case 'RWB':
    case 'LWB':
      return 'def';
    case 'DM':
    case 'CM':
    case 'AM':
    case 'RM':
    case 'LM':
      return 'mid';
    default:
      return 'att';
  }
}

/** Effektiver Attributwert unter Ermüdung (0 = frisch, 1 = völlig platt) */
export function eff(p: Player, key: AttrKey, fatigue: number): number {
  const base = p.attributes[key];
  const physical = key === 'pace' || key === 'acceleration' || key === 'stamina' || key === 'workRate';
  const k = physical ? 0.2 : key.startsWith('gk') ? 0.03 : 0.1;
  return base * (1 - k * fatigue);
}

function weighted(p: Player, w: Weights, fatigue: number): number {
  let s = 0;
  let tot = 0;
  for (const k in w) {
    const key = k as AttrKey;
    const wt = w[key]!;
    s += wt * eff(p, key, fatigue);
    tot += wt;
  }
  return tot > 0 ? s / tot : 50;
}

/** Abschlag, wenn ein Spieler nicht auf einer seiner Positionen spielt */
export function positionFit(p: Player, pos: Position): number {
  if (p.positions.includes(pos)) return 1;
  const line = positionLine(pos);
  if (p.positions.some((q) => positionLine(q) === line)) return 0.94;
  if (line === 'gk' || p.positions[0] === 'GK') return 0.45;
  return 0.85;
}

export function attackRating(p: Player, slot: LineupSlot, fatigue: number): number {
  return weighted(p, ATTACK_WEIGHTS[slot.role], fatigue) * positionFit(p, slot.position);
}

export function defendRating(p: Player, slot: LineupSlot, fatigue: number): number {
  return weighted(p, DEFEND_WEIGHTS[slot.role], fatigue) * positionFit(p, slot.position);
}

/** Taktik-Verschiebung der Grundpositionen (Team-Koordinaten) */
export function attackAnchor(slot: LineupSlot, tac: Tactic): Vec2 {
  const a = slot.anchorAttack;
  if (slot.role === 'goalkeeper') return { x: a.x, y: a.y };
  const widthFactor = 0.85 + 0.3 * tac.width;
  return { x: a.x, y: clamp(34 + (a.y - 34) * widthFactor, 2, 66) };
}

export function defendAnchor(slot: LineupSlot, tac: Tactic): Vec2 {
  const a = slot.anchorDefend;
  if (slot.role === 'goalkeeper') return { x: a.x + (tac.defensiveLine - 0.45) * 6, y: a.y };
  const line = roleLine(slot.role);
  let shift: number;
  if (line === 'def') shift = (tac.defensiveLine - 0.45) * 18;
  else if (line === 'mid') shift = (tac.defensiveLine * 0.5 + tac.pressingHeight * 0.5 - 0.45) * 20;
  else shift = (tac.pressingHeight - 0.45) * 24;
  return { x: clamp(a.x + shift, 4, 95), y: a.y };
}

export interface SlotInfo {
  player: Player;
  slot: LineupSlot;
  fatigue: number;
}

export interface TeamStrength {
  /** [Drittel 0..2][Kanal 0..2] in eigenen Koordinaten */
  att: number[][];
  def: number[][];
  pressPower: number; // 0..~1
  buildUp: number; // ~ Attributskala
  aerialAtt: number;
  aerialDef: number;
  setPiece: number;
  gk: number;
  avgAttack: number;
  avgDefend: number;
}

const ZONE_X = [17.5, 52.5, 87.5];
const ZONE_Y = [11.3, 34, 56.7];

function zoneWeight(p: Vec2, zx: number, zy: number): number {
  const dx = (p.x - zx) / 18;
  const dy = (p.y - zy) / 13;
  return 1 / (1 + dx * dx + dy * dy);
}

export function heightBonus(p: Player): number {
  const h = p.heightCm ?? 182;
  return (h - 182) * 0.6;
}

export function aerialScore(p: Player, fatigue: number): number {
  return 0.55 * eff(p, 'heading', fatigue) + 0.3 * eff(p, 'strength', fatigue) + 0.15 * eff(p, 'positioning', fatigue) + heightBonus(p);
}

export function computeStrength(slots: SlotInfo[], tac: Tactic): TeamStrength {
  const att = [0, 1, 2].map(() => [0, 0, 0]);
  const def = [0, 1, 2].map(() => [0, 0, 0]);
  let press = 0;
  let pressN = 0;
  let build = 0;
  let buildN = 0;
  let aerA = 0;
  let aerAN = 0;
  let aerD = 0;
  let aerDN = 0;
  let gk = 45;
  let sumA = 0;
  let sumD = 0;
  let setPiece = 60;
  const takers = new Set([...tac.cornerTakers, ...tac.freeKickTakers]);

  for (const s of slots) {
    const ar = attackRating(s.player, s.slot, s.fatigue);
    const dr = defendRating(s.player, s.slot, s.fatigue);
    sumA += ar;
    sumD += dr;
    const line = roleLine(s.slot.role);
    const aa = attackAnchor(s.slot, tac);
    const da = defendAnchor(s.slot, tac);
    if (line === 'gk') {
      gk = dr;
      build += 0.5 * ar;
      buildN += 0.5;
      continue;
    }
    for (let t = 0; t < 3; t++) {
      for (let c = 0; c < 3; c++) {
        att[t]![c]! += (zoneWeight(aa, ZONE_X[t]!, ZONE_Y[c]!) * ar) / 100;
        def[t]![c]! += (zoneWeight(da, ZONE_X[t]!, ZONE_Y[c]!) * dr) / 100;
      }
    }
    const p = s.player;
    if (line !== 'def') {
      press += (0.4 * eff(p, 'workRate', s.fatigue) + 0.3 * eff(p, 'stamina', s.fatigue) + 0.3 * eff(p, 'pace', s.fatigue)) / 100;
      pressN++;
    }
    if (line === 'def' || s.slot.role === 'holding-mid' || s.slot.role === 'deep-playmaker') {
      build += (0.5 * eff(p, 'shortPassing', s.fatigue) + 0.25 * eff(p, 'vision', s.fatigue) + 0.25 * eff(p, 'composure', s.fatigue));
      buildN++;
    }
    const aer = aerialScore(p, s.fatigue);
    if (line === 'att' || s.slot.role === 'box-to-box' || line === 'def') {
      aerA += aer * (line === 'att' ? 1.3 : 0.7);
      aerAN += line === 'att' ? 1.3 : 0.7;
    }
    if (line === 'def' || s.slot.role === 'holding-mid') {
      aerD += aer;
      aerDN++;
    }
    if (takers.has(p.id)) setPiece = Math.max(setPiece, 0.7 * eff(p, 'crossing', s.fatigue) + 0.3 * eff(p, 'longPassing', s.fatigue));
  }
  const n = Math.max(1, slots.length);
  return {
    att,
    def,
    pressPower: pressN ? press / pressN : 0.5,
    buildUp: buildN ? build / buildN : 60,
    aerialAtt: aerAN ? aerA / aerAN : 60,
    aerialDef: aerDN ? aerD / aerDN : 60,
    setPiece,
    gk,
    avgAttack: sumA / n,
    avgDefend: sumD / n,
  };
}

/**
 * Ermüdungszuwachs pro Minute. Hohe Laufbereitschaft und intensives Pressing kosten Kraft,
 * hohe Ausdauer bremst.
 */
export function fatigueRate(p: Player, slot: LineupSlot, tac: Tactic): number {
  if (slot.role === 'goalkeeper') return 0.0008;
  const stamina = p.attributes.stamina;
  const line = roleLine(slot.role);
  const pressShare = line === 'def' ? 0.4 : 1;
  const press = 1 + 0.9 * tac.pressingIntensity * pressShare * (0.6 + 0.4 * tac.pressingHeight) + 0.25 * tac.tempo;
  return 0.0058 * (1.55 - stamina / 100) * (0.75 + 0.5 * (p.attributes.workRate / 100)) * press;
}
