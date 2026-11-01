/**
 * Baut die statische 3D-Szene: Rasen mit Mähstreifen, Linien, Tore mit Netz, Werbebanden
 * (neutral, ohne Logos), vier Tribünen mit Dach und Flutlichtmasten.
 *
 * Läuft auch in Node (für Tests): ohne `document` entfallen nur die Canvas-Texturen.
 * Draw Calls werden klein gehalten (gleiche Materialien zusammengefasst).
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  floodlightMasts,
  goalFrame,
  goalNetSegments,
  HALF_L,
  HALF_W,
  mowingStripes,
  PITCH_DIMS,
  pitchLineTriangles,
  SURROUND,
} from './geometry';

export type Quality = 'high' | 'low';

/** Tribünen: Tiefe, Höhe der hinteren Kante, Abstand der Vorderkante zum Rasenrand */
export const STAND = { depth: 26, height: 20, gap: 2.5 } as const;

const COLORS = {
  grassLight: '#3f8f3a',
  grassDark: '#357d32',
  surround: '#2f6e2d',
  line: '#f4f7f2',
  board: '#13202c',
  boardStripe: '#c8102e',
  seats: '#5b1520',
  seatsAlt: '#2a2f38',
  concrete: '#6f7680',
  roof: '#c9ced6',
  mast: '#9aa3ad',
  lamp: '#fff6dd',
  sky: '#0b1524',
} as const;

function hasDom(): boolean {
  return typeof document !== 'undefined' && typeof document.createElement === 'function';
}

/** Rasentextur: Mähstreifen längs, leichte Körnung (deterministisch, kein Zufall) */
function grassTexture(quality: Quality): THREE.Texture | null {
  if (!hasDom()) return null;
  const totalL = 2 * (HALF_L + SURROUND.x);
  const totalW = 2 * (HALF_W + SURROUND.y);
  const pxPerM = quality === 'high' ? 16 : 8;
  const c = document.createElement('canvas');
  c.width = Math.round(totalL * pxPerM);
  c.height = Math.round(totalW * pxPerM);
  const g = c.getContext('2d');
  if (!g) return null;
  g.fillStyle = COLORS.surround;
  g.fillRect(0, 0, c.width, c.height);
  const yTop = SURROUND.y * pxPerM;
  const yH = 2 * HALF_W * pxPerM;
  for (const s of mowingStripes()) {
    const x0 = (s.x0 + HALF_L + SURROUND.x) * pxPerM;
    const x1 = (s.x1 + HALF_L + SURROUND.x) * pxPerM;
    g.fillStyle = s.dark ? COLORS.grassDark : COLORS.grassLight;
    const isEdge = s.x0 < -HALF_L || s.x1 > HALF_L;
    if (isEdge) g.fillRect(x0, 0, x1 - x0, c.height);
    else {
      g.fillRect(x0, yTop, x1 - x0, yH);
      // Außenbereich neben dem Feld: Streifen gedämpft fortsetzen
      g.globalAlpha = 0.45;
      g.fillRect(x0, 0, x1 - x0, yTop);
      g.fillRect(x0, yTop + yH, x1 - x0, c.height - yTop - yH);
      g.globalAlpha = 1;
    }
  }
  // Körnung: kleine helle/dunkle Tupfer aus einem einfachen Hash
  const n = Math.round((c.width * c.height) / (quality === 'high' ? 40 : 80));
  let h = 2166136261;
  for (let i = 0; i < n; i++) {
    h = Math.imul(h ^ i, 16777619) >>> 0;
    const x = h % c.width;
    h = Math.imul(h ^ (i + 7), 16777619) >>> 0;
    const y = h % c.height;
    g.fillStyle = (h & 1) === 0 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)';
    g.fillRect(x, y, 2, 2);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = quality === 'high' ? 8 : 1;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}

/** Sitzreihen-Textur: waagerechte Reihen mit Treppenaufgängen */
function seatTexture(): THREE.Texture | null {
  if (!hasDom()) return null;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const g = c.getContext('2d');
  if (!g) return null;
  g.fillStyle = COLORS.seats;
  g.fillRect(0, 0, 256, 256);
  for (let r = 0; r < 16; r++) {
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.fillRect(0, r * 16 + 12, 256, 4);
  }
  g.fillStyle = COLORS.concrete;
  g.fillRect(0, 0, 10, 256); // Treppe
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function std(color: string, extra: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, ...extra });
}

