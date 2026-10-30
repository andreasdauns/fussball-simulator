import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRng, ENGINE_VERSION, isRestartType, simulateMatch, type MatchResult } from '../src/engine';
import { pressTeam, sweeperTeam, weakTeam } from './fixtures/teams';

const home = pressTeam();
const away = sweeperTeam();

function stripVolatile(r: MatchResult): string {
  return JSON.stringify(r);
}

describe('rng', () => {
  it('ist deterministisch und gleichverteilt', () => {
    const a = createRng(42);
    const b = createRng(42);
    const xs = Array.from({ length: 1000 }, () => a.next());
    const ys = Array.from({ length: 1000 }, () => b.next());
    expect(xs).toEqual(ys);
    const mean = xs.reduce((s, v) => s + v, 0) / xs.length;
    expect(mean).toBeGreaterThan(0.45);
    expect(mean).toBeLessThan(0.55);
    expect(xs.every((v) => v >= 0 && v < 1)).toBe(true);
  });

  it('fork liefert unabhängige, reproduzierbare Teil-Ströme', () => {
    const r = createRng(7);
    const f1 = r.fork('a').next();
    const f2 = createRng(7).fork('a').next();
    const g = createRng(7).fork('b').next();
    expect(f1).toBe(f2);
    expect(f1).not.toBe(g);
    // fork verändert den Eltern-Strom nicht
    const p1 = createRng(7);
    p1.fork('x');
    expect(p1.next()).toBe(createRng(7).next());
  });

  it('Hilfsfunktionen bleiben in ihren Grenzen', () => {
    const r = createRng(1);
    for (let i = 0; i < 2000; i++) {
      const k = r.int(2, 5);
      expect(k).toBeGreaterThanOrEqual(2);
      expect(k).toBeLessThanOrEqual(5);
      expect(r.weightedIndex([0, 1, 0])).toBe(1);
    }
    let s = 0;
    let s2 = 0;
    for (let i = 0; i < 20000; i++) {
      const v = r.normal(10, 2);
      s += v;
      s2 += v * v;
    }
    const m = s / 20000;
    const sd = Math.sqrt(s2 / 20000 - m * m);
    expect(m).toBeCloseTo(10, 0);
    expect(sd).toBeGreaterThan(1.8);
    expect(sd).toBeLessThan(2.2);
  });
});

