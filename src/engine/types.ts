/**
 * Gemeinsame Datentypen für Engine, Daten und Darstellung.
 *
 * Koordinaten: Spielfeld 105 x 68 Meter. x = 0 ist die Torlinie der Heimmannschaft,
 * x = 105 die der Gastmannschaft (Heim greift also in Richtung x = 105 an, in Halbzeit 1).
 * y = 0 ist die obere Seitenlinie, y = 68 die untere. Die Engine rechnet immer in
 * diesem festen Koordinatensystem; Seitenwechsel zur Halbzeit spiegelt nur die Darstellung.
 */

export type TeamSide = 'home' | 'away';

export interface Vec2 {
  x: number;
  y: number;
}

/** Spielerwerte auf eigener Skala 1–99, relativ zur eigenen Epoche (siehe Skill player-rating-rubric). */
export interface PlayerAttributes {
  pace: number; // Tempo (Sprint)
  acceleration: number; // Antritt
  stamina: number; // Ausdauer
  strength: number; // Kraft / Körperlichkeit
  firstTouch: number; // Ballannahme / Technik
  dribbling: number;
  shortPassing: number;
  longPassing: number;
  crossing: number;
  finishing: number; // Abschluss
  longShots: number;
  heading: number; // Kopfball
  tackling: number; // Zweikampf / Tackling
  marking: number; // Deckung / Stellungsspiel defensiv
  positioning: number; // Laufwege offensiv
  vision: number; // Übersicht / Spielintelligenz
  composure: number; // Nervenstärke
  workRate: number; // Laufbereitschaft / Pressing
  // Torwart (bei Feldspielern niedrig)
  gkReflexes: number;
  gkHandling: number;
  gkPositioning: number; // Stellungsspiel / Strafraumbeherrschung
  gkDistribution: number; // Spieleröffnung
}

export type Position =
  | 'GK'
  | 'SW' // Libero
  | 'CB'
  | 'RB'
  | 'LB'
  | 'RWB'
  | 'LWB'
  | 'DM'
  | 'CM'
  | 'AM'
  | 'RM'
  | 'LM'
  | 'RW'
  | 'LW'
  | 'CF'
  | 'ST';

export interface Player {
  id: string; // Slug, z. B. "oliver-kahn"
  name: string; // Anzeigename
  shortName: string; // z. B. "Kahn"
  number: number; // Rückennummer in dieser Mannschaft
  positions: Position[]; // Hauptposition zuerst
  foot: 'left' | 'right' | 'both';
  heightCm?: number;
  overall: number; // Gesamtwert 1–99 (aus Rubrik)
  attributes: PlayerAttributes;
  /** Vertrauensstufe der Werte: hoch = mehrere Quellen, geschätzt = nur Faktenblatt */
  confidence: 'hoch' | 'mittel' | 'geschätzt';
  sources?: string[];
}

/** Rolle eines Spielers in der Aufstellung, steuert Laufwege und Entscheidungen. */
export type Role =
  | 'goalkeeper'
  | 'sweeper' // Libero hinter der Abwehr
  | 'stopper'
  | 'centre-back'
  | 'ball-playing-cb'
  | 'full-back'
  | 'wing-back'
  | 'inverted-full-back'
  | 'holding-mid'
  | 'deep-playmaker'
  | 'box-to-box'
  | 'advanced-playmaker'
  | 'shadow-striker'
  | 'wide-mid'
  | 'winger'
  | 'inside-forward'
  | 'target-man'
  | 'poacher'
  | 'complete-forward'
  | 'false-nine';

export interface LineupSlot {
  playerId: string;
  position: Position;
  role: Role;
  /** Grundposition im eigenen Team-Koordinatensystem (Angriff Richtung x = 105), in Ballbesitz */
  anchorAttack: Vec2;
  /** Grundposition gegen den Ball */
  anchorDefend: Vec2;
}

export interface Tactic {
  formation: string; // z. B. "3-5-2", "4-2-3-1"
  /** 0 = sehr tief, 1 = sehr hoch (Pressing-Startlinie) */
  pressingHeight: number;
  /** 0 = kaum Pressing, 1 = permanentes Gegenpressing */
  pressingIntensity: number;
  /** Höhe der Abwehrlinie: 0 = am Strafraum, 1 = Mittellinie */
  defensiveLine: number;
  /** 0 = eng, 1 = sehr breit */
  width: number;
  /** 0 = geduldiger Ballbesitz, 1 = sehr direkt / vertikal */
  directness: number;
  /** 0 = langsam, 1 = hohes Tempo */
  tempo: number;
  /** Neigung zu Flanken statt Kombination durchs Zentrum, 0–1 */
  crossingFocus: number;
  /** Konter nach Ballgewinn, 0–1 */
  counterAttack: number;
  /** Manndeckung statt Raumdeckung, 0–1 */
  manMarking: number;
  /** Abseitsfalle, 0–1 */
  offsideTrap: number;
  /** Zeitspiel/Verwalten bei Führung, 0–1 */
  gameManagement: number;
  freeKickTakers: string[];
  cornerTakers: string[];
  penaltyTakers: string[];
  captain: string;
}