/** Ein Tribünenblock: schräge Sitzfläche (Keil) plus Rückwand, als eine Geometrie */
function standGeometry(length: number): THREE.BufferGeometry {
  const { depth, height } = STAND;
  const shape = new THREE.Shape();
  // Profil in (Tiefe, Höhe): vorne niedrige Brüstung, steigt nach hinten an
  shape.moveTo(0, 0);
  shape.lineTo(0, 1.6);
  shape.lineTo(depth, height);
  shape.lineTo(depth, 0);
  shape.lineTo(0, 0);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: length, bevelEnabled: false, steps: 1 });
  // Extrusion läuft entlang +Z; so drehen, dass Länge entlang X und Tiefe nach außen (+Z) zeigt
  geo.rotateY(-Math.PI / 2); // Profil-x (Tiefe) → +Z (nach außen), Extrusion → −X
  geo.translate(length / 2, 0, 0);
  // UVs für die Sitzreihen: entlang Länge und Tiefe
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[2 * i] = pos.getX(i) / 8;
    uv[2 * i + 1] = Math.hypot(pos.getZ(i), pos.getY(i)) / 8;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.computeVertexNormals();
  return geo;
}

export interface StadiumBuild {
  group: THREE.Group;
  /** Lichter (werden der Szene direkt hinzugefügt) */
  lights: THREE.Light[];
  dispose: () => void;
}

