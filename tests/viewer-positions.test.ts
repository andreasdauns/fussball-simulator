import { describe, expect, it } from 'vitest';
import type { MatchEvent, MatchResult, TeamMatchStats, TeamSide, Vec2 } from '../src/engine/types';
import { simulateMatch } from '../src/engine';
import { DEMO_RED, DEMO_WHITE } from '../src/viewer2d/demoTeams';
import { highlightWindows } from '../src/viewer2d/highlights';
import { PositionSynth, type Frame } from '../src/viewer2d/positions';
import { BALLLESS_TYPES } from '../src/viewer2d/timeline';

/** Kleines, unabhängiges Spiel mit verketteten Ereignissen (unabhängig von der Engine). */
function syntheticMatch(): MatchResult {
  let s = 12345;
  const rnd = () => {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    return s / 4294967296;
  };
  const events: MatchEvent[] = [];
  const score = { home: 0, away: 0 };
  let t = 0;
  let ball: Vec2 = { x: 52.5, y: 34 };
  const ids = (side: TeamSide) => (side === 'home' ? DEMO_RED : DEMO_WHITE).lineup.map((l) => l.playerId);
  const push = (e: Omit<MatchEvent, 'id' | 'score' | 'clock'>) => {
    const m = e.half === 1 ? Math.floor(e.t / 60) + 1 : 46 + Math.floor((e.t - 2760) / 60);
    events.push({ ...e, id: events.length, clock: String(m), score: { ...score } });
    t = e.t + e.duration;
    if (!BALLLESS_TYPES.has(e.type)) ball = e.to;
  };
  for (const half of [1, 2] as const) {
    const side: TeamSide = half === 1 ? 'home' : 'away';
    if (half === 2) t = 2760;
    push({ t, duration: 0.6, half, type: 'kickoff', team: side, playerId: ids(side)[10], otherPlayerId: ids(side)[6], from: { x: 52.5, y: 34 }, to: { x: side === 'home' ? 48 : 57, y: 36 }, success: true, height: 'ground' });
    let poss: TeamSide = side;
    const endT = half === 1 ? 2730 : 5450;
    let n = 0;
    while (t < endT) {
      n++;
      t += 0.8 + rnd() * 2;
      const pl = ids(poss);
      const a = pl[1 + Math.floor(rnd() * 10)]!;
      const b = pl[1 + Math.floor(rnd() * 10)]!;
      if (n % 37 === 0) {
        // Torschuss + Tor, dann Anstoß des Gegners
        const goalX = poss === 'home' ? 105 : 0;
        push({ t, duration: 0.7, half, type: 'shot', team: poss, playerId: a, from: ball, to: { x: goalX, y: 33 }, success: true, xg: 0.3, height: 'ground' });
        score[poss]++;
        push({ t, duration: 1, half, type: 'goal', team: poss, playerId: a, from: ball, to: ball, success: true, text: 'TOR' });
        poss = poss === 'home' ? 'away' : 'home';
        t += 40;
        push({ t, duration: 0.6, half, type: 'kickoff', team: poss, playerId: ids(poss)[10], otherPlayerId: ids(poss)[6], from: { x: 52.5, y: 34 }, to: { x: 52.5, y: 40 }, success: true, height: 'ground' });
        continue;
      }
      if (n % 23 === 0) {
        const x = 5 + rnd() * 95;
        push({ t, duration: 1.5, half, type: 'pass', team: poss, playerId: a, otherPlayerId: b, from: ball, to: { x, y: 0 }, success: false, height: 'mid' });
        poss = poss === 'home' ? 'away' : 'home';
        t += 10;
        push({ t, duration: 1.5, half, type: 'throw-in', team: poss, playerId: ids(poss)[2], otherPlayerId: ids(poss)[5], from: ball, to: { x: ball.x, y: 12 }, success: true, height: 'mid' });
        continue;
      }
      const to = { x: 3 + rnd() * 99, y: 3 + rnd() * 62 };
      const d = Math.hypot(to.x - ball.x, to.y - ball.y);
      const ok = rnd() < 0.8;
      push({ t, duration: d / 15, half, type: d > 30 ? 'long-ball' : 'pass', team: poss, playerId: a, otherPlayerId: b, from: ball, to, success: ok, height: d > 30 ? 'high' : 'ground' });
      if (!ok) {
        poss = poss === 'home' ? 'away' : 'home';
        push({ t, duration: 0.4, half, type: 'interception', team: poss, playerId: ids(poss)[3], from: ball, to: ball, success: true });
      }
      if (half === 2 && n === 60) {
        const bench = DEMO_RED.bench[2]!.id;
        push({ t, duration: 0, half, type: 'substitution', team: 'home', playerId: ids('home')[7], otherPlayerId: bench, from: ball, to: ball, success: true, text: 'Wechsel' });
        t += 15;
      }
      if (half === 2 && n === 120) {
        push({ t, duration: 0, half, type: 'red-card', team: 'away', playerId: ids('away')[4], from: ball, to: ball, success: true, text: 'Rot' });
      }
    }
    push({ t, duration: 0, half, type: half === 1 ? 'half-time' : 'full-time', team: poss, from: ball, to: ball, success: true, text: 'Pfiff' });
  }
  const st = (): TeamMatchStats => ({ possession: 50, shots: 0, shotsOnTarget: 0, xg: 0, passes: 0, passAccuracy: 0, corners: 0, fouls: 0, yellow: 0, red: 0, offsides: 0 });
  return { seed: 1, engineVersion: 'test', home: DEMO_RED, away: DEMO_WHITE, events, score, stats: { home: st(), away: st() }, playerStats: [], momentum: new Array(92).fill(0) };
}

