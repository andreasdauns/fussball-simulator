---
name: broadcast-3d-conventions
description: Use whenever working on the 3D TV-style match view in src/viewer3d/ (Three.js scene, cameras, overlays, player models, animations, performance).
---

# 3D-Übertragung im TV-Look

Ziel: Es soll wirken wie eine Live-Übertragung (Sky-artig) – erreicht durch Bildregie, Grafik, Licht und Ton, nicht durch Fotorealismus.

## Reihenfolge
1. Bildregie und Einblendungen mit Platzhalter-Figuren fertigstellen, bevor Zeit in Animationen fließt.
2. Rasen (Mähstreifen), Flutlicht (ACES-Tonemapping), einfaches Stadion, Zuschauer per Instancing.
3. Figuren (Mixamo/Quaternius) mit Trikotfarben und Nummern, Animationen an Laufgeschwindigkeit gekoppelt, Aktionen auf den Ballkontakt getimt.
4. Wiederholungen (zweite Kamera, Zeitlupe) und Atmosphäre-Ton.

## Kamera
- Hauptkamera: erhöht auf Höhe der Mittellinie, folgt dem Ball mit Verzögerung und weichem Zoom; ca. 90 % der Spielzeit in dieser Totalen.
- Schnitte nur bei Toren, Großchancen, Standards; Wiederholung aus Hintertor- oder Gegenperspektive.
- Keine Nahaufnahmen von Gesichtern.

## Technik
- Three.js mit WebGL2 als Basis; WebGPU nur optional. Positionen kommen ausschließlich aus `src/viewer2d/positions.ts` (gleiche Logik wie 2D) – die 3D-Ansicht interpretiert nur.
- Qualitätsstufen „Hoch“ (Laptop) und „Niedrig“ (Handy/TV-Browser): Schatten, Postprocessing, Zuschauerdichte, Auflösung.
- Ziel: 60 fps auf Laptop, ≥ 30 fps auf Mittelklasse-Handy in „Niedrig“. Draw Calls über Instancing gering halten.
- Asset-Lizenzen gemäß Skill `legal-guardrails`, Herkunft in `CREDITS.md`.

## Prüfen
- Claude kann Optik schlecht beurteilen: nach visuellen Änderungen Screenshots/kurze Clips erzeugen und Andreas um Rückmeldung bitten (Frage im PR).
