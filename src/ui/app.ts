/**
 * 2D-Testansicht: verbindet Engine-Ergebnis, Positions-Synthese, Canvas und TV-Einblendungen
 * und steuert die Wiedergabe (Tempo, Highlights, Spulen).
 */

import type { MatchResult, TeamSheet } from '../engine/types';
import { ENGINE_VERSION } from '../engine/version';
import { goalsOf, highlightWindows, statsUntil, type GoalInfo, type HighlightWindow } from '../viewer2d/highlights';
import { PositionSynth } from '../viewer2d/positions';
import { PitchRenderer } from '../viewer2d/renderer2d';
import { lineupBoard, statsBoard } from './boards';
import { clear, h } from './dom';
import { resolveKits, type Kit } from './kits';
import { Banners, Scorebug, Ticker } from './overlay';
import { TimelineBar } from './timelineBar';

export type Simulate = (home: TeamSheet, away: TeamSheet, seed: number) => MatchResult;

const SPEEDS = [1, 4, 8, 16, 32] as const;
const DEFAULT_SPEED = 16;

type SeekKind = 'play' | 'jump' | 'seek';

interface Match {
  result: MatchResult;
  synth: PositionSynth;
  kits: { home: Kit; away: Kit };
  goals: GoalInfo[];
  windows: HighlightWindow[];
}

export class ViewerApp {
  private readonly root: HTMLElement;
  private readonly simulate: Simulate;
  private readonly teams: TeamSheet[];
  private readonly demo: boolean;

  // DOM
  private readonly homeSel: HTMLSelectElement;
  private readonly awaySel: HTMLSelectElement;
  private readonly seedIn: HTMLInputElement;
  private readonly stage: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly board: HTMLElement;
  private readonly modeChip: HTMLElement;
  private readonly playBtn: HTMLButtonElement;
  private readonly hlBtn: HTMLButtonElement;
  private readonly speedBtns: HTMLButtonElement[] = [];
  private readonly errorBox: HTMLElement;

  private readonly renderer: PitchRenderer;
  private readonly scorebug = new Scorebug();
  private readonly banners = new Banners();
  private readonly ticker = new Ticker();
  private readonly bar: TimelineBar;

  private match: Match | null = null;
  private tau = 0;
  private playing = false;
  private speed = DEFAULT_SPEED;
  private speedBeforeHl = DEFAULT_SPEED;
  private highlights = false;
  private boardPrimary: (() => void) | null = null;
  private lastFrameTime = 0;
  private precomputeDone = false;
  private dirty = true;