function sameFrame(a: Frame, b: Frame): void {
  expect(a.ball).toEqual(b.ball);
  expect(a.players.map((p) => [p.id, p.x, p.y])).toEqual(b.players.map((p) => [p.id, p.x, p.y]));
}

const MATCHES: [string, () => MatchResult][] = [
  ['synthetisch', syntheticMatch],
  ['Engine', () => simulateMatch(DEMO_RED, DEMO_WHITE, 7)],
];

describe.each(MATCHES)('PositionSynth (%s)', (_name, make) => {
  const result = make();
  const shared = new PositionSynth(result);

  it('ist deterministisch – unabhängig von Instanz und Abfragereihenfolge', () => {
    const a = new PositionSynth(result);
    const b = new PositionSynth(result);
    const end = a.timeline.endTau;
    const times = [0, 13.37, end * 0.25, end * 0.5 + 0.05, end * 0.8, end - 1];
    const forward = times.map((t) => a.frameAt(t));
    // b: rückwärts und mit Sprüngen
    const backward = [...times].reverse().map((t) => b.frameAt(t)).reverse();
    forward.forEach((f, i) => sameFrame(f, backward[i]!));
    // wiederholte Abfrage nach Spulen
    sameFrame(a.frameAt(times[2]!), forward[2]!);
  });

  it('hält alle Spieler innerhalb des Feldes (±3 m) und immer elf (bzw. weniger nach Rot) auf dem Platz', () => {
    const ps = shared;
    const end = ps.timeline.endTau;
    let maxCount = 0;
    for (let t = 0; t <= end; t += 0.5) {
      const f = ps.frameAt(t);
      const active = f.players.filter((p) => !p.leaving);
      const home = active.filter((p) => p.side === 'home').length;
      const away = active.filter((p) => p.side === 'away').length;
      expect(home).toBeLessThanOrEqual(11);
      expect(away).toBeLessThanOrEqual(11);
      expect(home).toBeGreaterThanOrEqual(10);
      expect(away).toBeGreaterThanOrEqual(10);
      maxCount = Math.max(maxCount, active.length);
      for (const p of f.players) {
        expect(p.x).toBeGreaterThanOrEqual(-3);
        expect(p.x).toBeLessThanOrEqual(108);
        expect(p.y).toBeGreaterThanOrEqual(-3);
        expect(p.y).toBeLessThanOrEqual(71);
      }
    }
    expect(maxCount).toBe(22);
  });

  it('Ball liegt zu Beginn und Ende jedes Ereignisses auf dessen from/to', () => {
    const ps = shared;
    const evs = ps.timeline.ballEvents;
    let checked = 0;
    for (let i = 0; i < evs.length; i++) {
      const te = evs[i]!;
      const next = evs[i + 1];
      if (next && next.start < te.end - 1e-9) continue; // überlappt: Folgeereignis gewinnt
      const b0 = ps.ballAt(te.start);
      expect(Math.abs(b0.x - te.ev.from.x)).toBeLessThan(0.01);
      expect(Math.abs(b0.y - te.ev.from.y)).toBeLessThan(0.01);
      if (te.end > te.start) {
        const b1 = ps.ballAt(te.end - 1e-7);
        expect(Math.abs(b1.x - te.ev.to.x)).toBeLessThan(0.05);
        expect(Math.abs(b1.y - te.ev.to.y)).toBeLessThan(0.05);
        expect(b1.z).toBeLessThan(0.05);
      }
      checked++;
    }
    expect(checked).toBeGreaterThan(100);
  });

  it('Seitenwechsel zur Halbzeit: Anzeige wird gespiegelt, Heim-Torwart steht dann rechts', () => {
    const ps = shared;
    const tl = ps.timeline;
    const before = ps.frameAt(tl.halfTimeTau - 0.2);
    const after = ps.frameAt(tl.h2StartTau + 0.1);
    expect(before.flipped).toBe(false);
    expect(after.flipped).toBe(true);
    const gk = (f: Frame, side: TeamSide) => f.players.find((p) => p.side === side && p.isGK && !p.leaving)!;
    expect(gk(ps.frameAt(30), 'home').x).toBeLessThan(30);
    expect(gk(after, 'home').x).toBeGreaterThan(75);
    expect(gk(after, 'away').x).toBeLessThan(30);
    // Ball zum Anstoß der 2. HZ in Anzeige-Koordinaten gespiegelt
    const ko = tl.ballEvents.find((te) => te.ev.half === 2)!;
    const fb = ps.frameAt(ko.start);
    expect(fb.ball.x).toBeCloseTo(105 - ko.ev.from.x, 5);
    expect(fb.ball.y).toBeCloseTo(68 - ko.ev.from.y, 5);
  });

  it('Höchsttempo bleibt glaubwürdig (Spieler am Ball ausgenommen)', () => {
    const ps = shared;
    const end = ps.timeline.endTau;
    let prev = ps.frameAt(0);
    let fast = 0;
    let samples = 0;
    for (let t = 0.1; t < end; t += 0.1) {
      const f = ps.frameAt(t);
      if (f.flipped === prev.flipped) {
        for (const p of f.players) {
          const q = prev.players.find((o) => o.idx === p.idx);
          if (!q || p.idx === f.holder || q.idx === prev.holder) continue;
          samples++;
          if (Math.hypot(p.x - q.x, p.y - q.y) / 0.1 > 10.5) fast++;
        }
      }
      prev = f;
    }
    expect(fast / samples).toBeLessThan(0.002);
  });

  it('Highlight-Fenster beginnen vor dem Ereignis und überlappen nicht', () => {
    const ps = shared;
    const ws = highlightWindows(ps.timeline);
    for (let i = 0; i < ws.length; i++) {
      expect(ws[i]!.from).toBeLessThanOrEqual(ws[i]!.tau);
      if (i > 0) expect(ws[i]!.from).toBeGreaterThan(ws[i - 1]!.to);
    }
  });
});

