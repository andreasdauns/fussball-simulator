/**
 * Nachbearbeitung: Spielnoten (kicker-Stil, 1.0 = Weltklasse, 6.0 = ungenügend)
 * und Momentum-Kurve pro Spielminute.
 */

import type { MatchEvent, PlayerMatchStats, TeamSide } from './types';
import type { Line } from './strength';
import { clamp } from './math';

export interface RatingInput {
  stats: PlayerMatchStats;
  line: Line;
  saves: number;
  keyActions: number;
  duelsWon: number;
  duelsLost: number;
}

const GRADES = [1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0, 5.5, 6.0];

/** Mittlere Leistungspunkte je Mannschaftsteil (aus Kalibrierläufen), damit die Durchschnittsnote ≈ 3,5 ist */
const LINE_MEAN: Record<Line, number> = { gk: 0.39, def: 0.14, mid: 1.02, att: 1.0 };
const LINE_SD: Record<Line, number> = { gk: 0.79, def: 0.74, mid: 0.61, att: 0.99 };

export function ratingPoints(r: RatingInput, score: { home: number; away: number }): number {
  const s = r.stats;
  const gf = s.team === 'home' ? score.home : score.away;
  const ga = s.team === 'home' ? score.away : score.home;
  const per90 = 90 / Math.max(30, s.minutes);
  let pts = 0;
  pts += s.goals * (r.line === 'def' ? 1.3 : 1.0);
  pts += s.assists * 0.6;
  pts += (s.shotsOnTarget - s.goals) * 0.06;
  pts += r.keyActions * 0.12 * per90;
  pts += (s.tackles + s.interceptions) * 0.04 * per90;
  pts += (r.duelsWon - r.duelsLost) * 0.04;
  if (s.passes > 0) pts += (s.passesCompleted / s.passes - 0.8) * 1.2 * clamp(s.passes / 40, 0.3, 1);
  pts -= s.yellow * 0.15 + s.red * 1.2;
  pts -= s.fouls * 0.03;
  if (r.line === 'gk') {
    pts += r.saves * 0.22;
    pts -= ga * 0.32;
    if (ga === 0) pts += 0.35;
  } else if (r.line === 'def') {
    pts -= ga * 0.22;
    if (ga === 0) pts += 0.3;
  } else if (r.line === 'mid') {
    pts -= ga * 0.08;
  }
  pts += clamp(gf - ga, -3, 3) * 0.12;
  return pts;
}

/** Nur für Kalibrierung: sammelt Rohpunkte */
export const ratingDebug: { sink: { line: Line; pts: number; minutes: number }[] | null } = { sink: null };

export function computeRatings(players: RatingInput[], score: { home: number; away: number }): void {
  for (const r of players) {
    const s = r.stats;
    if (s.minutes < 1) {
      s.rating = 3.5;
      continue;
    }
    const pts = ratingPoints(r, score);
    if (ratingDebug.sink) ratingDebug.sink.push({ line: r.line, pts, minutes: s.minutes });
    const z = (pts - LINE_MEAN[r.line]) / LINE_SD[r.line];
    // Kurzeinsätze ziehen Richtung 3.5
    const weight = clamp(s.minutes / 60, 0.25, 1);
    const raw = 3.45 - z * 0.95 * weight;
    let best = GRADES[0]!;
    let bd = Infinity;
    for (const g of GRADES) {
      const d = Math.abs(g - raw);
      if (d < bd) {
        bd = d;
        best = g;
      }
    }
    if (s.minutes < 20 && s.goals === 0) best = clamp(best, 3.0, 4.0);
    s.rating = best;
  }
}

/** Momentum pro Minute aus gewichteten Aktionen beider Teams, geglättet, -1 (Gast) … +1 (Heim) */
export function computeMomentum(events: MatchEvent[], endT: number): number[] {
  const n = Math.max(1, Math.ceil(endT / 60));
  const raw = new Array<number>(n).fill(0);
  for (const e of events) {
    const m = Math.min(n - 1, Math.floor(e.t / 60));
    const sign = e.team === 'home' ? 1 : -1;
    // Ballposition aus Sicht des Teams: Nähe zum gegnerischen Tor
    const advance = e.team === 'home' ? e.to.x / 105 : 1 - e.to.x / 105;
    let w = 0;
    switch (e.type) {
      case 'pass':
      case 'carry':
      case 'dribble':
        w = e.success ? (advance > 0.66 ? 0.35 : advance > 0.4 ? 0.1 : 0.02) : 0;
        break;
      case 'cross':
      case 'long-ball':
        w = e.success ? 0.3 : 0.08;
        break;
      case 'shot':
      case 'header':
        w = 1 + (e.xg ?? 0.1) * 4;
        break;
      case 'corner':
        w = 0.6;
        break;
      case 'goal':
        w = 1.5;
        break;
      default:
        w = 0;
    }
    raw[m]! += sign * w;
  }
  const out: number[] = [];
  let ema = 0;
  for (let i = 0; i < n; i++) {
    ema = ema * 0.6 + raw[i]! * 0.4;
    const v = ema / (1.2 + Math.abs(ema));
    out.push(Math.round(clamp(v, -1, 1) * 100) / 100);
  }
  return out;
}
