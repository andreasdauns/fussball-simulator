/**
 * Zugriff auf den Bayern-Spielerstamm (alle Personen über alle Epochen).
 * Grundlage für den Elf-Baukasten (F07) und weitere Mannschaften (F06).
 */
import type { PlayerRegister, Position, RegisterEntry } from '../../engine/types';
import registerJson from './register.json';

export const playerRegister = registerJson as PlayerRegister;

const byId = new Map(playerRegister.players.map((e) => [e.id, e]));

export function findRegisterEntry(id: string): RegisterEntry | undefined {
  return byId.get(id);
}

/** Alle Personen, die eine Position spielen konnten (Haupt- oder Nebenposition). */
export function playersForPosition(pos: Position): RegisterEntry[] {
  return playerRegister.players.filter((e) => e.positions.includes(pos));
}

/** Alle Personen, die in einem Jahr für Bayern aktiv waren (nur vollständig erfasste Jahre). */
export function playersActiveIn(year: number): RegisterEntry[] {
  return playerRegister.players.filter(
    (e) => e.bayernFrom !== null && e.bayernTo !== null && e.bayernFrom <= year && year <= e.bayernTo,
  );
}