/** Baut das Stadion. Größenordnung: ca. 15 Draw Calls. */
export function buildStadium(quality: Quality): StadiumBuild {
  const group = new THREE.Group();
  group.name = 'stadium';
  const disposables: { dispose: () => void }[] = [];
  const track = <T extends { dispose: () => void }>(o: T): T => {
    disposables.push(o);
    return o;
  };
  const shadows = quality === 'high';

  // ── Rasen ──
  const totalL = 2 * (HALF_L + SURROUND.x);
  const totalW = 2 * (HALF_W + SURROUND.y);
  const grassTex = grassTexture(quality);
  if (grassTex) track(grassTex);
  const grassGeo = track(new THREE.PlaneGeometry(totalL, totalW));
  grassGeo.rotateX(-Math.PI / 2);
  const grassMat = track(std(grassTex ? '#ffffff' : COLORS.grassLight, { map: grassTex, roughness: 0.95 }));
  const grass = new THREE.Mesh(grassGeo, grassMat);
  grass.name = 'grass';
  grass.receiveShadow = shadows;
  group.add(grass);

  // ── Linien (eine Geometrie) ──
  const tri = pitchLineTriangles();
  const linePos = new Float32Array((tri.length / 2) * 3);
  for (let t = 0; t < tri.length / 6; t++) {
    // Umlaufsinn so drehen, dass jede Fläche nach oben zeigt
    const ax = tri[6 * t]!, az = tri[6 * t + 1]!;
    let bx = tri[6 * t + 2]!, bz = tri[6 * t + 3]!;
    let cx = tri[6 * t + 4]!, cz = tri[6 * t + 5]!;
    if ((bz - az) * (cx - ax) - (bx - ax) * (cz - az) < 0) {
      [bx, cx] = [cx, bx];
      [bz, cz] = [cz, bz];
    }
    linePos.set([ax, 0.01, az, bx, 0.01, bz, cx, 0.01, cz], 9 * t);
  }
  const lineGeo = track(new THREE.BufferGeometry());
  lineGeo.setAttribute('position', new THREE.BufferAttribute(linePos, 3));
  const lineNrm = new Float32Array(linePos.length);
  for (let i = 1; i < lineNrm.length; i += 3) lineNrm[i] = 1;
  lineGeo.setAttribute('normal', new THREE.BufferAttribute(lineNrm, 3));
  const lineMat = track(std(COLORS.line, { roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2 }));
  const lines = new THREE.Mesh(lineGeo, lineMat);
  lines.name = 'lines';
  lines.receiveShadow = shadows;
  group.add(lines);

  // ── Tore: Rahmen (eine Geometrie) und Netz (Liniensegmente) ──
  const D = PITCH_DIMS;
  const frameParts: THREE.BufferGeometry[] = [];
  const netParts: Float32Array[] = [];
  const radial = quality === 'high' ? 12 : 6;
  for (const side of [-1, 1] as const) {
    for (const p of goalFrame(side)) {
      const g = new THREE.CylinderGeometry(D.postRadius, D.postRadius, p.len, radial);
      if (p.axis === 'z') g.rotateX(Math.PI / 2);
      g.translate(p.x, p.y, p.z);
      frameParts.push(g);
    }
    netParts.push(goalNetSegments(side, quality === 'high' ? 0.15 : 0.3));
  }
  const frameGeo = track(mergeGeometries(frameParts)!);
  frameParts.forEach((g) => g.dispose());
  const frame = new THREE.Mesh(frameGeo, track(std('#ffffff', { roughness: 0.4 })));
  frame.name = 'goal-frames';
  frame.castShadow = shadows;
  group.add(frame);
  const netLen = netParts.reduce((a, b) => a + b.length, 0);
  const netArr = new Float32Array(netLen);
  let off = 0;
  for (const p of netParts) {
    netArr.set(p, off);
    off += p.length;
  }
  const netGeo = track(new THREE.BufferGeometry());
  netGeo.setAttribute('position', new THREE.BufferAttribute(netArr, 3));
  const net = new THREE.LineSegments(netGeo, track(new THREE.LineBasicMaterial({ color: '#e8ecef', transparent: true, opacity: 0.55 })));
  net.name = 'goal-nets';
  group.add(net);

  // ── Werbebanden (neutral: dunkel mit rotem Streifen, keine Logos) ──
  const boardParts: THREE.BufferGeometry[] = [];
  const stripeParts: THREE.BufferGeometry[] = [];
  const bx = HALF_L + 4.5;
  const bz = HALF_W + 3.5;
  const addBoard = (cx: number, cz: number, len: number, alongX: boolean): void => {
    const g = new THREE.BoxGeometry(alongX ? len : 0.2, 0.9, alongX ? 0.2 : len);
    g.translate(cx, 0.45, cz);
    boardParts.push(g);
    const s = new THREE.BoxGeometry(alongX ? len : 0.21, 0.12, alongX ? 0.21 : len);
    s.translate(cx, 0.62, cz);
    stripeParts.push(s);
  };
  addBoard(0, -bz, 2 * bx, true); // Gegengerade
  addBoard(-HALF_L / 2 - 6, bz, HALF_L - 8, true); // Haupttribüne links (Mitte frei für Bänke)
  addBoard(HALF_L / 2 + 6, bz, HALF_L - 8, true);
  addBoard(-bx, -12 - (bz - 12) / 2, bz - 12, false); // hinter den Toren, Tor frei
  addBoard(-bx, 12 + (bz - 12) / 2, bz - 12, false);
  addBoard(bx, -12 - (bz - 12) / 2, bz - 12, false);
  addBoard(bx, 12 + (bz - 12) / 2, bz - 12, false);
  const boards = new THREE.Mesh(track(mergeGeometries(boardParts)!), track(std(COLORS.board, { roughness: 0.5, emissive: '#0a141e' })));
  boards.name = 'boards';
  boardParts.forEach((g) => g.dispose());
  group.add(boards);
  const stripes = new THREE.Mesh(track(mergeGeometries(stripeParts)!), track(std(COLORS.boardStripe, { emissive: COLORS.boardStripe, emissiveIntensity: 0.6 })));
  stripes.name = 'board-stripes';
  stripeParts.forEach((g) => g.dispose());
  group.add(stripes);

  // ── Trainerbänke (Haupttribünenseite, wo auch die Kamera steht) ──
  const benchParts: THREE.BufferGeometry[] = [];
  for (const sx of [-1, 1]) {
    const roof = new THREE.BoxGeometry(7, 0.08, 1.8);
    roof.translate(sx * 6, 2.1, HALF_W + 2.6);
    const back = new THREE.BoxGeometry(7, 2.1, 0.08);
    back.translate(sx * 6, 1.05, HALF_W + 3.5);
    benchParts.push(roof, back);
  }
  const benches = new THREE.Mesh(track(mergeGeometries(benchParts)!), track(std('#aeb8c2', { transparent: true, opacity: 0.75, roughness: 0.3 })));
  benches.name = 'benches';
  benchParts.forEach((g) => g.dispose());
  group.add(benches);

  // ── Tribünen ──
  const seatTex = seatTexture();
  if (seatTex) track(seatTex);
  const standParts: THREE.BufferGeometry[] = [];
  const edgeX = HALF_L + SURROUND.x + STAND.gap;
  const edgeZ = HALF_W + SURROUND.y + STAND.gap;
  const longLen = 2 * edgeX;
  const shortLen = 2 * edgeZ;
  const place = (len: number, rotY: number, tx: number, tz: number): void => {
    const g = standGeometry(len);
    g.rotateY(rotY);
    g.translate(tx, 0, tz);
    standParts.push(g);
  };
  place(longLen, 0, 0, edgeZ); // Haupttribüne (+Z, hinter der Kamera)
  place(longLen, Math.PI, 0, -edgeZ); // Gegengerade
  place(shortLen, Math.PI / 2, edgeX, 0); // Kurve rechts
  place(shortLen, -Math.PI / 2, -edgeX, 0); // Kurve links
  const standGeo = track(mergeGeometries(standParts)!);
  standParts.forEach((g) => g.dispose());
  const stands = new THREE.Mesh(standGeo, track(std(seatTex ? '#ffffff' : COLORS.seats, { map: seatTex, roughness: 0.9 })));
  stands.name = 'stands';
  stands.receiveShadow = shadows;
  group.add(stands);

  // Ecken zwischen den Tribünen schließen (Betonblöcke)
  const cornerParts: THREE.BufferGeometry[] = [];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const g = new THREE.BoxGeometry(STAND.depth, STAND.height * 0.9, STAND.depth);
      g.translate(sx * (edgeX + STAND.depth / 2), (STAND.height * 0.9) / 2, sz * (edgeZ + STAND.depth / 2));
      cornerParts.push(g);
    }
  }
  // Dächer über allen vier Tribünen (leicht nach innen geneigt)
  const roofParts: THREE.BufferGeometry[] = [];
  const roofDepth = STAND.depth * 0.85;
  const roofY = STAND.height + 11;
  const addRoof = (len: number, rotY: number, tx: number, tz: number): void => {
    const g = new THREE.BoxGeometry(len, 0.6, roofDepth);
    g.translate(0, 0, STAND.depth - roofDepth / 2);
    g.rotateX(-0.06);
    g.rotateY(rotY);
    g.translate(tx, roofY, tz);
    roofParts.push(g);
  };
  addRoof(longLen + 2 * STAND.depth, 0, 0, edgeZ);
  addRoof(longLen + 2 * STAND.depth, Math.PI, 0, -edgeZ);
  addRoof(shortLen, Math.PI / 2, edgeX, 0);
  addRoof(shortLen, -Math.PI / 2, -edgeX, 0);
  const concrete = new THREE.Mesh(track(mergeGeometries(cornerParts)!), track(std(COLORS.concrete)));
  concrete.name = 'corners';
  cornerParts.forEach((g) => g.dispose());
  group.add(concrete);
  const roofs = new THREE.Mesh(track(mergeGeometries(roofParts)!), track(std(COLORS.roof, { roughness: 0.6, side: THREE.DoubleSide })));
  roofs.name = 'roofs';
  roofParts.forEach((g) => g.dispose());
  group.add(roofs);

  // ── Flutlichtmasten ──
  const mastParts: THREE.BufferGeometry[] = [];
  const lampParts: THREE.BufferGeometry[] = [];
  for (const m of floodlightMasts(STAND.depth)) {
    const pole = new THREE.CylinderGeometry(0.5, 0.8, m.height, 8);
    pole.translate(m.x, m.height / 2, m.z);
    mastParts.push(pole);
    const panel = new THREE.BoxGeometry(9, 5, 0.6);
    panel.rotateX(0.5); // zum Feld geneigt
    panel.rotateY(m.yaw);
    panel.translate(m.x, m.height + 2, m.z);
    lampParts.push(panel);
  }
  const masts = new THREE.Mesh(track(mergeGeometries(mastParts)!), track(std(COLORS.mast, { metalness: 0.4, roughness: 0.5 })));
  masts.name = 'masts';
  mastParts.forEach((g) => g.dispose());
  group.add(masts);
  const lamps = new THREE.Mesh(track(mergeGeometries(lampParts)!), track(new THREE.MeshBasicMaterial({ color: COLORS.lamp })));
  lamps.name = 'lamps';
  lampParts.forEach((g) => g.dispose());
  group.add(lamps);

  // ── Licht: Flutlicht-Abend (Himmel dunkel, Feld hell) ──
  const lights: THREE.Light[] = [];
  const hemi = new THREE.HemisphereLight('#cfe0ff', '#24401f', 0.9);
  lights.push(hemi);
  const key = new THREE.DirectionalLight('#fff4e0', 2.2);
  key.position.set(-60, 70, 45);
  key.target.position.set(0, 0, 0);
  if (shadows) {
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    const cam = key.shadow.camera;
    cam.left = -70;
    cam.right = 70;
    cam.top = 50;
    cam.bottom = -50;
    cam.near = 10;
    cam.far = 220;
    key.shadow.bias = -0.0005;
  }
  lights.push(key);
  const fill = new THREE.DirectionalLight('#e6efff', 0.9);
  fill.position.set(60, 60, -45);
  lights.push(fill);

  return {
    group,
    lights,
    dispose: () => {
      for (const d of disposables) d.dispose();
    },
  };
}

export const SKY_COLOR = COLORS.sky;

/** Zählt die Draw Calls (sichtbare Meshes/Linien) einer Szene – für Tests und Anzeige */
export function countDrawCalls(root: THREE.Object3D): number {
  let n = 0;
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh || (o as THREE.LineSegments).isLineSegments) n++;
  });
  return n;
}
