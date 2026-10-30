/**
 * Positions-Synthese: erzeugt aus den Engine-Ereignissen (nur Ballwege) glaubwürdige
 * Positionen von Ball und allen Spielern zu jedem Zeitpunkt.
 *
 * - Rein und deterministisch: keine Zufallszahlen, keine Uhrzeit. Gleiches MatchResult
 *   und gleiche Zeit τ ergeben immer exakt dieselben Positionen, egal in welcher
 *   Reihenfolge abgefragt wird.
 * - Spieler werden in festen Schritten (10 Hz) vorwärts simuliert (Höchsttempo,
 *   Beschleunigungsgrenze). Alle 5 s wird ein Schnappschuss gespeichert, damit Springen
 *   (Spulen) schnell geht.
 * - Rechnet im festen Engine-Koordinatensystem; erst die Ausgabe (`frameAt`) spiegelt in
 *   der 2. Halbzeit für die Anzeige (Seitenwechsel).
 *
 * Diese Datei ist auch die Grundlage der späteren 3D-Ansicht (Skill broadcast-3d-conventions).
 */

import type { LineupSlot, MatchEvent, MatchResult, TeamSheet, TeamSide, Vec2 } from '../engine/types';
import {
  CARRY_TYPES,
  FLIGHT_TYPES,
  MatchTimeline,
  PITCH_L,
  PITCH_W,
  SET_PIECE_TYPES,
  type TimedEvent,
  otherSide,
  toTeam,
} from './timeline';

export const DT = 0.1;
const SNAP_EVERY = 50; // alle 5 s Spielzeit
const ACCEL = 4.2; // m/s²
const BENCH: Vec2 = { x: 52.5, y: 69.6 };
const BOUND = 2.6; // Spieler dürfen max. so weit hinter die Linien (Bank, Einwurf)
const CENTRE: Vec2 = { x: 52.5, y: 34 };

export interface BallState {
  x: number;
  y: number;
  /** Höhe über dem Boden in Metern */
  z: number;
}

export interface AgentInfo {
  idx: number;
  id: string;
  side: TeamSide;
  number: number;
  name: string;
  shortName: string;
  /** Höchsttempo in m/s */
  vmax: number;
  aerial: number;
}

export interface PlayerFrame {
  idx: number;
  id: string;
  side: TeamSide;
  number: number;
  shortName: string;
  x: number;
  y: number;
  isGK: boolean;
  /** Verlässt gerade den Platz (Auswechslung, Platzverweis) */
  leaving: boolean;
}

export interface Frame {
  tau: number;
  /** Anzeige gespiegelt (2. Halbzeit) */
  flipped: boolean;
  /** Ball in Anzeige-Koordinaten */
  ball: BallState;
  players: PlayerFrame[];
  /** Spieler am Ball (Agent-Index) oder -1 */
  holder: number;
  possession: TeamSide;
}

type Mode = 'play' | 'kickoff' | 'corner' | 'free-kick' | 'penalty' | 'goal-kick' | 'throw-in' | 'end';

interface Ctx {
  tau: number;
  ball: BallState;
  /** Wohin der Ball gerade unterwegs ist (bei Flugbällen das Ziel), sonst Ballposition */
  aim: Vec2;
  poss: TeamSide;
  holder: number;
  runners: { agent: number; target: Vec2; boost: number }[];
  mode: Mode;
  sp: MatchEvent | null;
  celebrate: { side: TeamSide; scorer: number } | null;
}

interface TeamInfo {
  side: TeamSide;
  sheet: TeamSheet;
  slots: LineupSlot[];
  agents: number[];
}

class SimState {
  k = 0;
  evPtr = 0;
  readonly px: Float64Array;
  readonly py: Float64Array;
  readonly vx: Float64Array;
  readonly vy: Float64Array;
  /** 0 = nicht auf dem Platz, 1 = spielt, 2 = verlässt den Platz */
  readonly status: Uint8Array;
  readonly slot: Int8Array;
  readonly gk: Uint8Array;
  /** geglättete Ballbesitzphase je Team (0 = gegen den Ball, 1 = mit Ball) */
  readonly poss = new Float64Array(2);

  constructor(n: number) {
    this.px = new Float64Array(n);
    this.py = new Float64Array(n);
    this.vx = new Float64Array(n);
    this.vy = new Float64Array(n);
    this.status = new Uint8Array(n);
    this.slot = new Int8Array(n).fill(-1);
    this.gk = new Uint8Array(n);
  }

  copyFrom(o: SimState): void {
    this.k = o.k;
    this.evPtr = o.evPtr;
    this.px.set(o.px);
    this.py.set(o.py);
    this.vx.set(o.vx);
    this.vy.set(o.vy);
    this.status.set(o.status);
    this.slot.set(o.slot);
    this.gk.set(o.gk);
    this.poss.set(o.poss);
  }

