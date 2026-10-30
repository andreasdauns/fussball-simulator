/**
 * TV-Einblendungen über dem Spielfeld: Anzeigetafel, Bauchbinden (Tor, Karte, Wechsel)
 * und Live-Ticker. Reine Darstellung.
 */

import type { MatchEvent, MatchResult, Player, TeamSheet, TeamSide } from '../engine/types';
import type { ClockDisplay, MatchTimeline } from '../viewer2d/timeline';
import { clear, h } from './dom';
import type { Kit } from './kits';

export function findPlayer(sheet: TeamSheet, id: string | undefined): Player | undefined {
  if (!id) return undefined;
  return sheet.players.find((p) => p.id === id) ?? sheet.bench.find((p) => p.id === id);
}

export function nameOn(result: MatchResult, side: TeamSide, id: string | undefined, full = false): string {
  if (!id) return '';
  const p = findPlayer(side === 'home' ? result.home : result.away, id) ?? findPlayer(side === 'home' ? result.away : result.home, id);
  if (!p) return id;
  return full ? p.name : p.shortName;
}

// ───────────────────────────── Anzeigetafel ─────────────────────────────

export class Scorebug {
  readonly el: HTMLElement;
  private readonly homeName: HTMLElement;
  private readonly awayName: HTMLElement;
  private readonly homeKit: HTMLElement;
  private readonly awayKit: HTMLElement;
  private readonly score: HTMLElement;
  private readonly clock: HTMLElement;
  private readonly time: HTMLElement;
  private readonly stoppage: HTMLElement;
  private readonly half: HTMLElement;
  private last = '';

  constructor() {
    this.homeKit = h('span', { class: 'kit' });
    this.awayKit = h('span', { class: 'kit' });
    this.homeName = h('span');
    this.awayName = h('span');
    this.score = h('div', { class: 'score' }, '0–0');
    this.time = h('span', {}, '00:00');
    this.stoppage = h('span', { class: 'stoppage', hidden: true });
    this.half = h('span', { class: 'half' });
    this.clock = h('div', { class: 'clock' }, this.time, this.stoppage, this.half);
    this.el = h(
      'div',
      { class: 'scorebug', role: 'status', 'aria-live': 'off' },
      h('div', { class: 'team home' }, this.homeKit, this.homeName),
      this.score,
      h('div', { class: 'team away' }, this.awayName, this.awayKit),
      this.clock,
    );
  }

  setTeams(home: TeamSheet, away: TeamSheet, kits: { home: Kit; away: Kit }): void {
    this.homeName.textContent = home.shortName;
    this.awayName.textContent = away.shortName;
    this.homeKit.style.background = kits.home.primary;
    this.awayKit.style.background = kits.away.primary;
    this.last = '';
  }

  update(score: { home: number; away: number }, clock: ClockDisplay): void {
    const key = `${score.home}-${score.away}|${clock.main}|${clock.stoppage ?? ''}|${clock.phase}`;
    if (key === this.last) return;
    this.last = key;
    this.score.textContent = `${score.home}–${score.away}`;
    this.time.textContent = clock.main;
    this.stoppage.hidden = !clock.stoppage;
    this.stoppage.textContent = clock.stoppage ?? '';
    this.half.textContent =
      clock.phase === 'pre' ? 'vor Anpfiff' : clock.phase === 'half-time' ? 'Halbzeit' : clock.phase === 'full-time' ? 'Ende' : clock.half === 1 ? '1. HZ' : '2. HZ';
  }
}

// ───────────────────────────── Bauchbinden ─────────────────────────────

interface ActiveBanner {
  el: HTMLElement;
  until: number;
}

export class Banners {
  readonly el: HTMLElement;
  private active: ActiveBanner[] = [];

  constructor() {
    this.el = h('div', { class: 'banners', 'aria-live': 'polite' });
  }

  clearAll(): void {
    clear(this.el);
    this.active = [];
  }

  private push(el: HTMLElement, ms: number, now: number): void {
    this.el.append(el);
    this.active.push({ el, until: now + ms });
    while (this.active.length > 3) {
      const b = this.active.shift()!;
      b.el.remove();
    }
  }

  tick(now: number): void {
    for (const b of this.active) {
      if (now > b.until && !b.el.classList.contains('out')) {
        b.el.classList.add('out');
        b.until = now + 250;
        b.el.dataset.dying = '1';
      } else if (b.el.dataset.dying && now > b.until) {
        b.el.remove();
      }
    }
    this.active = this.active.filter((b) => b.el.isConnected);
  }

