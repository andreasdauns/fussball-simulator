/**
 * Vollbild-Tafeln: Aufstellung vor dem Anpfiff, Statistik zur Halbzeit und zum Abpfiff.
 */

import type { MatchResult, TeamMatchStats, TeamSheet } from '../engine/types';
import type { GoalInfo } from '../viewer2d/highlights';
import { readableOn } from '../viewer2d/renderer2d';
import { h } from './dom';
import type { Kit } from './kits';
import { findPlayer, nameOn } from './overlay';

function lineupCard(team: TeamSheet, kit: Kit): HTMLElement {
  const pitch = h('div', { class: 'mini-pitch', role: 'img', 'aria-label': `Aufstellung ${team.name}, ${team.tactic.formation}` });
  for (const slot of team.lineup) {
    const p = findPlayer(team, slot.playerId);
    const gk = slot.position === 'GK';
    const fill = gk ? kit.gkPrimary : kit.primary;
    // Eigenes Tor unten, Angriff nach oben; Team-y = 0 liegt in Angriffsrichtung links
    const x = Math.max(4, Math.min(60, slot.anchorDefend.x));
    const top = 100 - ((x - 1) / 61) * 100;
    const left = 6 + (slot.anchorDefend.y / 68) * 88;
    pitch.append(
      h(
        'div',
        { class: 'mini-player', style: `top:${top.toFixed(1)}%;left:${left.toFixed(1)}%` },
        h(
          'span',
          { class: 'dot', style: `background:${fill};color:${gk ? readableOn(fill) : kit.numbers};border-color:${gk ? 'rgba(0,0,0,.4)' : kit.secondary}` },
          String(p?.number ?? ''),
        ),
        h('span', { class: 'nm' }, p?.shortName ?? slot.playerId),
      ),
    );
  }
  const bench = team.bench.map((b) => `${b.number} ${b.shortName}`).join(', ');
  return h(
    'section',
    { class: 'lineup-card' },
    h(
      'header',
      {},
      h('span', { class: 'swatch', style: `background:linear-gradient(180deg, ${kit.primary} 0 60%, ${kit.secondary} 60% 100%)` }),
      h('div', {}, h('div', { class: 'tname' }, team.name), h('div', { class: 'tmeta' }, `${team.tactic.formation} · Saison ${team.season}`)),
    ),
    pitch,
    h('div', { class: 'coach' }, 'Trainer: ', h('b', {}, team.coach.name)),
    bench ? h('div', { class: 'bench' }, `Bank: ${bench}`) : null,
  );
}

export function lineupBoard(home: TeamSheet, away: TeamSheet, kits: { home: Kit; away: Kit }, seed: number, onStart: () => void): HTMLElement {
  return h(
    'div',
    { class: 'board-inner' },
    h('div', { class: 'board-head' }, h('h2', {}, 'Aufstellungen'), h('span', { class: 'meta' }, `Spiel-Nr. ${seed} · Simulation – kein echtes Spiel`)),
    h('div', { class: 'lineups' }, lineupCard(home, kits.home), lineupCard(away, kits.away)),
    h('div', { class: 'board-actions' }, h('button', { class: 'btn primary', onclick: onStart, 'data-autofocus': '1' }, 'Anpfiff')),
  );
}

interface StatDef {
  label: string;
  get: (s: TeamMatchStats) => number;
  fmt?: (v: number) => string;
}

const STATS: StatDef[] = [
  { label: 'Ballbesitz', get: (s) => s.possession, fmt: (v) => `${Math.round(v)} %` },
  { label: 'Torschüsse', get: (s) => s.shots },
  { label: 'Aufs Tor', get: (s) => s.shotsOnTarget },
  { label: 'Erwartete Tore (xG)', get: (s) => s.xg, fmt: (v) => v.toFixed(2).replace('.', ',') },
  { label: 'Pässe', get: (s) => s.passes },
  { label: 'Passquote', get: (s) => s.passAccuracy, fmt: (v) => `${Math.round(v)} %` },
  { label: 'Ecken', get: (s) => s.corners },
  { label: 'Fouls', get: (s) => s.fouls },
  { label: 'Gelbe Karten', get: (s) => s.yellow },
  { label: 'Rote Karten', get: (s) => s.red },
];

function goalLine(result: MatchResult, g: GoalInfo): HTMLElement {
  const name = nameOn(result, g.side, g.scorerId) || '–';
  const extra = g.penalty ? ' (Elfm.)' : g.ownGoal ? ' (ET)' : '';
  return h('div', { class: 'g' }, h('span', { class: 'min' }, `${g.clock}' `), `${name}${extra}`);
}

export function statsBoard(opts: {
  result: MatchResult;
  title: string;
  score: { home: number; away: number };
  stats: { home: TeamMatchStats; away: TeamMatchStats };
  goals: GoalInfo[];
  kits: { home: Kit; away: Kit };
  actions: { label: string; primary?: boolean; onClick: () => void }[];
}): HTMLElement {
  const { result, stats, kits } = opts;
  const rows = STATS.map((d) => {
    const a = d.get(stats.home);
    const b = d.get(stats.away);
    const tot = a + b;
    const pa = tot > 0 ? (100 * a) / tot : 0;
    const pb = tot > 0 ? (100 * b) / tot : 0;
    const f = d.fmt ?? ((v: number) => String(v));
    return h(
      'div',
      { class: 'stat-row' },
      h('span', { class: 'v home' }, f(a)),
      h(
        'div',
        { class: 'mid' },
        h('span', { class: 'lbl' }, d.label),
        h(
          'div',
          { class: 'bars', 'aria-hidden': 'true' },
          h('div', { class: 'bar home' }, h('span', { style: `width:${pa.toFixed(1)}%;background:${kits.home.primary}` })),
          h('div', { class: 'bar' }, h('span', { style: `width:${pb.toFixed(1)}%;background:${kits.away.primary}` })),
        ),
      ),
      h('span', { class: 'v' }, f(b)),
    );
  });
  const hg = opts.goals.filter((g) => g.side === 'home');
  const ag = opts.goals.filter((g) => g.side === 'away');
  return h(
    'div',
    { class: 'board-inner' },
    h('div', { class: 'board-head' }, h('h2', {}, opts.title), h('span', { class: 'meta' }, 'Simulation – kein echtes Spiel')),
    h(
      'div',
      { class: 'stats-score' },
      h('div', { class: 'tn home' }, result.home.name),
      h('div', { class: 'big' }, `${opts.score.home}–${opts.score.away}`),
      h('div', { class: 'tn' }, result.away.name),
    ),
    opts.goals.length
      ? h('div', { class: 'goal-list' }, h('div', { class: 'col home' }, ...hg.map((g) => goalLine(result, g))), h('div', { class: 'col' }, ...ag.map((g) => goalLine(result, g))))
      : null,
    h('div', { class: 'stat-rows' }, ...rows),
    h(
      'div',
      { class: 'board-actions' },
      ...opts.actions.map((a, i) => h('button', { class: `btn${a.primary ? ' primary' : ''}`, onclick: a.onClick, 'data-autofocus': i === 0 ? '1' : undefined }, a.label)),
    ),
  );
}