  clone(): SimState {
    const s = new SimState(this.px.length);
    s.copyFrom(this);
    return s;
  }
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const hyp = (dx: number, dy: number) => Math.sqrt(dx * dx + dy * dy);
const distV = (a: Vec2, b: Vec2) => hyp(a.x - b.x, a.y - b.y);
const smooth = (u: number) => {
  const t = clamp(u, 0, 1);
  return t * t * (3 - 2 * t);
};

/** Wer ist nach diesem Ereignis am Ball? (Foul/Abseits/Tor/Fehlschuss → Gegner) */
function possOf(ev: MatchEvent): TeamSide {
  switch (ev.type) {
    case 'foul':
    case 'offside':
    case 'goal':
    case 'miss':
      return otherSide(ev.team);
    default:
      return ev.team;
  }
}

const SHOT_TYPES = new Set(['shot', 'header']);

/** Ballposition (feste Koordinaten) zum Zeitpunkt τ – reine Funktion der Ereignisse. */
export function ballAtTau(tl: MatchTimeline, tau: number): BallState {
  const bi = tl.ballIndexAt(tau);
  if (bi < 0) {
    const first = tl.ballEvents[0];
    return first ? { x: first.ev.from.x, y: first.ev.from.y, z: 0 } : { x: CENTRE.x, y: CENTRE.y, z: 0 };
  }
  const cur = tl.ballEvents[bi]!;
  const ev = cur.ev;
  if (tau < cur.end && cur.end > cur.start) {
    const s = (tau - cur.start) / (cur.end - cur.start);
    return interpEvent(ev, s);
  }
  const nxt = tl.ballEvents[bi + 1];
  if (nxt && distV(ev.to, nxt.ev.from) > 0.5) {
    // Spielfortsetzung an anderer Stelle: Ball liegt kurz, wird dann zum neuen Ort gebracht
    const gap = Math.max(0.001, nxt.start - cur.end);
    const w = smooth((tau - cur.end) / gap / 0.5 - 0.7);
    return { x: lerp(ev.to.x, nxt.ev.from.x, w), y: lerp(ev.to.y, nxt.ev.from.y, w), z: 0 };
  }
  return { x: ev.to.x, y: ev.to.y, z: 0 };
}

function interpEvent(ev: MatchEvent, s: number): BallState {
  const d = distV(ev.from, ev.to);
  const h = ev.height ?? 'ground';
  let sp = s;
  if (h === 'ground' && FLIGHT_TYPES.has(ev.type)) sp = 1 - Math.pow(1 - s, 1.5); // rollt aus
  let hMax = 0;
  if (h === 'high') hMax = clamp(d * 0.22, 2.5, 16);
  else if (h === 'mid') hMax = clamp(d * 0.07, 0.6, 3);
  return {
    x: lerp(ev.from.x, ev.to.x, sp),
    y: lerp(ev.from.y, ev.to.y, sp),
    z: 4 * hMax * s * (1 - s),
  };
}

export function toDisplay(p: Vec2, flipped: boolean): Vec2 {
  return flipped ? { x: PITCH_L - p.x, y: PITCH_W - p.y } : { x: p.x, y: p.y };
}

export class PositionSynth {
  readonly result: MatchResult;
  readonly timeline: MatchTimeline;
  readonly agents: AgentInfo[] = [];
  private readonly agentById = new Map<string, number>();
  private readonly teams: [TeamInfo, TeamInfo];
  private readonly snaps: SimState[] = [];
  private readonly cur: SimState;
  private readonly prev: SimState;
  /** höchster bislang simulierter Schritt (für Vorberechnung) */
  private frontier: SimState;
  readonly maxStep: number;
  // Arbeitsspeicher für Ziele
  private readonly tx: Float64Array;
  private readonly ty: Float64Array;
  private readonly spd: Float64Array;
  private readonly acc: Float64Array;
  private readonly fixed: Uint8Array;

  constructor(result: MatchResult) {
    this.result = result;
    this.timeline = new MatchTimeline(result);
    this.teams = [this.buildTeam('home', result.home), this.buildTeam('away', result.away)];
    // Spieler, die nur in Ereignissen auftauchen (z. B. Einwechselspieler außerhalb des Kaders)
    for (const ev of result.events) {
      if (ev.type === 'substitution' && ev.otherPlayerId && !this.agentById.has(`${ev.team}:${ev.otherPlayerId}`)) {
        const idx = this.addAgent(ev.team, ev.otherPlayerId, 0, ev.otherPlayerId, ev.otherPlayerId, 75, 50);
        this.teamOf(ev.team).agents.push(idx);
      }
    }
    const n = this.agents.length;
    this.tx = new Float64Array(n);
    this.ty = new Float64Array(n);
    this.spd = new Float64Array(n);
    this.acc = new Float64Array(n);
    this.fixed = new Uint8Array(n);
    this.maxStep = Math.ceil((this.timeline.endTau + 30) / DT);

    const s0 = new SimState(n);
    for (const t of this.teams) {
      t.agents.forEach((a) => {
        s0.px[a] = BENCH.x;
        s0.py[a] = BENCH.y;
      });
      t.sheet.lineup.forEach((slot, si) => {
        const a = this.agentById.get(`${t.side}:${slot.playerId}`);
        if (a === undefined) return;
        s0.status[a] = 1;
        s0.slot[a] = si;
        s0.gk[a] = slot.position === 'GK' ? 1 : 0;
      });
    }
    // Startaufstellung = Anstoßformation, ohne Anlauf
    const c0 = this.buildCtx(0);
    this.computeTargets(s0, c0);
    for (let i = 0; i < n; i++) {
      if (s0.status[i] === 1) {
        s0.px[i] = this.tx[i]!;
        s0.py[i] = this.ty[i]!;
      }
    }
    this.snaps.push(s0.clone());
    this.cur = s0.clone();
    this.prev = s0.clone();
    this.frontier = s0.clone();
  }

