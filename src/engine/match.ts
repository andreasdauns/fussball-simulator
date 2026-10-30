/**
 * Hybride Ereignis-Engine: Ballbesitzketten über Zonen, jede Aktion wird aus
 * Spielerwerten, Taktik und Gegnerdruck entschieden. Erzeugt einen lückenlosen,
 * animierbaren Ereignisstrom (nächstes `from` = vorheriges `to`, außer bei Standards).
 */

import type {
  EventType,
  LineupSlot,
  MatchEvent,
  MatchResult,
  Player,
  PlayerMatchStats,
  Position,
  Role,
  Tactic,
  TeamMatchStats,
  TeamSheet,
  TeamSide,
  Vec2,
} from './types';
import { createRng, type Rng } from './rng';
import {
  attackAnchor,
  aerialScore,
  computeStrength,
  defendAnchor,
  eff,
  fatigueRate,
  positionFit,
  positionLine,
  roleLine,
  type AttrKey,
  type Line,
  type TeamStrength,
} from './strength';
import { clamp, dist, distToGoal, goalAngle, inBox, logistic, logit, r2, PITCH_LENGTH, PITCH_WIDTH } from './math';
import { foulFactor, redPerFoul, yellowPerFoul } from './rules';
import { ENGINE_VERSION } from './version';
import { computeMomentum, computeRatings } from './postmatch';

export interface SimulateOptions {
  halfLengthMinutes?: number;
}

/** Kalibrierparameter (zentral, damit Feinabstimmung an einer Stelle passiert) */
export const P = {
  homeAdv: 0.05,
  passBase: 3.3,
  passSkillDiv: 18,
  passPress: 1.25,
  passDist: 24,
  passZone: 1.1,
  longBase: 0.9,
  crossBase: -0.75,
  carryFail: 0.07,
  foulPerStep: 0.0105,
  foulOnFailedDribble: 0.32,
  shotWeight: 0.55,
  xgBase: -1.1,
  xgDist: 0.11,
  xgAngle: 1.5,
  holdMin: 3.0,
  holdMax: 6.4,
  offsideBase: 0.02,
  counterBase: 0.3,
  boxDensity: 0.38,
  throughBase: -1.8,
  recover: 0.4,
  finalThirdPass: 0.85,
};

const OTHER: Record<TeamSide, TeamSide> = { home: 'away', away: 'home' };
const RESTART_TYPES = new Set<EventType>(['kickoff', 'throw-in', 'goal-kick', 'corner', 'free-kick', 'penalty']);
export function isRestartType(t: EventType): boolean {
  return RESTART_TYPES.has(t);
}

const DEFAULT_ROLE: Record<Position, Role> = {
  GK: 'goalkeeper',
  SW: 'sweeper',
  CB: 'centre-back',
  RB: 'full-back',
  LB: 'full-back',
  RWB: 'wing-back',
  LWB: 'wing-back',
  DM: 'holding-mid',
  CM: 'box-to-box',
  AM: 'advanced-playmaker',
  RM: 'wide-mid',
  LM: 'wide-mid',
  RW: 'winger',
  LW: 'winger',
  CF: 'complete-forward',
  ST: 'poacher',
};
const LINE_IDX: Record<Line, number> = { gk: 0, def: 1, mid: 2, att: 3 };

/** Umrechnung absolute ↔ Team-Koordinaten (Gast: um 180° gedreht). Selbstinvers. */
function tc(side: TeamSide, v: Vec2): Vec2 {
  return side === 'home' ? { x: v.x, y: v.y } : { x: PITCH_LENGTH - v.x, y: PITCH_WIDTH - v.y };
}
function rv(v: Vec2): Vec2 {
  return { x: r2(clamp(v.x, 0, PITCH_LENGTH)), y: r2(clamp(v.y, 0, PITCH_WIDTH)) };
}
function inside(v: Vec2, m = 0.5): Vec2 {
  return { x: clamp(v.x, m, PITCH_LENGTH - m), y: clamp(v.y, m, PITCH_WIDTH - m) };
}

interface PS {
  side: TeamSide;
  player: Player;
  slot: LineupSlot;
  line: Line;
  fatigue: number;
  fRate: number;
  aAnchor: Vec2;
  dAnchor: Vec2;
  stats: PlayerMatchStats;
  saves: number;
  keyActions: number;
  duelsWon: number;
  duelsLost: number;
  onT: number;
  offT: number | null;
}

interface TS {
  side: TeamSide;
  sheet: TeamSheet;
  base: Tactic;
  tac: Tactic;
  mood: number;
  on: PS[];
  all: PS[];
  bench: Player[];
  subsUsed: number;
  str: TeamStrength;
  s: TeamMatchStats & { highTurnovers: number; possTime: number; goals: number };
}

type RestartKind = 'kickoff' | 'throw-in' | 'goal-kick' | 'corner' | 'free-kick' | 'penalty';
interface Restart {
  kind: RestartKind;
  side: TeamSide;
  spot: Vec2; // absolut
  dead: number; // Totzeit in s
}

interface Flags {
  counter: number; // verbleibende Konter-Schritte
  through: boolean;
  cutback: boolean;
  steps: number; // Schritte in diesem Ballbesitz
}

interface ShotCtx {
  header?: boolean;
  through?: boolean;
  counter?: boolean;
  cross?: boolean;
  setPiece?: boolean;
  penalty?: boolean;
  freeKick?: boolean;
  rebound?: boolean;
  assister?: PS | null;
  pressure?: number;
}

class MatchSim {
  readonly L: number;
  readonly rng: Rng;
  readonly rTime: Rng;
  readonly rCoach: Rng;
  readonly rRef: Rng;
  readonly teams: Record<TeamSide, TS>;
  readonly events: MatchEvent[] = [];
  t = 0;
  half: 1 | 2 = 1;
  halfStartT = 0;
  halfRegEnd = 0;
  stoppage = -1;
  score = { home: 0, away: 0 };
  ball: Vec2 = { x: 52.5, y: 34 };
  poss: TeamSide = 'home';
  carrier: PS | null = null;
  restart: Restart | null = null;
  flags: Flags = { counter: 0, through: false, cutback: false, steps: 0 };
  lastPasser: PS | null = null;
  lastStrengthMinute = -1;
  lastFatigueT = 0;
  halfCounts = { goals: 0, subs: 0, cards: 0, fouls: 0, pens: 0 };

  constructor(
    readonly home: TeamSheet,
    readonly away: TeamSheet,
    readonly seed: number,
    opts: SimulateOptions,
  ) {
    this.L = opts.halfLengthMinutes ?? 45;
    const root = createRng(seed);
    this.rng = root.fork('play');
    this.rTime = root.fork('time');
    this.rCoach = root.fork('coach');
    this.rRef = root.fork('referee');
    this.teams = { home: this.initTeam('home', home), away: this.initTeam('away', away) };
  }

  // ───────────────────────────── Aufbau ─────────────────────────────

  private findPlayer(sheet: TeamSheet, id: string): Player {
    const p = sheet.players.find((q) => q.id === id) ?? sheet.bench.find((q) => q.id === id);
    if (!p) throw new Error(`Spieler ${id} nicht in ${sheet.id} gefunden`);
    return p;
  }

  private newPS(side: TeamSide, player: Player, slot: LineupSlot, tac: Tactic, onT: number): PS {
    return {
      side,
      player,
      slot,
      line: roleLine(slot.role),
      fatigue: 0,
      fRate: fatigueRate(player, slot, tac),
      aAnchor: attackAnchor(slot, tac),
      dAnchor: defendAnchor(slot, tac),
      stats: {
        playerId: player.id,
        team: side,
        minutes: 0,
        passes: 0,
        passesCompleted: 0,
        shots: 0,
        shotsOnTarget: 0,
        goals: 0,
        assists: 0,
        tackles: 0,
        interceptions: 0,
        fouls: 0,
        yellow: 0,
        red: 0,
        rating: 3.5,
      },
      saves: 0,
      keyActions: 0,
      duelsWon: 0,
      duelsLost: 0,
      onT,
      offT: null,
    };
  }

  private initTeam(side: TeamSide, sheet: TeamSheet): TS {
    if (sheet.lineup.length !== 11) throw new Error(`${sheet.id}: Aufstellung braucht genau 11 Spieler`);
    const tac: Tactic = { ...sheet.tactic };
    const on = sheet.lineup.map((slot) => this.newPS(side, this.findPlayer(sheet, slot.playerId), { ...slot }, tac, 0));
    const startIds = new Set(sheet.lineup.map((s) => s.playerId));
    const bench = sheet.bench.filter((p) => !startIds.has(p.id));
    const ts: TS = {
      side,
      sheet,
      base: { ...sheet.tactic },
      tac,
      mood: 0,
      on,
      all: [...on],
      bench,
      subsUsed: 0,
      str: computeStrength([], tac),
      s: {
        possession: 0,
        shots: 0,
        shotsOnTarget: 0,
        xg: 0,
        passes: 0,
        passAccuracy: 0,
        corners: 0,
        fouls: 0,
        yellow: 0,
        red: 0,
        offsides: 0,
        highTurnovers: 0,
        possTime: 0,
        goals: 0,
      },
    };
    ts.str = computeStrength(on, tac);
    return ts;
  }

  // ───────────────────────────── Hilfen ─────────────────────────────

  private a(ps: PS, k: AttrKey): number {
    return eff(ps.player, k, ps.fatigue);
  }

  private ha(side: TeamSide): number {
    return side === 'home' ? P.homeAdv : -P.homeAdv;
  }

  private gk(ts: TS): PS {
    return ts.on.find((p) => p.slot.role === 'goalkeeper') ?? ts.on[0]!;
  }

