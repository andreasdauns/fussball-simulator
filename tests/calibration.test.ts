/**
 * Kalibrierung: Viele simulierte Spiele müssen in realistischen Korridoren liegen.
 * Gemessene Werte werden ausgegeben (`npm run calibrate`), damit PROGRESS.md aktuell bleibt.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { simulateMatch, type MatchResult, type TeamSheet } from '../src/engine';
import { pressTeam, sweeperTeam, weakTeam } from './fixtures/teams';

const N_EQUAL = 500;
const N_STRONG = 300; // pro Heim-/Auswärts-Ansetzung
const N_STYLE = 200;

function run(h: TeamSheet, a: TeamSheet, n: number, seedBase: number): MatchResult[] {
  const out: MatchResult[] = [];
  for (let i = 0; i < n; i++) out.push(simulateMatch(h, a, seedBase + i));
  return out;
}

const avg = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / xs.length;

/** Ballgewinne (Tackling/Abfangen) im vorderen Drittel des Gegners */
function highTurnovers(r: MatchResult, side: 'home' | 'away'): number {
  return r.events.filter((e) => (e.type === 'tackle' || e.type === 'interception') && e.team === side && (side === 'home' ? e.from.x > 70 : e.from.x < 35)).length;
}

describe('Kalibrierung – gleich starke Mannschaften (Epoche 2020)', () => {
  let rs: MatchResult[] = [];
  beforeAll(() => {
    rs = run(pressTeam(), pressTeam({ id: 'test-press-b' }), N_EQUAL, 10_000);
  });

  it('liegt in allen Zielkorridoren', () => {
    const per = (f: (r: MatchResult) => number) => avg(rs.map(f));
    const m = {
      goals: per((r) => r.score.home + r.score.away),
      shotsHome: per((r) => r.stats.home.shots),
      shotsAway: per((r) => r.stats.away.shots),
      sotHome: per((r) => r.stats.home.shotsOnTarget),
      sotAway: per((r) => r.stats.away.shotsOnTarget),
      cornersHome: per((r) => r.stats.home.corners),
      cornersAway: per((r) => r.stats.away.corners),
      yellow: per((r) => r.stats.home.yellow + r.stats.away.yellow),
      red: per((r) => r.stats.home.red + r.stats.away.red),
      foulsPerTeam: per((r) => (r.stats.home.fouls + r.stats.away.fouls) / 2),
      offsidesPerTeam: per((r) => (r.stats.home.offsides + r.stats.away.offsides) / 2),
      passesHome: per((r) => r.stats.home.passes),
      passesAway: per((r) => r.stats.away.passes),
      accHome: per((r) => r.stats.home.passAccuracy),
      accAway: per((r) => r.stats.away.passAccuracy),
      possHome: per((r) => r.stats.home.possession),
      xgPerTeam: per((r) => (r.stats.home.xg + r.stats.away.xg) / 2),
      events: per((r) => r.events.length),
      homeWin: rs.filter((r) => r.score.home > r.score.away).length / rs.length,
      draw: rs.filter((r) => r.score.home === r.score.away).length / rs.length,
    };
    console.log('[Kalibrierung gleich stark]', JSON.stringify(Object.fromEntries(Object.entries(m).map(([k, v]) => [k, Math.round(v * 100) / 100]))));

    expect(m.goals).toBeGreaterThanOrEqual(2.3);
    expect(m.goals).toBeLessThanOrEqual(3.3);
    for (const v of [m.shotsHome, m.shotsAway]) {
      expect(v).toBeGreaterThanOrEqual(9);
      expect(v).toBeLessThanOrEqual(17);
    }
    for (const v of [m.sotHome, m.sotAway]) {
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(7);
    }
    for (const v of [m.cornersHome, m.cornersAway]) {
      expect(v).toBeGreaterThanOrEqual(3.5);
      expect(v).toBeLessThanOrEqual(7);
    }
    expect(m.yellow).toBeGreaterThanOrEqual(2);
    expect(m.yellow).toBeLessThanOrEqual(6);
    for (const v of [m.passesHome, m.passesAway]) {
      expect(v).toBeGreaterThanOrEqual(300);
      expect(v).toBeLessThanOrEqual(650);
    }
    for (const v of [m.accHome, m.accAway]) {
      expect(v).toBeGreaterThanOrEqual(70);
      expect(v).toBeLessThanOrEqual(90);
    }
    expect(m.possHome).toBeGreaterThanOrEqual(40);
    expect(m.possHome).toBeLessThanOrEqual(60);
    expect(m.events).toBeGreaterThanOrEqual(800);
    expect(m.events).toBeLessThanOrEqual(1400);
    // Heimvorteil: leicht, aber nicht dominant
    expect(m.homeWin).toBeGreaterThan(0.3);
    expect(m.homeWin).toBeLessThan(0.55);
    expect(m.draw).toBeGreaterThan(0.15);
  });
});

