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
- Die Testteams sind synthetisch. Die Kalibrierung muss mit den echten Bayern-2001/2020-Datensätzen wiederholt werden. (Erledigt in 0.2.0, siehe unten.)

## Engine 0.2.0 – Kalibrierung mit echten Mannschaften (Niveau-Invarianz)

### Problem
Bayern 2001 gegen Bayern 2020 ergab ≈ 5,4 Tore pro Spiel, und 2020 gewann 66 % (Messung über 200 Spiele: 2001 17,5 % / Remis 16 % / 2020 66,5 %, 17 bzw. 25 Schüsse). Ursache: Die Formeln vergleichen Fähigkeiten mit festen Ankern (z. B. `(skill − 72)/17`, `(skill − 70)/14`). Echte Werte liegen bei 79–84 im Schnitt (Testteams 63–68) und sind anders geformt: Abschluss 69/83 gegenüber 55, Flanken 72/86 gegenüber 60. Dadurch wurde jede Chance zu einer Großchance. Außerdem lag der Abstand der Einzelwerte zwischen beiden Teams bei 5,4 Punkten, der der Gesamtwerte (overall) aber nur bei 3,4. Daher kam die zu große Überlegenheit von 2020.

### Lösung (`src/engine/normalize.ts`)
1. **Mannschafts-Ausgleich:** Pro Spiel wird jede Mannschaft einheitlich verschoben, sodass der Abstand ihrer mittleren Feldspieler-Attribute dem Abstand der mittleren overall-Werte entspricht. Overall ist der kuratierte Gesamtwert aus mehreren Quellen. Das Profil innerhalb eines Teams bleibt unverändert.
2. **Gemeinsame Verschiebung je Attribut:** Beide Mannschaften werden um denselben Betrag je Attribut verschoben, bis ihr gemeinsamer Mittelwert dem Referenzprofil `REF_PROFILE` entspricht (Mittel der Kalibrier-Teams, Torwartwerte 80). Damit zählt nur noch die relative Stärke. Ein einheitliches +8 auf beide Teams ändert exakt nichts.
3. Torabschluss: Der Einfluss von Schütze und Torwart ist jetzt mit `softsign` gesättigt, sodass Extremwerte von 95–99 keine Torgarantie mehr bedeuten. Bei Flanken ist der Kopfballvorteil gesättigt, Standardflanken sind schwerer (−0,35), und Freistöße zwischen x = 68 und 82 werden nur noch zur Hälfte geflankt.
4. Flankenneigung je Rolle (`CROSS_ROLE`): Schienenspieler 1,6, Außenmittelfeld 1,4, Inside-Forward 0,5.
5. `xgBase` −1,1 → −1,2. Die Testmannschaft „Schwach“ hat jetzt Werte −6, damit Attribute und overall zusammenpassen.

### Vorher / nachher (Bayern 2001 – Bayern 2020, Heim/Gast gemischt)

| Wert | 0.1.0 | 0.2.0 (Test, 300 Spiele) | Ziel |
|---|---|---|---|
| Tore pro Spiel | 5,38 | 2,78 | 2,3–3,4 |
| Schüsse 2001 / 2020 | 17,3 / 24,7 | 11,5 / 12,9 | 9–18 |
| Siege 2001 / Remis / Siege 2020 | 17,5 / 16 / 66,5 % | 31,3 / 27,0 / 41,7 % | max. 55 %, Remis 18–32 % |
| Ballbesitz 2020 | 52,7 % | 52,8 % | > 50 % |
| hohe Ballgewinne 2020 / 2001 | – | 13,7 / 3,0 | 2020 deutlich mehr |
| Flanken 2001 / 2020 | 12,8 / 14,2 | 13,3 / 11,5 | 2001 mehr |
| Fouls 2001 / 2020 | 14,8 / 6,7 | 16,5 / 6,5 | 2001 mehr |
| Niveau-Invarianz (+8 auf alle Werte) | 5,38 → 6,09 Tore | 2,78 → 2,75 Tore | Δ < 0,4 |

Testteams (0.2.0): Tore 2,54, Schüsse 11,1 / 9,7, aufs Tor 4,2 / 3,6, Ecken 5,8 / 5,6, Gelb 3,8, Pässe 364 / 354, Passquote 80 / 79 %, Ballbesitz Heim 50,9 %, Favorit gewinnt 69,3 %. Alle Korridore eingehalten. Spiegelduelle: 2001 gegen 2001 ≈ 3,8 Tore, 2020 gegen 2020 ≈ 2,6 Tore.

### Offene Punkte
- Ein Spiegelduell 2001 gegen 2001 ergibt viele Tore (≈ 3,8): Flanken und Kopfbälle beider Teams treffen auf Manndecker. Das ist noch nicht durch einen Test abgedeckt.
- Die Normierung hängt vom overall-Wert in den Mannschaftsdateien ab. Falsche overall-Werte verschieben die Stärkeverhältnisse direkt.
- Einwechselspieler werden mit der Verschiebung ihrer Mannschaft normiert.

## 30.10.2026 – F02: 2D-Testansicht mit TV-Einblendungen (Viewer)

