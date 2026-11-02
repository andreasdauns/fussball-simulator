import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  floodlightMasts,
  goalFrame,
  goalNetSegments,
  HALF_L,
  HALF_W,
  mowingStripes,
  PITCH_DIMS,
  pitchLineTriangles,
} from '../src/viewer3d/geometry';
import { buildStadium, countDrawCalls } from '../src/viewer3d/stadium';
import { simulateMatch } from '../src/engine';
import { DEMO_RED, DEMO_WHITE } from '../src/viewer2d/demoTeams';
import { PositionSynth } from '../src/viewer2d/positions';
import { BALL_RADIUS, Figures3D, figureColors, fromWorld, MAX_FIGURES, toWorld } from '../src/viewer3d/figures';
import { resolveKits } from '../src/ui/kits';

describe('3D-Geometrie (F10)', () => {
  it('Linien liegen innerhalb des Feldes und sind symmetrisch', () => {
    const t = pitchLineTriangles();
    expect(t.length % 12).toBe(0); // je Segment 2 Dreiecke à 3 Ecken (x, z)
    let maxX = 0;
    let maxZ = 0;
    let sumX = 0;
    let sumZ = 0;
    for (let i = 0; i < t.length; i += 2) {
      maxX = Math.max(maxX, Math.abs(t[i]!));
      maxZ = Math.max(maxZ, Math.abs(t[i + 1]!));
      sumX += t[i]!;
      sumZ += t[i + 1]!;
    }
    // Außenkante der Linien = Feldmaß (Linien gehören zum Feld)
    expect(maxX).toBeCloseTo(HALF_L, 3);
    expect(maxZ).toBeCloseTo(HALF_W, 3);
    const n = t.length / 2;
    expect(Math.abs(sumX / n)).toBeLessThan(0.01);
    expect(Math.abs(sumZ / n)).toBeLessThan(0.01);
  });

  it('enthält Mittelkreis mit 9,15 m und Teilkreise vor den Strafräumen', () => {
    const t = pitchLineTriangles();
    let onCircle = 0;
    let onArcRight = 0;
    let arcInsideBox = 0;
    const spotX = HALF_L - PITCH_DIMS.penaltySpot;
    const boxEdge = HALF_L - PITCH_DIMS.penaltyAreaDepth;
    for (let i = 0; i < t.length; i += 2) {
      const x = t[i]!;
      const z = t[i + 1]!;
      if (Math.abs(Math.hypot(x, z) - PITCH_DIMS.centreCircle) < 0.07) onCircle++;
      const d = Math.hypot(x - spotX, z);
      if (Math.abs(d - PITCH_DIMS.centreCircle) < 0.07 && Math.abs(z) < 7.5) {
        onArcRight++;
        if (x > boxEdge + 0.1) arcInsideBox++;
      }
    }
    expect(onCircle).toBeGreaterThan(100);
    expect(onArcRight).toBeGreaterThan(30);
    expect(arcInsideBox).toBe(0); // Teilkreis nur außerhalb des Strafraums
  });

  it('Eckviertelkreise zeigen ins Feld', () => {
    const t = pitchLineTriangles();
    for (let i = 0; i < t.length; i += 2) {
      const x = Math.abs(t[i]!);
      const z = Math.abs(t[i + 1]!);
      // nichts darf außerhalb der Feldbegrenzung liegen (Ecken eingeschlossen)
      expect(x).toBeLessThanOrEqual(HALF_L + 1e-4);
      expect(z).toBeLessThanOrEqual(HALF_W + 1e-4);
    }
  });

  it('Mähstreifen decken die Feldlänge lückenlos ab und wechseln sich ab', () => {
    const s = mowingStripes(18);
    const inner = s.filter((x) => x.x0 >= -HALF_L - 1e-6 && x.x1 <= HALF_L + 1e-6);
    expect(inner).toHaveLength(18);
    expect(inner[0]!.x0).toBeCloseTo(-HALF_L, 6);
    expect(inner[17]!.x1).toBeCloseTo(HALF_L, 6);
    for (let i = 1; i < inner.length; i++) {
      expect(inner[i]!.x0).toBeCloseTo(inner[i - 1]!.x1, 6);
      expect(inner[i]!.dark).not.toBe(inner[i - 1]!.dark);
    }
  });

  it('Tore haben Regelmaß 7,32 × 2,44 m und Netz hinter der Linie', () => {
    for (const side of [-1, 1] as const) {
      const f = goalFrame(side);
      const posts = f.filter((p) => p.axis === 'y');
      expect(posts).toHaveLength(2);
      const inner = Math.abs(posts[0]!.z - posts[1]!.z) - 2 * PITCH_DIMS.postRadius;
      expect(inner).toBeCloseTo(PITCH_DIMS.goalWidth, 6);
      expect(posts[0]!.len).toBeCloseTo(PITCH_DIMS.goalHeight, 6);
      const net = goalNetSegments(side, 0.3);
      for (let i = 0; i < net.length; i += 3) {
        expect(net[i]! * side).toBeGreaterThanOrEqual(HALF_L - 1e-6);
        expect(net[i + 1]!).toBeLessThanOrEqual(PITCH_DIMS.goalHeight + 1e-6);
      }
    }
  });

  it('Flutlichtmasten stehen außerhalb des Spielfelds', () => {
    const m = floodlightMasts(26);
    expect(m).toHaveLength(4);
    for (const p of m) {
      expect(Math.abs(p.x)).toBeGreaterThan(HALF_L + 10);
      expect(Math.abs(p.z)).toBeGreaterThan(HALF_W + 10);
    }
  });
});