  constructor(root: HTMLElement, simulate: Simulate, teams: TeamSheet[], demo: boolean) {
    this.root = root;
    this.simulate = simulate;
    this.teams = teams;
    this.demo = demo;

    // Kopfzeile
    const opt = (t: TeamSheet, i: number) => h('option', { value: String(i) }, t.name);
    this.homeSel = h('select', { id: 'sel-home' }, ...teams.map(opt));
    this.awaySel = h('select', { id: 'sel-away' }, ...teams.map(opt));
    this.seedIn = h('input', { id: 'seed', type: 'number', inputmode: 'numeric', min: 0, step: 1, value: '1' });
    const newBtn = h('button', { class: 'btn primary', type: 'button', onclick: () => this.newMatchFromInputs() }, 'Neues Spiel');
    const diceBtn = h(
      'button',
      { class: 'btn', type: 'button', title: 'Zufällige Spiel-Nummer', onclick: () => this.randomSeed() },
      'Zufall',
    );

    const topbar = h(
      'header',
      { class: 'topbar' },
      h(
        'div',
        { class: 'brand' },
        'Fußball-Simulator',
        h('small', {}, 'Simulation – kein echtes Spiel'),
        h('small', { class: 'stamp', title: `Engine ${ENGINE_VERSION}` }, `Stand ${__BUILD_STAMP__}`),
      ),
      h('label', { class: 'field', for: 'sel-home' }, 'Heim', this.homeSel),
      h('span', { class: 'vs', 'aria-hidden': 'true' }, 'gegen'),
      h('label', { class: 'field', for: 'sel-away' }, 'Gast', this.awaySel),
      h('label', { class: 'field', for: 'seed' }, 'Spiel-Nr.', this.seedIn),
      diceBtn,
      newBtn,
    );

    // Bühne
    this.canvas = h('canvas', { role: 'img', 'aria-label': 'Spielfeld von oben' });
    this.board = h('div', { class: 'board', hidden: true });
    this.modeChip = h('div', { class: 'mode-chip', hidden: true });
    this.stage = h(
      'div',
      { class: 'stage' },
      this.canvas,
      this.scorebug.el,
      this.modeChip,
      this.banners.el,
      h('div', { class: 'sim-note' }, 'Simulation – kein echtes Spiel'),
      this.board,
    );
    this.renderer = new PitchRenderer(this.canvas);

    // Zeitleiste
    this.bar = new TimelineBar((t) => {
      this.hideBoard();
      this.setTau(t, 'seek');
    });

    // Steuerung
    this.playBtn = h('button', { class: 'btn icon-btn', type: 'button', 'aria-label': 'Abspielen', onclick: () => this.togglePlay() });
    const restartBtn = h(
      'button',
      { class: 'btn icon-btn', type: 'button', 'aria-label': 'Von vorn', title: 'Von vorn', onclick: () => this.restart() },
      svgIcon('restart'),
    );
    const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Tempo' });
    for (const s of SPEEDS) {
      const b = h('button', { type: 'button', 'aria-pressed': 'false', title: s === 1 ? 'Echtzeit' : `${s}-fach`, onclick: () => this.setSpeed(s) }, `${s}×`);
      this.speedBtns.push(b);
      seg.append(b);
    }
    this.hlBtn = h(
      'button',
      { class: 'btn toggle', type: 'button', 'aria-pressed': 'false', title: 'Nur Tore und Großchancen, je ca. 10 s Vorlauf', onclick: () => this.toggleHighlights() },
      'Highlights',
    );
    const controls = h(
      'section',
      { class: 'controls', 'aria-label': 'Wiedergabe' },
      this.playBtn,
      restartBtn,
      seg,
      this.hlBtn,
      h('span', { class: 'spacer' }),
      h('span', { class: 'hint' }, 'Leertaste: Pause · Pfeiltasten: 15 s spulen'),
    );

    this.errorBox = h('div', { class: 'error', hidden: true, role: 'alert' });
    const note = h(
      'p',
      { class: 'footer-note' },
      demo
        ? 'Noch keine Mannschaftsdateien hinterlegt – es spielen zwei Demo-Mannschaften mit erfundenen Spielern. '
        : '',
      'Gleiche Mannschaften und gleiche Spiel-Nummer ergeben immer genau dasselbe Spiel.',
    );

    clear(root);
    root.append(
      h('div', { class: 'app' }, topbar, this.errorBox, this.stage, this.bar.el, controls, this.ticker.el, note),
    );

    new ResizeObserver(() => {
      this.renderer.resize();
      this.dirty = true;
    }).observe(this.stage);
    this.renderer.resize();
    window.addEventListener('keydown', (e) => this.onKey(e));
    this.updateButtons();
  }

  // ───────────────────────────── Spiel anlegen ─────────────────────────────

  start(): void {
    const p = parseHash();
    const idx = (id: string | undefined, fallback: number) => {
      const i = id ? this.teams.findIndex((t) => t.id === id) : -1;
      return i >= 0 ? i : Math.min(fallback, this.teams.length - 1);
    };
    this.homeSel.value = String(idx(p.home, 0));
    this.awaySel.value = String(idx(p.away, 1));
    this.seedIn.value = String(p.seed ?? 1);
    this.newMatchFromInputs();
    requestAnimationFrame((t) => this.loop(t));
  }

  private randomSeed(): void {
    // Zufall nur für die Wahl der Spiel-Nummer (Bedienoberfläche), nicht in der Engine
    this.seedIn.value = String(1 + Math.floor(Math.random() * 999_999));
    this.newMatchFromInputs();
  }

