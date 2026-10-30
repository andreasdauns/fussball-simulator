import { test } from 'vitest';
import { simulateMatch, isRestartType } from '../src/engine';
import { pressTeam, sweeperTeam } from './fixtures/teams';
test('chain', () => {
  let breaks = 0, n = 0; const brk: Record<string, number> = {}; const sp: Record<string, number[]> = {};
  let dead=0, live=0; const N=50;
  for (let i = 0; i < N; i++) {
    const r = simulateMatch(pressTeam(), sweeperTeam(), 900 + i);
    for (let j = 1; j < r.events.length; j++) {
      const e = r.events[j]!, p = r.events[j - 1]!;
      n++;
      if ((e.from.x !== p.to.x || e.from.y !== p.to.y) && !isRestartType(e.type)) { breaks++; const k = p.type + '>' + e.type; brk[k] = (brk[k] ?? 0) + 1; }
      if (e.t < p.t) throw new Error('time');
      if (isRestartType(e.type)) dead += e.t - (p.t + p.duration); else live += e.t - p.t;
      if (e.duration > 0) { const v = Math.hypot(e.to.x - e.from.x, e.to.y - e.from.y) / e.duration; (sp[e.type] ??= []).push(v); }
    }
  }
  console.log('breaks', breaks, n, JSON.stringify(brk));
  console.log('dead/live min', (dead/N/60).toFixed(1), (live/N/60).toFixed(1));
  for (const k in sp) { const a = sp[k]!.sort((x,y)=>x-y); console.log('speed', k, a[Math.floor(a.length*0.05)]!.toFixed(1), a[Math.floor(a.length/2)]!.toFixed(1), a[Math.floor(a.length*0.95)]!.toFixed(1)); }
  const r = simulateMatch(pressTeam(), sweeperTeam(), 1);
  console.log(r.events.filter(e=>e.text).map(e=>`${e.clock} ${e.text}`).join('\n'));
  console.log(JSON.stringify(r.stats), r.momentum.length);
  console.log(r.playerStats.map(p=>`${p.playerId}:${p.minutes}'/${p.rating}/${p.goals}g/${p.passes}p`).join(' '));
});