describe('Wechsel und Platzverweis (synthetisch)', () => {
  const result = syntheticMatch();
  const ps = new PositionSynth(result);
  const tl = ps.timeline;

  it('eingewechselter Spieler kommt aufs Feld, ausgewechselter verlässt es', () => {
    const sub = tl.events.find((te) => te.ev.type === 'substitution')!;
    const f = ps.frameAt(sub.start + 40);
    const ids = f.players.filter((p) => !p.leaving).map((p) => p.id);
    expect(ids).toContain(sub.ev.otherPlayerId);
    expect(ids).not.toContain(sub.ev.playerId);
    const on = f.players.find((p) => p.id === sub.ev.otherPlayerId)!;
    expect(on.y).toBeLessThan(68);
  });

  it('nach Roter Karte spielt das Team mit zehn', () => {
    const red = tl.events.find((te) => te.ev.type === 'red-card')!;
    const f = ps.frameAt(red.start + 60);
    expect(f.players.filter((p) => p.side === 'away' && !p.leaving).length).toBe(10);
    expect(f.players.some((p) => p.id === red.ev.playerId && !p.leaving)).toBe(false);
  });

  it('Anstoßformation: vor dem Anpfiff stehen alle in der eigenen Hälfte', () => {
    const f = ps.frameAt(0);
    for (const p of f.players) {
      if (p.side === 'home') expect(p.x).toBeLessThanOrEqual(52.6);
      else expect(p.x).toBeGreaterThanOrEqual(52.4);
    }
  });
});
