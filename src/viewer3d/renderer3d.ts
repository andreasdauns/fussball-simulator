/**
 * 3D-Ansicht (Phase 2, Schritt 1): Stadion bei Flutlicht aus der TV-Führungsposition.
 * Spieler und Ball folgen in F11, Bildregie in F12. Die Ansicht liest nur – sie beeinflusst
 * nie das Spiel.
 */

import * as THREE from 'three';
import type { Frame } from '../viewer2d/positions';
import { HALF_W } from './geometry';
import { buildStadium, countDrawCalls, SKY_COLOR, type Quality, type StadiumBuild } from './stadium';

export type { Quality } from './stadium';

/**
 * TV-Führungskamera: auf der Haupttribüne in Höhe der Mittellinie (ca. 27 m hoch, 26 m hinter
 * der Seitenlinie). Breite des Bildausschnitts begrenzt wie bei einer echten Totale.
 */
export const TV_CAMERA = { height: 27, back: 26, maxHfovDeg: 74, minVfovDeg: 26, maxVfovDeg: 58 } as const;

/** Vorschlag für die Qualitätsstufe nach Gerät (Handy/Tablet → Niedrig) */
export function suggestQuality(): Quality {
  if (typeof window === 'undefined') return 'high';
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  const small = Math.min(window.screen?.width ?? 1920, window.screen?.height ?? 1080) < 700;
  return coarse || small ? 'low' : 'high';
}

export class Stadium3DRenderer {
  readonly canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(40, 16 / 9, 1, 600);
  private stadium: StadiumBuild | null = null;
  private quality: Quality;
  private cssW = 0;
  private cssH = 0;
  // Bildrate (gleitender Mittelwert über ca. 1 s)
  private frames = 0;
  private fpsT0 = 0;
  private fpsValue = 0;

  constructor(canvas: HTMLCanvasElement, quality: Quality) {
    this.canvas = canvas;
    this.quality = quality;
    this.renderer = this.makeRenderer();
    this.scene.background = new THREE.Color(SKY_COLOR);
    this.scene.fog = new THREE.Fog(SKY_COLOR, 220, 520);
    this.build();
  }

  private makeRenderer(): THREE.WebGLRenderer {
    const r = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: this.quality === 'high',
      powerPreference: 'high-performance',
    });
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    r.shadowMap.enabled = this.quality === 'high';
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    return r;
  }

  private build(): void {
    if (this.stadium) {
      this.scene.remove(this.stadium.group, ...this.stadium.lights);
      this.stadium.dispose();
    }
    this.stadium = buildStadium(this.quality);
    this.scene.add(this.stadium.group, ...this.stadium.lights);
    for (const l of this.stadium.lights) {
      if (l instanceof THREE.DirectionalLight) this.scene.add(l.target);
    }
  }

  getQuality(): Quality {
    return this.quality;
  }

  /** Qualität wechseln: Renderer neu anlegen (Kantenglättung lässt sich nur so umschalten) */
  setQuality(q: Quality): void {
    if (q === this.quality) return;
    this.quality = q;
    this.renderer.dispose();
    this.renderer = this.makeRenderer();
    this.cssW = 0;
    this.build();
    this.resize();
  }

  resize(): void {
    const parent = this.canvas.parentElement;
    const w = Math.max(50, parent?.clientWidth ?? window.innerWidth);
    const h = Math.max(50, parent?.clientHeight ?? window.innerHeight);
    if (w === this.cssW && h === this.cssH) return;
    this.cssW = w;
    this.cssH = h;
    const maxDpr = this.quality === 'high' ? 2 : 1;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxDpr));
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.camera.aspect = w / h;
    this.placeCamera();
  }

  /**
   * TV-Totale von der Haupttribüne. Im Querformat ist fast das ganze Feld im Bild, im
   * Hochformat der Mittelbereich. Ballverfolgung kommt mit der Bildregie (F12).
   */
  private placeCamera(): void {
    const aspect = this.camera.aspect || 16 / 9;
    const maxH = (TV_CAMERA.maxHfovDeg * Math.PI) / 180;
    let vfov = 2 * Math.atan(Math.tan(maxH / 2) / aspect);
    vfov = Math.min(Math.max(vfov, (TV_CAMERA.minVfovDeg * Math.PI) / 180), (TV_CAMERA.maxVfovDeg * Math.PI) / 180);
    this.camera.fov = (vfov * 180) / Math.PI;
    this.camera.position.set(0, TV_CAMERA.height, HALF_W + TV_CAMERA.back);
    this.camera.lookAt(0, 0, -1);
    this.camera.far = 600;
    this.camera.updateProjectionMatrix();
  }

  /** Ein Bild zeichnen. `frame` wird ab F11 für Spieler und Ball genutzt. */
  draw(_frame: Frame | null, now: number): void {
    this.renderer.render(this.scene, this.camera);
    this.frames++;
    if (this.fpsT0 === 0) this.fpsT0 = now;
    const dt = now - this.fpsT0;
    if (dt >= 1000) {
      this.fpsValue = Math.round((this.frames * 1000) / dt);
      this.frames = 0;
      this.fpsT0 = now;
    }
  }

  /** Bilder pro Sekunde (0, solange noch nicht gemessen) */
  fps(): number {
    return this.fpsValue;
  }

  info(): { drawCalls: number; triangles: number } {
    return { drawCalls: this.renderer.info.render.calls || countDrawCalls(this.scene), triangles: this.renderer.info.render.triangles };
  }

  dispose(): void {
    this.stadium?.dispose();
    this.renderer.dispose();
  }
}
