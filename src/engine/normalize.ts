/**
 * Niveau-Normierung: Spielerwerte sind epochenrelativ und je nach Datenquelle unterschiedlich
 * hoch und unterschiedlich geformt (z. B. Abschluss 83 vs. Deckung 74 bei echten Daten,
 * 57 vs. 59 bei den Kalibrier-Teams). Die Engine-Formeln sind auf ein Referenzprofil kalibriert.
 * Pro Spiel wird deshalb JEDES Attribut beider Mannschaften um denselben Betrag verschoben,
 * sodass das gemeinsame Mittel beider Startelfen dem Referenzprofil entspricht.
 * Unterschiede zwischen Spielern und zwischen den Mannschaften bleiben exakt erhalten –
 * es zählt nur die relative Stärke, nicht das absolute Niveau oder die Skala der Datenquelle.
 */

import type { Player, PlayerAttributes, TeamSheet } from './types';

/**
 * Referenzprofil (Mittel der Feldspieler beider Startelfen), auf das die Formeln kalibriert sind.
 * Abgeleitet aus den synthetischen Kalibrier-Mannschaften (tests/fixtures).
 */
export const REF_PROFILE: Record<keyof PlayerAttributes, number> = {
  pace: 72,
  acceleration: 72.4,
  stamina: 75.2,
  strength: 72.9,
  firstTouch: 71,
  dribbling: 66.1,
  shortPassing: 73,
  longPassing: 67.6,
  crossing: 59.9,
  finishing: 55.4,
  longShots: 57.2,
  heading: 66.6,
  tackling: 63.8,
  marking: 60.8,
  positioning: 64.1,
  vision: 67.6,
  composure: 69.2,
  workRate: 70.2,
  // Torwartwerte: Referenz für Torhüter (Feldspieler-GK-Werte werden mit verschoben, bleiben aber niedrig)
  gkReflexes: 80,
  gkHandling: 80,
  gkPositioning: 80,
  gkDistribution: 80,
};

const GK_KEYS = new Set<keyof PlayerAttributes>(['gkReflexes', 'gkHandling', 'gkPositioning', 'gkDistribution']);

function lineupPlayers(sheet: TeamSheet): { player: Player; isGk: boolean }[] {
  const out: { player: Player; isGk: boolean }[] = [];
  for (const slot of sheet.lineup) {
    const p = sheet.players.find((q) => q.id === slot.playerId) ?? sheet.bench.find((q) => q.id === slot.playerId);
    if (p) out.push({ player: p, isGk: slot.position === 'GK' });
  }
  return out;
}

/** Verschiebung je Attribut (gemeinsam) plus Mannschafts-Ausgleich je Team-ID */
export interface LevelShift {
  attr: Record<keyof PlayerAttributes, number>;
  /** Zusätzliche, einheitliche Verschiebung aller Werte je Mannschaft (Abgleich mit overall) */
  team: Record<string, number>;
}

const KEYS = Object.keys(REF_PROFILE) as (keyof PlayerAttributes)[];

/**
 * Verschiebung je Attribut, die den gemeinsamen Mittelwert beider Startelfen aufs Referenzprofil
 * bringt (Feldspielerwerte über die Feldspieler, Torwartwerte über die beiden Torhüter).
 */
export function computeLevelShift(home: TeamSheet, away: TeamSheet): LevelShift {
  // 1) Mannschafts-Ausgleich: Der Stärkeabstand beider Teams richtet sich nach dem kuratierten
  //    Gesamtwert (overall, mehrere Quellen), nicht nach der Höhe der abgeleiteten Einzelwerte.
  //    Das Profil (relative Stärken/Schwächen innerhalb eines Teams) bleibt unverändert.
  const stats = [home, away].map((sheet) => {
    let attrSum = 0;
    let attrN = 0;
    let ovSum = 0;
    let ovN = 0;
    for (const { player, isGk } of lineupPlayers(sheet)) {
      if (isGk) continue;
      ovSum += player.overall;
      ovN++;
      for (const k of KEYS) {
        if (GK_KEYS.has(k)) continue;
        attrSum += player.attributes[k];
        attrN++;
      }
    }
    return { attr: attrN ? attrSum / attrN : 0, ov: ovN ? ovSum / ovN : 0 };
  });
  const [h, a] = stats as [{ attr: number; ov: number }, { attr: number; ov: number }];
  const ovMid = (h.ov + a.ov) / 2;
  const attrMid = (h.attr + a.attr) / 2;
  const team: Record<string, number> = {};
  const homeOff = h.ov - ovMid - (h.attr - attrMid);
  const awayOff = a.ov - ovMid - (a.attr - attrMid);
  team[home.id] = homeOff;
  team[away.id] = home.id === away.id ? homeOff : awayOff;

  // 2) Gemeinsame Verschiebung je Attribut aufs Referenzprofil (nach dem Mannschafts-Ausgleich)
  const sum = {} as Record<keyof PlayerAttributes, number>;
  const cnt = {} as Record<keyof PlayerAttributes, number>;
  for (const k of KEYS) {
    sum[k] = 0;
    cnt[k] = 0;
  }
  for (const sheet of [home, away]) {
    const off = team[sheet.id]!;
    for (const { player, isGk } of lineupPlayers(sheet)) {
      for (const k of KEYS) {
        if (isGk !== GK_KEYS.has(k)) continue;
        sum[k] += player.attributes[k] + (GK_KEYS.has(k) ? 0 : off);
        cnt[k]++;
      }
    }
  }
  const attr = {} as Record<keyof PlayerAttributes, number>;
  for (const k of KEYS) attr[k] = cnt[k] ? REF_PROFILE[k] - sum[k] / cnt[k] : 0;
  return { attr, team };
}

/** Kopie eines Spielers mit verschobenen Werten (Eingabe bleibt unverändert) */
export function shiftPlayer(p: Player, shift: LevelShift, teamId: string): Player {
  const off = shift.team[teamId] ?? 0;
  const attrs = {} as PlayerAttributes;
  for (const k of KEYS) attrs[k] = Math.max(1, p.attributes[k] + shift.attr[k] + (GK_KEYS.has(k) ? 0 : off));
  return { ...p, attributes: attrs };
}