  private buildTeam(side: TeamSide, sheet: TeamSheet): TeamInfo {
    const t: TeamInfo = { side, sheet, slots: sheet.lineup.map((s) => ({ ...s })), agents: [] };
    const seen = new Set<string>();
    const ordered = [
      ...sheet.lineup.map((s) => s.playerId),
      ...sheet.players.map((p) => p.id),
      ...sheet.bench.map((p) => p.id),
    ];
    for (const id of ordered) {
      if (seen.has(id)) continue;
      seen.add(id);
      const p = sheet.players.find((q) => q.id === id) ?? sheet.bench.find((q) => q.id === id);
      const pace = p?.attributes.pace ?? 70;
      const aerial = p ? p.attributes.heading + p.attributes.strength * 0.5 : 50;
      t.agents.push(this.addAgent(side, id, p?.number ?? 0, p?.name ?? id, p?.shortName ?? id, pace, aerial));
    }
    return t;
  }

  private addAgent(side: TeamSide, id: string, number: number, name: string, shortName: string, pace: number, aerial: number): number {
    const idx = this.agents.length;
    this.agents.push({ idx, id, side, number, name, shortName, vmax: 5.6 + (2.8 * clamp(pace, 1, 99)) / 99, aerial });
    this.agentById.set(`${side}:${id}`, idx);
    return idx;
  }

  /** Agent zu einer Spieler-ID; `side` wird bevorzugt (dieselbe ID kann in beiden Kadern stehen). */
  agentIndex(id: string | undefined, side?: TeamSide): number {
    if (!id) return -1;
    if (side) {
      const a = this.agentById.get(`${side}:${id}`);
      if (a !== undefined) return a;
    }
    return this.agentById.get(`home:${id}`) ?? this.agentById.get(`away:${id}`) ?? -1;
  }

  /** Ausführender Spieler eines Ereignisses */
  actor(ev: MatchEvent): number {
    return this.agentIndex(ev.playerId, ev.team);
  }

  /** Zweiter Spieler: Mitspieler bei Pässen/Standards/Wechseln/Toren, sonst Gegenspieler */
  other(ev: MatchEvent): number {
    const same = FLIGHT_TYPES.has(ev.type) || ev.type === 'goal' || ev.type === 'substitution';
    return this.agentIndex(ev.otherPlayerId, same ? ev.team : otherSide(ev.team));
  }

  /** Ball in festen Koordinaten */
  ballAt(tau: number): BallState {
    return ballAtTau(this.timeline, tau);
  }

  // ───────────────────────────── Kontext ─────────────────────────────

  private buildCtx(tau: number): Ctx {
    const tl = this.timeline;
    const bi = tl.ballIndexAt(tau);
    const cur: TimedEvent | undefined = bi >= 0 ? tl.ballEvents[bi] : undefined;
    const nxt: TimedEvent | undefined = tl.ballEvents[bi + 1];
    const ball = this.ballAt(tau);
    const inEvent = !!cur && tau < cur.end;
    const ev = cur?.ev;

    let poss: TeamSide;
    if (!ev) poss = nxt?.ev.team ?? 'home';
    else if (inEvent) poss = possOf(ev);
    else poss = nxt ? nxt.ev.team : possOf(ev);

    const aim: Vec2 = ev && inEvent && FLIGHT_TYPES.has(ev.type) ? ev.to : { x: ball.x, y: ball.y };

    let mode: Mode = 'play';
    let sp: MatchEvent | null = null;
    if (tau >= tl.endTau) mode = 'end';
    else if (!inEvent && nxt && SET_PIECE_TYPES.has(nxt.ev.type)) sp = nxt.ev;
    else if (ev && SET_PIECE_TYPES.has(ev.type) && (inEvent || distV(ev.from, ev.to) < 0.5)) sp = ev;
    if (sp) mode = sp.type === 'kickoff' ? 'kickoff' : (sp.type as Mode);

    let holder = -1;
    if (ev && inEvent) {
      if (CARRY_TYPES.has(ev.type)) holder = this.actor(ev);
      else if (
        !FLIGHT_TYPES.has(ev.type) &&
        distV(ev.from, ev.to) < 0.5 &&
        ev.type !== 'goal' &&
        ev.type !== 'miss' &&
        ev.type !== 'offside' &&
        ev.type !== 'foul'
      )
        holder = this.actor(ev);
    } else if (nxt && nxt.ev.playerId && distV(nxt.ev.from, ball) < 1.0) {
      holder = this.actor(nxt.ev);
    }

    const runners: Ctx['runners'] = [];
    if (ev && inEvent) {
      if (FLIGHT_TYPES.has(ev.type) && !SHOT_TYPES.has(ev.type) && ev.otherPlayerId) {
        runners.push({ agent: this.other(ev), target: ev.to, boost: 1.3 });
      } else if ((ev.type === 'dribble' || ev.type === 'tackle' || ev.type === 'foul') && ev.otherPlayerId) {
        runners.push({ agent: this.other(ev), target: ball, boost: 1.2 });
        if (ev.type === 'foul') runners.push({ agent: this.actor(ev), target: ball, boost: 1.1 });
      }
    }
    if (nxt && nxt.ev.playerId && nxt.start - tau < 10) {
      const a = this.actor(nxt.ev);
      if (a !== holder) runners.push({ agent: a, target: nxt.ev.from, boost: 1.25 });
    }

    let celebrate: Ctx['celebrate'] = null;
    if (ev && ev.type === 'goal' && nxt?.ev.type === 'kickoff' && tau - cur!.start < Math.min(22, (nxt.start - cur!.start) * 0.5)) {
      celebrate = { side: ev.team, scorer: this.actor(ev) };
    }

    return { tau, ball, aim, poss, holder, runners: runners.filter((r) => r.agent >= 0), mode, sp, celebrate };
  }

  // ───────────────────────────── Ziele ─────────────────────────────

