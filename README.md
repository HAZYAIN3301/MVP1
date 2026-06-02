# Toxikologie-Detektiv

Interaktive Web-Demo für eine Biologie-Präsentation über **Bioindikation** mit der biolumineszenten Meeresbakterie *Aliivibrio fischeri*.

Die Klasse scannt einen QR-Code und öffnet diese Seite. Die App lädt Fotos eines Dunkelbox-Experiments, misst die Helligkeit der Biolumineszenz über die Zeit, zeichnet eine **kinetische Kurve** und ordnet den Schadstoff anhand der Kurvenform einer von drei Klassen zu (Oxidationsmittel / Schwermetall / organischer Schadstoff).

## Lokal starten

```bash
python3 -m http.server 8080
```

Dann `http://localhost:8080` öffnen. **Wichtig:** über einen HTTP-Server starten, nicht per Doppelklick — die App liest Bildpixel über die Canvas-API, was bei `file://` aus Sicherheitsgründen blockiert ist.

## Eigene Fotos einsetzen

Die `photos/` enthalten zunächst synthetische Testbilder. Für echte Experiment-Fotos:

1. Sechs Aufnahmen im Dunkelbox machen (t = 0, 30 s, 1 min, 3 min, 5 min, 15 min).
2. Als `t000.png … t900.png` in `photos/` ablegen (gleiche Dateinamen, ersetzen).
3. Falls die Sensor-Lunke nicht zentriert im Bild liegt: `roi` in `photos/manifest.json` anpassen (`cx`, `cy`, `r` als Anteil 0–1).

Der restliche Code bleibt unverändert.

## Technik

- Vanilla HTML / CSS / JS, kein Build-Schritt, kein Backend
- [Chart.js](https://www.chartjs.org/) (CDN) für die Kurve
- Helligkeit via Canvas: mittlere Luminanz in kreisförmiger ROI minus Ecken-Hintergrund, normiert auf den ersten Frame
- Klassifizierung: euklidische Distanz zu drei Referenz-Profilen
- Mobile-first, läuft offline nach dem ersten Laden

## Struktur

```
.
├── index.html           # UI
├── style.css            # Dark-Theme, mobile-first
├── app.js               # Ablauf: Laden, Animation, Klassifizierung
├── imageProcessing.js   # Canvas → Helligkeit
├── photos/              # Test-Fotos + manifest.json
└── tools/
    ├── generate_test_photos.py   # synthetische Testbilder erzeugen
    └── verify_extraction.py      # Extraktion gegen Sollwerte prüfen
```

## Test-Tools

```bash
python3 tools/generate_test_photos.py   # erzeugt photos/t*.png
python3 tools/verify_extraction.py       # prüft die Helligkeits-Extraktion
```

---

*Schulprojekt · Profil Ökologie · 2026*