  /** Ungefähre Spielerposition in Team-Koordinaten des eigenen Teams */
  private pos(ps: PS, inPoss: boolean, ballT: Vec2): Vec2 {
    if (ps.slot.role === 'goalkeeper') {
      const x = inPoss ? clamp(4 + (ballT.x - 30) * 0.12, 3, 16) : clamp(2.5 + (ballT.x - 50) * 0.08, 1.5, 12);
      return { x, y: 34 + (ballT.y - 34) * 0.15 };
    }
    if (inPoss) {
      const k = ps.line === 'def' ? 0.42 : ps.line === 'mid' ? 0.45 : 0.35;
      return {
        x: clamp(ps.aAnchor.x + (ballT.x - 52.5) * k, 6, ps.line === 'att' ? 94 : 88),
        y: clamp(ps.aAnchor.y + (ballT.y - 34) * 0.22, 1.5, 66.5),
      };
    }
    const k = ps.line === 'def' ? 0.32 : ps.line === 'mid' ? 0.42 : 0.4;
    return {
      x: clamp(ps.dAnchor.x + (ballT.x - 45) * k, 4, 96),
      y: clamp(ps.dAnchor.y + (ballT.y - 34) * 0.4, 2, 66),
    };
  }

  private nearest(team: TS, pointT: Vec2, ballT: Vec2, inPoss: boolean, exclude?: PS | null, noGk = true): PS {
    let best: PS | null = null;
    let bd = Infinity;
    for (const ps of team.on) {
      if (ps === exclude) continue;
      if (noGk && ps.slot.role === 'goalkeeper' && team.on.length > 1) continue;
      const d = dist(this.pos(ps, inPoss, ballT), pointT);
      if (d < bd) {
        bd = d;
        best = ps;
      }
    }
    return best ?? team.on[0]!;
  }

  private clock(endOfHalf = false): string {
    const s = Math.max(0, this.t - this.halfStartT - (endOfHalf ? 1 : 0));
    const offset = this.half === 1 ? 0 : this.L;
    const m = Math.floor(s / 60) + 1;
    if (m > this.L) return `${offset + this.L}+${m - this.L}`;
    return `${offset + m}`;
  }

  /** Regulär gezählte Spielminute (0..2L) */
  private gameMinute(): number {
    const s = (this.t - this.halfStartT) / 60;
    return (this.half === 1 ? 0 : this.L) + Math.min(this.L, s);
  }

  private emit(
    type: EventType,
    side: TeamSide,
    o: {
      player?: PS | null;
      other?: PS | null;
      otherId?: string;
      from: Vec2;
      to: Vec2;
      duration: number;
      success: boolean;
      xg?: number;
      height?: 'ground' | 'mid' | 'high';
      text?: string;
    },
  ): MatchEvent {
    const ev: MatchEvent = {
      id: this.events.length,
      t: r2(this.t),
      duration: r2(o.duration),
      half: this.half,
      clock: this.clock(type === 'half-time' || type === 'full-time'),
      type,
      team: side,
      from: rv(o.from),
      to: rv(o.to),
      success: o.success,
      score: { home: this.score.home, away: this.score.away },
    };
    if (o.player) ev.playerId = o.player.player.id;
    if (o.other) ev.otherPlayerId = o.other.player.id;
    else if (o.otherId) ev.otherPlayerId = o.otherId;
    if (o.xg !== undefined) ev.xg = Math.round(o.xg * 1000) / 1000;
    if (o.height) ev.height = o.height;
    if (o.text) ev.text = o.text;
    this.events.push(ev);
    this.ball = ev.to;
    this.t += o.duration;
    return ev;
  }

  private hold(side: TeamSide, base?: number): void {
    const ts = this.teams[side];
    const tempoF = 1.3 - 0.6 * ts.tac.tempo;
    let h = base ?? this.rTime.range(P.holdMin, P.holdMax) * tempoF;
    if (this.flags.counter > 0) h *= 0.55;
    this.t += h;
    ts.s.possTime += h;
  }

  private onBall(side: TeamSide, dur: number): void {
    this.teams[side].s.possTime += dur;
  }

  private scoreStr(): string {
    return `${this.score.home}:${this.score.away}`;
  }

  // ───────────────────────────── Ablauf ─────────────────────────────

  run(): MatchResult {
    for (const half of [1, 2] as const) {
      this.half = half;
      this.halfStartT = this.t;
      this.halfRegEnd = this.t + this.L * 60;
      this.stoppage = -1;
      this.halfCounts = { goals: 0, subs: 0, cards: 0, fouls: 0, pens: 0 };
      this.lastFatigueT = this.t;
      const kickSide: TeamSide = half === 1 ? 'home' : 'away';
      this.restart = { kind: 'kickoff', side: kickSide, spot: { x: 52.5, y: 34 }, dead: 0 };
      let guard = 0;
      for (;;) {
        if (++guard > 20000) throw new Error('Endlosschleife in der Simulation');
        if (this.t >= this.halfRegEnd && this.stoppage < 0) this.decideStoppage();
        if (this.stoppage >= 0) {
          const end = this.halfRegEnd + this.stoppage;
          if (this.t >= end && (this.restart || this.t >= end + 25 || this.ballSafe())) break;
        }
        this.tick();
      }
      if (half === 1) {
        this.emit('half-time', this.poss, {
          from: this.ball,
          to: this.ball,
          duration: 0,
          success: true,
          text: `Halbzeit – ${this.teams.home.sheet.shortName} ${this.scoreStr()} ${this.teams.away.sheet.shortName}`,
        });
        for (const side of ['home', 'away'] as const) {
          for (const ps of this.teams[side].on) ps.fatigue *= 0.82;
          this.halfTimeCoach(side);
        }
      } else {
        this.emit('full-time', this.poss, {
          from: this.ball,
          to: this.ball,
          duration: 0,
          success: true,
          text: `Abpfiff – Endstand ${this.teams.home.sheet.shortName} ${this.scoreStr()} ${this.teams.away.sheet.shortName}`,
        });
      }
    }
    return this.result();
  }

  private ballSafe(): boolean {
    const bT = tc(this.poss, this.ball);
    return bT.x > 25 && bT.x < 70;
  }

  private decideStoppage(): void {
    const c = this.halfCounts;
    let m = (this.half === 1 ? 0.6 : 1.6) + 0.45 * c.goals + 0.35 * c.subs + 0.25 * c.cards + 0.03 * c.fouls + 0.8 * c.pens;
    m += this.rTime.range(-0.5, 0.9);
    const mins = clamp(Math.round(m), 1, this.half === 1 ? 4 : 5);
    this.stoppage = mins * 60;
  }

  private tick(): void {
    this.updateFatigue();
    if (this.restart) {
      const r = this.restart;
      this.restart = null;
      const late = this.gameMinute() > this.L * 1.5;
      for (const side of ['home', 'away'] as const) {
        const ts = this.teams[side];
        const lead = this.score[side] - this.score[OTHER[side]];
        // Zeitspiel: führendes Team lässt sich bei eigenen Standards mehr Zeit
        if (late && lead > 0 && r.side === side) r.dead *= 1 + 0.5 * ts.tac.gameManagement;
      }
      this.t += r.dead;
      this.coachTick(r);
      this.ball = rv(r.spot);
      this.doRestart(r);
      return;
    }
    this.openPlay();
  }

  private updateFatigue(): void {
    const dt = (this.t - this.lastFatigueT) / 60;
    if (dt <= 0) return;
    this.lastFatigueT = this.t;
    for (const side of ['home', 'away'] as const) {
      for (const ps of this.teams[side].on) ps.fatigue = Math.min(1, ps.fatigue + ps.fRate * dt);
    }
    const minute = Math.floor(this.t / 60);
    if (minute !== this.lastStrengthMinute) {
      this.lastStrengthMinute = minute;
      this.refreshStrength('home');
      this.refreshStrength('away');
    }
  }

  private refreshStrength(side: TeamSide): void {
    const ts = this.teams[side];
    ts.str = computeStrength(ts.on, ts.tac);
  }

  private refreshTactic(side: TeamSide): void {
    const ts = this.teams[side];
    for (const ps of ts.on) {
      ps.aAnchor = attackAnchor(ps.slot, ts.tac);
      ps.dAnchor = defendAnchor(ps.slot, ts.tac);
      ps.fRate = fatigueRate(ps.player, ps.slot, ts.tac);
    }
    this.refreshStrength(side);
  }

  // ───────────────────────── Ballbesitz / Wechsel ─────────────────────────

  private setPossession(side: TeamSide, carrier: PS, at: Vec2, turnover: boolean): void {
    const prev = this.poss;
    this.poss = side;
    this.carrier = carrier;
    this.ball = rv(at);
    this.lastPasser = null;
    if (turnover || prev !== side) {
      this.flags = { counter: 0, through: false, cutback: false, steps: 0 };
    }
  }

  /** Ballgewinn im Spiel (Tackling/Abfangen) – ggf. Konter */
  private winBall(side: TeamSide, winner: PS, at: Vec2): void {
    this.setPossession(side, winner, at, true);
    const ts = this.teams[side];
    const opp = this.teams[OTHER[side]];
    const p = tc(side, at);
    if (p.x >= 70) {
      ts.s.highTurnovers++;
      // hoher Ballgewinn: sofortiges Umschalten
      if (this.rng.chance(0.6)) this.flags.counter = 2;
    } else if (p.x < 65) {
      const exposure = 0.3 + 0.7 * opp.tac.defensiveLine;
      const pc = P.counterBase * ts.tac.counterAttack * exposure * 2;
      if (this.rng.chance(pc)) this.flags.counter = 4;
    }
  }

  private loose(atAbs: Vec2, attSide: TeamSide, pAtt: number): void {
    const winSide = this.rng.chance(pAtt) ? attSide : OTHER[attSide];
    const ts = this.teams[winSide];
    const pT = tc(winSide, atAbs);
    const w = this.nearest(ts, pT, pT, winSide === this.poss);
    if (winSide !== attSide) this.winBall(winSide, w, atAbs);
    else this.setPossession(winSide, w, atAbs, false);
  }

  // ───────────────────────────── Spiel im Fluss ─────────────────────────────

