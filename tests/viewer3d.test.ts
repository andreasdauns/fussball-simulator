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