  private newMatchFromInputs(): void {
    const home = this.teams[Number(this.homeSel.value)] ?? this.teams[0]!;
    const away = this.teams[Number(this.awaySel.value)] ?? this.teams[1] ?? this.teams[0]!;
    let seed = Math.floor(Number(this.seedIn.value));
    if (!Number.isFinite(seed) || seed < 0) seed = 1;
    this.seedIn.value = String(seed);
    try {
      history.replaceState(null, '', `#h=${encodeURIComponent(home.id)}&a=${encodeURIComponent(away.id)}&s=${seed}`);
    } catch {
      /* z. B. file:// – egal */
    }
    this.load(home, away, seed);
  }

  private load(home: TeamSheet, away: TeamSheet, seed: number): void {
    let result: MatchResult;
    try {
      result = this.simulate(home, away, seed);
      this.errorBox.hidden = true;
    } catch (err) {
      this.errorBox.hidden = false;
      this.errorBox.textContent = `Das Spiel konnte nicht berechnet werden: ${err instanceof Error ? err.message : String(err)}`;
      return;
    }
    const synth = new PositionSynth(result);
    const k = resolveKits(result.home, result.away);
    const kits = { home: k.home, away: k.away };
    const goals = goalsOf(synth.timeline);
    this.match = { result, synth, kits, goals, windows: highlightWindows(synth.timeline) };
    this.precomputeDone = false;
    this.scorebug.setTeams(result.home, result.away, kits);
    this.ticker.setMatch(synth.timeline, kits);
    this.bar.setMatch(result, synth.timeline, goals, kits);
    this.banners.clearAll();
    this.renderer.resetTrail();
    this.playing = false;
    this.tau = 0;
    this.setTau(0, 'seek');
    this.showLineup();
  }

  // ───────────────────────────── Tafeln ─────────────────────────────

  private showBoard(content: HTMLElement, primary: () => void): void {
    this.board.replaceChildren(content);
    this.board.hidden = false;
    this.boardPrimary = primary;
    const af = content.querySelector<HTMLElement>('[data-autofocus]');
    if (af && document.activeElement && document.activeElement !== document.body && this.stage.contains(document.activeElement) === false) {
      // Fokus nicht aus Eingabefeldern reißen
    } else af?.focus({ preventScroll: true });
    this.updateButtons();
  }

  private hideBoard(): void {
    this.board.hidden = true;
    this.boardPrimary = null;
    this.updateButtons();
  }

  private showLineup(): void {
    const m = this.match;
    if (!m) return;
    const kick = () => {
      this.hideBoard();
      if (this.tau >= m.synth.timeline.endTau) this.setTau(0, 'seek');
      this.play();
    };
    this.showBoard(lineupBoard(m.result.home, m.result.away, m.kits, m.result.seed, kick), kick);
  }

  private showHalfTime(): void {
    const m = this.match;
    if (!m) return;
    const tl = m.synth.timeline;
    const cont = () => {
      this.hideBoard();
      this.play();
    };
    const stats = statsUntil(m.result, tl, tl.halfTimeTau);
    this.showBoard(
      statsBoard({
        result: m.result,
        title: 'Halbzeit',
        score: tl.scoreAt(tl.halfTimeTau),
        stats,
        goals: m.goals.filter((g) => g.tau <= tl.halfTimeTau),
        kits: m.kits,
        actions: [{ label: 'Weiter zur 2. Halbzeit', primary: true, onClick: cont }],
      }),
      cont,
    );
  }

  private showFullTime(): void {
    const m = this.match;
    if (!m) return;
    const again = () => {
      this.hideBoard();
      this.restart();
    };
    this.showBoard(
      statsBoard({
        result: m.result,
        title: 'Abpfiff',
        score: m.result.score,
        stats: m.result.stats,
        goals: m.goals,
        kits: m.kits,
        actions: [
          { label: 'Nächstes Spiel', primary: true, onClick: () => this.randomSeed() },
          { label: 'Noch einmal ansehen', onClick: again },
        ],
      }),
      () => this.randomSeed(),
    );
  }