  private openPlay(): void {
    const A = this.teams[this.poss];
    const B = this.teams[OTHER[this.poss]];
    let c = this.carrier;
    if (!c || !A.on.includes(c)) {
      c = this.nearest(A, tc(A.side, this.ball), tc(A.side, this.ball), true, null, false);
      this.carrier = c;
    }
    const bT = tc(A.side, this.ball);
    const bB = tc(B.side, this.ball);
    this.flags.steps++;

    // Gegner-Positionen in A-Koordinaten
    let dmin = 99;
    let nearestDef: PS = B.on[0]!;
    let lastLine = 0;
    for (const ps of B.on) {
      const q = tc(B.side, this.pos(ps, false, bB)); // absolut
      const qa = tc(A.side, q);
      if (ps.slot.role !== 'goalkeeper' && qa.x > lastLine) lastLine = qa.x;
      const d = dist(qa, bT);
      if (d < dmin && ps.slot.role !== 'goalkeeper') {
        dmin = d;
        nearestDef = ps;
      }
    }
    lastLine = Math.max(lastLine, 60);

    const pressZone = bT.x < 35 ? 0.15 + 0.85 * B.tac.pressingHeight : bT.x < 70 ? 0.45 + 0.35 * B.tac.pressingHeight : 0.6;
    const prox = 1 / (1 + (dmin / 6) * (dmin / 6));
    const counterRelief = this.flags.counter > 0 ? 0.6 : 1;
    const press = clamp(B.str.pressPower * (0.35 + 0.65 * B.tac.pressingIntensity) * (0.35 + 0.9 * pressZone) * (0.7 + 0.6 * prox) * counterRelief, 0, 1.3);

    // Foul im Zweikampf (vor der Aktion)
    const ff = foulFactor(B.sheet.era) * (0.55 + 0.7 * press) * (1 + 0.7 * B.tac.manMarking) * (bT.x > 70 ? 1.15 : 1) * (this.flags.counter > 0 ? 1.8 : 1);
    const boxF = inBox(bT) ? 0.025 : 1; // im Strafraum wird vorsichtiger verteidigt
    if (c.slot.role !== 'goalkeeper' && this.rRef.chance(P.foulPerStep * ff * boxF)) {
      this.foul(B, nearestDef, A, c, this.ball, this.flags.counter > 0);
      return;
    }

    // Durchbruch: freie Bahn zum Tor
    if (this.flags.through && bT.x > 80) {
      this.flags.through = false;
      // Verteidiger holt den Läufer noch ein?
      if (this.rng.chance(P.recover)) {
        this.carry(A, B, c, bT, 1.6, nearestDef, false);
        return;
      }
      if (distToGoal(bT) < 22) {
        this.shoot(A, B, c, bT, { through: true, counter: this.flags.counter > 0, assister: this.lastPasser, pressure: 0.15 });
        return;
      }
      this.carry(A, B, c, bT, 0.1, nearestDef, true);
      return;
    }

    const isGk = c.slot.role === 'goalkeeper';
    const tac = A.tac;
    const counter = this.flags.counter > 0;
    const directness = clamp(tac.directness + (counter ? 0.35 : 0), 0, 1);
    const d = distToGoal(bT);
    const wide = Math.abs(bT.y - 34) > 15;

    // Aktionsgewichte
    let wShot = 0;
    if (!isGk && d < 32) {
      const xgEst = this.xgModel(bT, {});
      const ls = (this.a(c, 'longShots') - 55) / 60;
      wShot = P.shotWeight * (d > 20 ? 0.12 + ls * 0.3 : 0.2 + 5 * xgEst) * (1 - press * 0.3);
      if (inBox(bT)) wShot += 0.25 * P.shotWeight;
      if (this.flags.steps <= 1 && d > 18) wShot *= 0.5;
    }
    let wPass = isGk ? 2.5 : 6.2 - 1.6 * directness;
    let wLong = (bT.x < 65 ? 0.3 + 1.0 * directness : 0.1) + (bT.x > 25 && bT.x < 70 ? 0.9 * B.tac.defensiveLine * (0.4 + directness) : 0);
    if (isGk) wLong = 1 + 3 * directness + 2 * B.tac.pressingHeight * B.tac.pressingIntensity;
    if (bT.x < 20 && press > 0.75) wLong += 1.2 * (1 - A.str.buildUp / 100);
    let wCross = 0;
    const wideRole = c.slot.role === 'wing-back' || c.slot.role === 'wide-mid' || c.slot.role === 'full-back';
    const crossFrom = wideRole ? 60 : 66;
    if (!isGk && bT.x > crossFrom && wide) wCross = 1.3 * clamp(4 * tac.crossingFocus - 1.2, 0.15, 2) * (0.5 + this.a(c, 'crossing') / 140) * (wideRole ? 1.15 : c.slot.role === 'inside-forward' ? 0.5 : 1);
    else if (!isGk && bT.x > 78 && Math.abs(bT.y - 34) > 9) wCross = 0.35 * clamp(4 * tac.crossingFocus - 1.2, 0.15, 2);
    let wCarry = isGk ? 0 : 0.45 + 0.6 * (1 - Math.min(1, press)) + (counter ? 1.5 : 0);
    let wDrib = 0;
    if (!isGk) {
      const dr = this.a(c, 'dribbling') / 100;
      wDrib = (bT.x > 50 ? 0.45 + 1.4 * dr * dr : 0.12) * (1 + 1.4 * B.tac.manMarking) * (c.line === 'att' || c.slot.role === 'winger' ? 1.4 : 0.8);
    }
    if (bT.x > 85) {
      wPass *= 0.75;
      wCarry *= 0.6;
    }
    const k = this.rng.weightedIndex([wShot, wPass, wLong, wCross, wCarry, wDrib]);
    switch (k) {
      case 0:
        this.shoot(A, B, c, bT, { counter, assister: this.lastPasser, pressure: press, cross: this.flags.cutback });
        return;
      case 1:
        this.pass(A, B, c, bT, press, directness, false, lastLine);
        return;
      case 2:
        this.pass(A, B, c, bT, press, directness, true, lastLine);
        return;
      case 3:
        this.cross(A, B, c, bT, 'cross');
        return;
      case 4:
        this.carry(A, B, c, bT, press, nearestDef, false);
        return;
      default:
        this.dribble(A, B, c, bT, nearestDef);
    }
  }

  private zoneAdv(A: TS, B: TS, pT: Vec2): number {
    const ti = pT.x < 35 ? 0 : pT.x < 70 ? 1 : 2;
    const ci = pT.y < 22.7 ? 0 : pT.y < 45.3 ? 1 : 2;
    const at = A.str.att[ti]![ci]!;
    const df = B.str.def[2 - ti]![2 - ci]! * (this.flags.counter > 0 ? 0.7 : 1);
    return (at - df) / (at + df + 0.01);
  }

  private pickReceiver(A: TS, B: TS, c: PS, bT: Vec2, directness: number, long: boolean): { r: PS; at: Vec2; open: number } | null {
    const items: PS[] = [];
    const ws: number[] = [];
    const pts: Vec2[] = [];
    const opens: number[] = [];
    const bB = tc(B.side, this.ball);
    const oppPos = B.on.map((ps) => tc(A.side, tc(B.side, this.pos(ps, false, bB))));
    const fwdBias = 0.15 + 0.9 * directness;
    for (const ps of A.on) {
      if (ps === c) continue;
      const isGk = ps.slot.role === 'goalkeeper';
      if (isGk && (bT.x > 40 || long)) continue;
      const p = this.pos(ps, true, bT);
      const d = dist(p, bT);
      const fwd = p.x - bT.x;
      let w: number;
      if (long) {
        if (d < 22 || fwd < 10) continue;
        w = 1 + fwd / 20 + (ps.line === 'att' ? 1 : 0);
      } else {
        if (d < 4 || d > 40) continue;
        const z = (d - 13) / 9;
        w = (1 / (1 + z * z)) * clamp(1 + (fwdBias * fwd) / 18, 0.25, 2.6);
        if (isGk) w *= 0.25;
      }
      // Flügelspiel: breite Spieler werden bei Flankenfokus bevorzugt angespielt
      if (!long && bT.x > 35 && Math.abs(p.y - 34) > 18) w *= 0.8 + 0.5 * A.tac.crossingFocus * (0.4 + A.tac.width);
      let open = 99;
      for (const q of oppPos) open = Math.min(open, dist(q, p));
      w *= 0.35 + clamp(open / 7, 0, 1.2);
      items.push(ps);
      ws.push(w);
      pts.push(p);
      opens.push(open);
    }
    if (!items.length) return null;
    const i = this.rng.weightedIndex(ws);
    return { r: items[i]!, at: pts[i]!, open: opens[i]! };
  }

