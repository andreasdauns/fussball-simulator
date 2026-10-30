/**
 * Zeitachse für die Darstellung.
 *
 * Die Engine liefert Ereignisse mit Spielzeit `t` (Sekunden). Für die Wiedergabe brauchen wir
 * eine streng monotone Zeitachse τ ("tau"): 1. Halbzeit τ = t, 2. Halbzeit um einen festen
 * Versatz verschoben, sodass zwischen Abpfiff der 1. HZ und Anpfiff der 2. HZ genau
 * BREAK_SECONDS liegen (Zeit, in der die Spieler zur Anstoßformation laufen).
 * Reine Funktionen, keine Zufallszahlen.
 */

import type { EventType, MatchEvent, MatchResult, TeamSide, Vec2 } from '../engine/types';

export const PITCH_L = 105;
export const PITCH_W = 68;
export const BREAK_SECONDS = 8;

/** Ereignisse, bei denen sich der Ball nicht bewegt bzw. die keinen Ballkontakt darstellen. */
export const BALLLESS_TYPES: ReadonlySet<EventType> = new Set<EventType>([
  'yellow-card',
  'red-card',
  'substitution',
  'half-time',
  'full-time',
]);

export const SET_PIECE_TYPES: ReadonlySet<EventType> = new Set<EventType>([
  'corner',
  'free-kick',
  'penalty',
  'goal-kick',
  'throw-in',
  'kickoff',
]);

/** Ereignisse, bei denen der Ball fliegt / rollt (der Ausführende bleibt zurück). */
export const FLIGHT_TYPES: ReadonlySet<EventType> = new Set<EventType>([
  'pass',
  'cross',
  'long-ball',
  'shot',
  'header',
  'clearance',
  'free-kick',
  'corner',
  'throw-in',
  'goal-kick',
  'penalty',
  'kickoff',
]);

/** Ereignisse, bei denen der Ausführende den Ball am Fuß mitführt. */
export const CARRY_TYPES: ReadonlySet<EventType> = new Set<EventType>(['carry', 'dribble']);

export interface TimedEvent {
  ev: MatchEvent;
  /** Index in der sortierten Gesamtliste */
  idx: number;
  start: number;
  end: number;
}

export function otherSide(s: TeamSide): TeamSide {
  return s === 'home' ? 'away' : 'home';
}

/** Spiegelung in das Team-Koordinatensystem (Angriff Richtung x = 105) und zurück (Involution). */
export function toTeam(p: Vec2, side: TeamSide): Vec2 {
  return side === 'home' ? { x: p.x, y: p.y } : { x: PITCH_L - p.x, y: PITCH_W - p.y };
}

