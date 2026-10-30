import { test } from 'vitest';
import { simulateMatch } from '../src/engine';
import { pressTeam, sweeperTeam } from './fixtures/teams';
test('goalsrc', () => {
  for (const [lab, h, a] of [['sw', sweeperTeam({era:2020}), sweeperTeam({id:'s2',era:2020})], ['pr', pressTeam(), pressTeam({id:'p2'})]] as const) {
    const src: Record<string, number> = {}; const shots: Record<string, number> = {}; const N = 200;
    for (let i = 0; i < N; i++) {
      const r = simulateMatch(h, a, 3000 + i);
      for (let j = 1; j < r.events.length; j++) {
        const e = r.events[j]!;
        if (e.type === 'shot' || e.type === 'header') {
          let k = j - 1; while (k > 0 && ['save','block'].includes(r.events[k]!.type)) k--;
          const key = e.type + '<' + r.events[k]!.type;
          shots[key] = (shots[key] ?? 0) + 1;
          if (r.events[j+1]?.type === 'goal') src[key] = (src[key] ?? 0) + 1;
        }
      }
    }
    console.log(lab, Object.entries(shots).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`${k}:${(v/N).toFixed(2)}/${((src[k]??0)/N).toFixed(2)}`).join(' '));
  }
});
