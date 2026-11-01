/**
 * Reine Geometrie für die 3D-Ansicht (ohne Three.js, ohne DOM) – testbar in Node.
 *
 * Koordinaten: Spielfeld-Meter wie in der 2D-Ansicht (x 0…105 längs, y 0…68 quer),
 * Mittelpunkt (52,5 | 34). In Three.js wird daraus X = x − 52,5, Z = y − 34, Y = Höhe.
 * Darstellung darf trigonometrische Funktionen nutzen (Regel 1 gilt nur für die Engine).
 */

import { PITCH_L, PITCH_W } from '../viewer2d/timeline';

export const HALF_L = PITCH_L / 2;
export const HALF_W = PITCH_W / 2;

/** Maße nach den Fußballregeln (Meter) */
export const PITCH_DIMS = {
  lineWidth: 0.12,
  centreCircle: 9.15,
  penaltyAreaDepth: 16.5,
  penaltyAreaWidth: 40.32,
  goalAreaDepth: 5.5,
  goalAreaWidth: 18.32,
  penaltySpot: 11,
  cornerArc: 1,
  goalWidth: 7.32,
  goalHeight: 2.44,
  goalDepth: 2.0,
  postRadius: 0.06,
} as const;

/** Rasenfläche über das Feld hinaus (Meter je Seite) */
export const SURROUND = { x: 7, y: 6 } as const;

/**
 * Dreiecke aller Linien als flache Liste (x, z) je Ecke, zentriert um den Anstoßpunkt.
 * Je Liniensegment zwei Dreiecke (6 Ecken).
 */
export function pitchLineTriangles(w: number = PITCH_DIMS.lineWidth): Float32Array {
  const out: number[] = [];
  const hw = w / 2;
  const seg = (x1: number, z1: number, x2: number, z2: number): void => {
    const dx = x2 - x1;
    const dz = z2 - z1;
    const len = Math.hypot(dx, dz) || 1;
    const nx = (-dz / len) * hw;
    const nz = (dx / len) * hw;
    out.push(x1 - nx, z1 - nz, x2 - nx, z2 - nz, x2 + nx, z2 + nz);
    out.push(x1 - nx, z1 - nz, x2 + nx, z2 + nz, x1 + nx, z1 + nz);
  };
  /** Rechteck aus vier Linien, Außenkante bündig zu den Maßen (Linien gehören zur Fläche) */
  const rect = (x1: number, z1: number, x2: number, z2: number): void => {
    seg(x1, z1, x2, z1);
    seg(x2, z1, x2, z2);
    seg(x2, z2, x1, z2);
    seg(x1, z2, x1, z1);
  };
  const arc = (cx: number, cz: number, r: number, a0: number, a1: number, n: number): void => {
    for (let i = 0; i < n; i++) {
      const t0 = a0 + ((a1 - a0) * i) / n;
      const t1 = a0 + ((a1 - a0) * (i + 1)) / n;
      seg(cx + r * Math.cos(t0), cz + r * Math.sin(t0), cx + r * Math.cos(t1), cz + r * Math.sin(t1));
    }
  };
  const spot = (cx: number, cz: number, r: number): void => {
    const n = 12;
    for (let i = 0; i < n; i++) {
      const t0 = (2 * Math.PI * i) / n;
      const t1 = (2 * Math.PI * (i + 1)) / n;
      out.push(cx, cz, cx + r * Math.cos(t0), cz + r * Math.sin(t0), cx + r * Math.cos(t1), cz + r * Math.sin(t1));
    }
  };

  const L = HALF_L - hw;
  const W = HALF_W - hw;
  const D = PITCH_DIMS;
  rect(-L, -W, L, W); // Seiten- und Torauslinien
  seg(0, -W, 0, W); // Mittellinie
  arc(0, 0, D.centreCircle, 0, 2 * Math.PI, 64);
  spot(0, 0, 0.15);
  for (const s of [-1, 1]) {
    const gx = s * L;
    // Strafraum
    seg(gx, -D.penaltyAreaWidth / 2, gx - s * D.penaltyAreaDepth, -D.penaltyAreaWidth / 2);
    seg(gx - s * D.penaltyAreaDepth, -D.penaltyAreaWidth / 2, gx - s * D.penaltyAreaDepth, D.penaltyAreaWidth / 2);
    seg(gx - s * D.penaltyAreaDepth, D.penaltyAreaWidth / 2, gx, D.penaltyAreaWidth / 2);
    // Torraum
    seg(gx, -D.goalAreaWidth / 2, gx - s * D.goalAreaDepth, -D.goalAreaWidth / 2);
    seg(gx - s * D.goalAreaDepth, -D.goalAreaWidth / 2, gx - s * D.goalAreaDepth, D.goalAreaWidth / 2);
    seg(gx - s * D.goalAreaDepth, D.goalAreaWidth / 2, gx, D.goalAreaWidth / 2);
    // Elfmeterpunkt und Teilkreis außerhalb des Strafraums
    const px = s * (HALF_L - D.penaltySpot);
    spot(px, 0, 0.15);
    // Teilkreis: Strafraumgrenze liegt 5,5 m vor dem Punkt Richtung Feldmitte
    const half = Math.acos((D.penaltyAreaDepth - D.penaltySpot) / D.centreCircle);
    const base = s > 0 ? Math.PI : 0; // Kreis öffnet zur Feldmitte
    arc(px, 0, D.centreCircle, base - half, base + half, 24);
    // Eckviertelkreise: Viertel von „längs ins Feld“ bis „quer ins Feld“
    for (const t of [-1, 1]) {
      const mid = Math.atan2(-t, -s); // Winkelhalbierende zeigt ins Feld
      arc(s * L, t * W, D.cornerArc, mid - Math.PI / 4, mid + Math.PI / 4, 8);
    }
  }
  return new Float32Array(out);
}

