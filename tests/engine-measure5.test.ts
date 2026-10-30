import { test } from 'vitest';
import { simulateMatch } from '../src/engine';
import { ratingDebug } from '../src/engine/postmatch';
import { pressTeam, sweeperTeam } from './fixtures/teams';
test('ratings', () => {
  ratingDebug.sink = [];
  for (let i = 0; i < 200; i++) { simulateMatch(pressTeam(), sweeperTeam(), 50 + i); simulateMatch(sweeperTeam(), pressTeam(), 50 + i); }
  const by: Record<string, number[]> = {};
  for (const x of ratingDebug.sink) if (x.minutes >= 45) (by[x.line] ??= []).push(x.pts);
  for (const k in by) { const a = by[k]!; const m = a.reduce((s,v)=>s+v,0)/a.length; const sd = Math.sqrt(a.reduce((s,v)=>s+(v-m)**2,0)/a.length); console.log('line', k, m.toFixed(3), sd.toFixed(3), a.length); }
  ratingDebug.sink = null;
});