describe('Stadion-Szene (F10)', () => {
  for (const q of ['high', 'low'] as const) {
    it(`baut sich in Qualität „${q}“ mit wenigen Draw Calls`, () => {
      const s = buildStadium(q);
      const calls = countDrawCalls(s.group);
      expect(calls).toBeGreaterThanOrEqual(10);
      expect(calls).toBeLessThanOrEqual(20);
      expect(s.lights.length).toBeGreaterThanOrEqual(2);
      const shadowLights = s.lights.filter((l) => l.castShadow);
      expect(shadowLights.length).toBe(q === 'high' ? 1 : 0);
      s.dispose();
    });
  }

  it('Tribünen umschließen das Feld, Rasen bleibt frei', () => {
    const s = buildStadium('low');
    const stands = s.group.getObjectByName('stands') as THREE.Mesh;
    stands.geometry.computeBoundingBox();
    const bb = stands.geometry.boundingBox!;
    expect(bb.max.x).toBeGreaterThan(HALF_L + 20);
    expect(bb.min.x).toBeLessThan(-HALF_L - 20);
    expect(bb.max.z).toBeGreaterThan(HALF_W + 20);
    expect(bb.min.z).toBeLessThan(-HALF_W - 20);
    // Kein Tribünenpunkt auf dem Spielfeld
    const pos = stands.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      const onPitch = Math.abs(pos.getX(i)) < HALF_L + 2 && Math.abs(pos.getZ(i)) < HALF_W + 2;
      expect(onPitch).toBe(false);
    }
    // Tribünen steigen nach außen an (Haupttribüne +Z: hinten höher als vorn)
    let frontMax = 0;
    let backMax = 0;
    for (let i = 0; i < pos.count; i++) {
      const z = pos.getZ(i);
      if (Math.abs(pos.getX(i)) > HALF_L + 20) continue; // nur Haupttribüne
      if (z > HALF_W && z < HALF_W + 12) frontMax = Math.max(frontMax, pos.getY(i));
      if (z > HALF_W + 30) backMax = Math.max(backMax, pos.getY(i));
    }
    expect(backMax).toBeGreaterThan(frontMax + 5);
    s.dispose();
  });
});

// ─────────────────────────── F11: Figuren und Ball ───────────────────────────
describe('3D-Figuren und Ball (F11)', () => {
  const result = simulateMatch(DEMO_RED, DEMO_WHITE, 7);
  const synth = new PositionSynth(result);
  const k = resolveKits(result.home, result.away);
  const kits = { home: k.home, away: k.away };
  const end = synth.timeline.endTau;
  const times = [0, 31.4, end * 0.2, end * 0.5 + 3, end * 0.75, end - 2];

  it('Umrechnung Feld ↔ Welt ist exakt umkehrbar, Anstoßpunkt = Ursprung', () => {
    const c = toWorld(52.5, 34, 0);
    expect(c.X).toBe(0);
    expect(c.Z).toBe(0);
    const w = toWorld(10, 60, 3);
    expect(w.Y).toBe(3);
    const back = fromWorld(w.X, w.Z);
    expect(back.x).toBeCloseTo(10, 10);
    expect(back.y).toBeCloseTo(60, 10);
  });

  it.each(['high', 'low'] as const)('zeigt Spieler exakt an den 2D-Positionen (%s)', (q) => {
    const f = new Figures3D(q);
    for (const t of times) {
      const frame = synth.frameAt(t);
      f.update(frame, kits);
      expect(f.shownCount()).toBe(Math.min(frame.players.length, MAX_FIGURES));
      expect(f.shownCount()).toBeGreaterThanOrEqual(20);
      frame.players.forEach((p, i) => {
        const pos = f.instancePosition(i);
        const back = fromWorld(pos.x, pos.z);
        expect(back.x).toBeCloseTo(p.x, 5);
        expect(back.y).toBeCloseTo(p.y, 5);
        expect(pos.y).toBe(0);
      });
    }
    f.dispose();
  });

  it('Ball folgt Position und Flughöhe aus der Positions-Synthese', () => {
    const f = new Figures3D('low');
    let maxZ = 0;
    // ganzes Spiel in 2-s-Schritten: Ball nie im Boden, Höhe = z + Radius
    for (let t = 0; t < end; t += 2) {
      const frame = synth.frameAt(t);
      f.update(frame, kits);
      const back = fromWorld(f.ball.position.x, f.ball.position.z);
      expect(back.x).toBeCloseTo(frame.ball.x, 5);
      expect(back.y).toBeCloseTo(frame.ball.y, 5);
      expect(f.ball.position.y).toBeCloseTo(frame.ball.z + BALL_RADIUS, 5);
      maxZ = Math.max(maxZ, frame.ball.z);
    }
    expect(maxZ).toBeGreaterThan(2); // hohe Bälle kommen vor und fliegen sichtbar
    f.dispose();
  });

  it('färbt Trikots nach Mannschaft, Torhüter in Torwartfarbe', () => {
    const f = new Figures3D('high');
    const frame = synth.frameAt(end * 0.3);
    f.update(frame, kits);
    frame.players.forEach((p, i) => {
      const kit = p.side === 'home' ? kits.home : kits.away;
      const want = figureColors(kit, p.isGK).shirt.toLowerCase();
      expect(f.instanceShirt(i)).toBe(new THREE.Color(want)
        .getHexString()
        .padStart(7, '#'));
    });
    f.dispose();
  });

  it('bleibt bei wenigen Draw Calls (Szene mit Figuren ≤ 22)', () => {
    for (const q of ['high', 'low'] as const) {
      const scene = new THREE.Scene();
      const s = buildStadium(q);
      const f = new Figures3D(q);
      f.update(synth.frameAt(100), kits);
      scene.add(s.group, f.group);
      expect(countDrawCalls(scene)).toBeLessThanOrEqual(22);
      s.dispose();
      f.dispose();
    }
  });
});