export function fmtClock(secs: number): string {
  const s = Math.max(0, Math.floor(secs));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m < 10 ? '0' : ''}${m}:${r < 10 ? '0' : ''}${r}`;
}

export interface ClockDisplay {
  main: string;
  /** Nachspielzeit, z. B. "+2" (laufende Minute der Nachspielzeit) */
  stoppage?: string;
  half: 1 | 2;
  phase: 'pre' | 'live' | 'half-time' | 'full-time';
}

export class MatchTimeline {
  readonly result: MatchResult;
  /** Alle Ereignisse, nach τ sortiert */
  readonly events: TimedEvent[];
  /** Nur Ereignisse mit Ballbewegung */
  readonly ballEvents: TimedEvent[];
  readonly h2Offset: number;
  readonly h1StartT: number;
  /** τ des Halbzeitpfiffs */
  readonly halfTimeTau: number;
  /** τ des Anstoßes zur 2. Halbzeit */
  readonly h2StartTau: number;
  /** τ des Abpfiffs (Ende der Wiedergabe) */
  readonly endTau: number;
  readonly hasSecondHalf: boolean;
  private readonly ballStarts: number[];
  private readonly allStarts: number[];

  constructor(result: MatchResult) {
    this.result = result;
    const evs = result.events;
    const h1 = evs.filter((e) => e.half === 1);
    const h2 = evs.filter((e) => e.half === 2);
    this.h1StartT = h1.length ? Math.min(...h1.map((e) => e.t)) : 0;
    let h1End = 0;
    for (const e of h1) h1End = Math.max(h1End, e.t + Math.max(0, e.duration));
    const h2First = h2.length ? Math.min(...h2.map((e) => e.t)) : h1End + BREAK_SECONDS;
    this.hasSecondHalf = h2.length > 0;
    this.h2Offset = h2.length ? h1End + BREAK_SECONDS - h2First : 0;

    const timed: TimedEvent[] = evs.map((ev) => {
      const start = ev.half === 2 ? ev.t + this.h2Offset : ev.t;
      return { ev, idx: 0, start, end: start + Math.max(0, ev.duration) };
    });
    timed.sort((a, b) => a.start - b.start || a.ev.id - b.ev.id);
    timed.forEach((te, i) => (te.idx = i));
    this.events = timed;
    this.ballEvents = timed.filter((te) => !BALLLESS_TYPES.has(te.ev.type));
    this.ballStarts = this.ballEvents.map((te) => te.start);
    this.allStarts = timed.map((te) => te.start);

    const ht = timed.find((te) => te.ev.type === 'half-time');
    this.h2StartTau = h2.length ? h2First + this.h2Offset : h1End + BREAK_SECONDS;
    this.halfTimeTau = ht ? ht.start : h2.length ? h1End : h1End;
    let end = 0;
    for (const te of timed) end = Math.max(end, te.end);
    this.endTau = end;
  }

  tauOf(ev: MatchEvent): number {
    return ev.half === 2 ? ev.t + this.h2Offset : ev.t;
  }

  /** Index (in ballEvents) des letzten Ballereignisses mit start ≤ τ, sonst -1. */
  ballIndexAt(tau: number): number {
    return lastLE(this.ballStarts, tau);
  }

  /** Index (in events) des letzten Ereignisses mit start ≤ τ, sonst -1. */
  eventIndexAt(tau: number): number {
    return lastLE(this.allStarts, tau);
  }

  /** Displayhälfte: ab Halbzeitpfiff werden die Seiten gewechselt angezeigt. */
  isFlipped(tau: number): boolean {
    return this.hasSecondHalf && tau >= this.halfTimeTau;
  }

  halfAt(tau: number): 1 | 2 {
    return this.hasSecondHalf && tau >= this.halfTimeTau ? 2 : 1;
  }

  clockAt(tau: number): ClockDisplay {
    if (tau < 0) return { main: '00:00', half: 1, phase: 'pre' };
    if (tau >= this.endTau && this.endTau > 0) {
      return { main: '90:00', half: 2, phase: 'full-time' };
    }
    if (!this.hasSecondHalf || tau < this.halfTimeTau) {
      const secs = tau - this.h1StartT;
      if (secs >= 2700) {
        return { main: '45:00', stoppage: `+${Math.floor((secs - 2700) / 60) + 1}`, half: 1, phase: 'live' };
      }
      return { main: fmtClock(secs), half: 1, phase: 'live' };
    }
    if (tau < this.h2StartTau) return { main: '45:00', half: 2, phase: 'half-time' };
    const secs = 2700 + (tau - this.h2StartTau);
    if (secs >= 5400) {
      return { main: '90:00', stoppage: `+${Math.floor((secs - 5400) / 60) + 1}`, half: 2, phase: 'live' };
    }
    return { main: fmtClock(secs), half: 2, phase: 'live' };
  }

  /** Spielstand zum Zeitpunkt τ (nach allen Ereignissen mit start ≤ τ). */
  scoreAt(tau: number): { home: number; away: number } {
    const i = this.eventIndexAt(tau);
    if (i < 0) return { home: 0, away: 0 };
    return this.events[i]!.ev.score;
  }

  /** Engine-Zeit t zu einem τ (für result.momentum, das nach t/60 indiziert ist). */
  engineT(tau: number): number {
    if (!this.hasSecondHalf || tau < this.halfTimeTau) return tau;
    if (tau < this.h2StartTau) return this.halfTimeTau;
    return tau - this.h2Offset;
  }

  /** Umkehrung von engineT */
  tauOfEngineT(t: number): number {
    if (!this.hasSecondHalf || t < this.halfTimeTau) return t;
    return t + this.h2Offset;
  }

  /** Spielminute (0-basiert) für den Momentum-Graphen. */
  minuteAt(tau: number): number {
    if (tau < this.halfTimeTau || !this.hasSecondHalf) return Math.max(0, Math.floor((tau - this.h1StartT) / 60));
    return 45 + Math.max(0, Math.floor((tau - this.h2StartTau) / 60));
  }
}

function lastLE(arr: number[], v: number): number {
  let lo = 0;
  let hi = arr.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid]! <= v) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

/** Name eines Spielers aus beiden Kadern */
export function playerName(result: MatchResult, id: string | undefined, short = true): string {
  if (!id) return '';
  for (const team of [result.home, result.away]) {
    const p = team.players.find((pl) => pl.id === id) ?? team.bench.find((pl) => pl.id === id);
    if (p) return short ? p.shortName : p.name;
  }
  return id;
}
