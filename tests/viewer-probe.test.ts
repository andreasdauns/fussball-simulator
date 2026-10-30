import { test } from 'vitest';
import { simulateMatch } from '../src/engine';
import { DEMO_RED, DEMO_WHITE } from '../src/viewer2d/demoTeams';
test('probe', () => {
  const r = simulateMatch(DEMO_RED, DEMO_WHITE, 42);
  console.log(r.score, r.events.length, r.momentum.length, r.engineVersion);
  const counts: Record<string, number> = {};
  for (const e of r.events) counts[e.type] = (counts[e.type] ?? 0) + 1;
  console.log(counts);
  for (const e of r.events.slice(0, 25)) console.log(JSON.stringify(e));
  const i = r.events.findIndex(e => e.type === 'half-time');
  for (const e of r.events.slice(i - 3, i + 8)) console.log(JSON.stringify(e));
  const g = r.events.findIndex(e => e.type === 'goal');
  for (const e of r.events.slice(Math.max(0,g - 4), g + 4)) console.log(JSON.stringify(e));
  let gaps = 0, jumps = 0;
  for (let k = 1; k < r.events.length; k++) { const a = r.events[k-1]!, b = r.events[k]!; if (b.t < a.t + a.duration - 0.01) gaps++; if (Math.hypot(a.to.x-b.from.x,a.to.y-b.from.y) > 1) jumps++; }
  console.log('overlaps', gaps, 'jumps', jumps);
});