/** Mähstreifen: Grenzen in x (zentriert), gleich breit über die Feldlänge, plus Randstreifen */
export function mowingStripes(count = 18): { x0: number; x1: number; dark: boolean }[] {
  const out: { x0: number; x1: number; dark: boolean }[] = [];
  const w = PITCH_L / count;
  out.push({ x0: -HALF_L - SURROUND.x, x1: -HALF_L, dark: true });
  for (let i = 0; i < count; i++) {
    out.push({ x0: -HALF_L + i * w, x1: -HALF_L + (i + 1) * w, dark: i % 2 === 0 });
  }
  out.push({ x0: HALF_L, x1: HALF_L + SURROUND.x, dark: count % 2 === 0 });
  return out;
}

/** Tor: Pfosten und Latte als Zylinder (Mittelpunkt, Länge, Achse) für eine Seite (−1 links, +1 rechts) */
export function goalFrame(side: -1 | 1): { x: number; y: number; z: number; len: number; axis: 'y' | 'z' }[] {
  const D = PITCH_DIMS;
  const x = side * (HALF_L + D.postRadius); // Pfosten stehen hinter der Torlinie, bündig
  const zh = D.goalWidth / 2 + D.postRadius;
  return [
    { x, y: D.goalHeight / 2, z: -zh, len: D.goalHeight, axis: 'y' },
    { x, y: D.goalHeight / 2, z: zh, len: D.goalHeight, axis: 'y' },
    { x, y: D.goalHeight + D.postRadius, z: 0, len: D.goalWidth + 4 * D.postRadius, axis: 'z' },
  ];
}

/**
 * Tornetz als Liniensegmente (x, y, z, x, y, z …): Rückwand, Dach, Seitenteile; Masche ca. 12 cm
 * auf Hoch, gröber auf Niedrig.
 */
export function goalNetSegments(side: -1 | 1, mesh: number): Float32Array {
  const D = PITCH_DIMS;
  const out: number[] = [];
  const x0 = side * HALF_L;
  const x1 = side * (HALF_L + D.goalDepth);
  const zw = D.goalWidth / 2;
  const top = D.goalHeight;
  const backTop = D.goalHeight * 0.85; // Netz hängt hinten etwas tiefer
  const line = (a: number[], b: number[]): void => {
    out.push(a[0]!, a[1]!, a[2]!, b[0]!, b[1]!, b[2]!);
  };
  const nz = Math.max(2, Math.round(D.goalWidth / mesh));
  const ny = Math.max(2, Math.round(top / mesh));
  const nx = Math.max(2, Math.round(D.goalDepth / mesh));
  // Rückwand: senkrecht und waagerecht
  for (let i = 0; i <= nz; i++) {
    const z = -zw + (2 * zw * i) / nz;
    line([x1, 0, z], [x1, backTop, z]);
  }
  for (let j = 0; j <= ny; j++) {
    const y = (backTop * j) / ny;
    line([x1, y, -zw], [x1, y, zw]);
  }
  // Dach: von der Latte schräg zur Rückwand
  for (let i = 0; i <= nz; i++) {
    const z = -zw + (2 * zw * i) / nz;
    line([x0, top, z], [x1, backTop, z]);
  }
  for (let k = 0; k <= nx; k++) {
    const t = k / nx;
    const x = x0 + (x1 - x0) * t;
    const y = top + (backTop - top) * t;
    line([x, y, -zw], [x, y, zw]);
  }
  // Seitenteile
  for (const z of [-zw, zw]) {
    for (let k = 0; k <= nx; k++) {
      const t = k / nx;
      const x = x0 + (x1 - x0) * t;
      line([x, 0, z], [x, top + (backTop - top) * t, z]);
    }
    for (let j = 0; j <= ny; j++) {
      const t = j / ny;
      const yb = backTop * t;
      const yf = top * t;
      line([x0, yf, z], [x1, yb, z]);
    }
  }
  return new Float32Array(out);
}

/** Lage der vier Flutlichtmasten (Ecken hinter den Tribünen), Höhe in Metern */
export function floodlightMasts(standDepth: number): { x: number; z: number; height: number; yaw: number }[] {
  const ox = HALF_L + SURROUND.x + standDepth * 0.7;
  const oz = HALF_W + SURROUND.y + standDepth * 0.7;
  const out: { x: number; z: number; height: number; yaw: number }[] = [];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      out.push({ x: sx * ox, z: sz * oz, height: 42, yaw: Math.atan2(-sx, -sz) });
    }
  }
  return out;
}
