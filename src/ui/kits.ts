/**
 * Trikotfarben für die Anzeige. Sind sich Heim- und Gastfarbe zu ähnlich
 * (z. B. Bayern gegen Bayern), spielt der Gast in seinen Zweitfarben.
 */

import type { TeamSheet } from '../engine/types';
import { readableOn } from '../viewer2d/renderer2d';

export type Kit = TeamSheet['colors'];

function rgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [128, 128, 128];
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Grober Farbabstand (gewichtetes RGB, 0–~765) */
export function colorDistance(a: string, b: string): number {
  const [r1, g1, b1] = rgb(a);
  const [r2, g2, b2] = rgb(b);
  const rm = (r1 + r2) / 2;
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;
  return Math.sqrt((2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db);
}

const CLASH = 150;

export function resolveKits(home: TeamSheet, away: TeamSheet): { home: Kit; away: Kit; awayAlternate: boolean } {
  const hk = { ...home.colors };
  let ak = { ...away.colors };
  let alt = false;
  if (colorDistance(hk.primary, ak.primary) < CLASH) {
    const swapped: Kit = {
      primary: ak.secondary,
      secondary: ak.primary,
      numbers: readableOn(ak.secondary) === '#111111' ? ak.primary : '#ffffff',
      gkPrimary: ak.gkPrimary,
    };
    if (colorDistance(hk.primary, swapped.primary) >= CLASH) ak = swapped;
    else ak = { primary: '#f4f4f4', secondary: '#1b1b1b', numbers: '#1b1b1b', gkPrimary: ak.gkPrimary };
    alt = true;
  }
  if (colorDistance(hk.gkPrimary, ak.gkPrimary) < 90) ak.gkPrimary = colorDistance(ak.gkPrimary, '#1e90ff') > 120 ? '#1e90ff' : '#8a2be2';
  return { home: hk, away: ak, awayAlternate: alt };
}