  private setT(i: number, team: TeamSide, pT: Vec2): void {
    const p = toTeam(pT, team);
    this.tx[i] = p.x;
    this.ty[i] = p.y;
  }

  private computeTargets(st: SimState, c: Ctx): void {
    const n = this.agents.length;
    for (let i = 0; i < n; i++) {
      this.tx[i] = st.px[i]!;
      this.ty[i] = st.py[i]!;
      this.spd[i] = 1;
      this.acc[i] = 1;
      this.fixed[i] = 0;
    }
    if (c.mode === 'end') {
      for (let i = 0; i < n; i++) this.spd[i] = 0.3;
      this.leaving(st);
      return;
    }

    // 1) Grundordnung beider Teams
    for (const team of this.teams) this.shape(st, c, team);

    // 2) Pressing der verteidigenden Mannschaft
    if (c.mode === 'play' || c.mode === 'throw-in') this.pressing(st, c);

    // 3) Laufwege für Passempfänger und nächsten Ballspieler
    for (const r of c.runners) {
      if (st.status[r.agent] !== 1) continue;
      this.tx[r.agent] = r.target.x;
      this.ty[r.agent] = r.target.y;
      this.spd[r.agent] = r.boost;
      this.acc[r.agent] = 1.6;
      this.fixed[r.agent] = 1;
    }

    // 4) Standardsituationen
    if (c.sp) {
      const sp = c.sp;
      switch (c.mode) {
        case 'kickoff':
          for (const t of this.teams) this.kickoffShape(st, t, sp.team === t.side, sp);
          break;
        case 'corner':
          this.cornerShape(st, sp);
          break;
        case 'free-kick':
          this.freeKickShape(st, sp);
          break;
        case 'penalty':
          this.penaltyShape(st, sp);
          break;
        case 'goal-kick':
          this.goalKickShape(st, sp);
          break;
        default:
          break;
      }
    }

    // 5) Torjubel
    if (c.celebrate) this.celebration(st, c.celebrate.side, c.celebrate.scorer);

    // 6) Ballführender
    if (c.holder >= 0 && st.status[c.holder] === 1) {
      this.tx[c.holder] = c.ball.x;
      this.ty[c.holder] = c.ball.y;
      this.spd[c.holder] = 1.3;
      this.acc[c.holder] = 2;
      this.fixed[c.holder] = 1;
    }

    // 7) Abstand zwischen Mitspielern (nur im offenen Spiel)
    if (c.mode === 'play') this.separate(st);

    this.leaving(st);
  }

  private shape(st: SimState, c: Ctx, team: TeamInfo): void {
    const side = team.side;
    const si = side === 'home' ? 0 : 1;
    const tac = team.sheet.tactic;
    const ph = st.poss[si]!;
    const attacking = c.poss === side;
    const bT = toTeam(c.aim, side);

    // Abseitslinie: zweitletzter Gegenspieler (in Team-Koordinaten), mindestens Mittellinie
    let offLine = PITCH_L;
    if (attacking) {
      let m1 = -1;
      let m2 = -1;
      const opp = this.teams[si === 0 ? 1 : 0];
      for (const a of opp.agents) {
        if (st.status[a] !== 1) continue;
        const x = side === 'home' ? st.px[a]! : PITCH_L - st.px[a]!;
        if (x > m1) {
          m2 = m1;
          m1 = x;
        } else if (x > m2) m2 = x;
      }
      offLine = Math.max(m2, 52.5);
    }

    for (const a of team.agents) {
      if (st.status[a] !== 1) continue;
      const slot = team.slots[st.slot[a]!];
      if (!slot) continue;
      const ax = lerp(slot.anchorDefend.x, slot.anchorAttack.x, ph);
      const ay = lerp(slot.anchorDefend.y, slot.anchorAttack.y, ph);
      let x: number;
      let y: number;
      if (st.gk[a]) {
        x = lerp(clamp(2.5 + bT.x * 0.07, 2, 10), clamp(6 + bT.x * 0.14, 6, 24), ph);
        y = clamp(34 + (bT.y - 34) * 0.2, 29, 39);
      } else {
        const kx = lerp(0.3, 0.36, ph);
        const lineAdj = (tac.defensiveLine - 0.5) * lerp(12, 8, ph);
        x = ax + (bT.x - 52.5) * kx + lineAdj;
        const wScale = lerp(0.8 - 0.15 * tac.pressingIntensity, 0.85 + 0.3 * tac.width, ph);
        const ky = lerp(0.35, 0.15, ph);
        y = 34 + (ay - 34) * wScale + (bT.y - 34) * ky;
        if (attacking && x > bT.x) x = Math.min(x, Math.max(offLine - 0.6, bT.x));
        x = clamp(x, 3, 102);
        y = clamp(y, 1.5, 66.5);
      }
      this.setT(a, side, { x, y });
      this.spd[a] = 0.85;
    }
  }