describe('Kalibrierung – Favorit gegen Außenseiter', () => {
  it('der stärkere Verein gewinnt 65–85 %, aber nie alles', () => {
    const strongHome = run(pressTeam(), weakTeam(), N_STRONG, 20_000);
    const strongAway = run(weakTeam(), pressTeam(), N_STRONG, 30_000);
    const wins = strongHome.filter((r) => r.score.home > r.score.away).length + strongAway.filter((r) => r.score.away > r.score.home).length;
    const losses = strongHome.filter((r) => r.score.home < r.score.away).length + strongAway.filter((r) => r.score.away < r.score.home).length;
    const rate = wins / (2 * N_STRONG);
    console.log('[Kalibrierung Favorit]', JSON.stringify({ winRate: Math.round(rate * 1000) / 10, lossRate: Math.round((losses / (2 * N_STRONG)) * 1000) / 10 }));
    expect(rate).toBeGreaterThanOrEqual(0.65);
    expect(rate).toBeLessThanOrEqual(0.85);
    expect(rate).toBeLessThan(1);
    expect(losses).toBeGreaterThan(0);
  });
});

describe('Kalibrierung – taktisches Verhalten', () => {
  let rs: MatchResult[] = [];
  let rev: MatchResult[] = [];
  beforeAll(() => {
    // Gleiche Epoche, damit nur die Taktik den Unterschied macht
    rs = run(pressTeam(), sweeperTeam({ era: 2020 }), N_STYLE, 40_000);
    rev = run(sweeperTeam({ era: 2020 }), pressTeam(), N_STYLE, 50_000);
  });

  const both = (fPress: (r: MatchResult, side: 'home' | 'away') => number) =>
    avg([...rs.map((r) => fPress(r, 'home')), ...rev.map((r) => fPress(r, 'away'))]);
  const bothOpp = (f: (r: MatchResult, side: 'home' | 'away') => number) =>
    avg([...rs.map((r) => f(r, 'away')), ...rev.map((r) => f(r, 'home'))]);

  it('Pressing-Team erobert den Ball öfter hoch', () => {
    const press = both(highTurnovers);
    const low = bothOpp(highTurnovers);
    console.log('[Taktik] hohe Ballgewinne Pressing/Libero', press.toFixed(2), low.toFixed(2));
    expect(press).toBeGreaterThan(low * 1.4);
  });

  it('hohe Linie lässt mehr Bälle in die Tiefe zu, Abseitsfalle greift öfter', () => {
    const behind = (r: MatchResult, side: 'home' | 'away') =>
      r.events.filter((e) => e.type === 'long-ball' && e.success && e.team === side && (side === 'home' ? e.to.x > 80 : e.to.x < 25)).length;
    const vsPress = bothOpp(behind); // Libero-Team spielt gegen hohe Linie
    const vsLow = both(behind); // Pressing-Team spielt gegen tiefe Linie
    const offs = (r: MatchResult, side: 'home' | 'away') => r.stats[side].offsides;
    console.log('[Taktik] erfolgreiche Steilbälle gegen Pressing/Libero', vsPress.toFixed(2), vsLow.toFixed(2), 'Abseits', bothOpp(offs).toFixed(2), both(offs).toFixed(2));
    expect(vsPress).toBeGreaterThan(vsLow);
    expect(bothOpp(offs)).toBeGreaterThan(both(offs));
  });

  it('Manndeckung führt zu mehr Fouls und Dribbel-Duellen', () => {
    const fouls = (r: MatchResult, side: 'home' | 'away') => r.stats[side].fouls;
    const dribblesAgainst = (r: MatchResult, side: 'home' | 'away') => r.events.filter((e) => e.type === 'dribble' && e.team !== side).length;
    console.log('[Taktik] Fouls Libero/Pressing', bothOpp(fouls).toFixed(2), both(fouls).toFixed(2), 'Dribblings gegen', bothOpp(dribblesAgainst).toFixed(2), both(dribblesAgainst).toFixed(2));
    expect(bothOpp(fouls)).toBeGreaterThan(both(fouls));
    expect(bothOpp(dribblesAgainst)).toBeGreaterThan(both(dribblesAgainst));
  });

  it('3-5-2 mit Schienenspielern flankt mehr, Ballbesitz-Team passt mehr', () => {
    const crosses = (r: MatchResult, side: 'home' | 'away') => r.events.filter((e) => e.type === 'cross' && e.team === side).length;
    const passes = (r: MatchResult, side: 'home' | 'away') => r.stats[side].passes;
    const crossShare = (r: MatchResult, side: 'home' | 'away') => crosses(r, side) / Math.max(1, passes(r, side));
    console.log('[Taktik] Flanken Libero/Pressing', bothOpp(crosses).toFixed(2), both(crosses).toFixed(2), 'Pässe', bothOpp(passes).toFixed(0), both(passes).toFixed(0));
    expect(bothOpp(crossShare)).toBeGreaterThan(both(crossShare) * 1.3);
    expect(both(passes)).toBeGreaterThan(bothOpp(passes));
  });
});