### Umfang
- `src/viewer2d/timeline.ts`: Wiedergabe-Zeitachse τ (2. Halbzeit lückenlos mit 8 s Pause angehängt), Uhr mit Nachspielzeit, Spielstand, Umrechnung τ ↔ Engine-Zeit (für `momentum`).
- `src/viewer2d/positions.ts`: Positions-Synthese. Ball rein aus den Ereignissen (Interpolation `from`→`to`, Bogen bei `mid`/`high`, rollender Ball bremst). 22 Spieler werden in 10-Hz-Schritten vorwärts simuliert (Höchsttempo nach `pace` 5,6–8,4 m/s, Beschleunigung 4,2 m/s²). Schnappschuss alle 5 s, damit Spulen schnell geht; Ergebnis ist unabhängig von Abfragereihenfolge. Ziele: Anker (Angriff/Abwehr je nach geglättetem Ballbesitz) + Verschiebung zum Ball, Kompaktheit über `defensiveLine`/`pressingIntensity`/`width`, Abseitslinie, Pressing der nächsten Verteidiger (Anzahl nach `pressingHeight`/`pressingIntensity`), Passempfänger läuft zum Zielpunkt, Ballführender am Ball. Standards: Anstoßformation, Ecke (Kopfballstarke in den Strafraum, Raumdeckung), gefährlicher Freistoß (Mauer 9,15 m), sonst 9,15 m Abstand, Elfmeter, Abstoß. Torjubel. Wechsel (Ein-/Auslaufen über die Seitenlinie), Rote Karte (Spieler geht). Seitenwechsel: nur Anzeige gespiegelt; zur 2. HZ stehen alle direkt in Anstoßformation (Bildschnitt).
- `src/viewer2d/renderer2d.ts`: Canvas-Draufsicht (Mähstreifen, korrekte Linien, Tore mit Netz, Spieler mit Nummern, TW in `gkPrimary`, Ball mit Schatten/Höhe/Spur, Ring + Namensschild am Ballführenden). DPR-bewusst, dreht im Hochformat auf 90°.
- `src/viewer2d/highlights.ts`: Highlight-Fenster (Tor, Rot, Elfmeter, Parade, Schuss ab xG 0,12; 10 s Vorlauf, überlappende zusammengelegt), Halbzeit-Statistik aus Ereignissen, Torliste.
- `src/viewer2d/demoTeams.ts`: zwei fiktive Demo-Teams („Rot 4-2-3-1“, „Weiß 3-5-2“), solange `src/data/teams/` leer ist.
- `src/ui/*`: Anzeigetafel, Bauchbinden (Tor/Karte/Wechsel), Aufstellungstafel mit Trainer, Halbzeit-/Abpfiff-Statistik mit Torliste, Momentum-Graph als Spulleiste mit Tormarken, Live-Ticker, Steuerung (Play/Pause, 1×–32×, Highlights, Neustart, Spiel-Nr., Zufall). Trikotkonflikt (z. B. Bayern gegen Bayern) → Gast in Zweitfarben (`kits.ts`). Mannschaften per `import.meta.glob('../data/teams/*.json')`. URL-Hash `#h=…&a=…&s=…` merkt Spiel.
- `src/main.ts` nutzt die echte Engine (`simulateMatch` aus `src/engine`); kein Stub nötig.
- Tests `tests/viewer-positions.test.ts` (15): Determinismus, Feldgrenzen ±3 m, 10–11 Spieler je Team, Ball = `from`/`to` an Ereignisgrenzen, Seitenwechsel, Tempo-Plausibilität, Highlights, Wechsel, Rot, Anstoßformation – jeweils mit synthetischem Spiel und echter Engine.

### Messwerte
- Vorberechnung eines ganzen Spiels: ≈ 0,6 s in Node (läuft im Browser schrittweise im Hintergrund).
- Ballführender im Mittel ≈ 1,3 m vom Ball, Passempfänger bei Ankunft ≈ 2,4 m.
- `dist-single/index.html` ≈ 112 kB (38 kB gzip).

### Bekannte Schwächen
- Laufwege sind regelbasiert, nicht taktisch „intelligent“; bei sehr schnellen Ballwechseln laufen Spieler dem Ball teils hinterher (Ballführender bis 1,3× Höchsttempo).
- Mehrere Ereignisse zum selben Zeitpunkt (Foul → Karte) überlappen; der Ball springt dann zum letzten.
- Highlight-Modus springt hart (kein Überblenden).
- Google-Font (Barlow Condensed) braucht Internet; offline greift eine Systemschrift.
- Optik nur per Screenshot geprüft – Andreas' Rückmeldung zum TV-Gefühl fehlt noch.

## 31.10.2026 – F04: Vorschau-Datei über CI (Status „wartet“)

### Umfang
- `.github/workflows/ci.yml`: zusätzlich `npm run build:single`, Prüfung `scripts/check-single.mjs`, Upload von `dist-single/index.html` als Actions-Artifact `fussball-simulator-vorschau` (30 Tage, privat). Außerdem `workflow_dispatch` für manuellen Start.
- `scripts/check-single.mjs`: genau eine Datei, kein externes `<script src>`, externe `<link>` nur Google Fonts, Hinweis „Simulation“ vorhanden, < 5 MB.
- `docs/VORSCHAU.md`: Anleitung für Andreas (Download, Öffnen auf iPhone/Android) und Optionen für einen festen Link.

### Prüfung
- typecheck, 55 Tests, build, build:single grün; `check-single`: ok (160 kB).
- `dist-single/index.html` per `file://` in Headless-Chromium geladen (1280×720 und 390×844): läuft, Aufstellung und Spielfeld sichtbar; einziger Fehler ist die nicht erreichbare Google-Schrift (erwartet, Systemschrift greift).

### Warum nicht „done“
- Abnahme verlangt einen Link. Ein Link heißt Veröffentlichung im Internet; GitHub Pages für private Repositories kostet (Pro), Alternativen (Cloudflare Pages/Netlify) sind öffentlich erreichbar. Beides ist Andreas' Entscheidung (CLAUDE.md Regeln 9/10). Status `wartet`, Frage im PR.