  private pressing(st: SimState, c: Ctx): void {
    const D = otherSide(c.poss);
    const team = this.teams[D === 'home' ? 0 : 1];
    const tac = team.sheet.tactic;
    const bD = toTeam(c.aim, D);
    const pressLine = 45 + 50 * tac.pressingHeight;
    let n = bD.x <= pressLine ? 1 + Math.round(2 * tac.pressingIntensity) : bD.x <= pressLine + 12 ? 1 : 0;
    if (bD.x < 30) n = Math.max(n, 2);
    if (n <= 0) return;
    const cand: { a: number; d: number }[] = [];
    for (const a of team.agents) {
      if (st.status[a] !== 1 || st.gk[a] || this.fixed[a]) continue;
      cand.push({ a, d: hyp(st.px[a]! - c.aim.x, st.py[a]! - c.aim.y) });
    }
    cand.sort((p, q) => p.d - q.d || p.a - q.a);
    const goal = D === 'home' ? { x: 0, y: 34 } : { x: PITCH_L, y: 34 };
    let dx = goal.x - c.aim.x;
    let dy = goal.y - c.aim.y;
    const dl = hyp(dx, dy) || 1;
    dx /= dl;
    dy /= dl;
    const px = -dy;
    const py = dx;
    for (let j = 0; j < Math.min(n, cand.length); j++) {
      const a = cand[j]!.a;
      const back = j === 0 ? 1.4 : 3.5;
      const lat = j === 0 ? 0 : j === 1 ? 3 : -3;
      this.tx[a] = c.aim.x + dx * back + px * lat;
      this.ty[a] = c.aim.y + dy * back + py * lat;
      this.spd[a] = 1.1 + 0.15 * tac.pressingIntensity;
      this.acc[a] = 1.3;
      this.fixed[a] = 1;
    }
  }

  private kickoffShape(st: SimState, team: TeamInfo, kicking: boolean, ev: MatchEvent): void {
    const kicker = this.actor(ev);
    const recv = this.other(ev);
    for (const a of team.agents) {
      if (st.status[a] !== 1) continue;
      const slot = team.slots[st.slot[a]!];
      if (!slot) continue;
      let p: Vec2;
      if (st.gk[a]) p = { x: 5, y: 34 };
      else {
        p = { x: Math.min(slot.anchorDefend.x * 0.9 + 2, 49.5), y: 34 + (slot.anchorDefend.y - 34) * 0.95 };
        if (!kicking) {
          const d = distV(p, CENTRE);
          if (d < 10) {
            const ux = d > 0.01 ? (p.x - CENTRE.x) / d : -1;
            const uy = d > 0.01 ? (p.y - CENTRE.y) / d : 0;
            p = { x: CENTRE.x + ux * 10, y: CENTRE.y + uy * 10 };
          }
        }
      }
      if (kicking && a === kicker) p = { x: 52.1, y: 34.4 };
      if (kicking && a === recv) {
        const r = toTeam(ev.to, team.side);
        p = { x: Math.min(r.x, 51.5), y: r.y };
      }
      this.setT(a, team.side, p);
      this.spd[a] = 0.75;
      this.fixed[a] = 1;
    }
  }

  private teamOf(side: TeamSide): TeamInfo {
    return this.teams[side === 'home' ? 0 : 1];
  }

  private outfield(st: SimState, team: TeamInfo, exclude: number): number[] {
    return team.agents.filter((a) => st.status[a] === 1 && !st.gk[a] && a !== exclude);
  }

  private gkOf(st: SimState, team: TeamInfo): number {
    for (const a of team.agents) if (st.status[a] === 1 && st.gk[a]) return a;
    return -1;
  }

  private cornerShape(st: SimState, ev: MatchEvent): void {
    const A = this.teamOf(ev.team);
    const B = this.teamOf(otherSide(ev.team));
    const taker = this.actor(ev);
    const spotA = toTeam(ev.from, A.side);
    const flip = spotA.y > 34;
    const my = (y: number) => (flip ? PITCH_W - y : y);
    const BOX = [
      { x: 97.5, y: 31 },
      { x: 98.5, y: 36.5 },
      { x: 95, y: 40 },
      { x: 93.5, y: 33 },
      { x: 100.5, y: 34.5 },
    ];
    const EDGE = [
      { x: 86, y: 28 },
      { x: 85, y: 40 },
    ];
    const att = this.outfield(st, A, taker).sort((p, q) => this.agents[q]!.aerial - this.agents[p]!.aerial || p - q);
    att.forEach((a, j) => {
      let p: Vec2;
      if (j < BOX.length) p = { x: BOX[j]!.x, y: my(BOX[j]!.y) };
      else if (j < BOX.length + EDGE.length) p = { x: EDGE[j - BOX.length]!.x, y: my(EDGE[j - BOX.length]!.y) };
      else {
        const slot = A.slots[st.slot[a]!]!;
        p = { x: clamp(slot.anchorDefend.x + 32, 42, 60), y: slot.anchorDefend.y };
      }
      this.setT(a, A.side, p);
      this.fixed[a] = 1;
    });
    const gkA = this.gkOf(st, A);
    if (gkA >= 0) this.setT(gkA, A.side, { x: 22, y: 34 });

    const spotB = toTeam(ev.from, B.side);
    const nearY = spotB.y < 34 ? 30.4 : 37.6;
    const ZONE = [
      { x: 1.2, y: nearY },
      { x: 5.5, y: 30 },
      { x: 5.5, y: 38 },
      { x: 6.8, y: 34 },
      { x: 9.5, y: 28.5 },
      { x: 9.5, y: 39.5 },
      { x: 11.5, y: 34 },
      { x: 14, y: 30.5 },
      { x: 14, y: 37.5 },
      { x: 18, y: 34 },
    ];
    const def = this.outfield(st, B, -1).sort((p, q) => {
      const sp = B.slots[st.slot[p]!]!.anchorDefend.x;
      const sq = B.slots[st.slot[q]!]!.anchorDefend.x;
      return sq - sp || p - q;
    });
    const stayUp = def.length >= 9 ? def.shift() : undefined;
    if (stayUp !== undefined) this.setT(stayUp, B.side, { x: 38, y: 34 });
    def.reverse(); // tiefste zuerst
    def.forEach((a, j) => {
      const z = ZONE[j % ZONE.length]!;
      this.setT(a, B.side, z);
      this.fixed[a] = 1;
    });
    const gkB = this.gkOf(st, B);
    if (gkB >= 0) this.setT(gkB, B.side, { x: 0.9, y: spotB.y < 34 ? 32.6 : 35.4 });
  }

