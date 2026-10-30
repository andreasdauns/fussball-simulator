import { test } from 'vitest';
import { simulateMatch } from '../src/engine';
import { pressTeam } from './fixtures/teams';

test('breakdown', () => {
  const N = 100;
  const types: Record<string, number> = {};
  const succ: Record<string, number> = {};
  const shotPrev: Record<string, number> = {};
  let restartDead = 0; let inPlay = 0;
  let possLen = 0, possN = 0;
  for (let i = 0; i < N; i++) {
    const r = simulateMatch(pressTeam(), pressTeam({ id: 'p2' }), 500 + i);
    let cur = 0;
    for (let j = 0; j < r.events.length; j++) {
      const e = r.events[j]!;
      types[e.type] = (types[e.type] ?? 0) + 1;
      if (e.success) succ[e.type] = (succ[e.type] ?? 0) + 1;
      if (e.type === 'shot' || e.type === 'header') {
        const p = r.events[j - 1]!;
        shotPrev[p.type] = (shotPrev[p.type] ?? 0) + 1;
      }
      if (j > 0) {
        const p = r.events[j - 1]!;
        const gap = e.t - (p.t + p.duration);
        if (['throw-in','goal-kick','corner','free-kick','kickoff','penalty'].includes(e.type)) restartDead += gap; else inPlay += gap + p.duration;
      }
      if (j>0 && r.events[j-1]!.team !== e.team && ['pass','long-ball','carry','dribble','cross'].includes(e.type)) { possLen += cur; possN++; cur = 0; }
      if (['pass','long-ball','cross'].includes(e.type)) cur++;
    }
  }
  const f = (o: Record<string, number>) => Object.entries(o).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`${k}:${(v/N).toFixed(1)}${succ[k]!==undefined && o===types?`(${(100*(succ[k]??0)/v).toFixed(0)}%)`:''}`).join(' ');
  console.log('types', f(types));
  console.log('shotPrev', f(shotPrev));
  console.log('dead min', (restartDead/N/60).toFixed(1), 'inplay min', (inPlay/N/60).toFixed(1), 'passes/poss', (possLen/possN).toFixed(2));
});
