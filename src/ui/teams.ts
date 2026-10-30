/**
 * Alle verfügbaren Mannschaften: JSON-Dateien aus src/data/teams/ (falls vorhanden),
 * sonst die zwei eingebauten Demo-Mannschaften.
 */

import type { TeamSheet } from '../engine/types';
import { DEMO_TEAMS } from '../viewer2d/demoTeams';

function isTeamSheet(v: unknown): v is TeamSheet {
  if (!v || typeof v !== 'object') return false;
  const t = v as Partial<TeamSheet>;
  return (
    typeof t.id === 'string' &&
    typeof t.name === 'string' &&
    Array.isArray(t.lineup) &&
    t.lineup.length === 11 &&
    Array.isArray(t.players) &&
    !!t.colors &&
    !!t.tactic &&
    !!t.coach
  );
}

export function loadTeams(): { teams: TeamSheet[]; demo: boolean } {
  const mods = import.meta.glob('../data/teams/*.json', { eager: true });
  const teams: TeamSheet[] = [];
  for (const key of Object.keys(mods).sort()) {
    const m = mods[key] as { default?: unknown } | unknown;
    const data = m && typeof m === 'object' && 'default' in m ? (m as { default: unknown }).default : m;
    if (isTeamSheet(data)) teams.push(data);
  }
  if (teams.length === 0) return { teams: [...DEMO_TEAMS], demo: true };
  return { teams, demo: false };
}