  private pass(A: TS, B: TS, c: PS, bT: Vec2, press: number, directness: number, long: boolean, lastLine: number): void {
    const pick = this.pickReceiver(A, B, c, bT, directness, long);
    if (!pick) {
      this.carry(A, B, c, bT, press, this.nearest(B, tc(B.side, this.ball), tc(B.side, this.ball), false), false);
      return;
    }
    const { r, open } = pick;
    let target: Vec2 = { x: pick.at.x + this.rng.range(-2, 2), y: pick.at.y + this.rng.range(-2, 2) };
    let inBehind = false;
    if (long && pick.at.x > lastLine - 8) {
      // Ball in den Rücken der Abwehr
      const lead = 4 + 14 * B.tac.defensiveLine;
      target = { x: Math.min(lastLine + lead * this.rng.range(0.4, 1), 100), y: target.y + (34 - target.y) * 0.2 };
      inBehind = target.x > lastLine;
    }
    target = inside(target, 1);
    const d = dist(bT, target);
    const isGk = c.slot.role === 'goalkeeper';
    const zone = this.zoneAdv(A, B, target);
    let lg: number;
    let type: EventType;
    let height: 'ground' | 'mid' | 'high';
    let speed: number;
    if (long) {
      type = 'long-ball';
      height = 'high';
      speed = this.rTime.range(17, 24);
      const skill = isGk ? 0.6 * this.a(c, 'gkDistribution') + 0.4 * this.a(c, 'longPassing') : 0.6 * this.a(c, 'longPassing') + 0.4 * this.a(c, 'vision');
      lg = P.longBase + (skill - 70) / 14 - press * 0.5 - (d - 30) / 40 + zone * 0.9;
      if (inBehind) {
        const def = this.nearest(B, tc(B.side, tc(A.side, target)), tc(B.side, this.ball), false);
        // Raum hinter der Abwehr: tiefe Linie lässt kaum Platz (Torwart läuft heraus)
        const space = 100 - lastLine;
        lg += ((this.a(r, 'pace') + this.a(r, 'acceleration')) / 2 - this.a(def, 'pace')) / 18 + 0.6 * B.tac.defensiveLine + P.throughBase;
        lg -= clamp((22 - space) / 8, 0, 2.2);
      } else {
        lg += (aerialScore(r.player, r.fatigue) - B.str.aerialDef) / 18;
      }
    } else {
      type = 'pass';
      height = d > 28 ? 'mid' : 'ground';
      speed = this.rTime.range(10.5, 16) + d * 0.1;
      const skill = 0.6 * this.a(c, 'shortPassing') + 0.2 * this.a(c, 'vision') + 0.2 * this.a(r, 'firstTouch');
      lg = P.passBase + (skill - 70) / P.passSkillDiv - press * P.passPress - (d - 12) / P.passDist + zone * P.passZone + (open - 5) / 12;
      if (target.x > 80) lg -= P.finalThirdPass * (target.x > 88 ? 1.6 : 1); // enger Raum vor dem Tor
    }
    lg += this.ha(A.side);
    const p = logistic(lg);
    const fromAbs = this.ball;
    const toAbs = tc(A.side, target);
    A.s.passes++;
    c.stats.passes++;

    // Abseits bei Steilpässen in den Rücken
    if (inBehind) {
      const pOff = clamp(P.offsideBase + 0.09 * B.tac.offsideTrap * (0.4 + B.tac.defensiveLine) - (this.a(r, 'positioning') - 70) / 250 - (this.flags.counter > 0 ? 0.05 : 0), 0.03, 0.5);
      if (this.rRef.chance(pOff)) {
        const dur = d / speed;
        this.emit(type, A.side, { player: c, other: r, from: fromAbs, to: toAbs, duration: dur, success: false, height });
        this.onBall(A.side, dur);
        A.s.offsides++;
        this.emit('offside', A.side, { player: r, from: toAbs, to: toAbs, duration: 0.5, success: false });
        const gk = this.gk(B);
        this.restart = { kind: 'free-kick', side: B.side, spot: toAbs, dead: this.rTime.range(12, 22) };
        this.carrier = gk;
        return;
      }
    }

    if (this.rng.chance(p)) {
      const dur = d / speed;
      this.emit(type, A.side, { player: c, other: r, from: fromAbs, to: toAbs, duration: dur, success: true, height });
      this.onBall(A.side, dur);
      c.stats.passesCompleted++;
      this.lastPasser = c;
      this.carrier = r;
      if (this.flags.counter > 0) this.flags.counter--;
      this.flags.through = inBehind;
      this.flags.cutback = false;
      if (target.x > 70) c.keyActions += 0.15;
      this.hold(A.side);
      return;
    }
    // Fehlpass
    const nearTouch = target.y < 5 || target.y > 63;
    const nearByline = target.x > 101;
    if ((nearTouch && this.rng.chance(0.55)) || (nearByline && this.rng.chance(0.7))) {
      const outT: Vec2 = nearByline && !nearTouch ? { x: 105, y: target.y } : { x: target.x, y: target.y < 34 ? 0 : 68 };
      const outAbs = tc(A.side, outT);
      const dur = dist(bT, outT) / speed;
      this.emit(type, A.side, { player: c, other: r, from: fromAbs, to: outAbs, duration: dur, success: false, height });
      this.onBall(A.side, dur);
      if (nearByline && !nearTouch) {
        this.restart = this.goalKick(B.side);
      } else {
        this.restart = { kind: 'throw-in', side: B.side, spot: outAbs, dead: this.rTime.range(8, 16) };
      }
      return;
    }
    const frac = this.rng.range(0.45, 0.95);
    const qT: Vec2 = { x: bT.x + (target.x - bT.x) * frac, y: bT.y + (target.y - bT.y) * frac };
    const qAbs = tc(A.side, qT);
    const dur = (d * frac) / speed;
    this.emit(type, A.side, { player: c, other: r, from: fromAbs, to: qAbs, duration: dur, success: false, height });
    this.onBall(A.side, dur);
    const qB = tc(B.side, qAbs);
    const interceptor = this.nearest(B, qB, tc(B.side, this.ball), false);
    interceptor.stats.interceptions++;
    this.emit('interception', B.side, { player: interceptor, other: r, from: qAbs, to: qAbs, duration: 0.4, success: true });
    this.winBall(B.side, interceptor, qAbs);
    this.hold(B.side, this.rTime.range(0.4, 1.2));
  }

  private carry(A: TS, B: TS, c: PS, bT: Vec2, press: number, def: PS, breakaway: boolean): void {
    const len = breakaway ? this.rng.range(8, 16) : this.rng.range(4, 13);
    const toward = bT.x > 75 ? (34 - bT.y) * 0.25 : (34 - bT.y) * 0.08;
    const toT = inside({ x: Math.min(bT.x + len * this.rng.range(0.55, 1), breakaway ? 99 : 96), y: bT.y + toward + this.rng.range(-4, 4) }, 1);
    const speed = this.rTime.range(5, 8) * (0.85 + 0.25 * (this.a(c, 'pace') / 100));
    let pFail = breakaway ? 0.08 : P.carryFail + press * 0.12 - (this.a(c, 'firstTouch') - 70) / 600;
    if (!breakaway && toT.x > 82) pFail += P.boxDensity * (1 - 0.4 * (this.zoneAdv(A, B, toT) + 0.5));
    if (this.rng.chance(pFail)) {
      const midT: Vec2 = { x: bT.x + (toT.x - bT.x) * 0.3, y: bT.y + (toT.y - bT.y) * 0.3 };
      const midAbs = tc(A.side, midT);
      const dur = dist(bT, midT) / speed + 0.3;
      this.emit('carry', A.side, { player: c, from: this.ball, to: midAbs, duration: dur, success: false, height: 'ground' });
      this.onBall(A.side, dur);
      this.tackle(B, def, c, midAbs);
      return;
    }
    const toAbs = tc(A.side, toT);
    const dur = dist(bT, toT) / speed;
    this.emit('carry', A.side, { player: c, from: this.ball, to: toAbs, duration: dur, success: true, height: 'ground' });
    this.onBall(A.side, dur);
    if (toT.x > 75 && Math.abs(toT.y - 34) > 14 && this.rng.chance(0.3)) this.flags.cutback = true;
    this.hold(A.side, this.rTime.range(0.3, 1.0));
  }

  private dribble(A: TS, B: TS, c: PS, bT: Vec2, def: PS): void {
    const att = 0.55 * this.a(c, 'dribbling') + 0.25 * this.a(c, 'acceleration') + 0.2 * this.a(c, 'pace');
    const dfn = 0.5 * this.a(def, 'tackling') + 0.3 * this.a(def, 'marking') + 0.2 * this.a(def, 'pace');
    const zone = this.zoneAdv(A, B, bT);
    const p = logistic(0.1 + (att - dfn) / 12 + zone * 0.6 + this.ha(A.side) - 0.25 * B.tac.manMarking);
    const len = this.rng.range(4, 9);
    const toT = inside({ x: Math.min(bT.x + len, 97), y: bT.y + this.rng.range(-5, 5) + (bT.x > 80 ? (34 - bT.y) * 0.2 : 0) }, 1);
    const speed = this.rTime.range(4.5, 7);
    if (this.rng.chance(p)) {
      const toAbs = tc(A.side, toT);
      const dur = dist(bT, toT) / speed + 0.3;
      this.emit('dribble', A.side, { player: c, other: def, from: this.ball, to: toAbs, duration: dur, success: true, height: 'ground' });
      this.onBall(A.side, dur);
      c.duelsWon++;
      def.duelsLost++;
      c.keyActions += toT.x > 70 ? 0.25 : 0.1;
      if (toT.x > 75 && Math.abs(toT.y - 34) > 12 && this.rng.chance(0.35)) this.flags.cutback = true;
      this.hold(A.side, this.rTime.range(0.3, 0.9));
      return;
    }
    const midT: Vec2 = { x: bT.x + (toT.x - bT.x) * 0.25, y: bT.y + (toT.y - bT.y) * 0.25 };
    const midAbs = tc(A.side, midT);
    const dur = dist(bT, midT) / speed + 0.4;
    this.emit('dribble', A.side, { player: c, other: def, from: this.ball, to: midAbs, duration: dur, success: false, height: 'ground' });
    this.onBall(A.side, dur);
    c.duelsLost++;
    const pf = (inBox(midT) ? 0.055 : 1) * P.foulOnFailedDribble * foulFactor(B.sheet.era) * (1 + 0.8 * B.tac.manMarking) * (1.2 - this.a(def, 'tackling') / 200);
    if (this.rRef.chance(pf)) {
      this.foul(B, def, A, c, midAbs, this.flags.counter > 0 || bT.x > 70);
      return;
    }
    this.tackle(B, def, c, midAbs);
  }

