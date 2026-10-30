import { test } from 'vitest';
import { simulateMatch } from '../src/engine';
import { pressTeam, sweeperTeam, weakTeam } from './fixtures/teams';

function agg(h: any, a: any, n: number, label: string) {
  const acc: Record<string, number> = {};
  let hw = 0, d = 0, aw = 0;
  const add = (k: string, v: number) => (acc[k] = (acc[k] ?? 0) + v);
  const t0 = performance.now();
  for (let i = 0; i < n; i++) {
    const r = simulateMatch(h, a, 1000 + i);
    const s = r.stats;
    add('goals', r.score.home + r.score.away);
    add('hgoals', r.score.home); add('agoals', r.score.away);
    add('shotsH', s.home.shots); add('shotsA', s.away.shots);
    add('sotH', s.home.shotsOnTarget); add('sotA', s.away.shotsOnTarget);
    add('xgH', s.home.xg); add('xgA', s.away.xg);
    add('cornH', s.home.corners); add('cornA', s.away.corners);
    add('yellow', s.home.yellow + s.away.yellow); add('red', s.home.red + s.away.red);
    add('foulsH', s.home.fouls); add('foulsA', s.away.fouls);
    add('passH', s.home.passes); add('passA', s.away.passes);
    add('accH', s.home.passAccuracy); add('accA', s.away.passAccuracy);
    add('possH', s.home.possession);
    add('offH', s.home.offsides); add('offA', s.away.offsides);
    add('events', r.events.length); add('evMax', 0); (globalThis as any).evmax = Math.max((globalThis as any).evmax ?? 0, r.events.length); (globalThis as any).evmin = Math.min((globalThis as any).evmin ?? 1e9, r.events.length);
    add('dur', r.events[r.events.length-1]!.t/60);
    const ht = (side: string) => r.events.filter(e => (e.type==='tackle'||e.type==='interception') && e.team===side && (side==='home'? e.to.x>70 : e.to.x<35)).length;
    add('highTOH', ht('home')); add('highTOA', ht('away'));
    add('subsH', r.events.filter(e=>e.type==='substitution'&&e.team==='home').length);
    add('subsA', r.events.filter(e=>e.type==='substitution'&&e.team==='away').length);
    if (r.score.home > r.score.away) hw++; else if (r.score.home === r.score.away) d++; else aw++;
  }
  const ms = (performance.now() - t0) / n;
  const out: string[] = [];
  for (const k in acc) out.push(`${k}=${(acc[k]! / n).toFixed(2)}`);
  console.log('evmin/max', (globalThis as any).evmin, (globalThis as any).evmax); console.log(`${label}: W/D/L ${hw}/${d}/${aw}  ms/match=${ms.toFixed(1)}\n  ${out.join('  ')}`);
}

test('measure', () => {
  const N = Number(process.env.N ?? 300);
  agg(pressTeam(), pressTeam({ id: 'p2' }), N, 'press v press');
  agg(sweeperTeam({era:2020}), sweeperTeam({ id: 's2', era:2020 }), N, 'sw v sw');
  agg(pressTeam(), sweeperTeam({era:2020}), N, 'press v sweeper');
  agg(pressTeam(), weakTeam(), N, 'press v weak');
  agg(weakTeam(), pressTeam(), N, 'weak v press');
});
