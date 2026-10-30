# PROGRESS – technisches Protokoll

## Engine v0 (ENGINE_VERSION 0.1.0)

### Aufbau
- `src/engine/rng.ts` – mulberry32, Helfer `next/range/int/chance/pick/weightedIndex/weightedPick/normal` (Summe von 4 Gleichverteilungen, kein log/cos). `fork(label)` leitet per FNV-1a + fmix32 unabhängige Teil-Ströme ab. Die Engine nutzt getrennte Ströme `play`, `time`, `coach`, `referee`, damit neue Funktionen nicht alle Zufallszahlen verschieben.
- `src/engine/math.ts` – deterministische Mathematik: `expDet` (Bereichsreduktion + Taylor, nur Grundrechenarten), `logistic`, `logit` (Bisektion), Torwinkel ohne atan (`7,32·dx/d²`), Distanzen mit `Math.sqrt` (IEEE-exakt).
- `src/engine/strength.ts` – Rollengewichte (mit Ball / gegen den Ball) für alle 20 Rollen, Positions-Eignung, Zonenstärken 3 Drittel × 3 Kanäle (Spieler über Ankerpunkte weich auf Zonen verteilt), Pressingkraft, Aufbauqualität, Luftstärke (Abwehr: Mittel der 3 besten Kopfballspieler), Standardqualität, Torwart. Ermüdung: Rate je Minute aus Ausdauer, Laufbereitschaft, Pressing-Intensität/-Höhe und Tempo; senkt Tempo-/Laufwerte um bis zu 30 %, Technik um bis zu 10 % und die Pressingkraft des Teams.
- `src/engine/match.ts` – Ereignis-Engine (Klasse `MatchSim`), alle Kalibrierparameter zentral im Objekt `P`.
- `src/engine/rules.ts` – Epoche: Gelb pro Foul (1960: 3 % → 2020: 13,5 %, Karten erst ab 1970), Rot pro Foul, Foulneigung.
- `src/engine/postmatch.ts` – Spielnoten und Momentum.
- `src/engine/index.ts` – öffentliche API: `simulateMatch(home, away, seed, { halfLengthMinutes })`, `ENGINE_VERSION`, `createRng`, `isRestartType`, alle Typen.

### Ablauf
- Ballbesitzketten: Jeder Schritt wählt für den Ballführenden gewichtet zwischen Schuss, Kurzpass, langem Ball, Flanke, Ballführen und Dribbling. Die Gewichte hängen ab von Zone, Spielerwerten, Taktik (Direktheit, Flankenfokus, Breite, Tempo, Konter) und Gegnerdruck (Pressing-Höhe/-Intensität × Nähe des nächsten Gegners).
- Erfolg = logistische Funktion aus Fähigkeitsdifferenz, Druck, Passlänge, Zonenvorteil (eigene Angriffs- vs. gegnerische Abwehrstärke der Zielzone), Freiheit des Empfängers und Heimvorteil.
- Lange Bälle hinter die Abwehrkette: Erfolg aus Tempo des Stürmers gegen Verteidiger, Höhe der gegnerischen Linie und freiem Raum dahinter. Abseits vor allem bei hoher Linie und Abseitsfalle. Wird der Ball hinter die Kette gespielt, entsteht ein Durchbruch: Abschluss mit Bonus, oder der Verteidiger holt den Stürmer noch ein (40 %).
- Fehlpässe führen zu Abfangen, Einwurf oder Abstoß; misslungene Dribblings und Ballführungen zu Tackling (teils ins Seitenaus oder zur Ecke) oder Foul. Bei Fouls im Strafraum gibt es Elfmeter (deutlich seltener als außerhalb).
- Fouls entstehen pro Schritt, stärker bei Pressing, Manndeckung, Kontern (taktisches Foul: mehr Karten) und im letzten Drittel.
- Schüsse: xG aus Distanz und Winkel plus Zuschläge für Kopfball, Steilpass, Konter, Flanke flach, Abpraller, Freistoß und Elfmeter (0,76). Danach Block, dann Tor (xG bereinigt um Schütze vs. Torwart), Parade oder vorbei. Paraden werden festgehalten, zur Ecke geklärt oder prallen ab (Nachschuss möglich).
- Konter: nach Ballgewinn in der eigenen Hälfte, abhängig von `counterAttack` und der Höhe der gegnerischen Linie. Hohe Ballgewinne (eigenes Angriffsdrittel) lösen schnelles Umschalten aus.
- Trainer: Wechsel ab etwa `firstSubMinute`, verteilt bis Minute 85, bis `maxSubs`. Zuerst gehen müde und verwarnte Spieler. Bei Rückstand kommen offensive, bei Führung defensive Wechsel (`aggressionWhenTrailing`/`cautionWhenLeading`). Ab Minute 60 (Rückstand) bzw. 67 (Führung) wird die Taktik angepasst. Halbzeitwechsel sind möglich. Bei Rot für den Torwart kommt der Ersatztorwart.
- Zeit: Spielzeit des Balls aus Distanz/Geschwindigkeit (Pass ca. 12–18 m/s, Ballführen 5–8 m/s, Schuss 20–30 m/s), dazu Haltezeit je Ballkontakt (abhängig vom Tempo) und Totzeit bei Standards. Führende Teams spielen bei Standards spät auf Zeit (`gameManagement`). Nachspielzeit 1–4 bzw. 1–5 Minuten aus Toren, Wechseln, Karten, Fouls und Elfmetern. Abgepfiffen wird erst bei einer Unterbrechung oder wenn der Ball im Mittelfeld ist.
- Ereignisse sind lückenlos verkettet (`from` = vorheriges `to`, außer bei Standards). Feste Koordinaten: Heim greift immer Richtung x = 105 an.
- Ticker (deutsch, mit `shortName`): Anpfiff, Tor (mit Vorlage), Großchance (xG ≥ 0,3), Elfmeter, Karten, Wechsel, Halbzeit, Abpfiff.
- Statistik: Ballbesitz über Zeit am Ball. Spielnoten im kicker-Stil (Leistungspunkte je Mannschaftsteil standardisiert, Mittel ≈ 3,4, Raster 1,0–6,0 in 0,5-Schritten). Momentum pro Minute als geglättete, gewichtete Aktionen (Schüsse, Ecken, Aktionen im letzten Drittel), −1 bis +1.