  private tackle(B: TS, def: PS, victim: PS, atAbs: Vec2): void {
    def.stats.tackles++;
    def.duelsWon++;
    const touchDist = Math.min(atAbs.y, PITCH_WIDTH - atAbs.y);
    const vT = tc(victim.side, atAbs);
    if (vT.x > 84 && this.rng.chance(0.06)) {
      // Abwehrspieler grätscht den Ball über die eigene Torlinie → Ecke
      const outT: Vec2 = { x: 105, y: clamp(vT.y + (vT.y < 34 ? -6 : 6), 1, 67) };
      const outAbs = tc(victim.side, outT);
      this.emit('tackle', B.side, { player: def, other: victim, from: atAbs, to: outAbs, duration: 0.3 + dist(atAbs, outAbs) / 12, success: true });
      this.restart = { kind: 'corner', side: victim.side, spot: tc(victim.side, { x: 105, y: vT.y < 34 ? 0 : 68 }), dead: this.rTime.range(18, 30) };
      return;
    }
    const pOut = touchDist < 14 ? 0.5 : 0.18;
    if (this.rng.chance(pOut)) {
      // Ball springt ins Aus
      const toward = touchDist < 14 || this.rng.chance(0.5) ? (atAbs.y < 34 ? 0 : PITCH_WIDTH) : atAbs.y < 34 ? PITCH_WIDTH : 0;
      const outAbs: Vec2 = { x: clamp(atAbs.x + this.rng.range(-4, 4), 1, 104), y: toward };
      const throwSide: TeamSide = this.rng.chance(0.55) ? victim.side : B.side;
      this.emit('tackle', B.side, { player: def, other: victim, from: atAbs, to: outAbs, duration: 0.3 + dist(atAbs, outAbs) / 12, success: true });
      this.restart = { kind: 'throw-in', side: throwSide, spot: outAbs, dead: this.rTime.range(7, 14) };
      return;
    }
    this.emit('tackle', B.side, { player: def, other: victim, from: atAbs, to: atAbs, duration: 0.5, success: true });
    this.winBall(B.side, def, atAbs);
    this.hold(B.side, this.rTime.range(0.4, 1.2));
  }

  private cross(A: TS, B: TS, c: PS, bT: Vec2, kind: 'cross' | 'corner' | 'free-kick'): void {
    const setPiece = kind !== 'cross';
    const low = !setPiece && this.rng.chance(0.25);
    const target: Vec2 = { x: this.rng.range(low ? 92 : 94, 101.5), y: this.rng.range(27, 41) };
    // Zielspieler: kopfballstarke Angreifer bevorzugt
    const cands = A.on.filter((ps) => ps !== c && ps.slot.role !== 'goalkeeper' && (ps.line === 'att' || ps.line === 'mid' || (setPiece && ps.line === 'def')));
    const ws = cands.map((ps) => {
      const aer = aerialScore(ps.player, ps.fatigue);
      const base = ps.line === 'att' ? 3 : ps.line === 'def' ? 1.6 : 1;
      return base * (low ? this.a(ps, 'finishing') / 70 : (aer / 70) * (aer / 70));
    });
    const r = cands.length ? cands[this.rng.weightedIndex(ws)]! : c;
    const skill = setPiece ? A.str.setPiece * 0.7 + this.a(c, 'crossing') * 0.3 : this.a(c, 'crossing');
    const aerDiff = aerialScore(r.player, r.fatigue) - B.str.aerialDef;
    let lg = P.crossBase + (skill - 70) / 14 + (low ? (this.a(r, 'positioning') - this.teamDefAvg(B)) / 16 : aerDiff / 13) + this.ha(A.side);
    if (setPiece) lg -= 0.1;
    if (this.flags.counter > 0) lg += 0.4;
    const p = logistic(lg);
    const fromAbs = this.ball;
    const toAbs = tc(A.side, target);
    const d = dist(bT, target);
    const speed = this.rTime.range(17, 23);
    const dur = d / speed;
    const evType: EventType = kind;
    if (kind === 'cross') {
      A.s.passes++;
      c.stats.passes++;
    }
    if (this.rng.chance(p)) {
      this.emit(evType, A.side, { player: c, other: r, from: fromAbs, to: toAbs, duration: dur, success: true, height: low ? 'ground' : 'high' });
      this.onBall(A.side, dur);
      if (kind === 'cross') c.stats.passesCompleted++;
      this.carrier = r;
      this.shoot(A, B, r, target, { header: !low, cross: true, setPiece, assister: c, counter: this.flags.counter > 0, pressure: 0.5 });
      return;
    }
    this.emit(evType, A.side, { player: c, other: r, from: fromAbs, to: toAbs, duration: dur, success: false, height: low ? 'ground' : 'high' });
    this.onBall(A.side, dur);
    const gk = this.gk(B);
    const claimP = low ? 0.08 : 0.12 + (this.a(gk, 'gkPositioning') - 70) / 300;
    if (this.rng.chance(claimP)) {
      gk.stats.interceptions++;
      this.emit('interception', B.side, { player: gk, other: r, from: toAbs, to: toAbs, duration: 0.6, success: true });
      this.setPossession(B.side, gk, toAbs, true);
      this.hold(B.side, this.rTime.range(3, 7));
      return;
    }
    const defender = this.nearest(B, tc(B.side, toAbs), tc(B.side, toAbs), false);
    this.clearance(A, B, defender, toAbs, 0.38);
  }

  private teamDefAvg(B: TS): number {
    let s = 0;
    let n = 0;
    for (const ps of B.on) {
      if (ps.line === 'def') {
        s += 0.6 * this.a(ps, 'marking') + 0.4 * this.a(ps, 'pace');
        n++;
      }
    }
    return n ? s / n : 60;
  }

  /** Klärungsaktion der verteidigenden Mannschaft B aus dem eigenen Strafraum */
  private clearance(A: TS, B: TS, def: PS, atAbs: Vec2, cornerP: number): void {
    def.stats.interceptions++;
    const u = this.rng.next();
    const atA = tc(A.side, atAbs);
    if (u < cornerP) {
      const flagT: Vec2 = { x: 105, y: atA.y < 34 ? 0 : 68 };
      const flagAbs = tc(A.side, flagT);
      const byline: Vec2 = tc(A.side, { x: 105, y: clamp(atA.y + (atA.y < 34 ? -8 : 8), 2, 66) });
      this.emit('clearance', B.side, { player: def, from: atAbs, to: byline, duration: 0.5, success: true, height: 'mid' });
      this.restart = { kind: 'corner', side: A.side, spot: flagAbs, dead: this.rTime.range(18, 32) };
      return;
    }
    const landB: Vec2 = { x: this.rng.range(25, 50), y: this.rng.range(4, 64) };
    const landAbs = tc(B.side, landB);
    const outTouch = this.rng.chance(0.15);
    // Klärung ins Toraus (Ecke) auch aus dem Spiel heraus
    const to = outTouch ? { x: landAbs.x, y: landAbs.y < 34 ? 0 : 68 } : landAbs;
    const dur = dist(atAbs, to) / this.rTime.range(18, 24);
    this.emit('clearance', B.side, { player: def, from: atAbs, to, duration: dur, success: true, height: 'high' });
    if (outTouch) {
      this.restart = { kind: 'throw-in', side: A.side, spot: to, dead: this.rTime.range(8, 15) };
      return;
    }
    const midAdv = A.str.att[1]![1]! - B.str.def[1]![1]!;
    this.loose(to, A.side, clamp(0.4 + midAdv * 0.15 + this.ha(A.side), 0.2, 0.65));
    this.hold(this.poss, this.rTime.range(0.5, 1.2));
  }

  // ───────────────────────────── Schüsse ─────────────────────────────

  private xgModel(pT: Vec2, ctx: ShotCtx): number {
    if (ctx.penalty) return 0.76;
    const d = distToGoal(pT);
    const ang = goalAngle(pT);
    let lg = P.xgBase - P.xgDist * d + P.xgAngle * ang;
    if (ctx.freeKick) lg = -1.55 - 0.075 * d;
    if (ctx.header) lg -= 0.95;
    if (ctx.through) lg += 0.75;
    if (ctx.counter) lg += 0.25;
    if (ctx.cross && !ctx.header) lg += 0.25;
    if (ctx.rebound) lg += 0.3;
    if (ctx.setPiece && ctx.header) lg -= 0.1;
    lg -= (ctx.pressure ?? 0.4) * 0.4;
    return clamp(logistic(lg), 0.01, 0.92);
  }