  private freeKickShape(st: SimState, ev: MatchEvent): void {
    const A = this.teamOf(ev.team);
    const B = this.teamOf(otherSide(ev.team));
    const taker = this.actor(ev);
    const sA = toTeam(ev.from, A.side);
    const dangerous = sA.x > 72 && Math.abs(sA.y - 34) < 26;
    if (!dangerous) {
      // Gegner halten 9,15 m Abstand
      for (const a of B.agents) {
        if (st.status[a] !== 1) continue;
        const dx = this.tx[a]! - ev.from.x;
        const dy = this.ty[a]! - ev.from.y;
        const d = hyp(dx, dy);
        if (d < 9.5) {
          const ux = d > 0.01 ? dx / d : B.side === 'home' ? -1 : 1;
          const uy = d > 0.01 ? dy / d : 0;
          this.tx[a] = clamp(ev.from.x + ux * 9.5, 0.5, PITCH_L - 0.5);
          this.ty[a] = clamp(ev.from.y + uy * 9.5, 0.5, PITCH_W - 0.5);
        }
      }
      return;
    }
    // Mauer
    let dx = PITCH_L - sA.x;
    let dy = 34 - sA.y;
    const dl = hyp(dx, dy) || 1;
    dx /= dl;
    dy /= dl;
    const wc = { x: sA.x + dx * 9.15, y: sA.y + dy * 9.15 };
    const nWall = sA.x > 84 ? 4 : 3;
    const wcFixed = toTeam(wc, A.side);
    const def = this.outfield(st, B, -1).sort((p, q) => {
      const dp = hyp(st.px[p]! - wcFixed.x, st.py[p]! - wcFixed.y);
      const dq = hyp(st.px[q]! - wcFixed.x, st.py[q]! - wcFixed.y);
      return dp - dq || p - q;
    });
    const ZONE = [
      { x: 8, y: 30 },
      { x: 8, y: 38 },
      { x: 9.5, y: 34 },
      { x: 12, y: 27 },
      { x: 12, y: 41 },
      { x: 14, y: 34 },
      { x: 16, y: 30 },
      { x: 16, y: 38 },
    ];
    def.forEach((a, j) => {
      if (j < nWall) {
        const off = (j - (nWall - 1) / 2) * 0.75;
        this.setT(a, A.side, { x: wc.x - dy * off, y: wc.y + dx * off });
      } else this.setT(a, B.side, ZONE[(j - nWall) % ZONE.length]!);
      this.fixed[a] = 1;
    });
    const gkB = this.gkOf(st, B);
    if (gkB >= 0) {
      const sB = toTeam(ev.from, B.side);
      this.setT(gkB, B.side, { x: 1, y: clamp(34 - (sB.y - 34) * 0.12, 31, 37) });
    }
    const BOX = [
      { x: 93, y: 30 },
      { x: 94, y: 36 },
      { x: 92, y: 41 },
      { x: 95, y: 33 },
    ];
    const att = this.outfield(st, A, taker).sort((p, q) => this.agents[q]!.aerial - this.agents[p]!.aerial || p - q);
    att.slice(0, 4).forEach((a, j) => {
      this.setT(a, A.side, BOX[j]!);
      this.fixed[a] = 1;
    });
  }

  private penaltyShape(st: SimState, ev: MatchEvent): void {
    const A = this.teamOf(ev.team);
    const B = this.teamOf(otherSide(ev.team));
    const taker = this.actor(ev);
    const rest: { a: number; side: TeamSide }[] = [];
    for (const t of [A, B]) for (const a of this.outfield(st, t, taker)) rest.push({ a, side: t.side });
    rest.sort((p, q) => p.a - q.a);
    const m = rest.length;
    rest.forEach((r, j) => {
      const y = 17 + (34 * j) / Math.max(1, m - 1);
      const x = Math.abs(y - 34) < 10.5 ? 84 - (j % 2) * 1.2 : 87 - (j % 2) * 1.2;
      this.setT(r.a, A.side, { x, y });
      this.fixed[r.a] = 1;
    });
    const gkB = this.gkOf(st, B);
    if (gkB >= 0) this.setT(gkB, B.side, { x: 0.3, y: 34 });
    const gkA = this.gkOf(st, A);
    if (gkA >= 0) this.setT(gkA, A.side, { x: 30, y: 34 });
  }

  private goalKickShape(st: SimState, ev: MatchEvent): void {
    const B = this.teamOf(otherSide(ev.team));
    for (const a of B.agents) {
      if (st.status[a] !== 1 || st.gk[a]) continue;
      const pA = toTeam({ x: this.tx[a]!, y: this.ty[a]! }, ev.team);
      if (pA.x < 17.5 && Math.abs(pA.y - 34) < 21) this.setT(a, ev.team, { x: 18, y: pA.y });
    }
  }

  private celebration(st: SimState, side: TeamSide, scorer: number): void {
    const team = this.teamOf(side);
    if (scorer < 0 || st.status[scorer] !== 1) return;
    const sT = toTeam({ x: st.px[scorer]!, y: st.py[scorer]! }, side);
    this.setT(scorer, side, { x: 99, y: sT.y < 34 ? 4 : 64 });
    this.spd[scorer] = 1.1;
    this.fixed[scorer] = 1;
    const mates = this.outfield(st, team, scorer);
    mates.forEach((a, j) => {
      const ang = (j / Math.max(1, mates.length)) * Math.PI * 2;
      this.tx[a] = st.px[scorer]! + Math.cos(ang) * 2.4;
      this.ty[a] = st.py[scorer]! + Math.sin(ang) * 2.4;
      this.spd[a] = 1.05;
      this.fixed[a] = 1;
    });
  }

