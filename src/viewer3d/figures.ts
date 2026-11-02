/**
 * 3D-Platzhalterfiguren und Ball (F11).
 *
 * Positionen kommen ausschließlich aus `Frame` (src/viewer2d/positions.ts) – dieselben
 * Anzeige-Koordinaten wie in der 2D-Ansicht. Diese Datei rechnet nur in 3D-Koordinaten um
 * und zeichnet; sie beeinflusst nie das Spiel.
 *
 * Figuren: einfache Körper aus Zylindern und Kugel (Hose, Trikot, Kopf) – keine echten
 * Gesichter, nur Trikotfarben. Echte animierte Figuren folgen in F20.
 * Draw Calls gering: je Körperteil ein InstancedMesh für alle Spieler.
 */

import * as THREE from 'three';
import type { Frame } from '../viewer2d/positions';
import { HALF_L, HALF_W } from './geometry';
import type { Quality } from './stadium';

export interface KitColors {
  primary: string;
  secondary: string;
  numbers: string;
  gkPrimary: string;
}

/** Maße der Platzhalterfigur (Meter) */
export const FIGURE = {
  height: 1.8,
  legTop: 0.92,
  torsoTop: 1.52,
  headRadius: 0.12,
  bodyRadius: 0.2,
  legRadius: 0.16,
} as const;

/**
 * Ballradius in der Darstellung. Echt 0,11 m; aus der Totalen (ca. 60 m Abstand) wäre der Ball
 * dann nur 2 Pixel groß. Wie bei der 2D-Ansicht leicht vergrößert, damit er erkennbar bleibt.
 */
export const BALL_RADIUS = 0.2;

/** Höchstzahl gleichzeitig gezeigter Spieler (22 + ein- und auslaufende Wechselspieler) */
export const MAX_FIGURES = 30;

/** Spielfeld-Meter (Anzeige-Koordinaten wie 2D) → Three.js-Welt (X längs, Z quer, Y Höhe) */
export function toWorld(x: number, y: number, z = 0): { X: number; Y: number; Z: number } {
  return { X: x - HALF_L, Y: z, Z: y - HALF_W };
}

/** Rückrichtung (für Tests) */
export function fromWorld(X: number, Z: number): { x: number; y: number } {
  return { x: X + HALF_L, y: Z + HALF_W };
}

/** Farbe je Spieler: Torhüter in Torwartfarbe, Feldspieler im Trikot; Hose in Zweitfarbe */
export function figureColors(kit: KitColors, isGK: boolean): { shirt: string; shorts: string } {
  return isGK ? { shirt: kit.gkPrimary, shorts: kit.gkPrimary } : { shirt: kit.primary, shorts: kit.secondary };
}

const SKIN_NEUTRAL = '#c9a98c'; // neutraler Hautton, keine Gesichter

export class Figures3D {
  readonly group = new THREE.Group();
  private readonly legs: THREE.InstancedMesh;
  private readonly torso: THREE.InstancedMesh;
  private readonly head: THREE.InstancedMesh;
  private readonly blobs: THREE.InstancedMesh | null;
  readonly ball: THREE.Mesh;
  private readonly ballShadow: THREE.Mesh;
  private readonly disposables: { dispose: () => void }[] = [];
  private readonly m = new THREE.Matrix4();
  private readonly c = new THREE.Color();
  private kitKey = '';
  /** Index im Frame → Instanz (für Tests und spätere Hervorhebungen) */
  private shown: number[] = [];

