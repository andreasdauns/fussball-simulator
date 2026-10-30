/**
 * Deterministischer Zufallszahlengenerator (mulberry32) mit benannten Teil-Strömen.
 *
 * Regel: In der Engine ausschließlich diesen Generator verwenden, nie Math.random.
 * `fork(label)` leitet aus dem Start-Seed und einem Namen einen unabhängigen Strom ab,
 * damit neue Funktionen (z. B. Noten, Ticker) nicht alle übrigen Zufallszahlen verschieben.
 */

export interface Rng {
  readonly seed: number;
  /** Gleichverteilt in [0, 1) */
  next(): number;
  /** Gleichverteilt in [min, max) */
  range(min: number, max: number): number;
  /** Ganze Zahl in [min, max] (beide inklusive) */
  int(min: number, max: number): number;
  /** true mit Wahrscheinlichkeit p */
  chance(p: number): boolean;
  pick<T>(items: readonly T[]): T;
  /** Index nach Gewichten (Gewichte ≥ 0; alle 0 → gleichverteilt) */
  weightedIndex(weights: readonly number[]): number;
  weightedPick<T>(items: readonly T[], weights: readonly number[]): T;
  /** Näherungsweise normalverteilt (Summe von 4 Gleichverteilungen, ohne log/cos) */
  normal(mean?: number, sd?: number): number;
  /** Unabhängiger, deterministisch abgeleiteter Teil-Strom */
  fork(label: string): Rng;
}

/** FNV-1a 32-Bit-Hash eines Strings */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** murmur3 fmix32 – mischt Bits gut durch */
function fmix32(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

function toUint32(seed: number): number {
  if (Number.isInteger(seed) && Math.abs(seed) < 2 ** 53) {
    const m = seed % 4294967296;
    return (m < 0 ? m + 4294967296 : m) >>> 0;
  }
  return hashString(String(seed));
}

const SQRT3 = Math.sqrt(3);

export function createRng(seed: number): Rng {
  const base = toUint32(seed);
  let state = fmix32(base ^ 0x9e3779b9);

  const next = (): number => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const weightedIndex = (weights: readonly number[]): number => {
    let total = 0;
    for (const w of weights) total += w > 0 ? w : 0;
    if (!(total > 0)) return Math.floor(next() * weights.length);
    let r = next() * total;
    for (let i = 0; i < weights.length; i++) {
      const w = weights[i]!;
      if (w <= 0) continue;
      r -= w;
      if (r < 0) return i;
    }
    // Rundungsrest: letztes positives Gewicht
    for (let i = weights.length - 1; i >= 0; i--) if (weights[i]! > 0) return i;
    return weights.length - 1;
  };

  const rng: Rng = {
    seed: base,
    next,
    range: (min, max) => min + (max - min) * next(),
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    chance: (p) => next() < p,
    pick: (items) => items[Math.floor(next() * items.length)]!,
    weightedIndex,
    weightedPick: (items, weights) => items[weightedIndex(weights)]!,
    normal: (mean = 0, sd = 1) => {
      const s = next() + next() + next() + next() - 2; // Varianz 1/3
      return mean + sd * s * SQRT3;
    },
    fork: (label) => createRng(fmix32(base ^ hashString(label)) ^ 0x5bd1e995),
  };
  return rng;
}