  private separate(st: SimState): void {
    for (const team of this.teams) {
      const ag = team.agents.filter((a) => st.status[a] === 1);
      for (let i = 0; i < ag.length; i++) {
        for (let j = i + 1; j < ag.length; j++) {
          const a = ag[i]!;
          const b = ag[j]!;
          const dx = this.tx[b]! - this.tx[a]!;
          const dy = this.ty[b]! - this.ty[a]!;
          const d = hyp(dx, dy);
          const min = 3.2;
          if (d >= min) continue;
          const ux = d > 0.01 ? dx / d : 0;
          const uy = d > 0.01 ? dy / d : 1;
          const push = (min - d) / 2;
          if (!this.fixed[a]) {
            this.tx[a] = this.tx[a]! - ux * push;
            this.ty[a] = this.ty[a]! - uy * push;
          }
          if (!this.fixed[b]) {
            this.tx[b] = this.tx[b]! + ux * push;
            this.ty[b] = this.ty[b]! + uy * push;
          }
        }
      }
    }
  }

  private leaving(st: SimState): void {
    for (let i = 0; i < this.agents.length; i++) {
      if (st.status[i] !== 2) continue;
      this.tx[i] = BENCH.x + (this.agents[i]!.side === 'home' ? -3 : 3);
      this.ty[i] = BENCH.y;
      this.spd[i] = 0.55;
    }
  }

  // ───────────────────────────── Schritt ─────────────────────────────

  /** Wendet Wechsel/Platzverweise an. Rückgabe true = Halbzeitpfiff in diesem Schritt. */
  private applyEvents(st: SimState, tau: number): boolean {
    let halfTime = false;
    const evs = this.timeline.events;
    while (st.evPtr < evs.length && evs[st.evPtr]!.start <= tau) {
      const ev = evs[st.evPtr]!.ev;
      st.evPtr++;
      if (ev.type === 'half-time') halfTime = true;
      else if (ev.type === 'substitution') {
        const off = this.actor(ev);
        const on = this.other(ev);
        if (off < 0 || on < 0 || st.status[on] === 1) continue;
        const slot = st.slot[off]!;
        if (slot < 0) continue;
        st.slot[on] = slot;
        st.gk[on] = st.gk[off]!;
        st.status[on] = 1;
        st.px[on] = BENCH.x;
        st.py[on] = BENCH.y;
        st.vx[on] = 0;
        st.vy[on] = 0;
        st.status[off] = 2;
        st.slot[off] = -1;
      } else if (ev.type === 'red-card') {
        const a = this.actor(ev);
        if (a >= 0 && st.status[a] === 1) {
          st.status[a] = 2;
          st.slot[a] = -1;
        }
      }
    }
    return halfTime;
  }

  private step(st: SimState): void {
    const tau = (st.k + 1) * DT;
    const halfTime = this.applyEvents(st, tau);
    if (halfTime) {
      // Kabinengang: alle stehen zur 2. Halbzeit direkt in Anstoßformation (Bildschnitt)
      const ck = this.buildCtx(Math.max(tau, this.timeline.h2StartTau));
      this.computeTargets(st, ck);
      for (let i = 0; i < this.agents.length; i++) {
        if (st.status[i] === 2) st.status[i] = 0;
        if (st.status[i] !== 1) continue;
        st.px[i] = this.tx[i]!;
        st.py[i] = this.ty[i]!;
        st.vx[i] = 0;
        st.vy[i] = 0;
      }
      st.poss[0] = 0;
      st.poss[1] = 0;
    }
    const c = this.buildCtx(tau);
    // Ballbesitzphase glätten
    for (let s = 0; s < 2; s++) {
      const target = c.poss === (s === 0 ? 'home' : 'away') ? 1 : 0;
      const d = clamp(target - st.poss[s]!, -DT / 1.2, DT / 1.2);
      st.poss[s] = st.poss[s]! + d;
    }
    this.computeTargets(st, c);
    const h = c.holder;
    const hx0 = h >= 0 ? st.px[h]! : 0;
    const hy0 = h >= 0 ? st.py[h]! : 0;
    const n = this.agents.length;
    for (let i = 0; i < n; i++) {
      if (st.status[i] === 0) continue;
      const vmax = this.agents[i]!.vmax * this.spd[i]!;
      const amax = ACCEL * this.acc[i]! * DT;
      const dx = this.tx[i]! - st.px[i]!;
      const dy = this.ty[i]! - st.py[i]!;
      const d = hyp(dx, dy);
      let dvx: number;
      let dvy: number;
      if (d < 0.05) {
        dvx = -st.vx[i]!;
        dvy = -st.vy[i]!;
      } else {
        const want = Math.min(vmax, d * 1.4);
        dvx = (dx / d) * want - st.vx[i]!;
        dvy = (dy / d) * want - st.vy[i]!;
      }
      const dv = hyp(dvx, dvy);
      if (dv > amax) {
        dvx *= amax / dv;
        dvy *= amax / dv;
      }
      st.vx[i] = st.vx[i]! + dvx;
      st.vy[i] = st.vy[i]! + dvy;
      st.px[i] = clamp(st.px[i]! + st.vx[i]! * DT, -BOUND, PITCH_L + BOUND);
      st.py[i] = clamp(st.py[i]! + st.vy[i]! * DT, -BOUND, PITCH_W + BOUND);
      if (st.status[i] === 2 && hyp(st.px[i]! - this.tx[i]!, st.py[i]! - this.ty[i]!) < 1.2) {
        st.status[i] = 0;
      }
    }
    // Ballführender klebt am Ball, wenn er nah genug ist (Korrektur begrenzt → keine Sprünge)
    if (h >= 0 && st.status[h] === 1) {
      const d = hyp(st.px[h]! - c.ball.x, st.py[h]! - c.ball.y);
      if (d < 2.5) {
        const prevBall = this.ballAt(tau - DT);
        let bx = c.ball.x - prevBall.x;
        let by = c.ball.y - prevBall.y;
        let bl = hyp(bx, by);
        if (bl < 1e-4) {
          bx = this.agents[h]!.side === 'home' ? 1 : -1;
          by = 0;
          bl = 1;
        }
        const nx = clamp(c.ball.x - (bx / bl) * 0.65, -BOUND, PITCH_L + BOUND);
        const ny = clamp(c.ball.y - (by / bl) * 0.65, -BOUND, PITCH_W + BOUND);
        let fx = nx;
        let fy = ny;
        const mx = fx - hx0;
        const my = fy - hy0;
        const md = hyp(mx, my);
        const lim = this.agents[h]!.vmax * 1.3 * DT;
        if (md > lim) {
          fx = hx0 + (mx * lim) / md;
          fy = hy0 + (my * lim) / md;
        }
        st.vx[h] = (fx - hx0) / DT;
        st.vy[h] = (fy - hy0) / DT;
        st.px[h] = fx;
        st.py[h] = fy;
      }
    }
    st.k++;
  }