### Kalibrierung (gemessen, `npm run calibrate`, deterministisch)
Testteams in `tests/fixtures/teams.ts` (frei erfunden): Pressing 4-2-3-1 (2020), Libero 3-5-2 (2001, Grundwerte −2 zum Ausgleich der stärkeren Profile), Schwach 4-4-2 (alle Werte −5).

500 Spiele, gleich starke Teams (Epoche 2020):

| Wert | gemessen | Korridor |
|---|---|---|
| Tore pro Spiel | 2,88 | 2,3–3,3 |
| Schüsse Heim / Gast | 12,0 / 10,7 | 9–17 |
| aufs Tor Heim / Gast | 4,5 / 4,0 | 3–7 |
| Ecken Heim / Gast | 5,95 / 5,96 | 3,5–7 |
| Gelbe Karten pro Spiel | 3,4 (Rot 0,14) | 2–6 |
| Pässe Heim / Gast | 363 / 350 | 300–650 |
| Passquote Heim / Gast | 80,5 % / 79,4 % | 70–90 % |
| Ballbesitz Heim | 51,0 % | 40–60 % |
| Ereignisse pro Spiel | ≈ 1320 | 800–1400 |
| Heimsiege / Remis | 42 % / 22 % | – |

- Favorit gegen Außenseiter (je 300 Spiele Heim/Auswärts): Favorit gewinnt 77,0 %, verliert 8,8 %.
- Taktik (je 200 Hin-/Rückspiele Pressing gegen Libero, beide Epoche 2020):
  - hohe Ballgewinne: Pressing 10,0, Libero 4,0
  - erfolgreiche Bälle in die Tiefe: gegen die hohe Linie 7,4, gegen die tiefe 3,2; Abseits gegen die Pressing-Elf 2,0, gegen die Libero-Elf 0,3
  - Manndeckung: Fouls Libero-Elf 13,2, Pressing-Elf 7,0; Dribblings gegen die Libero-Elf 82,7, gegen die Pressing-Elf 26,0
  - Flanken: Libero-Elf 9,8, Pressing-Elf 6,9; Pässe: 311 gegen 395
- Epochen (Libero gegen Libero): Gelb 1965: 0,0 / 1980: 2,2 / 2001: 3,0 pro Spiel.
- Stabilität: Bei drei verschiedenen Seed-Basen schwanken Tore zwischen 2,86 und 2,95 und Favoritensiege zwischen 72 und 76 %.
- Tempo: etwa 10–13 ms pro Spiel in Node (Grenze: 150 ms).

### Bekannte Schwächen / nächste Schritte
- Spielerpositionen werden nur grob aus Ankerpunkten und Ballposition geschätzt und dienen nur der Auswahl von Empfänger, Gegenspieler und Abfangendem. Echte Laufwege rechnet die Engine nicht. Der Viewer synthetisiert sie selbst.
- Die Ermüdung wirkt messbar, aber schwach. Pressing-Teams kassieren gegen Spielende nicht deutlich mehr Gegentore, weil die Wechsel frische Spieler bringen.
- Zu viele Dribblings gegen Manndeckung (≈ 80 pro Spiel). Das ist gewollt verstärkt, absolut aber eher hoch.
- Abseits: Gegen hohe Linien gibt es ≈ 4–5 pro Team und Spiel, gegen tiefe kaum welche. Ein Pass ins Abseits wird als Fehlpass gezählt.
- Ecken und Abstöße entstehen nur aus bestimmten Situationen (Block, Parade, geklärte Flanke, Grätsche an der Grundlinie). Abgefälschte Pässe gibt es nicht.
- Doppelte Unterzahl, Verletzungen, Elfmeterschießen und Verlängerung fehlen.
- Die Spielnoten-Normierung (`LINE_MEAN`/`LINE_SD` in `postmatch.ts`) ist auf die Testteams kalibriert. Bei echten Teams nachprüfen.
- Die Testteams sind synthetisch. Die Kalibrierung muss mit den echten Bayern-2001/2020-Datensätzen wiederholt werden.
