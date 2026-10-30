/**
 * Momentum-Graph mit integrierter Spulleiste: Balken pro Minute (oben Heim, unten Gast),
 * Tor-Markierungen, Halbzeit-Trenner und Abspielposition. Ein unsichtbarer Range-Input
 * darüber sorgt für Tastatur- und Touch-Bedienung.
 */

import type { MatchResult } from '../engine/types';
import type { GoalInfo } from '../viewer2d/highlights';
import type { MatchTimeline } from '../viewer2d/timeline';
import { h } from './dom';
import type { Kit } from './kits';

export class TimelineBar {
  readonly el: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly input: HTMLInputElement;
  private readonly legendHome: HTMLElement;
  private readonly legendAway: HTMLElement;
  private tl: MatchTimeline | null = null;
  private result: MatchResult | null = null;
  private goals: GoalInfo[] = [];
  private kits: { home: Kit; away: Kit } | null = null;
  private tau = 0;
  private dragging = false;
  private onSeek: (tau: number) => void;
  private base: HTMLCanvasElement | null = null;
  private w = 0;
  private hgt = 0;
  private dpr = 1;

  constructor(onSeek: (tau: number) => void) {
    this.onSeek = onSeek;
    this.canvas = h('canvas', { 'aria-hidden': 'true' });
    this.input = h('input', { type: 'range', min: 0, max: 1000, step: 1, value: 0, 'aria-label': 'Spielzeit spulen' });
    this.input.addEventListener('input', () => {
      if (!this.tl) return;
      this.onSeek((Number(this.input.value) / 1000) * this.tl.endTau);
    });
    this.input.addEventListener('pointerdown', () => (this.dragging = true));
    window.addEventListener('pointerup', () => (this.dragging = false));
    this.legendHome = h('span');
    this.legendAway = h('span');
    this.el = h(
      'section',
      { class: 'timeline', 'aria-label': 'Spielverlauf' },
      h('div', { class: 'tl-head' }, h('span', {}, 'Spielverlauf und Druckphasen'), h('span', { class: 'legend' }, this.legendHome, this.legendAway)),
      h('div', { class: 'track' }, this.canvas, this.input),
    );
    new ResizeObserver(() => this.layout()).observe(this.el);
  }

  setMatch(result: MatchResult, tl: MatchTimeline, goals: GoalInfo[], kits: { home: Kit; away: Kit }): void {
    this.result = result;
    this.tl = tl;
    this.goals = goals;
    this.kits = kits;
    this.legendHome.replaceChildren(h('i', { style: `background:${kits.home.primary}` }), result.home.shortName);
    this.legendAway.replaceChildren(h('i', { style: `background:${kits.away.primary}` }), result.away.shortName);
    this.base = null;
    this.layout();
  }

  private layout(): void {
    const track = this.canvas.parentElement;
    if (!track) return;
    const w = track.clientWidth;
    const hh = track.clientHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    if (w === this.w && hh === this.hgt && dpr === this.dpr && this.base) return;
    this.w = w;
    this.hgt = hh;
    this.dpr = dpr;
    this.canvas.width = Math.max(1, Math.round(w * dpr));
    this.canvas.height = Math.max(1, Math.round(hh * dpr));
    this.base = null;
    this.draw();
  }

  private x(tau: number): number {
    const end = this.tl?.endTau || 1;
    return 4 + ((this.w - 8) * tau) / end;
  }

  private buildBase(): HTMLCanvasElement | null {
    const tl = this.tl;
    const res = this.result;
    const kits = this.kits;
    if (!tl || !res || !kits || this.w <= 0) return null;
    const c = document.createElement('canvas');
    c.width = this.canvas.width;
    c.height = this.canvas.height;
    const g = c.getContext('2d')!;
    g.scale(this.dpr, this.dpr);
    const mid = this.hgt / 2;
    const amp = mid - 12;
    // Nulllinie
    g.fillStyle = 'rgba(255,255,255,0.18)';
    g.fillRect(4, mid - 0.5, this.w - 8, 1);
    // Balken pro Minute (Engine-Zeit → τ)
    const m = res.momentum;
    for (let i = 0; i < m.length; i++) {
      const v = Math.max(-1, Math.min(1, m[i] ?? 0));
      if (Math.abs(v) < 0.02) continue;
      const t0 = tl.tauOfEngineT(i * 60);
      const t1 = tl.tauOfEngineT((i + 1) * 60);
      const x0 = this.x(t0);
      const x1 = this.x(Math.min(t1, tl.endTau));
      const bw = Math.max(1, x1 - x0 - 1);
      g.fillStyle = v > 0 ? kits.home.primary : kits.away.primary;
      g.globalAlpha = 0.9;
      if (v > 0) g.fillRect(x0, mid - v * amp, bw, v * amp);
      else g.fillRect(x0, mid, bw, -v * amp);
    }
    g.globalAlpha = 1;
    // Halbzeit
    if (tl.hasSecondHalf) {
      const hx = this.x(tl.halfTimeTau);
      g.fillStyle = 'rgba(255,255,255,0.45)';
      g.fillRect(hx - 0.5, 2, 1, this.hgt - 4);
      g.font = '600 10px system-ui, sans-serif';
      g.fillStyle = 'rgba(255,255,255,0.55)';
      g.textAlign = 'center';
      g.fillText('HZ', hx, this.hgt - 1);
    }
    // Tore
    for (const goal of this.goals) {
      const gx = this.x(goal.tau);
      const top = goal.side === 'home';
      const y = top ? 7 : this.hgt - 7;
      g.beginPath();
      g.arc(gx, y, 5.5, 0, Math.PI * 2);
      g.fillStyle = '#ffd60a';
      g.fill();
      g.strokeStyle = 'rgba(0,0,0,0.6)';
      g.lineWidth = 1;
      g.stroke();
      g.fillStyle = 'rgba(255,214,10,0.55)';
      g.fillRect(gx - 0.5, top ? 12 : mid, 1, top ? mid - 12 : mid - 12);
    }
    return c;
  }

  setTime(tau: number): void {
    this.tau = tau;
    if (!this.dragging && this.tl) this.input.value = String(Math.round((tau / (this.tl.endTau || 1)) * 1000));
    if (this.tl) {
      const clock = this.tl.clockAt(tau);
      this.input.setAttribute('aria-valuetext', `${clock.main}${clock.stoppage ?? ''}`);
    }
    this.draw();
  }

  private draw(): void {
    const g = this.canvas.getContext('2d');
    if (!g) return;
    if (!this.base) this.base = this.buildBase();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (!this.base) return;
    g.drawImage(this.base, 0, 0);
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    // bereits gespielter Teil leicht aufgehellt, Rest abgedunkelt
    const px = this.x(this.tau);
    g.fillStyle = 'rgba(8,19,28,0.55)';
    g.fillRect(px, 0, this.w - px, this.hgt);
    g.fillStyle = '#ffffff';
    g.fillRect(px - 1, 0, 2, this.hgt);
    g.beginPath();
    g.moveTo(px - 5, 0);
    g.lineTo(px + 5, 0);
    g.lineTo(px, 6);
    g.closePath();
    g.fill();
  }
}
