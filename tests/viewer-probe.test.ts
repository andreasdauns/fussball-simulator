import { test } from 'vitest';
import { simulateMatch } from '../src/engine';
import { DEMO_RED, DEMO_WHITE } from '../src/viewer2d/demoTeams';
import { PositionSynth } from '../src/viewer2d/positions';
test('probe', () => {
  const r = simulateMatch(DEMO_RED, DEMO_WHITE, 42);
  const ps = new PositionSynth(r);
  for (const te of ps.timeline.events) if (te.ev.type==='substitution' || te.ev.type==='half-time' || (te.start>2895&&te.start<2910)) console.log(te.start.toFixed(1), te.ev.type, te.ev.half, te.ev.t, te.ev.playerId, te.ev.otherPlayerId);
  console.log(ps.timeline.halfTimeTau, ps.timeline.h2StartTau, ps.timeline.h2Offset);
  const f = ps.frameAt(2904);
  console.log(f.players.map(p => p.id + (p.leaving?'L':'')).join(' '));
});