export interface CoachProfile {
  name: string; // z. B. "Ottmar Hitzfeld"
  /** Typische Minute der ersten Einwechslung */
  firstSubMinute: number;
  /** Wie stark wird bei Rückstand offensiver umgestellt, 0–1 */
  aggressionWhenTrailing: number;
  /** Wie stark wird bei Führung defensiver umgestellt, 0–1 */
  cautionWhenLeading: number;
  maxSubs: number; // Regel der Epoche: 2001 = 3, 2020 = 5
}

export interface TeamSheet {
  id: string; // z. B. "bayern-2001"
  name: string; // "FC Bayern München 2000/01"
  shortName: string; // "Bayern 01"
  season: string; // "2000/01"
  era: number; // Jahr, z. B. 2001 (für Schiedsrichter- und Regel-Epoche)
  colors: { primary: string; secondary: string; numbers: string; gkPrimary: string };
  coach: CoachProfile;
  tactic: Tactic;
  lineup: LineupSlot[]; // genau 11
  bench: Player[];
  players: Player[]; // alle Spieler inkl. Startelf und Bank
  notes?: string;
}

export type EventType =
  | 'kickoff'
  | 'pass'
  | 'cross'
  | 'long-ball'
  | 'carry'
  | 'dribble'
  | 'shot'
  | 'header'
  | 'goal'
  | 'save'
  | 'block'
  | 'miss'
  | 'tackle'
  | 'interception'
  | 'clearance'
  | 'foul'
  | 'yellow-card'
  | 'red-card'
  | 'free-kick'
  | 'corner'
  | 'throw-in'
  | 'goal-kick'
  | 'penalty'
  | 'offside'
  | 'substitution'
  | 'half-time'
  | 'full-time';

export interface MatchEvent {
  /** Laufende Nummer, eindeutig */
  id: number;
  /** Spielzeit in Sekunden ab Anpfiff (Nachspielzeit fortlaufend, 1. HZ 0–~2820, 2. HZ ab 2700+…) */
  t: number;
  /** Dauer der Aktion in Sekunden (Ballflug, Dribbling …) */
  duration: number;
  half: 1 | 2;
  /** Angezeigte Spielminute, z. B. "45+2" */
  clock: string;
  type: EventType;
  team: TeamSide;
  playerId?: string;
  /** Mitspieler (Passempfänger), Gegenspieler (bei Zweikampf/Foul) oder eingewechselter Spieler */
  otherPlayerId?: string;
  /** Ballposition zu Beginn und am Ende der Aktion (feste Koordinaten, siehe oben) */
  from: Vec2;
  to: Vec2;
  /** Erfolgreich? (Pass angekommen, Dribbling gewonnen …) */
  success: boolean;
  /** Torwahrscheinlichkeit bei Schüssen */
  xg?: number;
  /** Ballhöhe für Darstellung: Boden, halbhoch, hoch */
  height?: 'ground' | 'mid' | 'high';
  /** Spielstand nach diesem Ereignis */
  score: { home: number; away: number };
  /** Optionaler kurzer Text für Ticker (deutsch) */
  text?: string;
}

export interface PlayerMatchStats {
  playerId: string;
  team: TeamSide;
  minutes: number;
  passes: number;
  passesCompleted: number;
  shots: number;
  shotsOnTarget: number;
  goals: number;
  assists: number;
  tackles: number;
  interceptions: number;
  fouls: number;
  yellow: number;
  red: number;
  distanceKm?: number;
  rating: number; // Spielnote 1.0–6.0 (kicker-Stil)
}

export interface TeamMatchStats {
  possession: number; // 0–100
  shots: number;
  shotsOnTarget: number;
  xg: number;
  passes: number;
  passAccuracy: number; // 0–100
  corners: number;
  fouls: number;
  yellow: number;
  red: number;
  offsides: number;
}

export interface MatchResult {
  seed: number;
  engineVersion: string;
  home: TeamSheet;
  away: TeamSheet;
  events: MatchEvent[];
  score: { home: number; away: number };
  stats: { home: TeamMatchStats; away: TeamMatchStats };
  playerStats: PlayerMatchStats[];
  /** Anteil Druck/Angriffsmomentum pro Spielminute, -1 (Gast) bis +1 (Heim) */
  momentum: number[];
}