  private shoot(A: TS, B: TS, s: PS, pT: Vec2, ctx: ShotCtx): void {
    const xg = this.xgModel(pT, ctx);
    const gk = this.gk(B);
    const d = distToGoal(pT);
    let skill: number;
    if (ctx.header) skill = 0.7 * this.a(s, 'heading') + 0.3 * this.a(s, 'positioning') + (s.player.heightCm ? (s.player.heightCm - 182) * 0.4 : 0);
    else if (ctx.freeKick) skill = 0.6 * this.a(s, 'longShots') + 0.4 * this.a(s, 'crossing');
    else if (ctx.penalty) skill = 0.5 * this.a(s, 'finishing') + 0.5 * this.a(s, 'composure');
    else if (d > 20) skill = 0.7 * this.a(s, 'longShots') + 0.3 * this.a(s, 'composure');
    else skill = 0.65 * this.a(s, 'finishing') + 0.35 * this.a(s, 'composure');
    const gkSkill = 0.5 * this.a(gk, 'gkReflexes') + 0.3 * this.a(gk, 'gkPositioning') + 0.2 * this.a(gk, 'gkHandling');
    const pg = logistic(logit(xg) + (skill - 72) / 17 - (gkSkill - 72) / 19 + this.ha(A.side));
    let pBlock = ctx.header || ctx.penalty ? 0.03 : ctx.through ? 0.06 : clamp(0.1 + 0.011 * (d - 8) + (ctx.pressure ?? 0.4) * 0.12, 0.05, 0.42);
    if (ctx.freeKick) pBlock = 0.25;
    const type: EventType = ctx.header ? 'header' : 'shot';
    const fromAbs = this.ball;
    A.s.shots++;
    A.s.xg += xg;
    s.stats.shots++;
    const name = s.player.shortName;
    const speed = ctx.header ? this.rTime.range(11, 16) : this.rTime.range(20, 30);
    const height = ctx.header ? 'mid' : this.rng.chance(0.4) ? 'mid' : 'ground';

    const u = this.rng.next();
    if (u < pBlock) {
      // Geblockt
      const blT: Vec2 = { x: Math.min(pT.x + this.rng.range(1.5, 5), 103), y: pT.y + (34 - pT.y) * 0.15 };
      const blAbs = tc(A.side, blT);
      const dur = dist(pT, blT) / speed;
      this.emit(type, A.side, { player: s, from: fromAbs, to: blAbs, duration: dur, success: false, xg, height });
      this.onBall(A.side, dur);
      const blocker = this.nearest(B, tc(B.side, blAbs), tc(B.side, blAbs), false);
      const v = this.rng.next();
      const big = xg >= 0.3 ? `Großchance für ${A.sheet.shortName}: ${name} scheitert am Block` : undefined;
      if (v < 0.4) {
        const by = tc(A.side, { x: 105, y: clamp(blT.y + this.rng.range(-10, 10), 2, 66) });
        this.emit('block', B.side, { player: blocker, other: s, from: blAbs, to: by, duration: 0.3 + dist(blAbs, by) / 16, success: true, text: big });
        this.restart = { kind: 'corner', side: A.side, spot: tc(A.side, { x: 105, y: blT.y < 34 ? 0 : 68 }), dead: this.rTime.range(18, 30) };
      } else {
        const landT: Vec2 = inside({ x: blT.x - this.rng.range(6, 18), y: blT.y + this.rng.range(-10, 10) }, 1);
        const landAbs = tc(A.side, landT);
        this.emit('block', B.side, { player: blocker, other: s, from: blAbs, to: landAbs, duration: 0.3 + dist(blAbs, landAbs) / 16, success: true, text: big });
        blocker.stats.interceptions++;
        this.loose(landAbs, A.side, 0.38);
        this.hold(this.poss, this.rTime.range(0.4, 1));
      }
      return;
    }
    const pgU = Math.min(0.97, pg / (1 - pBlock));
    const v = this.rng.next();
    if (v < pgU) {
      // Tor
      const goalT: Vec2 = { x: 105, y: this.rng.range(30.9, 37.1) };
      const gAbs = tc(A.side, goalT);
      const dur = dist(pT, goalT) / speed;
      this.emit(type, A.side, { player: s, other: ctx.assister ?? null, from: fromAbs, to: gAbs, duration: dur, success: true, xg, height });
      this.onBall(A.side, dur);
      this.score[A.side]++;
      A.s.goals++;
      A.s.shotsOnTarget++;
      s.stats.shotsOnTarget++;
      s.stats.goals++;
      const assister = ctx.assister && ctx.assister !== s && !ctx.penalty && !ctx.freeKick ? ctx.assister : null;
      if (assister) assister.stats.assists++;
      this.halfCounts.goals++;
      const how = ctx.penalty ? ' per Elfmeter' : ctx.header ? ' per Kopf' : ctx.freeKick ? ' per Freistoß' : '';
      const text = `TOR für ${A.sheet.shortName}! ${name} trifft${how} zum ${this.scoreStr()}${assister ? ` (Vorlage: ${assister.player.shortName})` : ''}`;
      this.emit('goal', A.side, { player: s, other: assister, from: gAbs, to: gAbs, duration: 1, success: true, text });
      this.restart = { kind: 'kickoff', side: B.side, spot: { x: 52.5, y: 34 }, dead: this.rTime.range(50, 80) };
      this.carrier = null;
      return;
    }
    const ang = goalAngle(pT);
    const pSave = clamp(0.22 + 0.22 * ang + (skill - 70) / 160 - (d > 22 ? 0.05 : 0), 0.15, 0.55);
    const big = xg >= 0.3;
    if (this.rng.chance(pSave)) {
      const svT: Vec2 = { x: 104, y: this.rng.range(31, 37) };
      const svAbs = tc(A.side, svT);
      const dur = dist(pT, svT) / speed;
      this.emit(type, A.side, { player: s, from: fromAbs, to: svAbs, duration: dur, success: false, xg, height });
      this.onBall(A.side, dur);
      A.s.shotsOnTarget++;
      s.stats.shotsOnTarget++;
      gk.saves++;
      const text = big ? `Großchance für ${A.sheet.shortName}: ${name} scheitert an ${gk.player.shortName}` : undefined;
      const holdP = clamp(0.5 + (this.a(gk, 'gkHandling') - 70) / 100 - (ctx.header ? 0 : 0.05), 0.3, 0.8);
      const w = this.rng.next();
      if (w < holdP) {
        this.emit('save', B.side, { player: gk, other: s, from: svAbs, to: svAbs, duration: 0.6, success: true, text });
        this.setPossession(B.side, gk, svAbs, true);
        this.hold(B.side, this.rTime.range(4, 9));
      } else if (w < holdP + (1 - holdP) * 0.5) {
        const by = tc(A.side, { x: 105, y: svT.y < 34 ? this.rng.range(20, 30) : this.rng.range(38, 48) });
        this.emit('save', B.side, { player: gk, other: s, from: svAbs, to: by, duration: 0.3 + dist(svAbs, by) / 15, success: true, text });
        this.restart = { kind: 'corner', side: A.side, spot: tc(A.side, { x: 105, y: svT.y < 34 ? 0 : 68 }), dead: this.rTime.range(18, 30) };
      } else {
        const landT: Vec2 = { x: this.rng.range(92, 99), y: this.rng.range(24, 44) };
        const landAbs = tc(A.side, landT);
        this.emit('save', B.side, { player: gk, other: s, from: svAbs, to: landAbs, duration: 0.3 + dist(svAbs, landAbs) / 15, success: true, text });
        const rebound = this.rng.chance(0.3);
        if (rebound) {
          const att = this.nearest(A, landT, landT, true, null);
          this.setPossession(A.side, att, landAbs, false);
          this.carrier = att;
          this.hold(A.side, 0.4);
          this.shoot(A, B, att, landT, { rebound: true, pressure: 0.6 });
        } else {
          const def = this.nearest(B, tc(B.side, landAbs), tc(B.side, landAbs), false);
          this.clearance(A, B, def, landAbs, 0.2);
        }
      }
      return;
    }
    // Vorbei
    const off = this.rng.chance(0.5);
    const missT: Vec2 = { x: 105, y: off ? this.rng.range(22, 30.3) : this.rng.range(37.7, 46) };
    const mAbs = tc(A.side, missT);
    const dur = dist(pT, missT) / speed;
    this.emit(type, A.side, { player: s, from: fromAbs, to: mAbs, duration: dur, success: false, xg, height: this.rng.chance(0.5) ? 'high' : height });
    this.onBall(A.side, dur);
    const text = big ? `Großchance für ${A.sheet.shortName}: ${name} verfehlt knapp` : undefined;
    this.emit('miss', A.side, { player: s, from: mAbs, to: mAbs, duration: 0.3, success: false, text });
    this.restart = this.goalKick(B.side);
  }

  private goalKick(side: TeamSide): Restart {
    return { kind: 'goal-kick', side, spot: tc(side, { x: 5.5, y: this.rng.chance(0.5) ? 29 : 39 }), dead: this.rTime.range(16, 30) };
  }

  // ───────────────────────────── Fouls & Karten ─────────────────────────────

  private foul(B: TS, fouler: PS, A: TS, victim: PS, atAbs: Vec2, tactical: boolean): void {
    B.s.fouls++;
    fouler.stats.fouls++;
    this.halfCounts.fouls++;
    const atA = tc(A.side, atAbs);
    const pen = inBox(atA);
    this.emit('foul', B.side, {
      player: fouler,
      other: victim,
      from: atAbs,
      to: atAbs,
      duration: 0.6,
      success: true,
      text: pen ? `Elfmeter für ${A.sheet.shortName}! ${fouler.player.shortName} foult ${victim.player.shortName}` : undefined,
    });
    // Karten
    const era = B.sheet.era;
    let yp = yellowPerFoul(era) * (tactical ? 1.8 : 1) * (1 + 0.4 * (this.a(fouler, 'tackling') < 55 ? 1 : 0)) * (pen ? 1.5 : 1);
    if (fouler.stats.yellow > 0) yp *= 0.3; // vorbelastete Spieler halten sich zurück
    const rp = redPerFoul(era) * (pen ? 2 : 1);
    let dead = this.rTime.range(14, 30);
    const v = this.rRef.next();
    if (v < rp) {
      this.card(B, fouler, 'red', atAbs);
      dead += 45;
    } else if (v < rp + yp && era >= 1970) {
      if (fouler.stats.yellow > 0) this.card(B, fouler, 'second', atAbs);
      else this.card(B, fouler, 'yellow', atAbs);
      dead += 20;
    }
    if (pen) {
      this.halfCounts.pens++;
      this.restart = { kind: 'penalty', side: A.side, spot: tc(A.side, { x: 94, y: 34 }), dead: this.rTime.range(45, 75) };
    } else {
      this.restart = { kind: 'free-kick', side: A.side, spot: atAbs, dead };
    }
    this.carrier = victim;
  }

  private card(ts: TS, ps: PS, kind: 'yellow' | 'second' | 'red', atAbs: Vec2): void {
    this.halfCounts.cards++;
    if (kind === 'yellow') {
      ps.stats.yellow++;
      ts.s.yellow++;
      this.emit('yellow-card', ts.side, { player: ps, from: atAbs, to: atAbs, duration: 0, success: true, text: `Gelbe Karte für ${ps.player.shortName} (${ts.sheet.shortName})` });
      return;
    }
    if (kind === 'second') {
      ps.stats.yellow++;
      ts.s.yellow++;
    }
    ps.stats.red++;
    ts.s.red++;
    const txt = kind === 'second' ? `Gelb-Rote Karte für ${ps.player.shortName} (${ts.sheet.shortName})` : `Rote Karte für ${ps.player.shortName} (${ts.sheet.shortName})`;
    this.emit('red-card', ts.side, { player: ps, from: atAbs, to: atAbs, duration: 0, success: true, text: txt });
    this.sendOff(ts, ps);
  }

