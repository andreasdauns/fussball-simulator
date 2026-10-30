/**
 * Epochenabhängige Schiedsrichter-/Regelparameter.
 */

function piecewise(x: number, pts: [number, number][]): number {
  const first = pts[0]!;
  if (x <= first[0]) return first[1];
  for (let i = 1; i < pts.length; i++) {
    const [x1, y1] = pts[i]!;
    const [x0, y0] = pts[i - 1]!;
    if (x <= x1) return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  }
  return pts[pts.length - 1]![1];
}

/** Wahrscheinlichkeit einer Gelben Karte pro Foul (Karten gibt es offiziell seit 1970). */
export function yellowPerFoul(era: number): number {
  return piecewise(era, [
    [1960, 0.03],
    [1970, 0.05],
    [1990, 0.1],
    [2005, 0.12],
    [2020, 0.135],
  ]);
}

/** Wahrscheinlichkeit einer glatt Roten Karte pro Foul */
export function redPerFoul(era: number): number {
  return piecewise(era, [
    [1960, 0.003],
    [1990, 0.004],
    [2020, 0.0035],
  ]);
}

/** Foulneigung relativ zu heute (früher wurde mehr laufen gelassen, aber härter gespielt) */
export function foulFactor(era: number): number {
  return piecewise(era, [
    [1960, 1.05],
    [1990, 1.05],
    [2020, 1.0],
  ]);
}
