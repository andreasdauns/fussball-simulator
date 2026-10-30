import { describe, expect, it } from 'vitest';
import type { LineupSlot, Player, PlayerAttributes, Position, Role, TeamSheet } from '../src/engine/types';
import { attackRating, defendRating, roleLine } from '../src/engine/strength';
import bayern2001 from '../src/data/teams/bayern-2001.json';
import bayern2020 from '../src/data/teams/bayern-2020.json';

const teams: TeamSheet[] = [bayern2001 as TeamSheet, bayern2020 as TeamSheet];

const ATTR_KEYS: (keyof PlayerAttributes)[] = [
  'pace', 'acceleration', 'stamina', 'strength', 'firstTouch', 'dribbling', 'shortPassing', 'longPassing', 'crossing',
  'finishing', 'longShots', 'heading', 'tackling', 'marking', 'positioning', 'vision', 'composure', 'workRate',
  'gkReflexes', 'gkHandling', 'gkPositioning', 'gkDistribution',
];

/** Standardrolle für Bankspieler (Hauptposition) – gleiche Zuordnung wie im Erzeugungsskript */
const DEFAULT_ROLE: Record<Position, Role> = {
  GK: 'goalkeeper', SW: 'sweeper', CB: 'centre-back', RB: 'full-back', LB: 'full-back', RWB: 'wing-back', LWB: 'wing-back',
  DM: 'holding-mid', CM: 'box-to-box', AM: 'advanced-playmaker', RM: 'wide-mid', LM: 'wide-mid', RW: 'winger', LW: 'winger',
  CF: 'complete-forward', ST: 'complete-forward',
};

/** Anteil Ballbesitz-/Defensivwert je Mannschaftsteil für den positionsgewichteten Mittelwert */
const MIX = { gk: [0, 1], def: [0.35, 0.65], mid: [0.7, 0.3], att: [0.85, 0.15] } as const;

function roleScore(p: Player, slot: LineupSlot): number {
  const [a, d] = MIX[roleLine(slot.role)];
  return a * attackRating(p, slot, 0) + d * defendRating(p, slot, 0);
}

describe.each(teams.map((t) => [t.id, t] as const))('TeamSheet %s', (_id, team) => {
  const byId = new Map(team.players.map((p) => [p.id, p]));

  it('hat genau 11 Startelf-Plätze mit einem Torwart', () => {
    expect(team.lineup).toHaveLength(11);
    expect(team.lineup.filter((s) => s.role === 'goalkeeper')).toHaveLength(1);
    expect(new Set(team.lineup.map((s) => s.playerId)).size).toBe(11);
  });

  it('alle Spieler-IDs existieren in players', () => {
    for (const s of team.lineup) expect(byId.has(s.playerId), s.playerId).toBe(true);
    for (const b of team.bench) expect(byId.has(b.id), b.id).toBe(true);
    const t = team.tactic;
    for (const id of [...t.freeKickTakers, ...t.cornerTakers, ...t.penaltyTakers, t.captain]) expect(byId.has(id), id).toBe(true);
    // players = Startelf + Bank, keine Doppelten
    const ids = [...team.lineup.map((s) => s.playerId), ...team.bench.map((b) => b.id)];
    expect(new Set(ids).size).toBe(ids.length);
    expect(team.players).toHaveLength(ids.length);
  });

  it('alle Attribute und Gesamtwerte liegen in 1–99', () => {
    for (const p of team.players) {
      expect(p.overall).toBeGreaterThanOrEqual(1);
      expect(p.overall).toBeLessThanOrEqual(99);
      for (const k of ATTR_KEYS) {
        const v = p.attributes[k];
        expect(Number.isInteger(v), `${p.id}.${k}`).toBe(true);
        expect(v, `${p.id}.${k}`).toBeGreaterThanOrEqual(1);
        expect(v, `${p.id}.${k}`).toBeLessThanOrEqual(99);
      }
      expect(Object.keys(p.attributes).sort()).toEqual([...ATTR_KEYS].sort());
    }
  });

  it('Gesamtwert passt (±3) zum positionsgewichteten Attributmittel', () => {
    const slots = new Map<string, LineupSlot>(team.lineup.map((s) => [s.playerId, s]));
    for (const p of team.players) {
      const slot: LineupSlot = slots.get(p.id) ?? {
        playerId: p.id,
        position: p.positions[0]!,
        role: DEFAULT_ROLE[p.positions[0]!],
        anchorAttack: { x: 50, y: 34 },
        anchorDefend: { x: 30, y: 34 },
      };
      const score = roleScore(p, slot);
      expect(Math.abs(score - p.overall), `${p.id}: overall ${p.overall}, Rollenmittel ${score.toFixed(1)}`).toBeLessThanOrEqual(3);
    }
  });

  it('Rückennummern sind eindeutig', () => {
    const nums = team.players.map((p) => p.number);
    expect(new Set(nums).size).toBe(nums.length);
  });

  it('Anker liegen auf dem Feld, Taktikwerte in 0–1, Quellen und Vertrauen gesetzt', () => {
    for (const s of team.lineup) {
      for (const v of [s.anchorAttack, s.anchorDefend]) {
        expect(v.x).toBeGreaterThanOrEqual(0);
        expect(v.x).toBeLessThanOrEqual(105);
        expect(v.y).toBeGreaterThanOrEqual(0);
        expect(v.y).toBeLessThanOrEqual(68);
      }
    }
    const t = team.tactic as unknown as Record<string, unknown>;
    for (const [k, v] of Object.entries(t)) if (typeof v === 'number') expect(v, k).toBeGreaterThanOrEqual(0), expect(v, k).toBeLessThanOrEqual(1);
    for (const p of team.players) {
      expect(['hoch', 'mittel', 'geschätzt']).toContain(p.confidence);
      expect(p.sources?.length ?? 0, p.id).toBeGreaterThan(0);
    }
  });
});

describe('Vergleich der beiden Mannschaften', () => {
  it('Startelf-Schnitt liegt nah beieinander (beide CL-Sieger, epochenrelativ)', () => {
    const avg = (t: TeamSheet) => {
      const ids = new Set(t.lineup.map((s) => s.playerId));
      const xi = t.players.filter((p) => ids.has(p.id));
      return xi.reduce((s, p) => s + p.overall, 0) / xi.length;
    };
    expect(Math.abs(avg(teams[0]!) - avg(teams[1]!))).toBeLessThanOrEqual(4);
  });

  it('Trikotfarben unterscheiden sich deutlich', () => {
    expect(teams[0]!.colors.primary.toLowerCase()).not.toBe(teams[1]!.colors.primary.toLowerCase());
  });
});