  show(ev: MatchEvent, result: MatchResult, kits: { home: Kit; away: Kit }, now: number): void {
    const team = ev.team === 'home' ? result.home : result.away;
    const kit = ev.team === 'home' ? kits.home : kits.away;
    if (ev.type === 'goal') {
      const scorer = nameOn(result, ev.team, ev.playerId, true);
      const minute = ev.clock.includes('+') ? ev.clock : `${ev.clock}.`;
      const own = /eigentor/i.test(ev.text ?? '');
      const el = h(
        'div',
        { class: 'banner goal' },
        h('div', { class: 'tag' }, 'TOR!'),
        h('div', { class: 'kitbar', style: `background:${kit.primary}` }),
        h(
          'div',
          { class: 'body' },
          h('div', { class: 'main' }, scorer || team.shortName),
          h('div', { class: 'sub' }, `${team.shortName} · ${minute} Minute${own ? ' · Eigentor' : ''}`),
        ),
        h('div', { class: 'score-now' }, `${ev.score.home}–${ev.score.away}`),
      );
      this.push(el, 6000, now);
    } else if (ev.type === 'yellow-card' || ev.type === 'red-card') {
      const red = ev.type === 'red-card';
      const el = h(
        'div',
        { class: 'banner card' },
        h('div', { class: 'tag' }, h('span', { class: `card-icon ${red ? 'red' : 'yellow'}`, 'aria-hidden': 'true' })),
        h('div', { class: 'kitbar', style: `background:${kit.primary}` }),
        h(
          'div',
          { class: 'body' },
          h('div', { class: 'main' }, nameOn(result, ev.team, ev.playerId, true)),
          h('div', { class: 'sub' }, `${red ? 'Rote Karte' : 'Gelbe Karte'} · ${team.shortName} · ${ev.clock}.`),
        ),
      );
      this.push(el, 4000, now);
    } else if (ev.type === 'substitution') {
      const el = h(
        'div',
        { class: 'banner sub' },
        h('div', { class: 'kitbar', style: `background:${kit.primary}` }),
        h(
          'div',
          { class: 'body' },
          h('div', { class: 'main' }, h('span', { class: 'on' }, '▲ '), nameOn(result, ev.team, ev.otherPlayerId, true)),
          h('div', { class: 'main' }, h('span', { class: 'off' }, '▼ '), nameOn(result, ev.team, ev.playerId, true)),
          h('div', { class: 'sub' }, `Wechsel · ${team.shortName} · ${ev.clock}.`),
        ),
      );
      this.push(el, 4000, now);
    }
  }
}

// ───────────────────────────── Ticker ─────────────────────────────

export class Ticker {
  readonly el: HTMLElement;
  private readonly list: HTMLOListElement;
  private readonly empty: HTMLElement;
  private shownUpTo = -1;
  private tl: MatchTimeline | null = null;
  private kits: { home: Kit; away: Kit } | null = null;

  constructor() {
    this.list = h('ol', { 'aria-live': 'polite', 'aria-relevant': 'additions' });
    this.empty = h('div', { class: 'empty' }, 'Der Ticker startet mit dem Anpfiff.');
    this.el = h('aside', { class: 'ticker', 'aria-label': 'Live-Ticker' }, h('h3', {}, 'Live-Ticker'), this.empty, this.list);
  }

  setMatch(tl: MatchTimeline, kits: { home: Kit; away: Kit }): void {
    this.tl = tl;
    this.kits = kits;
    this.shownUpTo = -1;
    clear(this.list);
    this.empty.hidden = false;
  }

  private item(ev: MatchEvent): HTMLLIElement {
    const kit = this.kits ? (ev.team === 'home' ? this.kits.home : this.kits.away) : null;
    let markColor = kit?.primary ?? '#888';
    if (ev.type === 'yellow-card') markColor = 'var(--yellow-card)';
    if (ev.type === 'red-card') markColor = 'var(--red-card)';
    const neutral = ev.type === 'half-time' || ev.type === 'full-time' || ev.type === 'kickoff';
    return h(
      'li',
      { class: ev.type === 'goal' ? 'goal' : '' },
      h('span', { class: 'm' }, `${ev.clock}'`),
      h(
        'span',
        { class: 't' },
        neutral ? null : h('span', { class: 'mark', style: `background:${markColor}`, 'aria-hidden': 'true' }),
        h('span', {}, ev.text ?? ''),
      ),
    );
  }

  /** Bis zum Ereignisindex `idx` (inklusive) anzeigen; neueste oben. */
  update(idx: number): void {
    if (!this.tl || idx === this.shownUpTo) return;
    const evs = this.tl.events;
    if (idx < this.shownUpTo) {
      clear(this.list);
      this.shownUpTo = -1;
    }
    const frag: HTMLLIElement[] = [];
    for (let i = this.shownUpTo + 1; i <= idx && i < evs.length; i++) {
      const ev = evs[i]!.ev;
      if (ev.text) frag.push(this.item(ev));
    }
    for (const li of frag) this.list.prepend(li);
    while (this.list.children.length > 250) this.list.lastElementChild?.remove();
    this.shownUpTo = idx;
    this.empty.hidden = this.list.children.length > 0;
  }
}