describe('simulateMatch – Determinismus und Konsistenz', () => {
  it('gleicher Seed → identisches Spiel', () => {
    const a = simulateMatch(home, away, 12345);
    const b = simulateMatch(pressTeam(), sweeperTeam(), 12345);
    expect(stripVolatile(a)).toBe(stripVolatile(b));
    expect(a).toEqual(b);
    expect(a.engineVersion).toBe(ENGINE_VERSION);
    expect(a.seed).toBe(12345);
  });

  it('verschiedene Seeds → verschiedene Spiele', () => {
    const a = simulateMatch(home, away, 1);
    const b = simulateMatch(home, away, 2);
    expect(stripVolatile(a)).not.toBe(stripVolatile(b));
  });

  it('verändert die Eingabe-Mannschaften nicht', () => {
    const h = pressTeam();
    const before = JSON.stringify(h);
    simulateMatch(h, weakTeam(), 99);
    expect(JSON.stringify(h)).toBe(before);
  });

  const seeds = [3, 17, 256, 4096, 777777];
  for (const seed of seeds) {
    it(`Ereignisstrom ist lückenlos und konsistent (Seed ${seed})`, () => {
      const r = simulateMatch(home, away, seed);
      const ev = r.events;
      expect(ev.length).toBeGreaterThan(800);
      expect(ev.length).toBeLessThan(1600);
      expect(ev[0]!.type).toBe('kickoff');
      expect(ev[ev.length - 1]!.type).toBe('full-time');
      expect(ev.filter((e) => e.type === 'half-time')).toHaveLength(1);

      let score = { home: 0, away: 0 };
      for (let i = 0; i < ev.length; i++) {
        const e = ev[i]!;
        expect(e.id).toBe(i);
        expect(e.duration).toBeGreaterThanOrEqual(0);
        for (const v of [e.from, e.to]) {
          expect(v.x).toBeGreaterThanOrEqual(0);
          expect(v.x).toBeLessThanOrEqual(105);
          expect(v.y).toBeGreaterThanOrEqual(0);
          expect(v.y).toBeLessThanOrEqual(68);
        }
        if (e.type === 'goal') score = { ...score, [e.team]: score[e.team] + 1 };
        expect(e.score).toEqual(score);
        if (i > 0) {
          const p = ev[i - 1]!;
          // Zeit monoton, Aktionen überlappen nicht
          expect(e.t).toBeGreaterThanOrEqual(p.t);
          expect(e.t + 1e-6).toBeGreaterThanOrEqual(Math.round((p.t + p.duration) * 100) / 100 - 0.011);
          // Ball springt nicht: from = vorheriges to, außer bei Standards
          if (!isRestartType(e.type)) expect(e.from).toEqual(p.to);
          expect(e.half).toBeGreaterThanOrEqual(p.half);
        }
        if (e.type === 'shot' || e.type === 'header') {
          expect(e.xg).toBeGreaterThan(0);
          expect(e.xg).toBeLessThan(1);
        }
      }
      expect(r.score).toEqual(score);
      // Tore aus Statistik und Spielerdaten stimmen überein
      const goalsBy = (side: 'home' | 'away') => r.playerStats.filter((p) => p.team === side).reduce((s, p) => s + p.goals, 0);
      expect(goalsBy('home')).toBe(r.score.home);
      expect(goalsBy('away')).toBe(r.score.away);
      expect(r.stats.home.possession + r.stats.away.possession).toBeCloseTo(100, 0);
      expect(r.stats.home.shotsOnTarget).toBeLessThanOrEqual(r.stats.home.shots);
      expect(r.stats.home.shotsOnTarget).toBeGreaterThanOrEqual(r.score.home);
    });
  }

  it('Spielzeit, Nachspielzeit und Uhr sind plausibel', () => {
    const r = simulateMatch(home, away, 5);
    const ht = r.events.find((e) => e.type === 'half-time')!;
    const ft = r.events[r.events.length - 1]!;
    expect(ht.t).toBeGreaterThanOrEqual(45 * 60);
    expect(ht.t).toBeLessThan(45 * 60 + 5 * 60 + 60);
    expect(ft.t - ht.t).toBeGreaterThanOrEqual(45 * 60);
    expect(ft.t - ht.t).toBeLessThan(45 * 60 + 6 * 60 + 60);
    expect(ht.clock).toMatch(/^45(\+\d)?$/);
    expect(ft.clock).toMatch(/^90(\+\d)?$/);
    for (const e of r.events) expect(e.clock).toMatch(/^\d{1,2}(\+\d{1,2})?$/);
    expect(r.events.filter((e) => e.half === 2)[0]!.clock).toBe('46');
  });

  it('halfLengthMinutes verkürzt das Spiel', () => {
    const r = simulateMatch(home, away, 8, { halfLengthMinutes: 10 });
    const ft = r.events[r.events.length - 1]!;
    expect(ft.t).toBeGreaterThan(20 * 60);
    expect(ft.t).toBeLessThan(32 * 60);
    expect(r.events.length).toBeLessThan(500);
  });

  it('Ballgeschwindigkeiten sind realistisch', () => {
    const r = simulateMatch(home, away, 21);
    const speeds: Record<string, number[]> = {};
    for (const e of r.events) {
      if (e.duration <= 0) continue;
      const d = Math.hypot(e.to.x - e.from.x, e.to.y - e.from.y);
      (speeds[e.type] ??= []).push(d / e.duration);
    }
    const median = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]!;
    expect(median(speeds.pass!)).toBeGreaterThan(10);
    expect(median(speeds.pass!)).toBeLessThan(25);
    expect(median(speeds.carry!)).toBeGreaterThan(4);
    expect(median(speeds.carry!)).toBeLessThan(9);
    for (const v of speeds.pass!) expect(v).toBeLessThan(32);
  });

  it('Ticker-Texte, Wechsel und Spielerstatistiken', () => {
    const r = simulateMatch(home, away, 31);
    const goals = r.events.filter((e) => e.type === 'goal');
    for (const g of goals) expect(g.text).toMatch(/^TOR für /);
    const subs = r.events.filter((e) => e.type === 'substitution');
    expect(subs.length).toBeGreaterThan(0);
    for (const s of subs) {
      expect(s.text).toMatch(/^Wechsel bei /);
      expect(s.otherPlayerId).toBeDefined();
    }
    expect(subs.filter((s) => s.team === 'home').length).toBeLessThanOrEqual(home.coach.maxSubs);
    expect(subs.filter((s) => s.team === 'away').length).toBeLessThanOrEqual(away.coach.maxSubs);
    const benchIds = new Set([...home.bench, ...away.bench].map((p) => p.id));
    for (const s of subs) expect(benchIds.has(s.otherPlayerId!)).toBe(true);
    for (const c of r.events.filter((e) => e.type === 'yellow-card' || e.type === 'red-card')) expect(c.text).toMatch(/Karte für/);
    expect(r.events.find((e) => e.type === 'half-time')!.text).toMatch(/^Halbzeit/);
    for (const p of r.playerStats) {
      expect(p.rating).toBeGreaterThanOrEqual(1);
      expect(p.rating).toBeLessThanOrEqual(6);
      expect(p.passesCompleted).toBeLessThanOrEqual(p.passes);
      expect(p.minutes).toBeGreaterThanOrEqual(0);
      expect(p.minutes).toBeLessThanOrEqual(90);
    }
    // 11 Starter pro Team + eingewechselte
    expect(r.playerStats.filter((p) => p.team === 'home')).toHaveLength(11 + subs.filter((s) => s.team === 'home').length);
    expect(r.momentum.length).toBeGreaterThanOrEqual(90);
    for (const m of r.momentum) {
      expect(m).toBeGreaterThanOrEqual(-1);
      expect(m).toBeLessThanOrEqual(1);
    }
  });

  it('ist schnell genug (< 150 ms pro Spiel)', () => {
    simulateMatch(home, away, 0); // Aufwärmen
    const t0 = performance.now();
    const n = 10;
    for (let i = 0; i < n; i++) simulateMatch(home, away, 100 + i);
    expect((performance.now() - t0) / n).toBeLessThan(150);
  });
});

describe('Regeln für den Engine-Quelltext', () => {
  it('nutzt keine nicht-deterministischen oder plattformabhängigen Funktionen', () => {
    const dir = join(__dirname, '..', 'src', 'engine');
    const forbidden = /Math\.(random|exp|pow|log|log2|log10|sin|cos|tan|atan|atan2|sinh|cosh|tanh|cbrt|hypot|expm1|log1p)\b|Date\.|new Date|performance\.now|\*\*/;
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.ts'))) {
      const src = readFileSync(join(dir, f), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//'))
        .join('\n');
      expect(src, f).not.toMatch(forbidden);
    }
  });
});
