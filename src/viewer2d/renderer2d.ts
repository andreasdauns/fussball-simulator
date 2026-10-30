/**
 * 2D-Canvas-Darstellung im Stil einer TV-Übertragungsgrafik (Draufsicht).
 * Zeichnet nur, was `PositionSynth.frameAt` liefert – keine eigene Spiellogik.
 */

import type { TeamSheet } from '../engine/types';
import type { Frame } from './positions';
import { PITCH_L, PITCH_W } from './timeline';

const MARGIN = 4.5; // Meter Rand um das Feld

export type Kit = TeamSheet['colors'];

export interface RenderOptions {
  /** Trikotfarben (ggf. Ausweichtrikot des Gastes) */
  home: Kit;
  away: Kit;
  /** Text über dem Ballführenden */
  holderName?: string;
}

export class PitchRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private pitchLayer: HTMLCanvasElement | null = null;
  private cssW = 0;
  private cssH = 0;
  private dpr = 1;
  /** Hochformat: Feld um 90° gedreht */
  private portrait = false;
  private scale = 1;
  private ox = 0;
  private oy = 0;
  private trail: { x: number; y: number; z: number }[] = [];
  private lastTau = -1;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D nicht verfügbar');
    this.ctx = ctx;
  }

  /** An Größe des Elternelements anpassen. Rückgabe: Hochformat ja/nein */
  resize(): boolean {
    const parent = this.canvas.parentElement;
    const w = Math.max(50, parent?.clientWidth ?? window.innerWidth);
    const h = Math.max(50, parent?.clientHeight ?? window.innerHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    if (w === this.cssW && h === this.cssH && dpr === this.dpr) return this.portrait;
    this.cssW = w;
    this.cssH = h;
    this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    const fullL = PITCH_L + 2 * MARGIN;
    const fullW = PITCH_W + 2 * MARGIN;
    const sLand = Math.min(w / fullL, h / fullW);
    const sPort = Math.min(w / fullW, h / fullL);
    this.portrait = sPort > sLand * 1.08;
    this.scale = this.portrait ? sPort : sLand;
    const dw = (this.portrait ? fullW : fullL) * this.scale;
    const dh = (this.portrait ? fullL : fullW) * this.scale;
    this.ox = (w - dw) / 2;
    this.oy = (h - dh) / 2;
    this.pitchLayer = null;
    return this.portrait;
  }

  /** Feldkoordinaten (Meter) → Bildschirm (CSS-Pixel) */
  private P(x: number, y: number): [number, number] {
    const s = this.scale;
    if (this.portrait) {
      // Gedreht: Anzeige-x läuft von unten nach oben, Anzeige-y von links nach rechts
      return [this.ox + (y + MARGIN) * s, this.oy + (PITCH_L - x + MARGIN) * s];
    }
    return [this.ox + (x + MARGIN) * s, this.oy + (y + MARGIN) * s];
  }

  isPortrait(): boolean {
    return this.portrait;
  }

  resetTrail(): void {
    this.trail = [];
    this.lastTau = -1;
  }

  private buildPitch(): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = this.canvas.width;
    c.height = this.canvas.height;
    const g = c.getContext('2d')!;
    g.scale(this.dpr, this.dpr);
    const s = this.scale;
    const P = (x: number, y: number) => this.P(x, y);

    // Umgebung (Rasen außerhalb der Linien, etwas dunkler)
    const [ax, ay] = P(-MARGIN, -MARGIN);
    const [bx, by] = P(PITCH_L + MARGIN, PITCH_W + MARGIN);
    g.fillStyle = '#1f5a2c';
    g.fillRect(Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax), Math.abs(by - ay));

    // Mähstreifen quer zur Längsachse
    const stripes = 18;
    const sw = (PITCH_L + 2 * MARGIN) / stripes;
    for (let i = 0; i < stripes; i++) {
      const x0 = -MARGIN + i * sw;
      const [p0x, p0y] = P(x0, -MARGIN);
      const [p1x, p1y] = P(x0 + sw, PITCH_W + MARGIN);
      g.fillStyle = i % 2 === 0 ? '#2f7a3d' : '#2a7037';
      g.fillRect(Math.min(p0x, p1x), Math.min(p0y, p1y), Math.abs(p1x - p0x), Math.abs(p1y - p0y));
    }
    // leichte Vignette
    const [cx, cy] = P(PITCH_L / 2, PITCH_W / 2);
    const grad = g.createRadialGradient(cx, cy, s * 10, cx, cy, s * 75);
    grad.addColorStop(0, 'rgba(255,255,255,0.04)');
    grad.addColorStop(1, 'rgba(0,0,0,0.22)');
    g.fillStyle = grad;
    g.fillRect(0, 0, this.cssW, this.cssH);

    g.strokeStyle = 'rgba(255,255,255,0.88)';
    g.lineWidth = Math.max(1, 0.12 * s);
    g.lineCap = 'round';
    const rect = (x0: number, y0: number, x1: number, y1: number) => {
      const [a1, a2] = P(x0, y0);
      const [b1, b2] = P(x1, y1);
      g.strokeRect(Math.min(a1, b1), Math.min(a2, b2), Math.abs(b1 - a1), Math.abs(b2 - a2));
    };
    const line = (x0: number, y0: number, x1: number, y1: number) => {
      g.beginPath();
      g.moveTo(...P(x0, y0));
      g.lineTo(...P(x1, y1));
      g.stroke();
    };
    const arc = (x: number, y: number, r: number, a0: number, a1: number) => {
      g.beginPath();
      for (let i = 0; i <= 48; i++) {
        const a = a0 + ((a1 - a0) * i) / 48;
        const [px, py] = P(x + Math.cos(a) * r, y + Math.sin(a) * r);
        if (i === 0) g.moveTo(px, py);
        else g.lineTo(px, py);
      }
      g.stroke();
    };
    const dot = (x: number, y: number, r: number) => {
      g.beginPath();
      g.arc(...P(x, y), r * s, 0, Math.PI * 2);
      g.fillStyle = 'rgba(255,255,255,0.9)';
      g.fill();
    };

    rect(0, 0, PITCH_L, PITCH_W);
    line(PITCH_L / 2, 0, PITCH_L / 2, PITCH_W);
    arc(PITCH_L / 2, PITCH_W / 2, 9.15, 0, Math.PI * 2);
    dot(PITCH_L / 2, PITCH_W / 2, 0.3);
    for (const left of [true, false]) {
      const gx = left ? 0 : PITCH_L;
      const dir = left ? 1 : -1;
      rect(gx, 34 - 20.16, gx + dir * 16.5, 34 + 20.16);
      rect(gx, 34 - 9.16, gx + dir * 5.5, 34 + 9.16);
      const spot = gx + dir * 11;
      dot(spot, 34, 0.25);
      // Teilkreis außerhalb des Strafraums: cos(a) = 5.5/9.15
      const a = Math.acos(5.5 / 9.15);
      if (left) arc(spot, 34, 9.15, -a, a);
      else arc(spot, 34, 9.15, Math.PI - a, Math.PI + a);
      // Tor
      g.save();
      g.lineWidth = Math.max(1.5, 0.2 * s);
      g.strokeStyle = '#ffffff';
      rect(gx, 34 - 3.66, gx - dir * 1.8, 34 + 3.66);
      g.restore();
      // Tornetz angedeutet
      g.save();
      g.strokeStyle = 'rgba(255,255,255,0.25)';
      g.lineWidth = 1;
      for (let yy = 34 - 3.66 + 0.9; yy < 34 + 3.66; yy += 0.9) line(gx, yy, gx - dir * 1.8, yy);
      g.restore();
    }
    // Eckbögen
    arc(0, 0, 1, 0, Math.PI / 2);
    arc(PITCH_L, 0, 1, Math.PI / 2, Math.PI);
    arc(0, PITCH_W, 1, -Math.PI / 2, 0);
    arc(PITCH_L, PITCH_W, 1, Math.PI, Math.PI * 1.5);
    return c;
  }

  draw(frame: Frame, opts: RenderOptions): void {
    const g = this.ctx;
    if (!this.pitchLayer) this.pitchLayer = this.buildPitch();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    g.drawImage(this.pitchLayer, 0, 0);
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const s = this.scale;

    // Ballspur
    if (this.lastTau < 0 || frame.tau < this.lastTau || frame.tau - this.lastTau > 3) this.trail = [];
    this.lastTau = frame.tau;
    this.trail.push({ ...frame.ball });
    if (this.trail.length > 14) this.trail.shift();

    // Spieler-Schatten
    const r = Math.max(6, 1.2 * s);
    for (const p of frame.players) {
      const [x, y] = this.P(p.x, p.y);
      g.beginPath();
      g.ellipse(x + r * 0.18, y + r * 0.28, r * 1.02, r * 0.9, 0, 0, Math.PI * 2);
      g.fillStyle = 'rgba(0,0,0,0.28)';
      g.fill();
    }

    // Markierung Ballführender
    const holder = frame.players.find((p) => p.idx === frame.holder);
    if (holder) {
      const [x, y] = this.P(holder.x, holder.y);
      g.beginPath();
      g.arc(x, y, r * 1.75, 0, Math.PI * 2);
      g.strokeStyle = 'rgba(255, 214, 10, 0.95)';
      g.lineWidth = Math.max(1.5, 0.22 * s);
      g.stroke();
      g.beginPath();
      g.arc(x, y, r * 1.75, 0, Math.PI * 2);
      g.fillStyle = 'rgba(255, 214, 10, 0.12)';
      g.fill();
    }

    // Spieler
    const fontPx = Math.max(8, r * 1.1);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const p of frame.players) {
      const team = p.side === 'home' ? opts.home : opts.away;
      const [x, y] = this.P(p.x, p.y);
      const fill = p.isGK ? team.gkPrimary : team.primary;
      g.globalAlpha = p.leaving ? 0.45 : 1;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fillStyle = fill;
      g.fill();
      g.lineWidth = Math.max(1.2, r * 0.2);
      g.strokeStyle = p.isGK ? 'rgba(0,0,0,0.55)' : team.secondary;
      g.stroke();
      g.font = `700 ${fontPx}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
      g.fillStyle = p.isGK ? readableOn(fill) : team.numbers;
      g.fillText(String(p.number || ''), x, y + fontPx * 0.04);
      g.globalAlpha = 1;
    }

    // Ball: Schatten am Boden, Ball je nach Höhe versetzt und größer
    const b = frame.ball;
    const [bx, by] = this.P(b.x, b.y);
    const lift = b.z * s * 0.55;
    const br = Math.max(3, 0.42 * s) * (1 + Math.min(b.z, 12) * 0.045);
    g.beginPath();
    g.ellipse(bx + lift * 0.35, by + lift * 0.25, br * 0.95, br * 0.7, 0, 0, Math.PI * 2);
    g.fillStyle = `rgba(0,0,0,${Math.max(0.12, 0.38 - b.z * 0.02)})`;
    g.fill();
    // Spur
    if (this.trail.length > 2) {
      g.beginPath();
      this.trail.forEach((t, i) => {
        const [tx, ty] = this.P(t.x, t.y);
        const l = t.z * s * 0.55;
        if (i === 0) g.moveTo(tx, ty - l);
        else g.lineTo(tx, ty - l);
      });
      g.strokeStyle = 'rgba(255,255,255,0.35)';
      g.lineWidth = Math.max(1, br * 0.6);
      g.lineJoin = 'round';
      g.stroke();
    }
    g.beginPath();
    g.arc(bx, by - lift, br, 0, Math.PI * 2);
    g.fillStyle = '#ffffff';
    g.fill();
    g.lineWidth = Math.max(0.8, br * 0.22);
    g.strokeStyle = '#1a1a1a';
    g.stroke();

    // Namensschild Ballführender
    if (holder && opts.holderName) {
      const [x, y] = this.P(holder.x, holder.y);
      const fs = Math.max(11, Math.min(16, s * 1.25));
      g.font = `600 ${fs}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
      const text = opts.holderName;
      const tw = g.measureText(text).width;
      const padX = fs * 0.5;
      const hgt = fs * 1.5;
      let lx = x - tw / 2 - padX;
      let ly = y - r * 2.2 - hgt;
      lx = Math.max(4, Math.min(this.cssW - tw - 2 * padX - 4, lx));
      if (ly < 4) ly = y + r * 2.2;
      const team = holder.side === 'home' ? opts.home : opts.away;
      g.fillStyle = 'rgba(8, 14, 24, 0.82)';
      roundRect(g, lx, ly, tw + 2 * padX, hgt, hgt * 0.25);
      g.fill();
      g.fillStyle = team.primary;
      g.fillRect(lx, ly + hgt - 3, tw + 2 * padX, 3);
      g.fillStyle = '#ffffff';
      g.textAlign = 'left';
      g.fillText(text, lx + padX, ly + hgt / 2);
      g.textAlign = 'center';
    }
  }
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** Schwarz oder Weiß, je nachdem was auf der Farbe besser lesbar ist */
export function readableOn(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return '#ffffff';
  const n = parseInt(m[1]!, 16);
  const r = (n >> 16) & 255;
  const gg = (n >> 8) & 255;
  const b = n & 255;
  return 0.299 * r + 0.587 * gg + 0.114 * b > 150 ? '#111111' : '#ffffff';
}