  // ───────────────────────────── Wiedergabe ─────────────────────────────

  private play(): void {
    if (!this.match) return;
    if (this.tau >= this.match.synth.timeline.endTau - 0.05) this.setTau(0, 'seek');
    if (this.highlights) this.enterNextWindow();
    this.playing = true;
    this.updateButtons();
  }

  private pause(): void {
    this.playing = false;
    this.updateButtons();
  }

  private togglePlay(): void {
    if (this.boardPrimary) {
      this.boardPrimary();
      return;
    }
    if (this.playing) this.pause();
    else this.play();
  }

  private restart(): void {
    this.pause();
    this.banners.clearAll();
    this.setTau(0, 'seek');
    this.showLineup();
  }

  private setSpeed(s: number): void {
    this.speed = s;
    this.updateButtons();
  }

  private toggleHighlights(): void {
    this.highlights = !this.highlights;
    if (this.highlights) {
      this.speedBeforeHl = this.speed;
      this.speed = 1;
      if (this.board.hidden) this.enterNextWindow();
    } else {
      this.speed = this.speedBeforeHl;
    }
    this.updateButtons();
  }

  /** Im Highlight-Modus: zum nächsten Fenster springen, falls außerhalb */
  private enterNextWindow(): void {
    const m = this.match;
    if (!m) return;
    const w = m.windows.find((x) => x.to > this.tau + 0.05);
    if (!w) {
      this.setTau(m.synth.timeline.endTau, 'jump');
      return;
    }
    if (this.tau < w.from) this.setTau(w.from, 'jump');
  }

  private seekBy(d: number): void {
    const m = this.match;
    if (!m) return;
    this.hideBoard();
    this.setTau(Math.max(0, Math.min(m.synth.timeline.endTau, this.tau + d)), 'seek');
  }

  private setTau(newTau: number, kind: SeekKind): void {
    const m = this.match;
    if (!m) return;
    const tl = m.synth.timeline;
    const prev = this.tau;
    const t = Math.max(0, Math.min(tl.endTau, newTau));
    this.tau = t;
    this.dirty = true;

    if (kind === 'seek' || t < prev) {
      this.banners.clearAll();
      this.renderer.resetTrail();
    }
    if (kind === 'jump') this.renderer.resetTrail();

    // Bauchbinden für Ereignisse, die im normalen Abspielen überschritten wurden
    if (kind === 'play' && t > prev) {
      const i0 = tl.eventIndexAt(prev) + 1;
      const i1 = tl.eventIndexAt(t);
      const now = performance.now();
      for (let i = i0; i <= i1; i++) {
        const ev = tl.events[i]!.ev;
        if (ev.type === 'goal' || ev.type === 'yellow-card' || ev.type === 'red-card' || ev.type === 'substitution') {
          this.banners.show(ev, m.result, m.kits, now);
        }
      }
    }
    this.ticker.update(tl.eventIndexAt(t));
    this.bar.setTime(t);

    if (kind !== 'seek') {
      if (tl.hasSecondHalf && prev < tl.halfTimeTau && t >= tl.halfTimeTau && t < tl.endTau) {
        this.pause();
        this.showHalfTime();
      } else if (prev < tl.endTau && t >= tl.endTau) {
        this.pause();
        this.showFullTime();
      }
    }
  }

