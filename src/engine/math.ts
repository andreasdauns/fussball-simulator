/**
 * Deterministische Mathe-Helfer. Nur Grundrechenarten und Math.sqrt (IEEE-exakt),
 * damit Ergebnisse auf allen Plattformen bitgleich sind. Kein Math.exp/pow/log/sin/cos.
 */

import type { Vec2 } from './types';

export const PITCH_LENGTH = 105;
export const PITCH_WIDTH = 68;
export const GOAL_Y_MIN = 34 - 3.66;
export const GOAL_Y_MAX = 34 + 3.66;

const LN2 = 0.6931471805599453;

/** e^x über Bereichsreduktion + Taylorreihe, nur +,-,*,/ */
export function expDet(x: number): number {
  if (x > 40) x = 40;
  if (x < -40) x = -40;
  const k = Math.round(x / LN2);
  const r = x - k * LN2; // |r| <= ~0.35
  // Taylor bis r^11
  let term = 1;
  let sum = 1;
  for (let i = 1; i <= 11; i++) {
    term = (term * r) / i;
    sum += term;
  }
  let scale = 1;
  if (k > 0) for (let i = 0; i < k; i++) scale *= 2;
  else for (let i = 0; i < -k; i++) scale *= 0.5;
  return sum * scale;
}

/** Logistische Funktion 1 / (1 + e^-x) */
export function logistic(x: number): number {
  return 1 / (1 + expDet(-x));
}

/** Umkehrung der logistischen Funktion – per Bisektion (nur für Konstanten nötig) */
export function logit(p: number): number {
  const q = clamp(p, 1e-6, 1 - 1e-6);
  let lo = -20;
  let hi = 20;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (logistic(mid) < q) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Weiche Sättigung auf (-1, 1) */
export function softsign(x: number): number {
  return x / (1 + Math.abs(x));
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function lerpVec(a: Vec2, b: Vec2, t: number): Vec2 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

export function dist(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Auf zwei Nachkommastellen runden (für saubere Ausgabe) */
export function r2(v: number): number {
  return Math.round(v * 100) / 100;
}

export function clampToPitch(v: Vec2, margin = 0.5): Vec2 {
  return {
    x: clamp(v.x, margin, PITCH_LENGTH - margin),
    y: clamp(v.y, margin, PITCH_WIDTH - margin),
  };
}

/**
 * Sichtwinkel aufs Tor (Bogenmaß, Näherung ohne atan): Torbreite · Abstand zur Linie / Distanz².
 * `p` im Team-Koordinatensystem (Angriff Richtung x = 105).
 */
export function goalAngle(p: Vec2): number {
  const dx = Math.max(0.5, PITCH_LENGTH - p.x);
  const dy = p.y - 34;
  const d2 = dx * dx + dy * dy;
  return Math.min(1.2, (7.32 * dx) / d2);
}

export function distToGoal(p: Vec2): number {
  const dx = PITCH_LENGTH - p.x;
  const dy = p.y - 34;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Liegt der Punkt (Team-Koordinaten) im gegnerischen Strafraum? */
export function inBox(p: Vec2): boolean {
  return p.x > PITCH_LENGTH - 16.5 && p.y > 34 - 20.16 && p.y < 34 + 20.16;
}