  private sendOff(ts: TS, ps: PS): void {
    ps.offT = this.t;
    ts.on = ts.on.filter((q) => q !== ps);
    if (ps.slot.role === 'goalkeeper') {
      // Ersatztorwart bringen (für einen Angreifer) oder Feldspieler ins Tor
      const benchGk = ts.bench.find((p) => p.positions[0] === 'GK');
      if (benchGk && ts.subsUsed < ts.sheet.coach.maxSubs) {
        const outfield = [...ts.on].sort((a, b) => LINE_IDX[b.line] - LINE_IDX[a.line] || a.player.overall - b.player.overall)[0];
        if (outfield) this.substitute(ts, outfield, benchGk, { ...ps.slot, playerId: benchGk.id });
      } else {
        const keeper = [...ts.on].sort((a, b) => b.player.attributes.gkReflexes - a.player.attributes.gkReflexes)[0];
        if (keeper) {
          keeper.slot = { ...ps.slot, playerId: keeper.player.id };
          keeper.line = 'gk';
        }
      }
    }
    this.refreshTactic(ts.side);
  }

  // ───────────────────────────── Standards ─────────────────────────────

  private doRestart(r: Restart): void {
    const A = this.teams[r.side];
    const B = this.teams[OTHER[r.side]];
    const spotT = tc(A.side, r.spot);
    this.poss = A.side;
    this.lastPasser = null;
    this.flags = { counter: 0, through: false, cutback: false, steps: 0 };
    switch (r.kind) {
      case 'kickoff': {
        const taker = A.on.find((p) => p.line === 'att') ?? A.on.find((p) => p.line === 'mid') ?? A.on[1]!;
        const cand = A.on.filter((p) => p !== taker && (p.line === 'mid' || p.line === 'def'));
        const recv = cand.length ? this.rng.pick(cand) : taker;
        const recvT = this.pos(recv, true, spotT);
        const toT = { x: Math.min(recvT.x, 50), y: recvT.y };
        const text = this.events.length === 0 ? `Anpfiff: ${A.sheet.shortName} gegen ${B.sheet.shortName}` : this.half === 2 && this.t - this.halfStartT < 5 ? 'Anpfiff zur zweiten Halbzeit' : undefined;
        this.restartPass('kickoff', A, B, taker, recv, spotT, toT, 0.99, 'ground', text);
        return;
      }
      case 'throw-in': {
        const taker = this.nearest(A, spotT, spotT, true);
        const recv = this.nearest(A, { x: clamp(spotT.x + this.rng.range(-4, 10), 3, 100), y: spotT.y < 34 ? 12 : 56 }, spotT, true, taker);
        const rT = this.pos(recv, true, spotT);
        const toT = { x: rT.x, y: spotT.y < 34 ? clamp(rT.y, 4, 22) : clamp(rT.y, 46, 64) };
        this.restartPass('throw-in', A, B, taker, recv, spotT, toT, 0.86, 'mid');
        return;
      }
      case 'goal-kick': {
        const gk = this.gk(A);
        const pressFactor = B.tac.pressingHeight * B.tac.pressingIntensity;
        const longP = clamp(0.2 + 0.5 * A.tac.directness + 0.35 * pressFactor + (this.era(A) < 1995 ? 0.25 : 0), 0.1, 0.95);
        if (this.rng.chance(longP)) {
          const fw = A.on.filter((p) => p.line === 'att' || p.line === 'mid');
          const recv = fw.length ? this.rng.pick(fw) : A.on[1]!;
          const toT: Vec2 = { x: this.rng.range(55, 72), y: this.rng.range(14, 54) };
          const aer = aerialScore(recv.player, recv.fatigue) - B.str.aerialDef;
          const p = logistic(-0.2 + aer / 16 + this.ha(A.side));
          this.restartPass('goal-kick', A, B, gk, recv, spotT, toT, p, 'high');
        } else {
          const defs = A.on.filter((p) => p.line === 'def');
          const recv = defs.length ? this.rng.pick(defs) : A.on[1]!;
          const rT = this.pos(recv, true, { x: 20, y: 34 });
          this.restartPass('goal-kick', A, B, gk, recv, spotT, { x: clamp(rT.x, 8, 30), y: rT.y }, clamp(0.97 - 0.12 * pressFactor, 0.8, 0.98), 'ground');
        }
        return;
      }
      case 'corner': {
        const taker = this.setPieceTaker(A, A.tac.cornerTakers, 'crossing');
        this.carrier = taker;
        if (this.rng.chance(0.15)) {
          const recv = this.nearest(A, { x: 98, y: spotT.y < 34 ? 10 : 58 }, { x: 100, y: 34 }, true, taker);
          const toT: Vec2 = { x: this.rng.range(95, 100), y: spotT.y < 34 ? this.rng.range(6, 14) : this.rng.range(54, 62) };
          this.restartPass('corner', A, B, taker, recv, spotT, toT, 0.9, 'ground');
          return;
        }
        this.cross(A, B, taker, spotT, 'corner');
        return;
      }
      case 'penalty': {
        const taker = this.setPieceTaker(A, A.tac.penaltyTakers, 'finishing');
        this.carrier = taker;
        this.emit('penalty', A.side, { player: taker, from: r.spot, to: r.spot, duration: 0.5, success: true, text: `${taker.player.shortName} tritt zum Elfmeter an` });
        this.shoot(A, B, taker, spotT, { penalty: true, pressure: 0 });
        return;
      }
      case 'free-kick': {
        const d = distToGoal(spotT);
        const central = Math.abs(spotT.y - 34) < 18;
        if (d < 31 && spotT.x > 75 && central && this.rng.chance(0.6)) {
          const taker = this.setPieceTaker(A, A.tac.freeKickTakers, 'longShots');
          this.carrier = taker;
          this.emit('free-kick', A.side, { player: taker, from: r.spot, to: r.spot, duration: 0.5, success: true });
          this.shoot(A, B, taker, spotT, { freeKick: true, pressure: 0.3 });
          return;
        }
        if (spotT.x > 68) {
          const taker = this.setPieceTaker(A, A.tac.freeKickTakers, 'crossing');
          this.carrier = taker;
          this.cross(A, B, taker, spotT, 'free-kick');
          return;
        }
        const taker = this.carrier && A.on.includes(this.carrier) ? this.carrier : this.nearest(A, spotT, spotT, true, null, false);
        const long = this.rng.chance(0.15 + 0.5 * A.tac.directness);
        const pick = this.pickReceiver(A, B, taker, spotT, A.tac.directness, long) ?? this.pickReceiver(A, B, taker, spotT, A.tac.directness, false);
        if (!pick) {
          this.carrier = taker;
          return;
        }
        this.restartPass('free-kick', A, B, taker, pick.r, spotT, pick.at, long ? 0.6 : 0.95, long ? 'high' : 'ground');
        return;
      }
    }
  }

  private era(ts: TS): number {
    return ts.sheet.era;
  }

  private setPieceTaker(A: TS, ids: string[], fallback: AttrKey): PS {
    for (const id of ids) {
      const ps = A.on.find((p) => p.player.id === id);
      if (ps) return ps;
    }
    let best = A.on[1] ?? A.on[0]!;
    for (const ps of A.on) if (ps.slot.role !== 'goalkeeper' && this.a(ps, fallback) > this.a(best, fallback)) best = ps;
    return best;
  }

  private restartPass(type: EventType, A: TS, B: TS, taker: PS, recv: PS, fromT: Vec2, toT: Vec2, p: number, height: 'ground' | 'mid' | 'high', text?: string): void {
    const to = inside(toT, 1);
    const d = dist(fromT, to);
    const speed = height === 'high' ? this.rTime.range(17, 23) : this.rTime.range(10, 15);
    const fromAbs = tc(A.side, fromT);
    const toAbs = tc(A.side, to);
    const dur = Math.max(0.4, d / speed);
    if (this.rng.chance(p)) {
      this.emit(type, A.side, { player: taker, other: recv, from: fromAbs, to: toAbs, duration: dur, success: true, height, text });
      this.onBall(A.side, dur);
      this.carrier = recv;
      this.lastPasser = taker;
      this.hold(A.side);
      return;
    }
    this.emit(type, A.side, { player: taker, other: recv, from: fromAbs, to: toAbs, duration: dur, success: false, height, text });
    this.onBall(A.side, dur);
    if (height === 'high') {
      // Kopfballduell verloren → zweiter Ball
      const toB = tc(B.side, toAbs);
      const w = this.nearest(B, toB, toB, false);
      w.duelsWon++;
      this.emit('interception', B.side, { player: w, other: recv, from: toAbs, to: toAbs, duration: 0.4, success: true, height: 'high' });
      w.stats.interceptions++;
      this.winBall(B.side, w, toAbs);
    } else {
      const toB = tc(B.side, toAbs);
      const w = this.nearest(B, toB, toB, false);
      w.stats.interceptions++;
      this.emit('interception', B.side, { player: w, other: recv, from: toAbs, to: toAbs, duration: 0.4, success: true });
      this.winBall(B.side, w, toAbs);
    }
    this.hold(B.side, this.rTime.range(0.4, 1.2));
  }

  // ───────────────────────────── Trainer ─────────────────────────────

  private coachTick(r: Restart): void {
    const minute = this.gameMinute();
    for (const side of ['home', 'away'] as const) {
      this.tacticShift(side, minute);
      this.maybeSub(side, minute, r);
    }
  }