  private loop(now: number): void {
    const dtReal = this.lastFrameTime ? Math.min(0.1, (now - this.lastFrameTime) / 1000) : 0;
    this.lastFrameTime = now;
    const m = this.match;
    if (m) {
      if (this.playing) {
        let next = this.tau + dtReal * this.speed;
        if (this.highlights) {
          const cur = m.windows.find((w) => this.tau >= w.from - 0.05 && this.tau <= w.to);
          if (!cur || next > cur.to) {
            const nw = m.windows.find((w) => w.from > this.tau + 0.05 && w.to > next);
            if (nw && (!cur || next > cur.to)) {
              this.setTau(Math.min(next, cur ? cur.to : next), 'play');
              if (this.playing) this.setTau(nw.from, 'jump');
              next = -1;
            } else if (!nw) {
              this.setTau(m.synth.timeline.endTau, 'jump');
              next = -1;
            }
          }
        }
        if (next >= 0) this.setTau(next, 'play');
      }
      // Vorberechnung im Hintergrund, damit späteres Spulen sofort geht
      if (!this.precomputeDone) this.precomputeDone = m.synth.precompute(this.playing ? 400 : 1500);

      if (this.dirty || this.playing) this.render();
      this.banners.tick(now);
    }
    requestAnimationFrame((t) => this.loop(t));
  }

  private render(): void {
    const m = this.match;
    if (!m) return;
    this.dirty = false;
    const frame = m.synth.frameAt(this.tau);
    const holder = frame.holder >= 0 ? m.synth.agents[frame.holder] : undefined;
    this.renderer.draw(frame, { home: m.kits.home, away: m.kits.away, holderName: holder ? holder.shortName : undefined });
    const tl = m.synth.timeline;
    this.scorebug.update(tl.scoreAt(this.tau), tl.clockAt(this.tau));
  }

  // ───────────────────────────── Bedienung ─────────────────────────────

  private updateButtons(): void {
    const playingNow = this.playing;
    this.playBtn.replaceChildren(svgIcon(playingNow ? 'pause' : 'play'));
    this.playBtn.setAttribute('aria-label', playingNow ? 'Pause' : 'Abspielen');
    this.playBtn.title = playingNow ? 'Pause (Leertaste)' : 'Abspielen (Leertaste)';
    SPEEDS.forEach((s, i) => this.speedBtns[i]!.setAttribute('aria-pressed', String(s === this.speed)));
    this.hlBtn.setAttribute('aria-pressed', String(this.highlights));
    const chip = this.highlights ? 'Highlights' : !playingNow && this.board.hidden && this.match ? 'Pause' : '';
    this.modeChip.hidden = !chip;
    this.modeChip.textContent = chip;
  }

  private onKey(e: KeyboardEvent): void {
    const tgt = e.target as HTMLElement | null;
    const tag = tgt?.tagName;
    if (tag === 'INPUT' && (tgt as HTMLInputElement).type !== 'range') return;
    if (tag === 'SELECT' || tag === 'TEXTAREA') return;
    if (e.code === 'Space' || e.key === ' ') {
      if (tag === 'BUTTON' && tgt !== this.playBtn) return; // Leertaste aktiviert fokussierte Knöpfe selbst
      e.preventDefault();
      this.togglePlay();
    } else if (e.key === 'ArrowRight' && tag !== 'INPUT') {
      e.preventDefault();
      this.seekBy(15);
    } else if (e.key === 'ArrowLeft' && tag !== 'INPUT') {
      e.preventDefault();
      this.seekBy(-15);
    }
  }
}

function parseHash(): { home?: string; away?: string; seed?: number } {
  const out: { home?: string; away?: string; seed?: number } = {};
  const q = new URLSearchParams(location.hash.replace(/^#/, ''));
  const hh = q.get('h');
  const a = q.get('a');
  const s = q.get('s');
  if (hh) out.home = hh;
  if (a) out.away = a;
  if (s && /^\d+$/.test(s)) out.seed = Number(s);
  return out;
}

function svgIcon(kind: 'play' | 'pause' | 'restart'): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '20');
  svg.setAttribute('height', '20');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('fill', 'currentColor');
  const d = {
    play: 'M7 4.5v15l13-7.5z',
    pause: 'M6 4.5h4.2v15H6zM13.8 4.5H18v15h-4.2z',
    restart: 'M12 5a7 7 0 1 1-6.93 8h2.03A5 5 0 1 0 12 7v3L7.5 6 12 2z',
  }[kind];
  path.setAttribute('d', d);
  svg.append(path);
  return svg;
}