  // ───────────────────────────── Abfrage ─────────────────────────────

  /** Rechnet bis zu `maxSteps` Schritte im Voraus (für flüssiges Spulen). true = fertig. */
  precompute(maxSteps: number): boolean {
    const f = this.frontier;
    const last = this.snaps[this.snaps.length - 1]!;
    if (last.k > f.k) f.copyFrom(last);
    let done = 0;
    while (f.k < this.maxStep && done < maxSteps) {
      this.step(f);
      done++;
      if (f.k % SNAP_EVERY === 0 && this.snaps.length === f.k / SNAP_EVERY) this.snaps.push(f.clone());
    }
    return f.k >= this.maxStep;
  }

  /** Bringt `cur` auf Schritt k+1 und `prev` auf Schritt k. */
  private ensure(k: number): void {
    const cur = this.cur;
    if (cur.k === k + 1) return;
    if (!(cur.k <= k && k - cur.k < SNAP_EVERY * 2)) {
      const si = Math.floor(k / SNAP_EVERY);
      if (si >= this.snaps.length) {
        // Schnappschüsse bis dorthin anlegen
        while (this.snaps.length <= si && this.frontier.k < this.maxStep) this.precompute(SNAP_EVERY);
      }
      const snap = this.snaps[Math.min(si, this.snaps.length - 1)]!;
      cur.copyFrom(snap);
    }
    while (cur.k < k + 1) {
      this.prev.copyFrom(cur);
      this.step(cur);
      if (cur.k % SNAP_EVERY === 0 && this.snaps.length === cur.k / SNAP_EVERY) this.snaps.push(cur.clone());
    }
  }

  /** Vollständiges Bild zum Zeitpunkt τ (Anzeige-Koordinaten, Seitenwechsel berücksichtigt). */
  frameAt(tauIn: number): Frame {
    const tau = clamp(tauIn, 0, this.maxStep * DT - DT);
    const k = Math.floor(tau / DT + 1e-9);
    let f = tau / DT - k;
    this.ensure(k);
    // Über den Halbzeit-Schnitt hinweg nicht interpolieren
    const ht = this.timeline.halfTimeTau;
    if (this.timeline.hasSecondHalf && ht > k * DT && ht <= (k + 1) * DT) f = tau >= ht ? 1 : 0;
    const a = this.prev;
    const b = this.cur;
    const flipped = this.timeline.isFlipped(tau);
    const ballF = this.ballAt(tau);
    const ballD = toDisplay(ballF, flipped);
    const c = this.buildCtx(tau);
    const players: PlayerFrame[] = [];
    for (let i = 0; i < this.agents.length; i++) {
      const sa = a.status[i]!;
      const sb = b.status[i]!;
      if (sb === 0 && (sa === 0 || f > 0.5)) continue;
      if (sa === 0 && f < 0.5) continue;
      const ag = this.agents[i]!;
      let x: number;
      let y: number;
      if (sa === 0 || f >= 1) {
        x = b.px[i]!;
        y = b.py[i]!;
      } else if (sb === 0 || f <= 0) {
        x = a.px[i]!;
        y = a.py[i]!;
      } else {
        x = lerp(a.px[i]!, b.px[i]!, f);
        y = lerp(a.py[i]!, b.py[i]!, f);
      }
      const p = toDisplay({ x, y }, flipped);
      players.push({
        idx: i,
        id: ag.id,
        side: ag.side,
        number: ag.number,
        shortName: ag.shortName,
        x: p.x,
        y: p.y,
        isGK: (sb !== 0 ? b.gk[i] : a.gk[i]) === 1,
        leaving: (sb !== 0 ? sb : sa) === 2,
      });
    }
    return { tau, flipped, ball: { x: ballD.x, y: ballD.y, z: ballF.z }, players, holder: c.holder, possession: c.poss };
  }
}