  private tacticShift(side: TeamSide, minute: number): void {
    const ts = this.teams[side];
    const lead = this.score[side] - this.score[OTHER[side]];
    const late = minute >= this.L * 2 * 0.67;
    let mood = 0;
    if (late && lead < 0) mood = -1;
    else if (minute >= this.L * 2 * 0.75 && lead > 0) mood = 1;
    if (mood === ts.mood) return;
    ts.mood = mood;
    const b = ts.base;
    const c = ts.sheet.coach;
    const t: Tactic = { ...b };
    if (mood === -1) {
      const a = c.aggressionWhenTrailing;
      t.directness = clamp(b.directness + 0.25 * a, 0, 1);
      t.pressingHeight = clamp(b.pressingHeight + 0.2 * a, 0, 1);
      t.pressingIntensity = clamp(b.pressingIntensity + 0.15 * a, 0, 1);
      t.defensiveLine = clamp(b.defensiveLine + 0.15 * a, 0, 1);
      t.crossingFocus = clamp(b.crossingFocus + 0.15 * a, 0, 1);
      t.tempo = clamp(b.tempo + 0.15 * a, 0, 1);
    } else if (mood === 1) {
      const k = c.cautionWhenLeading;
      t.pressingHeight = clamp(b.pressingHeight - 0.25 * k, 0, 1);
      t.defensiveLine = clamp(b.defensiveLine - 0.2 * k, 0, 1);
      t.tempo = clamp(b.tempo - 0.3 * k * (0.5 + b.gameManagement), 0, 1);
      t.directness = clamp(b.directness - 0.1 * k, 0, 1);
      t.counterAttack = clamp(b.counterAttack + 0.2 * k, 0, 1);
    }
    ts.tac = t;
    this.refreshTactic(side);
  }

  private maybeSub(side: TeamSide, minute: number, r: Restart): void {
    const ts = this.teams[side];
    const coach = ts.sheet.coach;
    if (ts.subsUsed >= coach.maxSubs || !ts.bench.length) return;
    // Wechsel nur bei Unterbrechungen, nicht beim eigenen Elfmeter
    if (r.kind === 'penalty') return;
    const first = coach.firstSubMinute * (this.L / 45);
    const end = this.L * 2 * 0.94;
    const planned = coach.maxSubs;
    let target = 0;
    if (minute >= first - 3) {
      const gap = Math.max(4, (end - first) / Math.max(1, planned - 1));
      target = Math.min(planned, 1 + Math.floor((minute - first) / gap));
    }
    const exhausted = ts.on.some((p) => p.fatigue > 0.8 && p.slot.role !== 'goalkeeper');
    if (exhausted && minute > this.L) target = Math.max(target, ts.subsUsed + 1);
    // Viele Trainer nutzen nicht alle Wechsel
    if (ts.subsUsed >= target) return;
    if (!this.rCoach.chance(0.45)) return;
    this.makeSub(side, minute);
  }

  private halfTimeCoach(side: TeamSide): void {
    const ts = this.teams[side];
    if (ts.subsUsed >= ts.sheet.coach.maxSubs) return;
    const lead = this.score[side] - this.score[OTHER[side]];
    const p = 0.08 + (lead < 0 ? 0.25 * ts.sheet.coach.aggressionWhenTrailing : 0) + (ts.on.some((x) => x.stats.yellow > 0 && x.line !== 'att') ? 0.12 : 0);
    if (this.rCoach.chance(p)) {
      const ball = this.ball;
      this.makeSub(side, this.L);
      this.ball = ball;
    }
  }

  private makeSub(side: TeamSide, minute: number): void {
    const ts = this.teams[side];
    const lead = this.score[side] - this.score[OTHER[side]];
    const coach = ts.sheet.coach;
    const attacking = lead < 0 && minute > this.L * 1.2 && this.rCoach.chance(coach.aggressionWhenTrailing);
    const defensive = lead > 0 && minute > this.L * 1.5 && this.rCoach.chance(coach.cautionWhenLeading);
    let off: PS | null = null;
    let best = -Infinity;
    for (const ps of ts.on) {
      if (ps.slot.role === 'goalkeeper') continue;
      let s = ps.fatigue * 2.2 + (ps.stats.yellow > 0 ? (ps.line === 'att' ? 0.25 : 0.6) : 0) + this.rCoach.range(0, 0.35);
      s += (ps.duelsLost - ps.duelsWon) * 0.03 - ps.stats.goals * 0.4;
      if (attacking) s += ps.line === 'def' || ps.slot.role === 'holding-mid' ? 0.6 * coach.aggressionWhenTrailing : 0;
      if (defensive) s += ps.line === 'att' ? 0.6 * coach.cautionWhenLeading : 0;
      if (s > best) {
        best = s;
        off = ps;
      }
    }
    if (!off) return;
    const offLine = off.line;
    let wantLine: Line = offLine;
    if (attacking) wantLine = 'att';
    else if (defensive) wantLine = offLine === 'att' ? 'mid' : 'def';
    let on: Player | null = null;
    let bs = -Infinity;
    for (const p of ts.bench) {
      if (p.positions[0] === 'GK') continue;
      const pl = positionLine(p.positions[0]!);
      let s = p.overall * positionFit(p, off.slot.position);
      if (pl === wantLine) s += 25;
      if (s > bs) {
        bs = s;
        on = p;
      }
    }
    if (!on) return;
    let slot: LineupSlot = { ...off.slot, playerId: on.id };
    const newLine = positionLine(on.positions[0]!);
    if (newLine !== offLine && !on.positions.includes(off.slot.position)) {
      const shift = (LINE_IDX[newLine] - LINE_IDX[offLine]) * 9;
      const pos = on.positions[0]!;
      slot = {
        playerId: on.id,
        position: pos,
        role: DEFAULT_ROLE[pos],
        anchorAttack: { x: clamp(off.slot.anchorAttack.x + shift, 10, 98), y: off.slot.anchorAttack.y },
        anchorDefend: { x: clamp(off.slot.anchorDefend.x + shift, 6, 90), y: off.slot.anchorDefend.y },
      };
    }
    this.substitute(ts, off, on, slot);
  }

  private substitute(ts: TS, off: PS, on: Player, slot: LineupSlot): void {
    const ps = this.newPS(ts.side, on, slot, ts.tac, this.t);
    off.offT = this.t;
    ts.on = ts.on.map((q) => (q === off ? ps : q));
    if (!ts.on.includes(ps)) ts.on.push(ps);
    ts.all.push(ps);
    ts.bench = ts.bench.filter((p) => p !== on);
    ts.subsUsed++;
    this.halfCounts.subs++;
    if (this.carrier === off) this.carrier = ps;
    this.emit('substitution', ts.side, {
      player: off,
      other: ps,
      from: this.ball,
      to: this.ball,
      duration: 0,
      success: true,
      text: `Wechsel bei ${ts.sheet.shortName}: ${on.shortName} kommt für ${off.player.shortName}`,
    });
    this.t += this.rTime.range(10, 25);
    this.refreshTactic(ts.side);
  }

  // ───────────────────────────── Ergebnis ─────────────────────────────

  private result(): MatchResult {
    const endT = this.t;
    const totalPoss = this.teams.home.s.possTime + this.teams.away.s.possTime || 1;
    const stats = {} as { home: TeamMatchStats; away: TeamMatchStats };
    for (const side of ['home', 'away'] as const) {
      const s = this.teams[side].s;
      let passes = 0;
      let ok = 0;
      for (const ps of this.teams[side].all) {
        passes += ps.stats.passes;
        ok += ps.stats.passesCompleted;
      }
      stats[side] = {
        possession: Math.round((1000 * s.possTime) / totalPoss) / 10,
        shots: s.shots,
        shotsOnTarget: s.shotsOnTarget,
        xg: Math.round(s.xg * 100) / 100,
        passes,
        passAccuracy: passes ? Math.round((1000 * ok) / passes) / 10 : 0,
        corners: s.corners,
        fouls: s.fouls,
        yellow: s.yellow,
        red: s.red,
        offsides: s.offsides,
      };
    }
    // Ecken aus allen Quellen (Ecken-Ereignisse zählen)
    stats.home.corners = this.events.filter((e) => e.type === 'corner' && e.team === 'home').length;
    stats.away.corners = this.events.filter((e) => e.type === 'corner' && e.team === 'away').length;

    const minutesOf = (ps: PS): number => {
      const conv = (t: number): number => {
        const firstEnd = this.events.find((e) => e.type === 'half-time')?.t ?? endT;
        if (t <= firstEnd) return Math.min(this.L, t / 60);
        const h2 = this.events.find((e) => e.type === 'kickoff' && e.half === 2)?.t ?? firstEnd;
        return this.L + Math.min(this.L, Math.max(0, t - h2) / 60);
      };
      return Math.round(conv(ps.offT ?? endT) - conv(ps.onT));
    };
    const playerStats: PlayerMatchStats[] = [];
    const ratingInput = [];
    for (const side of ['home', 'away'] as const) {
      const ts = this.teams[side];
      for (const ps of ts.all) {
        ps.stats.minutes = Math.max(0, minutesOf(ps));
        const mins = ps.stats.minutes;
        const base = ps.line === 'gk' ? 5.4 : ps.line === 'def' ? 10.2 : ps.line === 'mid' ? 11.2 : 10.0;
        ps.stats.distanceKm = Math.round(((base * (0.88 + 0.24 * (ps.player.attributes.workRate / 100))) * mins) / 90 * 10) / 10;
        playerStats.push(ps.stats);
        ratingInput.push({ stats: ps.stats, line: ps.line, saves: ps.saves, keyActions: ps.keyActions, duelsWon: ps.duelsWon, duelsLost: ps.duelsLost });
      }
    }
    computeRatings(ratingInput, this.score);
    return {
      seed: this.seed,
      engineVersion: ENGINE_VERSION,
      home: this.home,
      away: this.away,
      events: this.events,
      score: { ...this.score },
      stats,
      playerStats,
      momentum: computeMomentum(this.events, endT),
    };
  }
}

export function simulateMatch(home: TeamSheet, away: TeamSheet, seed: number, options: SimulateOptions = {}): MatchResult {
  return new MatchSim(home, away, seed, options).run();
}
