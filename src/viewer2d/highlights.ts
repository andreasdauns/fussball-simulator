/**
 * Highlights und Zwischenstatistik – reine Funktionen über der Zeitachse.
 */

import type { MatchEvent, MatchResult, TeamMatchStats, TeamSide } from '../engine/types';
import type { MatchTimeline } from './timeline';

export const LEAD_IN = 10;

export interface HighlightWindow {
  /** τ, ab dem abgespielt wird (≈10 s vor dem Ereignis) */
  from: number;
  /** τ, bis zu dem abgespielt wird */
  to: number;
  /** auslösendes Ereignis */
  ev: MatchEvent;
  tau: number;
}

/** Ist das Ereignis sehenswert genug für den Highlight-Modus? */
export function isNotable(ev: MatchEvent): boolean {
  switch (ev.type) {
    case 'goal':
    case 'red-card':
    case 'penalty':
      return true;
    case 'save':
      return true;
    case 'shot':
    case 'header':
      return (ev.xg ?? 0) >= 0.12;
    default:
      return false;
  }
}

/** Highlight-Fenster, überlappende werden zusammengelegt. */
export function highlightWindows(tl: MatchTimeline): HighlightWindow[] {
  const raw: HighlightWindow[] = [];
  for (const te of tl.events) {
    if (!isNotable(te.ev)) continue;
    const after = te.ev.type === 'goal' ? 9 : te.ev.type === 'red-card' ? 4 : 4;
    raw.push({ from: Math.max(0, te.start - LEAD_IN), to: Math.min(tl.endTau, te.end + after), ev: te.ev, tau: te.start });
  }
  const out: HighlightWindow[] = [];
  for (const w of raw) {
    const last = out[out.length - 1];
    if (last && w.from <= last.to + 2) {
      last.to = Math.max(last.to, w.to);
      // Tor hat Vorrang als „Titel“ des Fensters
      if (w.ev.type === 'goal' && last.ev.type !== 'goal') {
        last.ev = w.ev;
        last.tau = w.tau;
      }
    } else out.push({ ...w });
  }
  return out;
}

function emptyStats(): TeamMatchStats {
  return { possession: 50, shots: 0, shotsOnTarget: 0, xg: 0, passes: 0, passAccuracy: 0, corners: 0, fouls: 0, yellow: 0, red: 0, offsides: 0 };
}

const PASS_TYPES = new Set(['pass', 'cross', 'long-ball']);
const SHOT_TYPES = new Set(['shot', 'header']);

/**
 * Statistik bis zum Zeitpunkt τ, aus den Ereignissen gezählt (für die Halbzeit-Tafel).
 * Zum Abpfiff zeigt die Oberfläche die Engine-Statistik `result.stats`.
 */
export function statsUntil(result: MatchResult, tl: MatchTimeline, tau: number): { home: TeamMatchStats; away: TeamMatchStats } {
  const s = { home: emptyStats(), away: emptyStats() };
  const completed = { home: 0, away: 0 };
  const possT = { home: 0, away: 0 };
  const evs = tl.events;
  for (let i = 0; i < evs.length; i++) {
    const te = evs[i]!;
    if (te.start > tau) break;
    const ev = te.ev;
    const t = s[ev.team];
    if (PASS_TYPES.has(ev.type)) {
      t.passes++;
      if (ev.success) completed[ev.team]++;
    } else if (SHOT_TYPES.has(ev.type)) {
      t.shots++;
      t.xg += ev.xg ?? 0;
      const nxt = evs[i + 1]?.ev;
      if (nxt && (nxt.type === 'goal' || nxt.type === 'save')) t.shotsOnTarget++;
    } else if (ev.type === 'corner') t.corners++;
    else if (ev.type === 'foul') t.fouls++;
    else if (ev.type === 'yellow-card') t.yellow++;
    else if (ev.type === 'red-card') t.red++;
    else if (ev.type === 'offside') t.offsides++;
    // Ballbesitz: Zeit bis zum nächsten Ereignis dem ausführenden Team gutschreiben
    if (ev.type !== 'half-time' && ev.type !== 'full-time' && ev.type !== 'substitution') {
      const next = evs[i + 1];
      const until = Math.min(next ? next.start : te.end, tau);
      const owner: TeamSide = ev.type === 'foul' || ev.type === 'goal' || ev.type === 'miss' ? (ev.team === 'home' ? 'away' : 'home') : ev.team;
      const dt = Math.max(0, Math.min(until - te.start, 40));
      possT[owner] += dt;
    }
  }
  const tot = possT.home + possT.away;
  for (const side of ['home', 'away'] as const) {
    const t = s[side];
    t.passAccuracy = t.passes ? Math.round((100 * completed[side]) / t.passes) : 0;
    t.possession = tot > 0 ? Math.round((100 * possT[side]) / tot) : 50;
    t.xg = Math.round(t.xg * 100) / 100;
  }
  s.away.possession = 100 - s.home.possession;
  return s;
}

export interface GoalInfo {
  side: TeamSide;
  clock: string;
  scorerId?: string;
  assistId?: string;
  tau: number;
  ownGoal: boolean;
  penalty: boolean;
  score: { home: number; away: number };
}

export function goalsOf(tl: MatchTimeline): GoalInfo[] {
  const out: GoalInfo[] = [];
  for (let i = 0; i < tl.events.length; i++) {
    const te = tl.events[i]!;
    if (te.ev.type !== 'goal') continue;
    let penalty = false;
    for (let j = i - 1; j >= Math.max(0, i - 3); j--) if (tl.events[j]!.ev.type === 'penalty') penalty = true;
    out.push({
      side: te.ev.team,
      clock: te.ev.clock,
      scorerId: te.ev.playerId,
      assistId: te.ev.otherPlayerId,
      tau: te.start,
      ownGoal: /eigentor/i.test(te.ev.text ?? ''),
      penalty,
      score: te.ev.score,
    });
  }
  return out;
}
