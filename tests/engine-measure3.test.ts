import { test } from 'vitest';
import { simulateMatch } from '../src/engine';
import { pressTeam } from './fixtures/teams';
test('shots', () => {
  const N = 100; let n=0, d=0, xg=0; const bins: number[] = new Array(8).fill(0);
  let entriesFT = 0, poss = 0;
  for (let i = 0; i < N; i++) {
    const r = simulateMatch(pressTeam(), pressTeam({ id: 'p2' }), 700 + i);
    let prevTeam = '';
    for (const e of r.events) {
      if (e.type==='shot'||e.type==='header') { n++; const gx = e.team==='home'?105:0; const dd=Math.sqrt((e.from.x-gx)**2+(e.from.y-34)**2); d+=dd; xg+=e.xg!; bins[Math.min(7,Math.floor(dd/5))]!++; }
      if (['pass','long-ball','carry','dribble','cross'].includes(e.type)) { if (e.team!==prevTeam) poss++; prevTeam=e.team; }
    }
  }
  console.log('shots/match', (n/N).toFixed(1), 'avgDist', (d/n).toFixed(1), 'xg/shot', (xg/n).toFixed(3), 'bins', bins.map(b=>(b/N).toFixed(1)).join(' '), 'poss/match', (poss/N).toFixed(0));
});