  constructor(quality: Quality) {
    this.group.name = 'figures';
    const shadows = quality === 'high';
    const seg = quality === 'high' ? 10 : 6;
    const track = <T extends { dispose: () => void }>(o: T): T => {
      this.disposables.push(o);
      return o;
    };
    const mat = (rough = 0.7): THREE.MeshStandardMaterial => track(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: rough }));

    // Beine/Hose: Zylinder vom Boden bis zur Hüfte
    const legGeo = track(new THREE.CylinderGeometry(FIGURE.legRadius, FIGURE.legRadius * 0.8, FIGURE.legTop, seg));
    legGeo.translate(0, FIGURE.legTop / 2, 0);
    // Oberkörper/Trikot: etwas breiter, oben schmaler (Schultern → Hals)
    const torsoH = FIGURE.torsoTop - FIGURE.legTop;
    const torsoGeo = track(new THREE.CylinderGeometry(FIGURE.bodyRadius * 0.9, FIGURE.bodyRadius, torsoH, seg));
    torsoGeo.translate(0, FIGURE.legTop + torsoH / 2, 0);
    const headGeo = track(new THREE.SphereGeometry(FIGURE.headRadius, seg, Math.max(4, seg - 2)));
    headGeo.translate(0, FIGURE.height - FIGURE.headRadius - 0.04, 0);

    this.legs = new THREE.InstancedMesh(legGeo, mat(), MAX_FIGURES);
    this.torso = new THREE.InstancedMesh(torsoGeo, mat(0.6), MAX_FIGURES);
    const headMat = track(new THREE.MeshStandardMaterial({ color: SKIN_NEUTRAL, roughness: 0.8 }));
    this.head = new THREE.InstancedMesh(headGeo, headMat, MAX_FIGURES);
    this.legs.name = 'figure-legs';
    this.torso.name = 'figure-torso';
    this.head.name = 'figure-head';
    for (const im of [this.legs, this.torso, this.head]) {
      im.count = 0;
      im.castShadow = shadows;
      im.frustumCulled = false; // Instanzen über das ganze Feld verteilt
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(im);
    }
    // Farbpuffer anlegen (setColorAt legt ihn sonst erst beim ersten Aufruf an)
    for (let i = 0; i < MAX_FIGURES; i++) {
      this.legs.setColorAt(i, this.c.set('#ffffff'));
      this.torso.setColorAt(i, this.c);
    }

    // Weiche Bodenschatten nur in „Niedrig“ (in „Hoch“ werfen die Figuren echte Schatten)
    const blobTex = shadows ? null : track(blobTexture());
    if (!shadows) {
      const blobGeo = track(new THREE.PlaneGeometry(1.1, 1.1));
      blobGeo.rotateX(-Math.PI / 2);
      const blobMat = track(new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.35, depthWrite: false, alphaMap: blobTex ?? undefined }));
      this.blobs = new THREE.InstancedMesh(blobGeo, blobMat, MAX_FIGURES);
      this.blobs.name = 'figure-blobs';
      this.blobs.count = 0;
      this.blobs.frustumCulled = false;
      this.blobs.renderOrder = 1;
      this.group.add(this.blobs);
    } else {
      this.blobs = null;
    }

    // Ball mit Bodenschatten (zeigt die Flughöhe)
    const ballGeo = track(new THREE.SphereGeometry(BALL_RADIUS, seg + 4, seg));
    this.ball = new THREE.Mesh(ballGeo, track(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.45 })));
    this.ball.name = 'ball';
    this.ball.castShadow = shadows;
    this.group.add(this.ball);
    const bsGeo = track(new THREE.CircleGeometry(BALL_RADIUS * 1.1, 16));
    bsGeo.rotateX(-Math.PI / 2);
    this.ballShadow = new THREE.Mesh(bsGeo, track(new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.4, depthWrite: false })));
    this.ballShadow.name = 'ball-shadow';
    this.ballShadow.renderOrder = 1;
    this.group.add(this.ballShadow);
  }

  /** Spieler und Ball auf den Stand von `frame` setzen */
  update(frame: Frame, kits: { home: KitColors; away: KitColors }): void {
    const key = `${kits.home.primary}|${kits.home.secondary}|${kits.home.gkPrimary}|${kits.away.primary}|${kits.away.secondary}|${kits.away.gkPrimary}`;
    const forceColors = key !== this.kitKey;
    this.kitKey = key;

    const n = Math.min(frame.players.length, MAX_FIGURES);
    const prev = this.shown;
    const shown: number[] = [];
    let colorsChanged = forceColors || n !== prev.length;
    for (let i = 0; i < n; i++) {
      const p = frame.players[i]!;
      const w = toWorld(p.x, p.y);
      this.m.makeTranslation(w.X, 0, w.Z);
      this.legs.setMatrixAt(i, this.m);
      this.torso.setMatrixAt(i, this.m);
      this.head.setMatrixAt(i, this.m);
      if (this.blobs) {
        this.m.makeTranslation(w.X, 0.02, w.Z);
        this.blobs.setMatrixAt(i, this.m);
      }
      if (prev[i] !== p.idx) colorsChanged = true;
      shown.push(p.idx);
    }
    if (colorsChanged) {
      for (let i = 0; i < n; i++) {
        const p = frame.players[i]!;
        const col = figureColors(p.side === 'home' ? kits.home : kits.away, p.isGK);
        this.torso.setColorAt(i, this.c.set(col.shirt));
        this.legs.setColorAt(i, this.c.set(col.shorts));
      }
      if (this.torso.instanceColor) this.torso.instanceColor.needsUpdate = true;
      if (this.legs.instanceColor) this.legs.instanceColor.needsUpdate = true;
    }
    this.shown = shown;
    for (const im of [this.legs, this.torso, this.head, this.blobs]) {
      if (!im) continue;
      im.count = n;
      im.instanceMatrix.needsUpdate = true;
    }

    // Ball: Höhe aus der Positions-Synthese, Schatten am Boden
    const b = toWorld(frame.ball.x, frame.ball.y, frame.ball.z);
    this.ball.position.set(b.X, b.Y + BALL_RADIUS, b.Z);
    this.ballShadow.position.set(b.X, 0.02, b.Z);
    const s = Math.max(0.5, 1 - frame.ball.z * 0.04);
    this.ballShadow.scale.setScalar(s);
    (this.ballShadow.material as THREE.MeshBasicMaterial).opacity = Math.max(0.12, 0.4 - frame.ball.z * 0.02);
  }

  /** Aktuelle Weltposition einer gezeigten Figur (Instanz i) – für Tests */
  instancePosition(i: number): THREE.Vector3 {
    const out = new THREE.Matrix4();
    this.torso.getMatrixAt(i, out);
    return new THREE.Vector3().setFromMatrixPosition(out);
  }

  instanceShirt(i: number): string {
    const c = new THREE.Color();
    this.torso.getColorAt(i, c);
    return `#${c.getHexString()}`;
  }

  shownCount(): number {
    return this.torso.count;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    for (const im of [this.legs, this.torso, this.head, this.blobs]) im?.dispose();
  }
}

/** Runde, weich auslaufende Maske für Bodenschatten (Canvas; in Node ohne DOM: Datentextur) */
function blobTexture(): THREE.Texture {
  const N = 32;
  const data = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const dx = (x + 0.5) / N - 0.5;
      const dy = (y + 0.5) / N - 0.5;
      const r = Math.sqrt(dx * dx + dy * dy) * 2;
      const a = Math.max(0, Math.min(1, (1 - r) * 1.6));
      const v = Math.round(255 * a);
      const o = 4 * (y * N + x);
      data[o] = v;
      data[o + 1] = v;
      data[o + 2] = v;
      data[o + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}
